#!/usr/bin/env node
// SEO audit grounded in Google patents + technical checklist (CLI).
// usage: node audit.mjs <url> [--max 300] [--brand "Tên,biệt danh"] [--file a.csv --file b.csv …] [--out file.html]
//        (--file nhận GSC, Screaming Frog, Semrush, Ahrefs; --gsc / --backlinks vẫn dùng được)
//        [--checklist file.xlsx | --no-checklist] [--psi-key KEY | --no-psi] [--cache] [--json] [--delay 250]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCsv, parseCsvRows, decodeBuffer } from './lib/csv.mjs';
import { runAudit, DEFAULT_CHECKLIST } from './lib/run.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const url = args.find((a) => /^https?:\/\//.test(a));
if (!url) {
  console.log('Cách dùng: node audit.mjs https://example.com [--max 300] [--brand "Tên thương hiệu"] [--gsc gsc.csv] [--backlinks backlinks.csv] [--psi-key KEY] [--out report.html]');
  process.exit(1);
}

const host = new URL(url).host.replace(/^www\./, '');
const cacheFile = path.join(here, 'reports', host + '.crawl.json');
const probeFile = path.join(here, 'reports', host + '.probes.json');
const useCache = args.includes('--cache');
const out = opt('out', path.join(here, 'reports', `${host}-${new Date().toISOString().slice(0, 10)}.html`));
fs.mkdirSync(path.dirname(out), { recursive: true });

const checklistFile = args.includes('--no-checklist') ? null : opt('checklist', DEFAULT_CHECKLIST);
const res = await runAudit({
  url,
  brand: opt('brand', '').split(',').map((s) => s.trim()).filter(Boolean),
  maxPages: Number(opt('max', 300)), delay: Number(opt('delay', 250)), concurrency: Number(opt('concurrency', 4)),
  gscRows: opt('gsc') ? readCsv(opt('gsc')) : [],
  backlinkRows: opt('backlinks') ? readCsv(opt('backlinks')) : [],
  // --file can repeat: any GSC / Screaming Frog / Semrush / Ahrefs CSV, type is detected from its columns
  files: args.flatMap((a, i) => (a === '--file' ? [args[i + 1]] : [])).map((f) => ({ name: path.basename(f), ...parseCsvRows(decodeBuffer(fs.readFileSync(f))) })),
  checklistFile, psi: !args.includes('--no-psi'), psiKey: opt('psi-key', process.env.PSI_KEY || ''),
  site: useCache && fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')) : null,
  probes: useCache && fs.existsSync(probeFile) ? JSON.parse(fs.readFileSync(probeFile, 'utf8')) : null,
  xlsxOut: checklistFile ? out.replace(/\.html$/, '') + ' - ' + path.basename(checklistFile) : null,
});

fs.writeFileSync(cacheFile, JSON.stringify(res.site));
if (res.probes) fs.writeFileSync(probeFile, JSON.stringify(res.probes));
fs.writeFileSync(out, res.html);
if (args.includes('--json')) fs.writeFileSync(out.replace(/\.html$/, '.json'), JSON.stringify(res.data, null, 1));
const decisionsOut = out.replace(/\.html$/, '') + ' - Quyet dinh noi dung.xlsx';
if (res.decisionsXlsx) fs.writeFileSync(decisionsOut, res.decisionsXlsx);

console.log(`\nĐiểm tổng: ${res.score.overall}/100`);
for (const g of Object.values(res.score.groups)) console.log(`  ${g.priority} ${g.label.padEnd(30)} ${g.score === null ? '—' : g.score}  (${g.counts.high} cao · ${g.counts.medium} TB · ${g.counts.low} thấp)`);
console.log(`\n✓ Báo cáo: ${out}`);
if (checklistFile) console.log(`✓ Checklist đã điền: ${out.replace(/\.html$/, '')} - ${path.basename(checklistFile)}`);
if (res.decisionsXlsx) console.log(`✓ Bảng quyết định nội dung: ${decisionsOut}`);
