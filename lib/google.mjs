// Google OAuth (per team member) + Search Console / GA4 data for the audit.
// Env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (OAuth "Web application" client), SESSION_SECRET (cookie encryption).
// The refresh token lives only in an encrypted HttpOnly cookie in that member's browser.
import crypto from 'node:crypto';

const SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/webmasters.readonly', 'https://www.googleapis.com/auth/analytics.readonly'];
const COOKIE = 'sa_google';
const STATE_COOKIE = 'sa_gstate';
const MAX_AGE = 180 * 24 * 3600;

export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const key = () => crypto.createHash('sha256').update((process.env.SESSION_SECRET || '') + ':google-token').digest();

function seal(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString('base64url');
}
function unseal(s) {
  try {
    const b = Buffer.from(s, 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }
}
const readCookie = (req, name) => (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(name + '='))?.slice(name.length + 1);
const cookie = (name, value, maxAge, path = '/') => `${name}=${value}; Path=${path}; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

export function baseUrl(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https');
  return `${proto}://${host}`;
}
const redirectUri = (req) => baseUrl(req) + '/api/google';

// ── OAuth ────────────────────────────────────────────────────────────────
// One Google consent both signs the member in (openid email) and grants read access to GSC/GA4.
// The consent screen is only forced when no refresh token is stored yet; later sign-ins just pick the account.
export function authStart(req, user = '', { forceConsent = false } = {}) {
  const nonce = crypto.randomBytes(16).toString('base64url');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: !forceConsent && connection(req) ? 'select_account' : 'consent', include_granted_scopes: 'true', state: `${nonce}.${user}`,
  });
  return { url: url.href, setCookie: cookie(STATE_COOKIE, nonce, 600, '/api/google') };
}

// → { email, cookies }. The id_token comes straight from Google's token endpoint over TLS (authenticated with
// our client secret), so its claims can be read without separate signature verification.
export async function authCallback(req, query) {
  const expected = readCookie(req, STATE_COOKIE);
  if (!query.code || !expected || !String(query.state || '').startsWith(expected + '.')) throw new Error('Phiên kết nối Google không hợp lệ hoặc đã hết hạn, hãy thử lại.');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code: query.code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: 'authorization_code' }) });
  const t = await r.json();
  if (!r.ok) throw new Error('Google từ chối đăng nhập: ' + (t.error_description || t.error || r.status));
  const claims = t.id_token ? JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()) : {};
  if (!claims.email || claims.email_verified === false) throw new Error('Không xác định được email Google đã xác minh.');
  const email = String(claims.email).toLowerCase();
  // no new refresh token when consent was skipped: keep the stored one if it belongs to the same account
  const prev = connection(req);
  const rt = t.refresh_token || (prev?.email === email ? prev.rt : null);
  const cookies = [cookie(STATE_COOKIE, '', 0, '/api/google')];
  if (rt) cookies.push(cookie(COOKIE, seal({ rt, email }), MAX_AGE));
  return { email, cookies, needsConsent: !rt };
}

export const disconnectCookie = () => cookie(COOKIE, '', 0);
export function connection(req) {
  const v = readCookie(req, COOKIE);
  return v ? unseal(v) : null;
}

async function accessToken(conn) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ refresh_token: conn.rt, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: 'refresh_token' }) });
  const t = await r.json();
  if (!r.ok) { const e = new Error('Kết nối Google đã hết hạn hoặc bị thu hồi, hãy kết nối lại.'); e.reauth = true; throw e; }
  return t.access_token;
}

async function gapi(token, url, body) {
  const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = j.error?.message || r.statusText;
    throw new Error(/has not been used|is disabled/i.test(msg) ? 'API Google chưa được bật trong Google Cloud project: ' + msg : msg);
  }
  return j;
}

