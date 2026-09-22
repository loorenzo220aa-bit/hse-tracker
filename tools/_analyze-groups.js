// Analyse group lists: duplicates, cross-group overlaps, match rate against employees
const fs = require('fs');
const raw = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const KEY = 'sb_publishable_0yFEikxwbqcW0zaKK27E0w_pHP_InLj';
const norm = s => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/–|—/g, '-');

(async () => {
  const r = await fetch('https://xdmngrosmblrqoirjaai.supabase.co/rest/v1/employees?select=num,ar,en,dept', { headers: { apikey: KEY, Authorization: 'Bearer ' + KEY } });
  const emps = await r.json();
  const byNum = new Map(emps.map(e => [norm(e.num), e]));

  const seen = new Map();
  for (const [g, rows] of Object.entries(raw)) {
    const ids = rows.map(x => norm(x.id));
    const dupIn = ids.filter((v, i) => ids.indexOf(v) !== i);
    let matched = 0, unmatched = [];
    for (const row of rows) {
      const k = norm(row.id);
      if (byNum.has(k)) matched++; else unmatched.push(row.id);
    }
    console.log(`\n${g}: ${rows.length} rows | matched ${matched} | unmatched ${rows.length - matched}`);
    if (dupIn.length) console.log('  duplicates inside group:', [...new Set(dupIn)]);
    if (unmatched.length) console.log('  unmatched ids:', unmatched.join(', '));
    rows.forEach(row => {
      const k = norm(row.id);
      if (seen.has(k)) console.log('  !! also in group', seen.get(k), '→', row.id, row.name);
      else seen.set(k, g);
    });
  }
  console.log('\nunique across all:', seen.size, '| employees in DB:', emps.length);
  const inDbNotInGroups = emps.filter(e => !seen.has(norm(e.num)));
  console.log('in DB but not in any group:', inDbNotInGroups.length, inDbNotInGroups.slice(0, 12).map(e => e.num).join(', '));
})();
