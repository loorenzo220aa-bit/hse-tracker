// Parse the three saved portal pages into {A:[{id,name}], B:[...], D:[...]}
const fs = require('fs');
const files = {
  A: 'C:\\Users\\USER\\Downloads\\Hyundai HSE Portal.html',
  B: 'C:\\Users\\USER\\Downloads\\Hyundai HSE PortalB.html',
  D: 'C:\\Users\\USER\\Downloads\\Hyundai HSE PortalD.html',
};
const strip = s => s.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
  .replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

const out = {};
for (const [g, f] of Object.entries(files)) {
  const html = fs.readFileSync(f, 'utf8');
  const rows = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m;
  while ((m = trRe.exec(html))) {
    const cells = [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => strip(c[1]));
    if (cells.length < 3) continue;
    // expected: #, ID, Name, Sessions, Scored, Avg %, Absent, Sick, Excused
    if (!/^\d+$/.test(cells[0])) continue;
    const id = cells[1], name = cells[2];
    if (!id || !name) continue;
    if (/^(ID|Name|#)$/i.test(id)) continue;
    rows.push({ n: +cells[0], id, name, sessions: cells[3], scored: cells[4], avg: cells[5], absent: cells[6], sick: cells[7], excused: cells[8] });
  }
  out[g] = rows;
  console.log(g, 'rows:', rows.length, '| first:', JSON.stringify(rows[0]), '| last:', JSON.stringify(rows[rows.length - 1]));
}
// id format breakdown
for (const [g, rows] of Object.entries(out)) {
  const fmt = {};
  rows.forEach(r => {
    const k = r.id.replace(/\d+/g, '#').replace(/\s+/g, '');
    fmt[k] = (fmt[k] || 0) + 1;
  });
  console.log(g, 'id formats:', JSON.stringify(fmt));
  const bad = rows.filter(r => !/^[A-Za-z]+ *- *\d+$/.test(r.id));
  if (bad.length) console.log(g, 'non-standard ids:', bad.slice(0, 5).map(b => b.id));
}
fs.writeFileSync(process.argv[2] || 'C:\\Users\\USER\\Documents\\Default Project\\_groups-raw.json', JSON.stringify(out, null, 1));
console.log('saved raw JSON');
