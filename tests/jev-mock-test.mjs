// Offline test of the Jev backlink pass: mocked api.typesafe.ai (response shape from docs.typesafe.ai quickstart).
import fs from 'node:fs';
const realFetch = globalThis.fetch;
let calls = 0, bad = false;
globalThis.fetch = async (url, opt = {}) => {
  if (String(url) === 'https://api.typesafe.ai/v1/systemone') {
    calls++;
    if (bad) return new Response(JSON.stringify({ detail: 'Invalid API key' }), { status: 401 });
    const body = JSON.parse(opt.body);
    const s = JSON.parse(body.state);
    const spammy = (s.authority_score ?? 50) < 6 || s.same_ip_subnet_domains >= 3;
    const unsure = !spammy && (s.authority_score ?? 50) < 15;
    await new Promise((r) => setTimeout(r, 20));
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers: {
      spam: { type: 'noul', noul: spammy ? 0.93 : 0.08 },
      manipulative: { type: 'noul', noul: s.first_seen_in_spike_month ? 0.9 : 0.1 },
      site_type: { type: 'choice', choice: spammy ? 'directory' : 'blog', confidence: 0.7, probabilities: {} },
      relevance: { type: 'score', score: spammy ? 0 : 2, confidence: 0.8, probabilities: {} },
      verdict: { type: 'choice', choice: spammy ? 'DISAVOW' : unsure ? 'REVIEW' : 'KEEP', confidence: unsure ? 0.3 : 0.85, probabilities: {} },
    }, usage: { input_tokens: 880, output_tokens: 60 } }));
  }
  return realFetch(url, opt);
};
const { runAudit } = await import('../lib/run.mjs');
const { parseCsvRows, decodeBuffer } = await import('../lib/csv.mjs');
const site = await (await import('./_site.mjs')).demoSite();
const files = ['semrush_referring_domains', 'competitor_backlinks'].map((n) => ({ name: n + '.csv', ...parseCsvRows(decodeBuffer(fs.readFileSync(`tests/fixtures/${n}.csv`))) }));
const base = { url: 'https://books.toscrape.com/', site, files, brand: ['Books to Scrape', 'toscrape'], checklistFile: null };

let t = Date.now();
let r = await runAudit({ ...base, jev: { key: 'test-key', niche: 'online bookstore', budget: 1, threshold: 0.8 }, log: (m) => /Jev/.test(m) && console.log(m) });
let B = r.data.backlinks;
console.log(`A) Jev: method=${B.method} counts=${JSON.stringify(B.counts)} · ${calls} calls · ${Date.now() - t}ms`);
console.log('   ví dụ:', B.list.filter((d) => d.jev).slice(0, 2).map((d) => d.domain + ' → ' + d.verdict + ' | ' + d.why[0]).join('\n          '));
console.log('   brand mirror:', B.list.find((d) => d.domain === 'toscrape-books-mirror.com').verdict, '| disavow header:', B.disavowTxt.split('\n')[0]);
console.log('   report text:', r.html.includes('Nhãn do <b>Jev</b>'));

calls = 0;
r = await runAudit({ ...base, jev: { key: 'k', budget: 0.005, threshold: 0.8 }, log: (m) => /Jev/.test(m) && console.log(m) });
console.log(`B) ngưỡng $0.005 → analysed ${r.data.backlinks.jev.analysed}/${r.data.backlinks.domains}, stoppedBy=${r.data.backlinks.jev.stoppedBy}`);

calls = 0; bad = true;
r = await runAudit({ ...base, jev: { key: 'wrong', budget: 1 }, log: (m) => /Jev/.test(m) && console.log(m) });
console.log(`C) key sai → method=${r.data.backlinks.method} · ${calls} calls · stoppedBy=${r.data.backlinks.jev.stoppedBy}`);
bad = false; calls = 0;
r = await runAudit({ ...base, log: () => {} });
console.log(`D) không có key → method=${r.data.backlinks.method} · ${calls} calls`);
