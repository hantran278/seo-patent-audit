// POST /api/jev → one real Jev request on a made-up spammy domain, to check the key and show latency/cost (~$0.00002).
import { currentUser } from '../lib/auth.mjs';
import { systemOne, JEV_PRICE_IN } from '../lib/jev.mjs';

export default async function handler(req, res) {
  if (!currentUser(req)) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  if (req.method !== 'POST') return res.status(405).end();
  const key = String(req.body?.key || process.env.JEV_API_KEY || '').trim();
  if (!key) return res.status(400).json({ error: 'Chưa có API key (nhập key hoặc đặt JEV_API_KEY trên server).' });
  const domain = 'goldbacklinks-seo-boost.link';
  const t0 = Date.now();
  try {
    const r = await systemOne(key, JSON.stringify({ referring_domain: domain, authority_score: 1, backlinks_from_domain: 420, same_ip_subnet_domains: 27, first_seen_in_spike_month: true }), {
      spam: { type: 'noul', instructions: 'This referring domain is a link spam source (PBN, link farm, link directory or site that sells links).' },
      verdict: { type: 'choice', instructions: 'Recommended action in a backlink audit.', criteria: { DISAVOW: 'Spammy link source', REVIEW: 'Unclear, needs a human look', RECHECK: 'Not enough information', KEEP: 'Legitimate link source' } },
    }, { timeout: 15000 });
    const input = r.usage?.input_tokens || 0;
    return res.status(200).json({ model: r.model, domain, spam: r.answers?.spam?.noul ?? 0, verdict: r.answers?.verdict?.choice, inputTokens: input, cost: input * JEV_PRICE_IN, ms: Date.now() - t0 });
  } catch (e) {
    return res.status(e.status === 401 || e.status === 403 ? 400 : 502).json({ error: (e.status === 401 || e.status === 403 ? 'API key không hợp lệ: ' : 'Jev báo lỗi: ') + e.message });
  }
}
