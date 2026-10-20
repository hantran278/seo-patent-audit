// Offline test of the Jev backlink pass: mocked api.typesafe.ai (response shape from docs.typesafe.ai quickstart).
import fs from 'node:fs';
const realFetch = globalThis.fetch;
let calls = 0, gapCalls = 0, bad = false;
globalThis.fetch = async (url, opt = {}) => {
  if (String(url) === 'https://api.typesafe.ai/v1/systemone') {
    calls++;
    if (bad) return new Response(JSON.stringify({ detail: 'Invalid API key' }), { status: 401 });
    const body = JSON.parse(opt.body);
    const s = JSON.parse(body.state);
    // batched request: one entry per domain in s.domains, questions d<k>_<name>
    const answers = {};
    s.domains.forEach((d, k) => {
      const spammy = (d.authority_score ?? 50) < 6 || d.same_ip_subnet_domains >= 3;
      const unsure = !spammy && (d.authority_score ?? 50) < 15;
      answers['d' + k + '_spam'] = { type: 'noul', noul: spammy ? 0.93 : 0.08 };
      answers['d' + k + '_manipulative'] = { type: 'noul', noul: d.first_seen_in_spike_month ? 0.9 : 0.1 };
      answers['d' + k + '_site_type'] = { type: 'choice', choice: spammy ? 'directory' : 'blog', confidence: 0.7, probabilities: {} };
      answers['d' + k + '_relevance'] = { type: 'score', score: spammy ? 0 : 2, confidence: 0.8, probabilities: {} };
      answers['d' + k + '_verdict'] = { type: 'choice', choice: spammy ? 'DISAVOW' : unsure ? 'REVIEW' : 'KEEP', confidence: unsure ? 0.3 : 0.85, probabilities: {} };
      // link-gap relevance pass (g<k>_ questions): "book" domains are on-niche, "spam" ones are scrapers
      answers['g' + k + '_relevance'] = { type: 'score', score: /book|read|novel/.test(d.domain) ? 0.9 : 0.1, confidence: 0.7, probabilities: {} };
      answers['g' + k + '_site_type'] = { type: 'choice', choice: /spam|seo|stat/.test(d.domain) ? 'stats_scraper' : 'blog', confidence: 0.7, probabilities: {} };
    });
    if (s.task.startsWith('Link-building')) gapCalls++;
    if (!Object.keys(body.questions).every((q) => q in answers)) throw new Error('unexpected question ' + Object.keys(body.questions).find((q) => !(q in answers)));
    await new Promise((r) => setTimeout(r, 20));
    // ~ shared state once + ~200 tokens per domain
    return new Response(JSON.stringify({ model: 'jev-1.13.0', answers, usage: { input_tokens: 500 + 200 * s.domains.length, output_tokens: 60 } }));
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
// link gap relevance: scored, on-niche prospects first inside a kind, report column present
const { default: assert } = await import('node:assert/strict');
const G = B.gaps.find((g) => g.gap.length);
assert.ok(B.gapJev?.scored > 0 && gapCalls > 0, 'gap relevance scored');
assert.ok(G.gap.every((x, i, a) => i === 0 || a[i - 1].kind !== x.kind || (a[i - 1].relevance ?? 0.5) >= 0.6 || (x.relevance ?? 0.5) < 0.6), 'on-niche first inside a kind');
assert.ok(r.html.includes('Liên quan ngách'));
console.log(`   link gap: Jev chấm ${B.gapJev.scored} domain · ${gapCalls} lần gọi · đầu danh sách: ${G.gap.slice(0, 3).map((x) => x.domain + ' ' + x.relevance).join(', ')}`);

calls = 0;
r = await runAudit({ ...base, jev: { key: 'k', budget: 0.001, threshold: 0.8 }, log: (m) => /Jev/.test(m) && console.log(m) });
console.log(`B) ngưỡng $0.001 → analysed ${r.data.backlinks.jev.analysed}/${r.data.backlinks.domains}, stoppedBy=${r.data.backlinks.jev.stoppedBy}`);

calls = 0; bad = true;
r = await runAudit({ ...base, jev: { key: 'wrong', budget: 1 }, log: (m) => /Jev/.test(m) && console.log(m) });
console.log(`C) key sai → method=${r.data.backlinks.method} · ${calls} calls · stoppedBy=${r.data.backlinks.jev.stoppedBy}`);
bad = false; calls = 0;
r = await runAudit({ ...base, log: () => {} });
console.log(`D) không có key → method=${r.data.backlinks.method} · ${calls} calls`);
