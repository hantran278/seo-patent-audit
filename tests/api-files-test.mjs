// Local end-to-end test of /api/audit with gzipped multi-file upload (uses the local test user from .env.local).
import fs from 'node:fs';
import { gzipSync } from 'node:zlib';
import { parseCsvRows, decodeBuffer } from '../lib/csv.mjs';

const base = 'http://localhost:' + (process.argv[2] || 3001);
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter(Boolean).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const [user, pass] = env.APP_USERS.split(';')[0].split(/:(.*)/s);
const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass }) });
const cookie = lr.headers.get('set-cookie').split(';')[0];
console.log('login', lr.status);

const dir = 'tests/fixtures/';
const files = ['internal_all', 'semrush_positions', 'ahrefs_backlinks', 'Queries', 'Pages', 'semrush_audit']
  .map((n) => ({ name: n + '.csv', ...parseCsvRows(decodeBuffer(fs.readFileSync(dir + n + '.csv'))) }));
const filesGz = gzipSync(JSON.stringify(files)).toString('base64');
const r = await fetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ url: 'https://books.toscrape.com/', maxPages: 20, psi: false, filesGz }) });
for (const line of (await r.text()).trim().split('\n')) {
  const m = JSON.parse(line);
  if (m.type === 'log') console.log('log:', m.message);
  else if (m.type === 'done') console.log('done:', m.host, 'score', m.score, 'html', m.html.length, 'has sources line', m.html.includes('Dữ liệu nhập:'));
  else console.log(m);
}
