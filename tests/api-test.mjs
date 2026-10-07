// Local API smoke test against the dev server (uses the local test user from .env.local).
// usage: node tests/api-test.mjs [port] [maxPages]     (maxPages > 500 → full-site multi-batch mode)
import fs from 'node:fs';
import { gunzipSync } from 'node:zlib';
const base = 'http://localhost:' + (process.argv[2] || 3001);
const maxPages = Number(process.argv[3] || 30);
const env = Object.fromEntries(fs.readFileSync('.env.local', 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((l) => /^[A-Z_]+=/.test(l)).map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, '')]; }));
const [user, pass] = env.APP_USERS.split(';')[0].split(/:(.*)/s);
const lr = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ user, pass }) });
const cookie = lr.headers.get('set-cookie').split(';')[0];
console.log('login', lr.status);
async function call(body) {
  const r = await fetch(base + '/api/audit', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify(body) });
  let last = null;
  for (const line of (await r.text()).trim().split('\n')) {
    const m = JSON.parse(line);
    if (m.type === 'log') console.log('log:', m.message);
    else if (m.type === 'error') throw new Error(m.message);
    else last = m;
  }
  return last;
}
const url = 'https://books.toscrape.com/';
const body = { url, maxPages, psi: false };
if (maxPages > 500) {
  let jobId = '', done = false;
  while (!done) { const b = await call({ url, maxPages, mode: 'batch', jobId }); console.log('batch:', JSON.stringify(b)); jobId = b.jobId; done = b.done; }
  body.jobId = jobId;
}
const m = await call(body);
const html = m.htmlGz ? gunzipSync(Buffer.from(m.htmlGz, 'base64')).toString('utf8') : m.html;
console.log('done:', m.host, 'score', m.score, 'html', html.length, 'xlsx', m.xlsx?.length, '| URL trong báo cáo:', (html.match(/(\d+) URL đã crawl/) || [])[1]);
