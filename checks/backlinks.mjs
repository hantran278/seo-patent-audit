// Referring-domain audit: groups backlink rows per domain, counts IP /24 clusters and monthly new-domain spikes
// (code only, no AI), then sorts every domain into DISAVOW / REVIEW / RECHECK / KEEP with the reasons behind it,
// and builds the disavow.txt draft. The verdict step is rule-based; an AI classifier (e.g. Jev) can replace
// `ruleVerdict` later and receive the same signals.
import { linkGap, rankGap, GAP_KINDS } from './linkgap.mjs';
import { issue } from './common.mjs';
import { pct } from '../lib/util.mjs';
import { jevClassify, jevRelevance, JEV_PRICE_IN } from '../lib/jev.mjs';

const GAP_JEV_MAX = 200;   // link-gap domains scored for niche relevance per run (~$0.002)

export const VERDICTS = ['DISAVOW', 'REVIEW', 'RECHECK', 'KEEP'];

const hostOf = (s) => { try { return new URL(/^https?:/.test(s) ? s : 'http://' + s).host.replace(/^www\./, '').toLowerCase(); } catch { return String(s).toLowerCase(); } };
const ipNum = (ip) => { const p = String(ip || '').split('.').map(Number); return p.length === 4 && p.every((x) => x >= 0 && x < 256) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null; };
// shared CDN / hosting front-ends: many unrelated sites sit on the same /24, so these never count as a "network"
const CDN = ['104.16.0.0/12', '172.64.0.0/13', '188.114.96.0/20', '162.158.0.0/15', '141.101.64.0/18', '108.162.192.0/18', '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '190.93.240.0/20', '197.234.240.0/22', '198.41.128.0/17', '131.0.72.0/22',
  '151.101.0.0/16', '199.232.0.0/16', '13.32.0.0/15', '13.224.0.0/14', '18.64.0.0/14', '52.84.0.0/15', '99.84.0.0/16', '143.204.0.0/16', '205.251.192.0/19', '142.250.0.0/15', '172.217.0.0/16', '216.58.192.0/19', '216.239.32.0/19', '192.178.0.0/15', '74.125.0.0/16', '185.199.108.0/22', '76.76.21.0/24', '75.2.0.0/17', '23.227.32.0/19']
  .map((c) => { const [ip, bits] = c.split('/'); return [ipNum(ip), Number(bits)]; });
export const isCdnIp = (ip) => { const n = ipNum(ip); return n !== null && CDN.some(([base, bits]) => (n >>> (32 - bits)) === (base >>> (32 - bits))); };
export const subnet24 = (ip) => (ipNum(ip) === null ? null : String(ip).split('.').slice(0, 3).join('.'));

const SPAM_NAME = /(casino|betting|sportsbook|\dbet|bet\d|slot(s|online|gacor|\d)|poker|baccarat|lottery|togel|judi|gacor|ufabet|888|sbobet|porn|sexy|xxx|nude|escort|viagra|cialis|pharmacy|payday|forex-?signal|crypto-?signal|essaywrit|backlink|seo-?(tool|stat|check|rank|link)|linkbuild|bookmark|directory|webcatalog|pbn)/;
const STAT_SITE = /(websiteoutlook|siteprice|statshow|sitelike|similarsites|hypestat|siteworth|webrate|domainstats|site-?analyzer|websitevalue|worthofweb|bigwebsitevalue|seositecheckup|robtex|urlscan|whois|ip-?address|dnslookup|sitesimilar|webstatsdomain|siteindices|websiteinformer|aboutus\.com|cutestat|website-?(stats|worth|value)|domain-?(stats|value|worth)|linkbacklink|backlinkchecker|seo-?stats|rankchart|sitesummary)/;
const SPAM_TLD = /\.(shop|store|monster|website|online|xyz|top|click|buzz|icu|site|space|fun|cyou|cfd|sbs|bond|lol|rest|beauty|hair|quest|pw|tk|ml|ga|cf|gq|work|live|life|today|world)$/;

