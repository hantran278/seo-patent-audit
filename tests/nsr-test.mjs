// NSR-style site quality: chunk evenness, folder standard, title vs queries, direct share, content decisions.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { nsrChecks, chunkOf } from '../checks/nsr.mjs';
import { renderReport } from '../lib/report.mjs';

const O = 'https://ex.com';
const pg = (path, words, extra = {}) => ({
  url: O + path, finalUrl: O + path, status: 200, type: 'text/html', title: extra.title || 'Guide ' + path, canonical: O + path,
  robotsMeta: '', words, headings: extra.noH2 ? [{ level: 1, text: 't' }] : [{ level: 1, text: 't' }, { level: 2, text: 's' }],
  schemaTypes: extra.noSchema ? [] : ['Article'], inlinks: Array.from({ length: extra.inl ?? 4 }, (_, i) => ({ from: O + '/src' + i })), links: [], ...extra,
});

assert.equal(chunkOf(O + '/insights/ai/foo/'), '/insights/ai/');
assert.equal(chunkOf(O + '/about-us'), '/');

// /insights/: 6 solid posts, 1 far below standard, 1 near-duplicate, 1 off-topic, 1 thin orphan
const pages = [
  pg('/', 900),
  ...['a', 'b', 'c', 'd', 'e', 'f'].map((s) => pg(`/insights/${s}`, 1200, { title: 'AI strategy consulting guide ' + s })),
  pg('/insights/weak', 300, { noSchema: true, noH2: true, inl: 1 }),
  pg('/insights/dup', 1100),
  pg('/insights/offtopic', 900),
  pg('/insights/orphan', 120, { inl: 0 }),
  pg('/insights/mismatch', 1000, { title: 'Our company news and updates' }),
];
const gsc = [
  { query: 'ai strategy consulting', page: O + '/insights/a', clicks: 40, impressions: 900, position: 4 },
  { query: 'ai strategy consulting', page: O + '/insights/b', clicks: 2, impressions: 400, position: 9 },
  { query: 'mvp cost', page: O + '/insights/mismatch', clicks: 5, impressions: 300, position: 8 },
  { query: 'mvp development cost', page: O + '/insights/mismatch', clicks: 3, impressions: 200, position: 9 },
  { query: 'weak topic', page: O + '/insights/weak', clicks: 0, impressions: 60, position: 30 },
  { query: 'ai strategy consulting guide', page: O + '/insights/c', clicks: 12, impressions: 300, position: 6 },
];
const site = { start: O + '/', origin: O, host: 'ex.com', brand: ['enosta'], pages,
  nearDuplicatePairs: [{ a: O + '/insights/c', b: O + '/insights/dup', d: 2 }], offTopicPages: [O + '/insights/offtopic'] };
const ga4Rows = Object.assign([], { channels: [{ channel: 'Organic Search', sessions: 900 }, { channel: 'Direct', sessions: 60 }, { channel: 'Referral', sessions: 40 }] });

const issues = nsrChecks(site, gsc, { ga4Rows });
const by = Object.fromEntries(issues.map((i) => [i.id, i]));

// the weak post sits far below its folder (words, inlinks, schema, H2); healthy posts do not
assert.deepEqual(by['below-folder-standard'].urls.map((u) => u.url), [O + '/insights/weak', O + '/insights/orphan']);
assert.match(by['below-folder-standard'].urls[0].note, /không có schema/);
// title shares no word with the queries the page actually gets
assert.deepEqual(by['title-query-mismatch'].urls.map((u) => u.url), [O + '/insights/mismatch']);
// direct share 6% of sessions
assert.match(by['direct-traffic-share'].title, /6%/);
assert.equal(by['direct-traffic-share'].severity, 'low');
// /insights/ mixes strong pages with many zero-click ones
assert.match(by['chunk-quality-uneven'].urls[0].note, /0 click/);

const D = Object.fromEntries(site.contentDecisions.map((r) => [r.url.replace(O, ''), r]));
assert.equal(D['/insights/dup'].decision, 'Gộp + 301');
assert.match(D['/insights/dup'].reasons, /\/insights\/c/);
assert.equal(D['/insights/b'].decision, 'Viết lại', 'loses "ai strategy consulting" to /a but is not thin');
assert.match(D['/insights/b'].reasons, /\/insights\/a/);
assert.equal(D['/insights/offtopic'].decision, 'Xem lại chủ đề');
assert.equal(D['/insights/orphan'].decision, 'Noindex / Xoá + 301');
assert.equal(D['/insights/weak'].decision, 'Viết lại');
assert.match(D['/insights/weak'].reasons, /60 lượt hiển thị/);
assert.equal(D['/insights/mismatch'].decision, 'Giữ, sửa title');
assert.equal(D['/insights/a'].decision, 'Giữ');
assert.equal(D['/'], undefined, 'homepage is not a clean-up candidate');

// without GSC the table still works, and says so
const site2 = { ...site, contentDecisions: undefined, belowStandard: undefined };
nsrChecks(site2, []);
assert.ok(site2.contentDecisions.every((r) => r.clicks === null && /chưa có dữ liệu GSC/.test(r.reasons)));
assert.equal(site2.contentDecisions.find((r) => r.url.endsWith('/orphan')).decision, 'Viết lại', 'no GSC: cannot prove zero demand, so no noindex');

