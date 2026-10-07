// Offline test of Google sign-in (api/google.js + api/login.js) with a mocked Google token endpoint.
process.env.GOOGLE_CLIENT_ID = 'test.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'secret';
process.env.SESSION_SECRET = 'y'.repeat(40);
process.env.APP_USERS = 'admin:pw123456';
process.env.ALLOWED_EMAILS = 'seo@enosta.com, @team.vn';

let next = {};   // what the mocked token endpoint returns
globalThis.fetch = async (url) => {
  if (String(url).startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'a', ...(next.rt ? { refresh_token: next.rt } : {}), id_token: 'h.' + Buffer.from(JSON.stringify({ email: next.email, email_verified: true })).toString('base64url') + '.s' }));
  throw new Error('unexpected fetch ' + url);
};
const { default: google } = await import('../api/google.js');
const { default: login } = await import('../api/login.js');
const { currentUser } = await import('../lib/auth.mjs');

let jar = {};
const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
function call(handler, url, method = 'GET') {
  return new Promise((resolve) => {
    const headers = {};
    const res = {
      statusCode: 200, body: '',
      setHeader(k, v) { headers[k.toLowerCase()] = v; if (k.toLowerCase() === 'set-cookie') for (const c of [].concat(v)) { const [kv, ...attrs] = c.split(';'); const [n, val] = kv.split('='); if (/Max-Age=0/.test(attrs.join(';'))) delete jar[n.trim()]; else jar[n.trim()] = val; } },
      status(c) { this.statusCode = c; return this; }, json(o) { this.body = JSON.stringify(o); resolve(this); return this; }, end(b = '') { this.body += b; resolve(this); return this; }, headers,
    };
    Promise.resolve(handler({ url, method, headers: { host: 'localhost:3000', cookie: cookieHeader() }, body: {} }, res));
  });
}
const who = () => currentUser({ headers: { cookie: cookieHeader() } });
const title = (r) => (r.body.match(/<h2[^>]*>(.*?)<\/h2>/) || [])[1] || r.body.slice(0, 80);
async function signIn(email, rt) {
  const s = await call(google, '/api/google?action=start');
  const loc = new URL(s.headers.location);
  next = { email, rt };
  const nonce = jar.sa_gstate;
  const cb = await call(google, `/api/google?code=c&state=${nonce}.${loc.searchParams.get('state').split('.')[1] || ''}`);
  return { prompt: loc.searchParams.get('prompt'), cb };
}

console.log('status (khách):', (await call(google, '/api/google?action=status')).body);
let r = await signIn('seo@enosta.com', 'rt-1');
console.log('1) seo@enosta.com →', r.cb.statusCode, title(r.cb), '| prompt', r.prompt, '| phiên:', who(), '| có cookie google:', !!jar.sa_google);
console.log('   status:', (await call(google, '/api/google?action=status')).body);
await call(login, '/api/login', 'DELETE');
console.log('2) đăng xuất → phiên:', who(), '| cookie google:', !!jar.sa_google);
r = await signIn('seo@enosta.com', 'rt-2');
console.log('3) đăng nhập lại (đã xoá google) → prompt', r.prompt, '| phiên:', who());
r = await signIn('seo@enosta.com', undefined);
console.log('4) lần sau (Google không trả refresh token) → prompt', r.prompt, '|', r.cb.statusCode, title(r.cb), '| giữ token cũ:', !!jar.sa_google);
r = await signIn('lan@team.vn', undefined);
console.log('5) đổi sang lan@team.vn không có token →', r.cb.statusCode, r.cb.headers.location || title(r.cb), '| phiên:', who());
await call(login, '/api/login', 'DELETE');
r = await signIn('hacker@gmail.com', 'rt-x');
console.log('6) email ngoài danh sách →', r.cb.statusCode, title(r.cb), '| phiên:', who());
r = await call(google, '/api/google?code=c&state=forged.');
console.log('7) state giả →', r.statusCode, title(r));