// one record per referring domain
export function groupDomains(rows) {
  const m = new Map();
  for (const r of rows) {
    const d = hostOf(r.source);
    if (!d || !d.includes('.')) continue;
    const x = m.get(d) || { domain: d, rows: 0, links: 0, as: null, ip: null, country: null, firstSeen: null, lastSeen: null, nofollow: 0, lost: 0, sitewide: false, traffic: null, anchors: [], targets: new Set() };
    x.rows++;
    x.links += r.links ?? 1;
    if (r.dr !== null) x.as = Math.max(x.as ?? 0, r.dr);
    x.ip ||= r.ip; x.country ||= r.country || null;
    if (r.firstSeen && (!x.firstSeen || r.firstSeen < x.firstSeen)) x.firstSeen = r.firstSeen;
    if (r.lastSeen && (!x.lastSeen || r.lastSeen > x.lastSeen)) x.lastSeen = r.lastSeen;
    if (r.nofollow) x.nofollow++;
    if (r.lost) x.lost++;
    if (r.sitewide) x.sitewide = true;
    if (r.traffic !== null) x.traffic = Math.max(x.traffic ?? 0, r.traffic);
    if (r.anchor) x.anchors.push(r.anchor);
    if (r.target) x.targets.add(r.target);
    m.set(d, x);
  }
  return [...m.values()];
}

// code-only signals (0 token): IP /24 networks and months with an abnormal number of new referring domains
export function networkSignals(domains) {
  const subnets = new Map();
  for (const d of domains) {
    if (!d.ip || isCdnIp(d.ip)) continue;
    const s = subnet24(d.ip);
    if (s) subnets.set(s, [...(subnets.get(s) || []), d]);
  }
  const clusters = [...subnets.entries()].filter(([, ds]) => ds.length >= 3)
    .map(([net, ds]) => ({ net: net + '.x', domains: ds.map((d) => d.domain), avgAs: ds.some((d) => d.as !== null) ? Math.round(ds.reduce((a, d) => a + (d.as || 0), 0) / ds.length) : null }))
    .sort((a, b) => b.domains.length - a.domains.length);

  const byMonth = new Map();
  for (const d of domains) if (d.firstSeen) byMonth.set(d.firstSeen.slice(0, 7), (byMonth.get(d.firstSeen.slice(0, 7)) || 0) + 1);
  const months = [];
  if (byMonth.size) {
    const last = [...byMonth.keys()].sort().pop();
    const [y, mo] = last.split('-').map(Number);
    for (let i = 23; i >= 0; i--) { const dt = new Date(Date.UTC(y, mo - 1 - i, 1)); const k = dt.toISOString().slice(0, 7); months.push({ month: k, count: byMonth.get(k) || 0 }); }
  }
  const sorted = months.map((m) => m.count).sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const nonzero = months.filter((m) => m.count).map((m) => m.count);
  const base = Math.max(median, nonzero.length ? nonzero.reduce((a, b) => a + b, 0) / nonzero.length : 0);
  const spikes = months.filter((m) => m.count >= 15 && m.count > 3 * Math.max(base, 2)).map((m) => m.month);
  return { clusters, months, spikes };
}