// the report with a decisions tab must still be valid JavaScript
const html = renderReport({
  meta: { date: 'x', patentCount: 0, vault: '', version: 1, web: true }, site: { url: O, host: 'ex.com', crawled: pages.length, indexable: pages.length, sitemapCount: 0, brand: [] },
  sources: [], ga4: null, backlinks: null, score: { overall: 80, groups: {} }, groups: {}, issues: [], patents: {}, pages: [], gsc: null, checklist: null,
  contentDecisions: site.contentDecisions,
});
for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
assert.match(html, /Quyết định nội dung/);

console.log('PASS NSR: chunk evenness, folder standard, title vs queries, direct share, content decisions (with and without GSC), report script valid');

// URL variants (trailing slash) are one page; utility/listing pages are not "thin articles"
const v = { start: O + '/', origin: O, host: 'ex.com', brand: [], pages: [
  pg('/', 900), pg('/works', 140, { inl: 9 }), pg('/works/', 140, { inl: 2 }), pg('/contact', 40),
  pg('/insights', 200, { links: Array.from({ length: 15 }, (_, i) => ({ href: O + '/insights/p' + i, main: true, text: 'Post ' + i })) }),
  ...['a', 'b', 'c', 'd', 'e'].map((s) => pg('/insights/' + s, 1000)) ],
  nearDuplicatePairs: [{ a: O + '/works', b: O + '/works/', d: 0 }] };
nsrChecks(v, []);
const V = Object.fromEntries(v.contentDecisions.map((r) => [r.url.replace(O, ''), r]));
assert.equal(V['/works/'].decision, 'Gộp biến thể URL');
assert.match(V['/works/'].reasons, /ex\.com\/works /);
assert.notEqual(V['/works'].decision, 'Gộp + 301', 'a page is never merged into itself');
assert.equal(V['/contact'].decision, 'Giữ'); assert.match(V['/contact'].reasons, /tiện ích/);
assert.equal(V['/insights'].decision, 'Giữ', 'a listing page with many links is not a thin article');
console.log('PASS NSR: URL variants and utility/listing pages');
// a URL that 301s to its canonical form is not a variant, a duplicate or a decision row
const r = { start: O + '/', origin: O, host: 'ex.com', brand: [], pages: [pg('/', 900), pg('/works', 900), { ...pg('/works/', 900), finalUrl: O + '/works', chain: [{ url: O + '/works/', status: 301 }] }] };
nsrChecks(r, []);
assert.deepEqual(r.contentDecisions.map((x) => x.url), [O + '/works']);
console.log('PASS NSR: redirected URLs ignored');

// run log tab: present, script still valid, progress regex and newline escapes survive the template
const html2 = renderReport({
  meta: { date: 'x', patentCount: 0, vault: '', version: 1, web: true }, site: { url: O, host: 'ex.com', crawled: 1, indexable: 1, sitemapCount: 0, brand: [] },
  sources: [], ga4: null, backlinks: null, score: { overall: 80, groups: {} }, groups: {}, issues: [], patents: {}, pages: [], gsc: null, checklist: null, contentDecisions: [],
  runLog: [{ t: 1000, m: 'ℹ Đầu vào: thương hiệu "Enosta"' }, { t: 2000, m: '  crawled 50 pages…' }, { t: 65000, m: '⚠ GA4: quota' }],
});
for (const m of html2.matchAll(/<script>([\s\S]*?)<\/script>/g)) new vm.Script(m[1]);
assert.match(html2, /Nhật ký chạy/);
assert.ok(html2.includes(String.raw`/^\s*crawled \d+ pages/`), 'regex escapes kept in the output');
assert.ok(html2.includes(String.raw`.join('\n')`), 'newline escape kept in the output');
console.log('PASS run log tab');

// competitor referring-domain exports (no target column) are recognised from the file name
import { classifyFiles } from '../lib/sources.mjs';
const hdr = ['Domain', 'Domain rating', 'Dofollow links'];
const imp = classifyFiles([
  { name: 'andersenlab.com-backlinks_refdomains.csv', header: hdr, rows: [['a.com', '50', '3']] },
  { name: 'www.enosta.com_refdomains.csv', header: hdr, rows: [['b.com', '40', '1']] },
  { name: 'backlinks.csv', header: hdr, rows: [['c.com', '30', '1']] },
]);
assert.deepEqual(imp.backlinks.map((r) => r.site || ''), ['andersenlab.com', 'enosta.com', '']);
console.log('PASS backlink files: competitor site taken from the file name');
// GSC Links "Top linking sites" export (Site · Linking pages · Target pages), English and Vietnamese UI
const gscLinks = classifyFiles([
  { name: 'https___enosta.com_-Top linking sites-2026-10-20.csv', header: ['Site', 'Linking pages', 'Target pages'], rows: [['krowdbase.com', '885', '1']] },
  { name: 'gsc-lien-ket.csv', header: ['Trang web', 'Trang liên kết', 'Trang đích'], rows: [['goodfirms.co', '183', '1']] },
]);
assert.deepEqual(gscLinks.summary.map((s) => s.kind), ['backlinks', 'backlinks']);
assert.deepEqual(gscLinks.backlinks.map((r) => [r.source, r.links, r.site || '']), [['krowdbase.com', 885, 'enosta.com'], ['goodfirms.co', 183, '']]);
console.log('PASS GSC top linking sites export detected');
