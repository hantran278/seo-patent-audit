// Offline test of the Google integration: mocked Google APIs → lib/google.mjs → runAudit (cached crawl).
import fs from 'node:fs';
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'x'.repeat(40);
const B = 'https://books.toscrape.com';
const realFetch = globalThis.fetch;
const calls = [];
globalThis.fetch = async (url, opt = {}) => {
  url = String(url);
  calls.push((opt.method || 'GET') + ' ' + url.replace(/\?.*/, ''));
  const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return json({ access_token: 'ya29.test', expires_in: 3600 });
  if (url === 'https://www.googleapis.com/webmasters/v3/sites') return json({ siteEntry: [{ siteUrl: 'sc-domain:books.toscrape.com', permissionLevel: 'siteOwner' }, { siteUrl: 'https://other.com/', permissionLevel: 'siteUnverifiedUser' }] });
  if (url.includes('analyticsadmin.googleapis.com')) return json({ accountSummaries: [{ displayName: 'Demo', propertySummaries: [{ property: 'properties/123', displayName: 'Books to Scrape' }] }] });
  if (url.includes('/searchAnalytics/query')) {
    const body = JSON.parse(opt.body);
    const rows = body.startRow ? [] : Array.from({ length: 300 }, (_, i) => ({ keys: [`book query ${i}`, `${B}/catalogue/page-${(i % 20) + 1}.html`], clicks: Math.max(0, 40 - i % 40), impressions: 400 + i * 3, ctr: 0.05, position: 1 + (i % 25) }));
    return json({ rows });
  }
  if (url.includes('analyticsdata.googleapis.com')) return json({ rows: [
    ...Array.from({ length: 12 }, (_, i) => ({ dimensionValues: [{ value: `/catalogue/page-${i + 1}.html` }, { value: 'books.toscrape.com' }], metricValues: [{ value: String(900 - i * 50) }, { value: String(i < 4 ? 90 : 600 - i * 30) }, { value: i === 0 ? '0' : '3' }, { value: '45' }] })),
    { dimensionValues: [{ value: '/a-deleted-page/' }, { value: 'books.toscrape.com' }], metricValues: [{ value: '500' }, { value: '300' }, { value: '2' }, { value: '30' }] },
  ] });
  return realFetch(url, opt);
};

const g = await import('../lib/google.mjs');
const req = { headers: { host: 'seo-patent-audit.vercel.app', 'x-forwarded-proto': 'https', cookie: '' } };
const start = g.authStart(req, 'admin');
const u = new URL(start.url);
console.log('auth URL:', u.origin + u.pathname, '| redirect_uri =', u.searchParams.get('redirect_uri'), '| scopes =', u.searchParams.get('scope').split(' ').length, '| offline =', u.searchParams.get('access_type'));
// callback: wrong state rejected
req.headers.cookie = start.setCookie.split(';')[0];
try { await g.authCallback(req, { code: 'c', state: 'wrong.admin' }); console.log('state check: FAILED (accepted)'); } catch (e) { console.log('state check: rejected bad state ✓'); }
// sealed cookie round-trip via a fake token exchange
globalThis.fetch = ((orig) => async (url, opt) => String(url).startsWith('https://oauth2.googleapis.com/token') && String(opt.body).includes('authorization_code')
  ? new Response(JSON.stringify({ refresh_token: '1//rt', id_token: 'h.' + Buffer.from(JSON.stringify({ email: 'seo@enosta.com' })).toString('base64url') + '.s' }), { status: 200 })
  : orig(url, opt))(globalThis.fetch);
const { cookies } = await g.authCallback(req, { code: 'c', state: start.setCookie.split(';')[0].split('=')[1] + '.admin' });
const gcookie = cookies.find((c) => c.startsWith('sa_google='));
req.headers.cookie = gcookie.split(';')[0];
const conn = g.connection(req);
console.log('cookie round-trip:', conn?.email, conn?.rt === '1//rt' ? 'refresh token ✓' : 'FAIL', '| cookie size', gcookie.length);
console.log('tampered cookie →', g.connection({ headers: { cookie: req.headers.cookie.slice(0, -4) + 'AAAA' } }));

const props = await g.listProperties(conn);
console.log('properties:', JSON.stringify(props));
const gsc = await g.fetchGsc(conn, 'sc-domain:books.toscrape.com', { log: console.log });
const ga4 = await g.fetchGa4(conn, 'properties/123', { log: console.log });

const { runAudit } = await import('../lib/run.mjs');
const site = await (await import('./_site.mjs')).demoSite();
const r = await runAudit({ url: B + '/', site, gscRows: gsc, ga4Rows: ga4, sourcesExtra: [{ name: 'sc-domain:books.toscrape.com', kind: 'gsc', label: 'Search Console (API, 90 ngày)', rows: gsc.length }, { name: 'properties/123', kind: 'ga4', label: 'GA4 organic (API, 90 ngày)', rows: ga4.length }], checklistFile: null, log: () => {} });
for (const i of r.data.issues.filter((i) => /^(ga4|ranking|ctr|striking|cannibal)/.test(i.id))) console.log(`[${i.severity}] ${i.id}: ${i.title} | ${i.urls.slice(0, 2).map((u) => u.url.replace(B, '') + ' (' + u.note + ')').join(' ; ')}`);
console.log('user-signals score:', r.score.groups['user-signals'].score, '| report has GA4 line:', r.html.includes('GA4 organic (90 ngày)'), '| sources line:', r.html.includes('Search Console (API, 90 ngày)'));
console.log('Google calls:', [...new Set(calls)].join(' | '));
