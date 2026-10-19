// Site-wide quality in the spirit of NSR (QualityNsrNsrData in the 2024 leak): quality is scored per site chunk
// (directory), uneven quality drags the chunk, new pages inherit the folder score unless they deviate from it.
// Leak field names have no published weights or thresholds: every threshold here is a proxy chosen by this tool.
import { issue, isIndexable } from './common.mjs';
import { tokenize, STOP } from '../lib/util.mjs';

const deaccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const terms = (t) => new Set(tokenize(deaccent(t)).filter((w) => !STOP.has(w) && w.length > 1));
const key = (u) => { try { const x = new URL(u); return (x.host.replace(/^www\./, '') + x.pathname).replace(/\/$/, '').toLowerCase(); } catch { return String(u || '').toLowerCase(); } };
const median = (a) => { const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
// site chunk = the page's directory: /insights/ai/foo -> /insights/ai/ ; /about-us -> /
export function chunkOf(url) {
  try { const p = new URL(url).pathname.replace(/\/$/, ''); const i = p.lastIndexOf('/'); return i <= 0 ? '/' : p.slice(0, i + 1); } catch { return '/'; }
}

// Per-page GSC totals and top queries (needs page rows; query rows are optional).
function gscByPage(gsc) {
  const m = new Map();
  for (const r of gsc) {
    if (!r.page) continue;
    const k = key(r.page);
    const e = m.get(k) || { clicks: 0, impressions: 0, queries: new Map() };
    e.clicks += r.clicks; e.impressions += r.impressions;
    if (r.query) { const q = e.queries.get(r.query) || { clicks: 0, impressions: 0 }; q.clicks += r.clicks; q.impressions += r.impressions; e.queries.set(r.query, q); }
    m.set(k, e);
  }
  return m;
}

// Utility and listing pages (contact, legal, hubs that mostly list links) are short by design: they are not held
// to the article standard for "thin" and "below folder standard".
const UTILITY = /\/(contact|contact-us|lien-he|privacy|privacy-policy|terms|terms-of-service|cookie|cookies|chinh-sach|dieu-khoan|sitemap|login|cart|checkout|thank-you|cam-on)(\/|$)|\/(page|tag|category|author)\/|\/page\/\d+/i;
export function isUtility(p) {
  const internalMain = (p.links || []).filter((l) => l.main && /^https?:/.test(l.href)).length;
  return UTILITY.test(p.url) || (p.words < 400 && internalMain >= 12);
}

export function nsrChecks(site, gsc = [], { ga4Rows = [] } = {}) {
  const out = [];
  // redirected URLs carry their target content and are not documents of their own
  const all = site.pages.filter(isIndexable).filter((p) => !(p.chain && p.chain.length) && key(p.url) !== key(site.start));
  if (!all.length) return out;
  // one representative per URL variant (trailing slash, www, http/https): the most linked one
  const reps = new Map();
  for (const p of all) { const k = key(p.url), r = reps.get(k); if (!r || (p.inlinks || []).length > (r.inlinks || []).length) reps.set(k, p); }
  const pages = [...reps.values()];
  const variants = all.filter((p) => reps.get(key(p.url)) !== p);
  const G = gscByPage(gsc);
  const hasPageGsc = G.size > 0;
  const hasQueryGsc = [...G.values()].some((e) => e.queries.size);
  const g = (p) => G.get(key(p.url)) || G.get(key(p.finalUrl)) || (hasPageGsc ? { clicks: 0, impressions: 0, queries: new Map() } : null);
  const inl = (p) => new Set((p.inlinks || []).map((l) => l.from)).size;

  // ── chunks (directories) ──
  const chunks = new Map();
  for (const p of pages.filter((x) => !isUtility(x))) { const c = chunkOf(p.url); (chunks.get(c) || chunks.set(c, []).get(c)).push(p); }
  const stats = new Map();
  for (const [c, list] of chunks) {
    stats.set(c, {
      n: list.length,
      words: median(list.map((p) => p.words)), inlinks: median(list.map(inl)),
      schemaShare: list.filter((p) => (p.schemaTypes || []).length).length / list.length,
      h2Share: list.filter((p) => (p.headings || []).some((h) => h.level === 2)).length / list.length,
    });
  }

  // A1/A2: uneven quality inside a chunk
  const uneven = [];
  for (const [c, list] of chunks) {
    if (list.length < 5) continue;
    const thin = list.filter((p) => p.words < 250).length;
    const zero = hasPageGsc ? list.filter((p) => g(p).clicks === 0).length : null;
    const strong = hasPageGsc ? list.filter((p) => g(p).clicks >= 10).length : null;
    const words = list.map((p) => p.words), mean = words.reduce((a, b) => a + b, 0) / words.length;
    const cv = mean ? Math.sqrt(words.reduce((a, w) => a + (w - mean) ** 2, 0) / words.length) / mean : 0;
    const reasons = [thin / list.length >= 0.3 && `${pct(thin, list.length)}% trang mỏng (< 250 từ)`, hasPageGsc && strong > 0 && zero / list.length >= 0.5 && `${pct(zero, list.length)}% trang 0 click trong khi ${strong} trang có ≥ 10 click`, cv >= 1 && `độ dài nội dung chênh rất lớn (hệ số biến thiên ${cv.toFixed(1)})`].filter(Boolean);
    if (reasons.length) uneven.push({ c, n: list.length, reasons });
  }
  if (uneven.length)
    out.push(issue('site-quality', 'chunk-quality-uneven', uneven.some((u) => u.reasons.length >= 2) ? 'high' : 'medium', `${uneven.length} thư mục có chất lượng không đồng đều giữa các trang`, { why: 'Google chấm chất lượng theo cả site và từng khu (site chunk, thường là thư mục). Theo leak 2024, độ chênh chất lượng (siteQualityStddev, chardVariance) là tín hiệu riêng: vài trang yếu cạnh trang tốt kéo điểm chung của cả khu. Ngưỡng ở đây do tool đặt, Google không công bố.', fix: 'Trong mỗi thư mục: nâng các trang yếu lên chuẩn của trang tốt nhất, gộp trang trùng ý, noindex hoặc xoá + 301 trang không có giá trị. Xem tab "Quyết định nội dung".', patents: ['US8682892B1', 'US9031929B1'], urls: uneven.map((u) => ({ url: site.origin + u.c, note: `${u.n} trang · ${u.reasons.join(' · ')}` })) }));

  // A5: a page far below its folder's standard (rhubarb-like deviation from the parent chunk)
  const below = [];
  for (const p of pages.filter((x) => !isUtility(x))) {
    const s = stats.get(chunkOf(p.url));
    if (!s || s.n < 5) continue;
    const gaps = [s.words >= 300 && p.words < s.words * 0.5 && `${p.words} từ (trung vị ${s.words})`, s.inlinks >= 2 && inl(p) < s.inlinks * 0.5 && `${inl(p)} link nội bộ trỏ tới (trung vị ${s.inlinks})`, s.schemaShare >= 0.7 && !(p.schemaTypes || []).length && 'không có schema (≥ 70% trang cùng thư mục có)', s.h2Share >= 0.7 && !(p.headings || []).some((h) => h.level === 2) && 'không có H2 (≥ 70% trang cùng thư mục có)'].filter(Boolean);
    if (gaps.length >= 2) below.push({ p, gaps });
  }
  site.belowStandard = new Set(below.map((b) => b.p.url));
  if (below.length)
    out.push(issue('site-quality', 'below-folder-standard', below.length >= 10 ? 'medium' : 'low', `${below.length} trang thấp hơn hẳn chuẩn của thư mục chứa nó`, { why: 'Trang mới thừa hưởng điểm chất lượng của thư mục cha; trang lệch xa chuẩn của thư mục (tín hiệu rhubarb trong leak) có thể bị tách khỏi điểm đó và kéo độ đồng đều của thư mục xuống.', fix: 'Đưa trang lên ngang trung vị của thư mục (độ dài, link nội bộ, schema, cấu trúc heading) hoặc gộp vào trang mạnh hơn.', patents: ['US8682892B1'], urls: below.map((b) => ({ url: b.p.url, note: b.gaps.join(' · ') })) }));

  // A6: title vs the queries the page actually gets (titlematchScore proxy)
  const brandRe = site.brand?.length ? new RegExp(site.brand.map((b) => deaccent(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')) : null;
  const mismatch = [];
  if (hasQueryGsc) for (const p of pages) {
    const e = g(p);
    if (!e || e.impressions < 100 || !p.title) continue;
    const top = [...e.queries].filter(([q]) => !(brandRe && brandRe.test(deaccent(q)))).sort((a, b) => b[1].impressions - a[1].impressions).slice(0, 3);
    if (!top.length) continue;
    const t = terms(p.title);
    const cover = (q) => { const qt = [...terms(q)]; return qt.length ? qt.filter((w) => t.has(w)).length / qt.length : 1; };
    const best = Math.max(...top.map(([q]) => cover(q)));
    if (best < 0.34) mismatch.push({ p, top: top.map(([q]) => q), best });
  }
  if (mismatch.length)
    out.push(issue('query-understanding', 'title-query-mismatch', mismatch.length >= 10 ? 'medium' : 'low', `${mismatch.length} trang có title gần như không chứa từ của các query chính đang mang lượt hiển thị`, { why: 'Leak 2024 có trường titlematchScore: mức khớp giữa title và query thật. Title lệch khỏi query mà Google đã gắn cho trang thường làm CTR thấp, hoặc là dấu hiệu trang đang xếp hạng cho intent khác dự định.', fix: 'Nếu query đúng intent của trang: đưa cụm chính vào title (giữ tự nhiên). Nếu query thuộc trang khác: xem lại cannibalization và link nội bộ.', patents: ['US10068022B2', 'US8452766B1'], urls: mismatch.map((m) => ({ url: m.p.url, note: `title: "${m.p.title.slice(0, 70)}" · query: ${m.top.join(' | ')}` })) }));

  // C2: direct traffic share (directFrac proxy) from GA4 channel totals
  const ch = ga4Rows?.channels;
  if (Array.isArray(ch) && ch.length) {
    const total = ch.reduce((a, r) => a + r.sessions, 0), direct = ch.filter((r) => /^direct$/i.test(r.channel)).reduce((a, r) => a + r.sessions, 0);
    if (total >= 100) {
      site.directShare = direct / total;
      out.push(issue('user-signals', 'direct-traffic-share', direct / total < 0.1 ? 'low' : 'info', `Truy cập trực tiếp chiếm ${pct(direct, total)}% phiên (GA4, 90 ngày)`, { why: 'Leak 2024 có directFrac trong dữ liệu chất lượng site: tỉ lệ người vào thẳng (gõ tên miền, bookmark) phản ánh nhu cầu thương hiệu. Đây là chỉ số theo dõi theo tháng, không phải lỗi kỹ thuật.', fix: 'Tăng nhu cầu thương hiệu: newsletter, LinkedIn, PR/giải thưởng, quảng cáo ghi rõ tên thương hiệu; theo dõi cùng query thương hiệu trong GSC.', urls: ch.sort((a, b) => b.sessions - a.sessions).slice(0, 8).map((r) => ({ url: r.channel, note: `${r.sessions.toLocaleString('vi-VN')} phiên (${pct(r.sessions, total)}%)` })) }));
    }
  }

  site.contentDecisions = [
    ...contentDecisions(site, pages, { g, hasPageGsc, inl, mismatch: new Set(mismatch.map((m) => m.p.url)) }),
    ...variants.map((p) => ({ url: p.url, title: p.title || '', chunk: chunkOf(p.url), words: p.words, inlinks: inl(p), clicks: null, impressions: null, decision: 'Gộp biến thể URL', reasons: `cùng trang với ${reps.get(key(p.url)).url} (khác dấu / cuối, www hoặc http). Chọn một dạng, 301 dạng còn lại và để canonical trỏ về dạng đó` })),
  ];
  return out;
}

// One decision per indexable URL for the content clean-up, with the reasons it was taken. Rules are applied in order;
// every row is a suggestion for a human reviewer, never an automatic merge/redirect.
function contentDecisions(site, pages, { g, hasPageGsc, inl, mismatch }) {
  const byKey = new Map(pages.map((p) => [key(p.url), p]));
  const clicks = (p) => (hasPageGsc ? g(p).clicks : null);
  const impr = (p) => (hasPageGsc ? g(p).impressions : null);
  const strength = (p) => (hasPageGsc ? g(p).clicks * 1000 + g(p).impressions : 0) + inl(p) * 10 + p.words / 100;

  // near-duplicate partners (same simhash rule as the near-duplicates check)
  const dupOf = new Map();
  for (const pr of site.nearDuplicatePairs || []) {
    const a = byKey.get(key(pr.a)), b = byKey.get(key(pr.b));
    if (!a || !b) continue;
    if (a === b) continue; // same page reached through two URL variants: handled as "Gộp biến thể URL"
    const [weak, strong] = strength(a) < strength(b) ? [a, b] : [b, a];
    if (!dupOf.has(weak.url)) dupOf.set(weak.url, strong.url);
  }
  // cannibalisation losers: same query, both pages ≥ 15% of its impressions, this page clearly weaker
  const cannOf = new Map();
  if (hasPageGsc) {
    const byQuery = new Map();
    for (const p of pages) for (const [q, v] of g(p).queries) (byQuery.get(q) || byQuery.set(q, []).get(q)).push({ p, ...v });
    for (const [q, list] of byQuery) {
      const tot = list.reduce((a, x) => a + x.impressions, 0);
      if (tot < 50) continue;
      const big = list.filter((x) => x.impressions / tot >= 0.15).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
      for (const x of big.slice(1)) if (!cannOf.has(x.p.url)) cannOf.set(x.p.url, { winner: big[0].p.url, query: q });
    }
  }
  const offTopic = new Set((site.offTopicPages || []));
  const below = site.belowStandard || new Set();

  return pages.map((p) => {
    const thin = p.words < 250, c = clicks(p), i = impr(p), reasons = [];
    let decision;
    if (dupOf.has(p.url)) { decision = 'Gộp + 301'; reasons.push('gần trùng nội dung với ' + dupOf.get(p.url)); }
    else if (cannOf.has(p.url) && (thin || below.has(p.url))) { decision = 'Gộp + 301'; reasons.push(`tranh query "${cannOf.get(p.url).query}" với ${cannOf.get(p.url).winner} và yếu hơn`); }
    else if (cannOf.has(p.url)) { decision = 'Viết lại'; reasons.push(`tranh query "${cannOf.get(p.url).query}" với ${cannOf.get(p.url).winner}: tách rõ intent hoặc gộp`); }
    else if (offTopic.has(p.url) && !(c > 0)) { decision = 'Xem lại chủ đề'; reasons.push('từ vựng chính khác trọng tâm của site (ước đoán tự động, cần người xác nhận; nếu đúng là lạc chủ đề thì chuyển sang site/khu khác hoặc noindex)' + (c === 0 ? ', 0 click' : '')); }
    else if (isUtility(p)) { decision = 'Giữ'; reasons.push('trang tiện ích/danh mục (ngắn là bình thường)'); }
    else if (thin && i === 0 && inl(p) <= 1) { decision = 'Noindex / Xoá + 301'; reasons.push(`${p.words} từ, 0 lượt hiển thị, ${inl(p)} link nội bộ trỏ tới`); }
    else if (thin || below.has(p.url)) { decision = 'Viết lại'; reasons.push(thin ? `mỏng (${p.words} từ)` : 'thấp hơn chuẩn thư mục'); if (i > 0) reasons.push(`có nhu cầu: ${i.toLocaleString('vi-VN')} lượt hiển thị`); }
    else if (mismatch.has(p.url)) { decision = 'Giữ, sửa title'; reasons.push('title lệch query chính'); }
    else { decision = 'Giữ'; }
    if (!hasPageGsc) reasons.push('chưa có dữ liệu GSC theo trang');
    return { url: p.url, title: p.title || '', chunk: chunkOf(p.url), words: p.words, inlinks: inl(p), clicks: c, impressions: i, decision, reasons: reasons.join('; ') };
  });
}

export const DECISION_ORDER = ['Gộp biến thể URL', 'Gộp + 301', 'Noindex / Xoá + 301', 'Xem lại chủ đề', 'Viết lại', 'Giữ, sửa title', 'Giữ'];
