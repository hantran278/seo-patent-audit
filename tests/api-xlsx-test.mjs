// Run an audit through the local web API and save the checklist xlsx exactly as the browser would download it.
// usage: node tests/api-xlsx-test.mjs [port] [out.xlsx]
import fs from 'node:fs';
const base = 'http://localhost:' + (process.argv[2] || 3001);
const out = process.argv[3] || 'reports/web-test.xlsx';
fs.mkdirSync('reports', { recursive: true });
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const [user, pass] = env.APP_USERS.split(';')[0].split(/:(.*)/s);
const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass }) });
const cookie = lr.headers.get('set-cookie').split(';')[0];
const r = await fetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ url: 'https://books.toscrape.com/', maxPages: 30, psi: false }) });
for (const line of (await r.text()).trim().split('\n')) {
  const m = JSON.parse(line);
  if (m.type === 'done') { const b = Buffer.from(m.xlsx, 'base64'); fs.writeFileSync(out, b); console.log('xlsx từ API:', b.length, 'bytes →', out); }
  if (m.type === 'error') console.log('error:', m.message);
}
