// TypeSafe Jev (System One) client + the backlink questions.
// API: POST https://api.typesafe.ai/v1/systemone, Bearer key; body { state, model, questions } → { answers, usage }.
// Docs: https://docs.typesafe.ai/introduction/quickstart.md
const API = 'https://api.typesafe.ai/v1/systemone';
export const JEV_PRICE_IN = 0.042 / 1e6;   // USD per input token (output is free)

export async function systemOne(key, state, questions, { model = 'jev-latest', timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(API, { method: 'POST', signal: ctrl.signal, headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' }, body: JSON.stringify({ state, model, questions }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error?.message || j.message || j.detail || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return j;
  } finally { clearTimeout(t); }
}

// Five questions per referring domain (same shape as the Choice / Score / Noul primitives)
const QUESTIONS = (niche) => ({
  spam: { type: 'noul', instructions: 'This referring domain is a link spam source: part of a private blog network (PBN), link farm, auto-generated or scraped content site, link directory, or a site that exists mainly to sell or exchange links.' },
  site_type: { type: 'choice', instructions: 'What kind of website is this referring domain most likely to be?', criteria: {
    publication: 'News site, magazine or editorial publication', business: 'Real business, brand, organisation or institution website', blog: 'Genuine personal or niche blog',
    community: 'Forum, Q&A, social or other user-generated content platform', directory: 'Link directory, listing or bookmarking site', stats_scraper: 'Website statistics / SEO checker / whois / scraper site that auto-generates pages about other domains',
    gambling_adult_pharma: 'Gambling, adult, pharmacy or similar high-risk content', parked_expired: 'Parked, expired, repurposed or abandoned domain', other: 'None of the above' } },
  relevance: { type: 'score', instructions: `How topically relevant is this referring domain to a website in this niche: ${niche || 'unknown niche'}`, criteria: ['Unrelated topic', 'Loosely related', 'Clearly related to the niche'] },
  manipulative: { type: 'noul', instructions: 'The link pattern looks manipulative: e.g. same IP network as many other linking domains, appeared in a sudden spike, very low authority with many links, or keyword-stuffed anchors.' },
  verdict: { type: 'choice', instructions: 'Recommended action for this referring domain in a backlink audit.', criteria: {
    DISAVOW: 'Clearly spammy or manipulative link source that should be added to the disavow file',
    REVIEW: 'Suspicious or unclear; a human should look at the linking page before deciding',
    RECHECK: 'Not enough information, or the link may no longer exist; re-crawl or re-export later',
    KEEP: 'Legitimate or harmless link source; keep it' } },
});

function stateFor(d, ctx) {
  return JSON.stringify({
    target_website: ctx.host, target_brand: ctx.brand.join(', ') || null, niche: ctx.niche || null,
    referring_domain: d.domain, authority_score: d.as, backlinks_from_domain: d.links, ip: d.ip, country: d.country,
    first_seen: d.firstSeen, last_seen: d.lastSeen,
    same_ip_subnet_domains: ctx.clusterOf.get(d.domain)?.domains.length || 0,
    first_seen_in_spike_month: !!(d.firstSeen && ctx.spikes.has(d.firstSeen.slice(0, 7))),
    sample_anchors: d.anchors.slice(0, 5), rule_based_signals: d.why,
  });
}

// Classify domains with Jev, concurrency-limited, stopping at the USD budget / deadline.
// Returns { analysed, calls, inputTokens, cost, stoppedBy, errors }. Mutates each analysed domain.
export async function jevClassify(domains, ctx, { key, budget = 1, threshold = 0.8, concurrency = 8, deadline = Infinity, log = () => {} }) {
  const stats = { analysed: 0, calls: 0, inputTokens: 0, outputTokens: 0, cost: 0, stoppedBy: null, errors: 0, lastError: null };
  const questions = QUESTIONS(ctx.niche);
  let i = 0;
  async function worker() {
    while (i < domains.length) {
      if (budget > 0 && stats.cost >= budget) { stats.stoppedBy ||= 'budget'; return; }
      if (Date.now() > deadline) { stats.stoppedBy ||= 'time'; return; }
      if (stats.errors >= 5 && stats.analysed === 0) { stats.stoppedBy ||= 'error'; return; }
      const d = domains[i++];
      try {
        const r = await systemOne(key, stateFor(d, ctx), questions);
        stats.calls++;
        stats.inputTokens += r.usage?.input_tokens || 0; stats.outputTokens += r.usage?.output_tokens || 0;
        stats.cost = stats.inputTokens * JEV_PRICE_IN;
        const a = r.answers || {};
        const spam = a.spam?.noul ?? null, manip = a.manipulative?.noul ?? null;
        const type = a.site_type?.choice, rel = a.relevance?.score, v = a.verdict?.choice, conf = a.verdict?.confidence ?? 0;
        let verdict = v || d.verdict;
        // screening: high spam probability → DISAVOW straight away; unsure verdicts go to a human
        if (spam !== null && spam >= threshold) verdict = 'DISAVOW';
        else if (verdict !== 'KEEP' && conf < 0.4) verdict = 'REVIEW';
        if (d.brandHit && verdict !== 'KEEP') verdict = 'REVIEW';
        d.rule = d.verdict;
        d.verdict = verdict;
        d.jev = { spam, manipulative: manip, siteType: type, relevance: rel, confidence: conf, model: r.model };
        d.why = [`Jev: ${verdict} (tin cậy ${Math.round(conf * 100)}%) · spam ${spam === null ? '—' : Math.round(spam * 100) + '%'} · loại site ${type || '—'} · liên quan ngách ${rel ?? '—'}/2`, ...d.why.filter((w) => !/^Jev:/.test(w))];
        stats.analysed++;
      } catch (e) {
        stats.errors++; stats.lastError = e.message;
        if (e.status === 401 || e.status === 403) { stats.stoppedBy = 'auth'; i = domains.length; return; }
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  log(`✓ Jev: ${stats.analysed}/${domains.length} domain · ${stats.calls} lần gọi · ${stats.inputTokens.toLocaleString('vi-VN')} token vào · ~$${stats.cost.toFixed(4)}${stats.stoppedBy ? ' · dừng do ' + ({ budget: 'chạm ngưỡng chi phí', time: 'hết thời gian', auth: 'API key không hợp lệ', error: 'lỗi API' })[stats.stoppedBy] : ''}${stats.lastError && !stats.analysed ? ' · lỗi: ' + stats.lastError : ''}`);
  return stats;
}
