// Minimal team auth for the web app.
// APP_USERS="an:matkhau1;binh:matkhau2"  SESSION_SECRET=<random string ≥ 32 chars>
import crypto from 'node:crypto';

const COOKIE = 'sa_session';
const TTL = 7 * 24 * 3600 * 1000;

function users() {
  return Object.fromEntries((process.env.APP_USERS || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => { const i = s.indexOf(':'); return [s.slice(0, i).trim(), s.slice(i + 1)]; }));
}
const secret = () => {
  const s = process.env.SESSION_SECRET || '';
  if (s.length < 32) throw new Error('SESSION_SECRET chưa được cấu hình (cần ≥ 32 ký tự).');
  return s;
};
const sign = (v) => crypto.createHmac('sha256', secret()).update(v).digest('base64url');
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// Google sign-in allowlist: ALLOWED_EMAILS="a@gmail.com, b@x.com, @enosta.com" (an entry starting with @ allows the whole domain)
export function isAllowedEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e.includes('@')) return false;
  return (process.env.ALLOWED_EMAILS || '').split(/[;,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
    .some((a) => (a.startsWith('@') ? e.endsWith(a) : e === a));
}

export function checkPassword(user, pass) {
  const u = users();
  return Object.prototype.hasOwnProperty.call(u, user) && safeEq(u[user], pass);
}

export function sessionCookie(user) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + TTL })).toString('base64url');
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL / 1000}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Server-to-server caller (SEO Tool backend): Authorization: Bearer <token> matching one of SEO_TOOL_TOKENS
// (comma-separated, each ≥ 32 chars). Unset = feature off. Tokens live only in env, never in the repo.
export function serviceCaller(req) {
  const tokens = (process.env.SEO_TOOL_TOKENS || '').split(/[,;\s]+/).map((s) => s.trim()).filter((s) => s.length >= 32);
  const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
  if (!tokens.length || !m) return null;
  return tokens.some((t) => safeEq(t, m[1])) ? 'seo-tool' : null;
}

export function currentUser(req) {
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEq(sign(payload), sig)) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    // a session stays valid only while its user is still in APP_USERS or (Google sign-in) in ALLOWED_EMAILS
    return exp > Date.now() && (users()[u] !== undefined || isAllowedEmail(u)) ? u : null;
  } catch { return null; }
}
