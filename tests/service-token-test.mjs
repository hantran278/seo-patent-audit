// Service token for the SEO Tool backend (lib/auth.mjs serviceCaller + api/audit.js dataGz).
// Needs network: the "token ok" case crawls 10 pages of the public demo site books.toscrape.com (no PageSpeed).
// node tests/service-token-test.mjs
import { gunzipSync } from 'node:zlib';

process.env.SESSION_SECRET = 'x'.repeat(40);
const TOKEN = 't'.repeat(40);
const { serviceCaller, sessionCookie } = await import('../lib/auth.mjs');
const handler = (await import('../api/audit.js')).default;

let fail = 0;
const check = (name, ok, detail) => { console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok || detail === undefined ? '' : ' - ' + String(detail).slice(0, 300))); if (!ok) fail++; };
const req = (headers, body = {}) => ({ method: 'POST', headers, body });
/** Minimal res mock: collects status + NDJSON lines. */
function mockRes() {
  const r = { code: 200, lines: [], json: null };
  r.status = (c) => { r.code = c; return r; };
  r.json = (o) => { r.body = o; return r; };
  r.writeHead = (c) => { r.code = c; };
  r.write = (s) => { r.lines.push(...String(s).split('\n').filter(Boolean).map((l) => JSON.parse(l))); };
  r.end = () => r;
  return r;
}

// serviceCaller
delete process.env.SEO_TOOL_TOKENS;
check('không đặt SEO_TOOL_TOKENS → token bị từ chối', serviceCaller(req({ authorization: 'Bearer ' + TOKEN })) === null);
process.env.SEO_TOOL_TOKENS = 'short, ' + TOKEN;
check('token đúng → seo-tool', serviceCaller(req({ authorization: 'Bearer ' + TOKEN })) === 'seo-tool');
check('token sai → null', serviceCaller(req({ authorization: 'Bearer ' + 'u'.repeat(40) })) === null);
check('token ngắn trong danh sách (< 32 ký tự) không dùng được', serviceCaller(req({ authorization: 'Bearer short' })) === null);
check('thiếu header → null', serviceCaller(req({})) === null);

// handler: 401 paths
let res = mockRes();
await handler(req({ authorization: 'Bearer ' + 'u'.repeat(40) }, { url: 'https://books.toscrape.com/' }), res);
check('API: token sai → 401', res.code === 401, res.code);
res = mockRes();
await handler(req({}, { url: 'https://books.toscrape.com/' }), res);
check('API: không đăng nhập, không token → 401', res.code === 401, res.code);
res = mockRes();
await handler(req({ authorization: 'Bearer ' + TOKEN }, { url: 'http://127.0.0.1/' }), res);
check('API: token đúng nhưng URL nội bộ → 400 (chặn SSRF giữ nguyên)', res.code === 400, res.code);

// handler: token ok → done has dataGz with the full JSON
res = mockRes();
await handler(req({ authorization: 'Bearer ' + TOKEN }, { url: 'https://books.toscrape.com/', maxPages: 10, psi: false }), res);
const done = res.lines.find((l) => l.type === 'done');
let data = null;
try { data = JSON.parse(gunzipSync(Buffer.from(done.dataGz, 'base64')).toString('utf8')); } catch { /* checked below */ }
check('API: token đúng → done có dataGz giải nén ra JSON đầy đủ (site, score, issues, pages)',
  done && data && data.site.host === 'books.toscrape.com' && typeof data.score.overall === 'number' && Array.isArray(data.issues) && data.pages.length > 0,
  JSON.stringify(res.lines.filter((l) => l.type === 'error')));

// cookie session (web app) → no dataGz, as before
process.env.APP_USERS = 'tester:pw';
const cookie = sessionCookie('tester').split(';')[0];
res = mockRes();
await handler(req({ cookie }, { url: 'https://books.toscrape.com/', maxPages: 10, psi: false }), res);
const done2 = res.lines.find((l) => l.type === 'done');
check('API: đăng nhập cookie như cũ → chạy, KHÔNG có dataGz', done2 && done2.htmlGz && !('dataGz' in done2), JSON.stringify(res.lines.filter((l) => l.type === 'error')));

console.log(fail ? `\n${fail} ca SAI` : '\nTẤT CẢ ĐẠT');
process.exit(fail ? 1 : 0);