export function ruleVerdict(d, ctx) {
  const why = [];
  let score = 0;
  const name = d.domain;
  if (STAT_SITE.test(name)) { score += 4; why.push('site thống kê/scraper tự động'); }
  if (SPAM_NAME.test(name)) { score += 3; why.push('tên miền chứa từ khoá spam (cờ bạc, thuốc, SEO/link…)'); }
  if (SPAM_TLD.test(name)) { score += 1.5; why.push('đuôi tên miền hay bị dùng cho spam'); }
  const cluster = ctx.clusterOf.get(name);
  if (cluster) { score += cluster.domains.length >= 8 ? 3 : 2; why.push(`cùng mạng ${cluster.net} với ${cluster.domains.length - 1} domain khác`); }
  if (d.firstSeen && ctx.spikes.has(d.firstSeen.slice(0, 7))) { score += 1.5; why.push(`xuất hiện trong tháng tăng đột biến ${d.firstSeen.slice(0, 7)}`); }
  if (d.as !== null) {
    if (d.as < 5) { score += 2; why.push(`AS/DR rất thấp (${d.as})`); }
    else if (d.as < 15) { score += 1; why.push(`AS/DR thấp (${d.as})`); }
    else if (d.as >= 50) { score -= 3; why.push(`AS/DR cao (${d.as})`); }
    else if (d.as >= 30) { score -= 2; why.push(`AS/DR khá (${d.as})`); }
  }
  if (d.links >= 200 && (d.as ?? 0) < 10) { score += 1.5; why.push(`${d.links} backlink từ một domain yếu (link sitewide)`); }
  if (d.traffic !== null && d.traffic > 1000) { score -= 1; why.push(`có traffic (${d.traffic.toLocaleString('vi-VN')})`); }

  d.brandHit = ctx.brandTokens.some((t) => t && name.includes(t));
  if ((d.as === null || d.as < 30) && d.brandHit) return { verdict: 'REVIEW', score, why: ['tên miền chứa token thương hiệu (site của mình hoặc site giả mạo/scraper)', ...why] };
  const stale = d.lastSeen && ctx.today - new Date(d.lastSeen) > 90 * 864e5;
  if (d.lost && d.lost === d.rows) return { verdict: 'RECHECK', score, why: ['các link từ domain này đã mất (lost)', ...why] };
  if (score >= 4) return { verdict: 'DISAVOW', score, why };
  if (stale) return { verdict: 'RECHECK', score, why: [`lần cuối thấy link ${d.lastSeen}, có thể đã mất`, ...why] };
  if (d.as === null && !d.ip) return { verdict: 'RECHECK', score, why: ['thiếu dữ liệu AS/DR và IP', ...why] };
  if (score >= 2) return { verdict: 'REVIEW', score, why };
  return { verdict: 'KEEP', score, why: why.length ? why : ['không có dấu hiệu bất thường'] };
}

