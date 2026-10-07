// Build lib/patents.json from the patent research vault data (run again after adding analyses).
import fs from 'node:fs';
import path from 'node:path';

// usage: node build-patents.mjs [đường-dẫn-repo-nghiên-cứu]  (thư mục chứa patent-crawler/ và Google Patent Research/)
const ROOT = process.argv[2] || process.env.PATENT_RESEARCH_DIR || 'C:/Users/PC/Documents/Obsidian Vault';
const SRC = path.join(ROOT, 'patent-crawler');
const VAULT_NOTES = path.join(ROOT, 'Google Patent Research', '01 - Core Patents');
const load = (dir) => Object.assign({}, ...fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))));
const vi = load(path.join(SRC, 'data/vi'));
const an = load(path.join(SRC, 'data/analysis'));
const notes = fs.existsSync(VAULT_NOTES) ? fs.readdirSync(VAULT_NOTES) : [];

const out = {};
for (const f of fs.readdirSync(path.join(SRC, 'data/raw'))) {
  const p = JSON.parse(fs.readFileSync(path.join(SRC, 'data/raw', f), 'utf8'));
  const note = notes.find((n) => n.startsWith(p.id + ' - '));
  // family members without their own note point at the representative's note
  const repNote = note || notes.find((n) => fs.readFileSync(path.join(VAULT_NOTES, n), 'utf8').includes(`family: [`) && fs.readFileSync(path.join(VAULT_NOTES, n), 'utf8').match(/^family: .*$/m)?.[0].includes(p.id));
  const repId = repNote ? repNote.split(' - ')[0] : p.id;
  const a = an[p.id] || an[repId] || null;
  let mech = '';
  if (a) {
    for (const line of a.mech.split('\n')) {
      mech += (mech ? ' ' : '') + line.replace(/^\s*(-|\d+\.)\s*/, '').replace(/\*\*/g, '');
      if (mech.length > 140) break;
    }
  } else mech = (vi[p.id]?.a || vi[repId]?.a || '').slice(0, 220);
  out[p.id] = {
    title: vi[p.id]?.t || vi[repId]?.t || p.title,
    year: (p.priority_date || '').slice(0, 4),
    relevance: a?.relevance || null,
    mech: mech.length > 320 ? mech.slice(0, 317) + '…' : mech,
    note: repNote ? repNote.replace(/\.md$/, '') : null,
  };
}
fs.writeFileSync('lib/patents.json', JSON.stringify(out));
console.log('patents:', Object.keys(out).length, 'with notes:', Object.values(out).filter((x) => x.note).length);
