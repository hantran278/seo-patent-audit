import { checkPassword, sessionCookie, clearCookie, currentUser } from '../lib/auth.mjs';
import { disconnectCookie } from '../lib/google.mjs';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') { const user = currentUser(req); return res.status(200).json({ user, jevServerKey: !!user && !!process.env.JEV_API_KEY }); }
    // logging out also drops the Google connection (shared computers)
    if (req.method === 'DELETE') { res.setHeader('Set-Cookie', [clearCookie(), disconnectCookie()]); return res.status(200).json({ ok: true }); }
    if (req.method !== 'POST') return res.status(405).end();
    const { user = '', pass = '' } = req.body || {};
    if (!checkPassword(String(user).trim(), String(pass))) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return res.status(401).json({ error: 'Sai tài khoản hoặc mật khẩu.' });
    }
    res.setHeader('Set-Cookie', sessionCookie(String(user).trim()));
    return res.status(200).json({ user: String(user).trim() });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