export async function backlinkAudit(rows, site, { sf = [], today = new Date(), jev = null } = {}) {
  const out = [];
  if (!rows.length) return out;
  const own = bare(site.host);
  // split own backlinks from competitor files (target URL on another host)
  const byTarget = new Map();
  for (const r of rows) { const t = r.target ? hostOf(r.target) : r.site ? bare(r.site) : own; const k = t === own || t.endsWith('.' + own) ? own : t; byTarget.set(k, [...(byTarget.get(k) || []), r]); }
  const mine = byTarget.get(own) || [];
  const competitors = [...byTarget.entries()].filter(([k]) => k !== own);

  const domains = groupDomains(mine);
  const net = networkSignals(domains);
  const clusterOf = new Map(net.clusters.flatMap((c) => c.domains.map((d) => [d, c])));
  // brand tokens come from the "Tên thương hiệu" field (the domain label is only a fallback when it is distinctive)
  const deacc = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
  const given = (site.brand || []).flatMap((b) => [deacc(b).replace(/[^a-z0-9]/g, ''), deacc(b).replace(/[^a-z0-9]+/g, '-')]);
  const brandTokens = [...new Set(given.length ? given : [own.split('.')[0]])].filter((t) => t.length >= 6 || (given.length && t.length >= 4));
  const ctx = { clusterOf, spikes: new Set(net.spikes), brandTokens, today };
  for (const d of domains) Object.assign(d, ruleVerdict(d, ctx));
  // optional AI pass (Jev): rule signals become part of the state; unanalysed domains keep the rule verdict
  let jevStats = null;
  // no niche typed in: describe the site with its homepage title + meta description, so relevance is judged against something
  const home = site.pages?.find((p) => p.url === site.start) || site.pages?.find((p) => { try { return new URL(p.url).pathname === '/'; } catch { return false; } });
  const niche = String(jev?.niche || '').trim() || [home?.title, home?.metaDesc].filter(Boolean).join(' · ').slice(0, 300);
  if (jev?.key && !jev.niche && niche) jev.log?.(`  ngách cho Jev lấy từ trang chủ: "${niche.slice(0, 120)}"`);
  if (jev?.key && domains.length) {
    // ~400 input tokens per domain when batched 10 per request (one domain per request measured ~1,000 on a real 14k-domain run)
    jev.log?.(`▶ Jev phân loại ${domains.length} referring domain của ${site.host} (ước tính ~$${(domains.length * 400 * 0.042 / 1e6).toFixed(3)}, ngưỡng spam ${jev.threshold ?? 0.8}, dừng khi tới $${jev.budget ?? 1})…`);
    jevStats = await jevClassify(domains, { ...ctx, host: site.host, brand: site.brand || [], niche }, jev);
  }
  domains.sort((a, b) => VERDICTS.indexOf(a.verdict) - VERDICTS.indexOf(b.verdict) || b.score - a.score);
  const counts = Object.fromEntries(VERDICTS.map((v) => [v, domains.filter((d) => d.verdict === v).length]));
  const disavow = domains.filter((d) => d.verdict === 'DISAVOW');

  // link gap: domains linking to a competitor but not to us
  const ownSet = new Set(domains.map((d) => d.domain));
  const { gaps, intersect } = linkGap(competitors.map(([host, rs]) => [host, groupDomains(rs)]), ownSet, { skip: (d) => SPAM_NAME.test(d) || STAT_SITE.test(d), maxList: Infinity });
  // Jev: niche relevance + site type for the head of the list (shared prospects first, then each competitor's top),
  // from what is left of the budget; spam / scraper / parked sites it spots are dropped, the rest re-ranked
  let gapJev = null;
  if (jev?.key && jevStats?.stoppedBy !== 'auth' && intersect.length + gaps.length) {
    const pick = new Map();
    for (const x of [...intersect, ...gaps.flatMap((g) => g.gap.slice(0, 60))]) if (pick.size < GAP_JEV_MAX && !pick.has(x.domain)) pick.set(x.domain, { domain: x.domain, as: x.as, kind: x.kind });
    const left = (jev.budget ?? 1) - (jevStats?.cost || 0);
    if (left > 0 && Date.now() < (jev.deadline ?? Infinity)) {
      jev.log?.(`▶ Jev chấm độ liên quan ngách cho ${pick.size} domain link gap (ước tính ~$${(pick.size * 150 * JEV_PRICE_IN).toFixed(4)})…`);
      gapJev = await jevRelevance([...pick.values()], { host: site.host, niche }, { key: jev.key, budget: Math.min(left, 0.05), deadline: jev.deadline, log: jev.log });
      const BAD = new Set(['stats_scraper', 'gambling_adult_pharma', 'parked_expired']);
      const tag = (x) => { const s = pick.get(x.domain); if (s && typeof s.relevance === 'number') { x.relevance = s.relevance; x.siteType = s.siteType; } return x; };
      const bad = (x) => BAD.has(x.siteType);
      for (const g of gaps) {
        g.gap.forEach(tag);
        const drop = g.gap.filter(bad).length;
        if (drop) { g.excluded['Jev: spam / site tự sinh / bỏ hoang'] = drop; g.gap = g.gap.filter((x) => !bad(x)); g.kept -= drop; for (const k of GAP_KINDS) g.byKind[k] = g.gap.filter((x) => x.kind === k).length; }
        g.gap.sort(rankGap);
      }
      intersect.forEach(tag);
      intersect.splice(0, intersect.length, ...intersect.filter((x) => !bad(x)).sort(rankGap));
    }
  }
  for (const g of gaps) g.gap = g.gap.slice(0, 300);
  intersect.splice(300);

  site.backlinkReport = {
    method: jevStats?.analysed ? 'jev' : 'rules', jev: jevStats, domains: domains.length, rows: mine.length, counts,
    hasAs: domains.some((d) => d.as !== null), hasIp: domains.some((d) => d.ip), hasDates: domains.some((d) => d.firstSeen),
    clusters: net.clusters.slice(0, 30), months: net.months, spikes: net.spikes,
    list: domains.slice(0, 3000).map((d) => ({ domain: d.domain, as: d.as, links: d.links, ip: d.ip, country: d.country, first: d.firstSeen, last: d.lastSeen, verdict: d.verdict, why: d.why, jev: !!d.jev })),
    disavowTxt: [`# ${site.host} · ${today.toISOString().slice(0, 10)} · ${disavow.length} domain đề xuất DISAVOW (${jevStats?.analysed ? `Jev ${jevStats.analysed} domain + quy tắc` : 'phân loại theo quy tắc'})`, '# RÀ SOÁT THỦ CÔNG TRƯỚC KHI UPLOAD lên Google Disavow Tool. Chỉ disavow khi có dấu hiệu link thao túng hoặc đã bị Manual Action.', ...disavow.map((d) => 'domain:' + d.domain)].join('\n'),
    gaps, intersect, gapJev,
  };

  if (disavow.length)
    out.push(issue('links', 'bl-disavow-candidates', pct(disavow.length, domains.length) > 30 ? 'high' : 'medium', `${disavow.length}/${domains.length} referring domain có dấu hiệu spam (đề xuất DISAVOW sau khi rà soát)`, {
      why: 'Google phân nhóm các trang link tới site theo chất lượng và giảm/bỏ giá trị link từ mạng thao túng; khi tỷ lệ link xấu quá lớn, cả site có thể bị đánh giá thấp. ' + (jevStats?.analysed ? `Nhãn do Jev phân loại (${jevStats.analysed} domain) kết hợp quy tắc: confidence không phải xác suất đúng, luôn rà soát trước khi disavow.` : 'Nhãn ở đây do quy tắc tự động gán: luôn rà soát trước khi disavow.'),
      fix: 'Mở tab Backlink → lọc DISAVOW → kiểm tra nhanh vài domain → tải disavow.txt và upload ở Google Search Console (Disavow links). Không disavow link từ site thật chỉ vì AS thấp.',
      patents: ['US9002832B1', 'US8825645B1', 'US9558233B1', 'US8719276B1'],
      urls: disavow.map((d) => ({ url: d.domain, note: d.why.join(' · ') })), total: domains.length }));

  if (net.spikes.length) {
    const peak = net.months.find((m) => m.month === net.spikes[net.spikes.length - 1]);
    out.push(issue('links', 'bl-new-domain-spike', 'medium', `Số referring domain mới tăng đột biến (${net.spikes.join(', ')}; cao nhất ${peak.count} domain/tháng)`, {
      why: 'Google theo dõi tốc độ xuất hiện link theo thời gian; tốc độ tăng bất thường so với lịch sử là dấu hiệu link nhân tạo (mua link, spam hoặc tấn công negative SEO).',
      fix: 'Đối chiếu với hoạt động marketing tháng đó (PR, chiến dịch). Nếu không chủ động xây link, rà soát nhóm domain mới trong tháng này và cân nhắc disavow phần spam.',
      patents: ['US7346839B2', 'US8244722B1'],
      urls: net.months.filter((m) => net.spikes.includes(m.month)).map((m) => ({ url: m.month, note: `${m.count} domain mới` })) }));
  }

  if (sf.length || site.pages.length) {
    const status = new Map([...site.pages.map((p) => [p.url.replace(/\/$/, ''), p.status]), ...sf.map((r) => [r.url.replace(/\/$/, ''), r.status])]);
    const broken = new Map();
    for (const r of mine) if (r.target) { const s = status.get(r.target.replace(/#.*$/, '').replace(/\/$/, '')); if (s >= 400) broken.set(r.target, [...(broken.get(r.target) || []), hostOf(r.source)]); }
    if (broken.size)
      out.push(issue('links', 'bl-broken-targets', 'high', `${broken.size} URL đang nhận backlink nhưng trả lỗi 4xx/5xx (mất giá trị link)`, {
        why: 'PageRank từ backlink chỉ truyền tới trang còn hoạt động; link trỏ vào trang lỗi là giá trị bị bỏ phí.',
        fix: 'Redirect 301 từng URL lỗi về trang thay thế liên quan nhất, hoặc khôi phục trang; với link giá trị cao, liên hệ site nguồn sửa link.',
        patents: ['US6285999B1', 'US7725452B1'],
        urls: [...broken.entries()].sort((a, b) => b[1].length - a[1].length).map(([u, ds]) => ({ url: u, note: `${ds.length} backlink · ${[...new Set(ds)].slice(0, 3).join(', ')}` })) }));
  }

  const toHome = mine.filter((r) => r.target && /^https?:\/\/[^/]+\/?$/.test(r.target)).length;
  const withTarget = mine.filter((r) => r.target).length;
  if (withTarget >= 30 && toHome / withTarget > 0.85)
    out.push(issue('links', 'bl-homepage-share', 'low', `${pct(toHome, withTarget)}% backlink trỏ về trang chủ`, {
      why: 'Link sâu tới trang dịch vụ/bài viết giúp PageRank và ngữ cảnh anchor tới đúng trang cần xếp hạng.',
      fix: 'Khi xây link/PR, ưu tiên trỏ tới trang dịch vụ, bài chuyên môn, nghiên cứu.', patents: ['US7716225B1', 'US6285999B1'], metric: toHome, total: withTarget }));

  const gapNote = (d) => `${d.kind}${typeof d.relevance === 'number' ? ` · liên quan ngách ${Math.round(d.relevance * 100)}%` : ''} · AS/DR ${d.as ?? '—'}${d.competitors ? ' · link tới ' + d.competitors.join(', ') : d.shared > 1 ? ` · link tới ${d.shared} đối thủ` : ''}`;
  const excludedText = (ex) => Object.entries(ex).map(([k, n]) => `${n} ${k}`).join(', ');
  const gapFix = 'Làm theo thứ tự: (1) danh bạ / đánh giá B2B: tạo hoặc hoàn thiện hồ sơ, xin review khách hàng; (2) báo chí / PR: pitch câu chuyện, số liệu, chuyên gia; (3) giáo dục / tổ chức: hội thảo, tài trợ, nghiên cứu chung; (4) blog / site khác: xem từng site có cùng ngành không trước khi tiếp cận. Ưu tiên domain đã link tới nhiều đối thủ: họ đã có thói quen link tới công ty cùng ngành.';
  if (intersect.length)
    out.push(issue('links', 'bl-link-intersect', 'low', `Link gap chung: ${intersect.length} domain link tới ≥ 2 đối thủ nhưng chưa link tới ${own}`, {
      why: 'Domain đã link tới nhiều công ty cùng ngành thường là danh bạ, báo chí hoặc cộng đồng của ngành, nên đây là nhóm dễ xin link nhất.',
      fix: gapFix, patents: ['US6285999B1', 'US7716225B1'],
      urls: intersect.slice(0, 200).map((d) => ({ url: d.domain, note: gapNote(d) })) }));
  for (const g of gaps.filter((x) => x.kept))
    out.push(issue('links', 'bl-link-gap-' + g.host.replace(/[^a-z0-9]+/g, '-'), 'info', `Link gap với ${g.host}: ${g.kept} domain có thể tiếp cận (${Object.entries(g.byKind).filter(([, n]) => n).map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ')})`, {
      why: `Đã loại ${excludedText(g.excluded) || '0 domain'} trong tổng ${g.total} domain link tới đối thủ, vì không xin link được bằng outreach hoặc giá trị thấp.`,
      fix: gapFix,
      urls: g.gap.slice(0, 200).map((d) => ({ url: d.domain, note: gapNote(d) })) }));
  return out;
}
const bare = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
