// Google sign-in + Search Console / GA4 connection.
//   GET  /api/google?action=start       → redirect to Google (sign-in for new visitors, or connect for logged-in members)
//   GET  /api/google?code=…&state=…     → OAuth callback (this URL is the redirect URI)
//   GET  /api/google?action=status      → { configured, signIn, connected, email }  (public: drives the login screen)
//   GET  /api/google?action=properties  → { gsc: [siteUrl], ga4: [{id,name}] }
//   DELETE /api/google                  → disconnect GSC/GA4 (keeps the tool session)
import { currentUser, sessionCookie, isAllowedEmail } from '../lib/auth.mjs';
import { googleConfigured, authStart, authCallback, connection, disconnectCookie, listProperties } from '../lib/google.mjs';

const page = (res, title, msg, ok) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<body style="font:15px/1.6 system-ui,sans-serif;max-width:520px;margin:15vh auto;padding:0 16px;color:#1c1c1a">
<h2 style="font-size:18px">${title}</h2><p>${msg}</p><p><a href="/">← Quay lại công cụ audit</a></p>
${ok ? '<script>setTimeout(()=>location.href="/",800)</script>' : ''}</body>`);
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const signInEnabled = () => googleConfigured() && !!(process.env.ALLOWED_EMAILS || '').trim();

export default async function handler(req, res) {
  const user = currentUser(req);
  const q = Object.fromEntries(new URL(req.url, 'http://x').searchParams);

  if (q.code || q.error) {   // OAuth callback
    if (q.error) return page(res.status(400), 'Chưa đăng nhập Google', q.error === 'access_denied' ? 'Bạn đã huỷ, hoặc email này chưa được thêm vào danh sách thử nghiệm của app Google.' : 'Google báo lỗi: ' + esc(q.error));
    try {
      const { email, cookies, needsConsent } = await authCallback(req, q);
      if (!user && !isAllowedEmail(email)) return page(res.status(403), 'Email chưa được cấp quyền', `Tài khoản <b>${esc(email)}</b> chưa có trong danh sách được phép dùng công cụ. Liên hệ quản trị để được thêm vào ALLOWED_EMAILS.`);
      if (!user) cookies.push(sessionCookie(email));
      res.setHeader('Set-Cookie', cookies);
      if (needsConsent) { res.statusCode = 302; res.setHeader('Location', '/api/google?action=start&consent=1'); return res.end(); }
      return page(res, user ? 'Đã kết nối Google' : 'Đã đăng nhập', 'Đang mở công cụ audit…', true);
    } catch (e) { return page(res.status(400), 'Đăng nhập Google thất bại', esc(e.message)); }
  }

  if (q.action === 'status') {
    const c = user ? connection(req) : null;
    return res.status(200).json({ configured: googleConfigured(), signIn: signInEnabled(), connected: !!c, email: c?.email || null });
  }
  if (q.action === 'start') {
    if (!googleConfigured()) return page(res.status(503), 'Chưa cấu hình Google', 'Thiếu GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET trên server.');
    if (!user && !signInEnabled()) return page(res.status(403), 'Chưa bật đăng nhập Google', 'Quản trị cần khai báo ALLOWED_EMAILS trên server.');
    const { url, setCookie } = authStart(req, user || '', { forceConsent: q.consent === '1' });
    res.setHeader('Set-Cookie', setCookie);
    res.statusCode = 302; res.setHeader('Location', url); return res.end();
  }

  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  if (req.method === 'DELETE') { res.setHeader('Set-Cookie', disconnectCookie()); return res.status(200).json({ ok: true }); }
  if (!googleConfigured()) return res.status(503).json({ error: 'Chưa cấu hình GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET trên server.' });
  if (q.action === 'properties') {
    const c = connection(req);
    if (!c) return res.status(401).json({ error: 'Chưa kết nối Google.', reauth: true });
    try { return res.status(200).json(await listProperties(c)); }
    catch (e) {
      if (e.reauth) res.setHeader('Set-Cookie', disconnectCookie());
      return res.status(e.reauth ? 401 : 502).json({ error: e.message, reauth: !!e.reauth });
    }
  }
  return res.status(400).json({ error: 'action không hợp lệ.' });
}