// ── Property lists ───────────────────────────────────────────────────────
export async function listProperties(conn) {
  const token = await accessToken(conn);
  const [gsc, ga4] = await Promise.allSettled([
    gapi(token, 'https://www.googleapis.com/webmasters/v3/sites'),
    (async () => {
      const out = [];
      let pageToken = '';
      do {
        const j = await gapi(token, 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries?pageSize=200' + (pageToken ? '&pageToken=' + pageToken : ''));
        for (const a of j.accountSummaries || []) for (const p of a.propertySummaries || []) out.push({ id: p.property, name: `${p.displayName} (${a.displayName})` });
        pageToken = j.nextPageToken || '';
      } while (pageToken && out.length < 2000);
      return out;
    })(),
  ]);
  return {
    email: conn.email,
    gsc: gsc.status === 'fulfilled' ? (gsc.value.siteEntry || []).filter((s) => s.permissionLevel !== 'siteUnverifiedUser').map((s) => s.siteUrl).sort() : [],
    ga4: ga4.status === 'fulfilled' ? ga4.value.sort((a, b) => a.name.localeCompare(b.name)) : [],
    errors: [gsc, ga4].map((x, i) => x.status === 'rejected' ? `${i ? 'GA4' : 'Search Console'}: ${x.reason.message}` : null).filter(Boolean),
  };
}

// ── Data for the audit ───────────────────────────────────────────────────
const day = (d) => d.toISOString().slice(0, 10);
export function dateRange(days = 90) {
  const end = new Date(Date.now() - 3 * 864e5);   // GSC data lags ~2–3 days
  return { start: day(new Date(end - (days - 1) * 864e5)), end: day(end) };
}

// GSC query × page rows, shaped like a CSV export so normalizeGsc() reads them unchanged
export async function fetchGsc(conn, siteUrl, { days = 90, maxRows = 50000, log = () => {} } = {}) {
  const token = await accessToken(conn);
  const { start, end } = dateRange(days);
  const rows = [];
  for (let startRow = 0; startRow < maxRows; startRow += 25000) {
    const j = await gapi(token, `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`,
      { startDate: start, endDate: end, dimensions: ['query', 'page'], type: 'web', rowLimit: 25000, startRow, dataState: 'final' });
    for (const r of j.rows || []) rows.push({ query: r.keys[0], page: r.keys[1], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });
    if (!j.rows || j.rows.length < 25000) break;
  }
  log(`✓ Search Console (${siteUrl}, ${start} → ${end}): ${rows.length.toLocaleString('vi-VN')} dòng truy vấn × trang`);
  return rows;
}

// GA4 organic landing pages: sessions, engagement, key events
export async function fetchGa4(conn, property, { days = 90, log = () => {} } = {}) {
  const token = await accessToken(conn);
  const { start, end } = dateRange(days);
  const id = String(property).replace(/^properties\//, '');
  const j = await gapi(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
    dateRanges: [{ startDate: start, endDate: end }],
    dimensions: [{ name: 'landingPage' }, { name: 'hostName' }],
    metrics: [{ name: 'sessions' }, { name: 'engagedSessions' }, { name: 'keyEvents' }, { name: 'averageSessionDuration' }],
    dimensionFilter: { filter: { fieldName: 'sessionDefaultChannelGroup', stringFilter: { value: 'Organic Search' } } },
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 10000,
  });
  const rows = (j.rows || []).map((r) => {
    const [path, host] = r.dimensionValues.map((d) => d.value);
    const [sessions, engaged, keyEvents, dur] = r.metricValues.map((m) => Number(m.value) || 0);
    return { path, host, sessions, engagedSessions: engaged, engagementRate: sessions ? engaged / sessions : 0, keyEvents, avgDuration: dur };
  }).filter((r) => r.path && r.path !== '(not set)');
  log(`✓ GA4 (${property}, ${start} → ${end}): ${rows.length.toLocaleString('vi-VN')} landing page organic · ${rows.reduce((a, r) => a + r.sessions, 0).toLocaleString('vi-VN')} phiên`);
  // all channels (Direct share = brand demand / directFrac proxy); a failure here must not lose the organic rows
  try {
    const cj = await gapi(token, `https://analyticsdata.googleapis.com/v1beta/properties/${id}:runReport`, {
      dateRanges: [{ startDate: start, endDate: end }], dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }], limit: 50,
    });
    rows.channels = (cj.rows || []).map((r) => ({ channel: r.dimensionValues[0].value, sessions: Number(r.metricValues[0].value) || 0 }));
  } catch (e) { log('⚠ GA4 theo kênh: ' + e.message); }
  return rows;
}
