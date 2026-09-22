const fs = require('fs');
const crypto = require('crypto');
const h = fs.readFileSync(process.argv[2], 'utf8');
const start = h.indexOf('const PWD_SALT=');
const end = h.indexOf('/* يقبل كلمة المرور');
const src = h.slice(start, end);
eval(src);

const vectors = ['', 'abc', 'hello world', 'علي123', 'كلمة-مرور-سريحة-جداً', 'a'.repeat(100), 'مرور', 'p@ssw0rd!'];
let ok = 0, bad = [];
for (const v of vectors) {
  const mine = sha256Hex(v);
  const ref = crypto.createHash('sha256').update(v, 'utf8').digest('hex');
  if (mine === ref) ok++; else bad.push(JSON.stringify(v) + '\n    mine: ' + mine + '\n    ref : ' + ref);
}
// known NIST vectors
const known = [
  ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
];
for (const [inp, want] of known) {
  if (sha256Hex(inp) === want) ok++; else bad.push('known vector failed for ' + JSON.stringify(inp));
}
console.log('SHA-256 vectors passed: ' + ok + '/' + (vectors.length + known.length));
if (bad.length) { console.log('FAILED:'); bad.forEach(b => console.log('  ' + b)); process.exit(1); }
console.log('hashPass sample format ok:', /^h\$HSE-Tracker-2026\$[0-9a-f]{64}$/.test(hashPass('test')), hashPass('test').slice(0, 30) + '...');
console.log('isHashed(plaintext):', isHashed('plain'), '| isHashed(hash):', isHashed(hashPass('plain')));
