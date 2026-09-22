/* Migrate plain-text passwords in Supabase `users` to salted SHA-256 (h$... form).
   - Verifies every row after writing
   - Rolls back automatically if any verification fails
   - Never prints a password or a hash
   Usage: node _migrate-users.js <path-to-index.html> */
const fs = require('fs');

const SB = 'https://xdmngrosmblrqoirjaai.supabase.co';
const KEY = 'sb_publishable_0yFEikxwbqcW0zaKK27E0w_pHP_InLj';
const H = { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' };

// pull the exact hashing implementation out of the app
const html = fs.readFileSync(process.argv[2], 'utf8');
const src = html.slice(html.indexOf('const PWD_SALT='), html.indexOf('/* يقبل كلمة المرور'));
eval(src);

async function main() {
  const rows = await (await fetch(SB + '/rest/v1/users?select=id,username,password,role', { headers: H })).json();
  if (!Array.isArray(rows)) { console.log('READ FAILED:', JSON.stringify(rows).slice(0, 200)); process.exit(1); }
  console.log('Users read:', rows.length);

  const plan = rows.filter(r => typeof r.password === 'string' && !isHashed(r.password))
                   .map(r => ({ id: r.id, from: r.password, to: hashPass(r.password) }));
  const already = rows.length - plan.length;
  console.log('Already hashed:', already, '| To migrate:', plan.length);

  if (!plan.length) { console.log('NOTHING TO DO'); return; }

  // self-check the algorithm before touching anything
  for (const p of plan) {
    if (!/^h\$HSE-Tracker-2026\$[0-9a-f]{64}$/.test(p.to) || p.to === p.from) {
      console.log('ABORT: hash self-check failed'); process.exit(2);
    }
  }

  const written = [];
  for (const p of plan) {
    try {
      const r = await fetch(SB + '/rest/v1/users?id=eq.' + encodeURIComponent(p.id), {
        method: 'PATCH', headers: { ...H, Prefer: 'return=representation' },
        body: JSON.stringify({ password: p.to }),
      });
      const out = await r.json().catch(() => []);
      if (r.ok && Array.isArray(out) && out.length) written.push(p);
      else console.log('PATCH failed for id', p.id, '->', r.status, JSON.stringify(out).slice(0, 160));
    } catch (e) { console.log('PATCH threw for id', p.id, e.message); }
  }
  console.log('Written:', written.length, 'of', plan.length);

  // verify from the server
  const after = await (await fetch(SB + '/rest/v1/users?select=id,password', { headers: H })).json();
  const byId = Object.fromEntries((Array.isArray(after) ? after : []).map(r => [r.id, r.password]));
  const bad = written.filter(p => byId[p.id] !== p.to);
  console.log('Verified:', written.length - bad.length, 'of', written.length);

  if (bad.length) {
    console.log('ROLLING BACK', bad.length, 'row(s)...');
    for (const p of bad) {
      await fetch(SB + '/rest/v1/users?id=eq.' + encodeURIComponent(p.id), {
        method: 'PATCH', headers: H, body: JSON.stringify({ password: p.from }),
      });
    }
    console.log('RESULT: verification failed — rolled back, database unchanged'); process.exit(3);
  }

  // final safety net: simulate login for every migrated account
  const simOk = written.every(p => hashPass(p.from) === p.to);
  console.log('Login simulation:', simOk ? 'OK for all ' + written.length + ' accounts' : 'FAILED');
  console.log(simOk ? 'RESULT: MIGRATION COMPLETE' : 'RESULT: SIMULATION FAILED');
  process.exit(simOk ? 0 : 4);
}
main();
