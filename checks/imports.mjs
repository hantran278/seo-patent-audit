// Checks on imported data: Screaming Frog crawl, Semrush/Ahrefs keyword positions, Semrush Site Audit issues.
import { issue, isIndexable } from './common.mjs';
import { pct } from '../lib/util.mjs';

const bare = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
const hostOf = (u) => { try { return bare(new URL(u).host); } catch { return ''; } };
const norm = (u) => String(u || '').replace(/#.*$/, '').replace(/\/$/, '');

// ── Screaming Frog ────────────────────────────────────────────────────────
export function sfChecks(rows, site) {
  const out = [];
  if (!rows.length) return out;
  const own = rows.filter((r) => hostOf(r.url) === bare(site.host));
  if (!own.length) {
    out.push(issue('crawl-index', 'sf-other-domain', 'info', `File Screaming Frog không chứa URL nào của ${site.host}`, { fix: 'Kiểm tra lại: có thể đã tải nhầm file crawl của site khác.', urls: [...new Set(rows.slice(0, 20).map((r) => hostOf(r.url)))].map((h) => ({ url: h })) }));
    return out;
  }
  const html = own.filter((r) => /html/i.test(r.type) || (!r.type && r.title !== undefined));
  const ok = html.filter((r) => r.status === 200);
  const idx = ok.filter((r) => r.indexable !== false);
  site.sfSummary = { urls: own.length, html: html.length, indexable: idx.length };
  const note = (r, extra = '') => [r.inlinks !== null ? `${r.inlinks} inlink` : '', extra].filter(Boolean).join(' · ');

  const errors = own.filter((r) => r.status >= 400 || r.status === 0);
  if (errors.length)
    out.push(issue('crawl-index', 'sf-errors', errors.length > 10 ? 'high' : 'medium', `Screaming Frog: ${errors.length} URL trả lỗi 4xx/5xx/không phản hồi`, { why: 'URL lỗi lặp lại bị loại khỏi lịch crawl; link nội bộ trỏ tới URL lỗi lãng phí crawl budget và PageRank.', fix: 'Sửa hoặc gỡ link nội bộ trỏ tới các URL này (xem tab Inlinks trong Screaming Frog); redirect 301 URL đã xoá có giá trị.', patents: ['US7725452B1'], urls: errors.map((r) => ({ url: r.url, note: note(r, `HTTP ${r.status || 'không phản hồi'}`) })), total: own.length }));

  const redirects = own.filter((r) => r.status >= 300 && r.status < 400 && (r.inlinks ?? 1) > 0);
  if (redirects.length)
    out.push(issue('crawl-index', 'sf-redirects', redirects.length > 50 ? 'medium' : 'low', `Screaming Frog: ${redirects.length} URL redirect vẫn được link nội bộ`, { fix: 'Cập nhật link nội bộ trỏ thẳng tới URL đích cuối cùng.', patents: ['US7725452B1'], urls: redirects.map((r) => ({ url: r.url, note: note(r, r.redirect ? `→ ${r.redirect}` : `HTTP ${r.status}`) })) }));

  const nonIdx = ok.filter((r) => r.indexable === false);
  if (nonIdx.length)
    out.push(issue('crawl-index', 'sf-non-indexable', 'info', `Screaming Frog: ${nonIdx.length} trang HTML 200 không indexable`, { why: 'Kiểm tra lại đây có đúng là các trang bạn muốn chặn index (noindex/canonical sang trang khác) hay không.', fix: 'Gỡ noindex hoặc sửa canonical cho trang cần index; với trang không cần index, bỏ link nội bộ và loại khỏi sitemap.', patents: ['US8868559B2'], urls: nonIdx.map((r) => ({ url: r.url, note: r.reason || 'Non-Indexable' })), total: ok.length }));

  if (idx.length && idx[0].title !== undefined) {
    const noTitle = idx.filter((r) => !r.title);
    if (noTitle.length) out.push(issue('duplicates', 'sf-missing-title', 'high', `Screaming Frog: ${noTitle.length} trang indexable thiếu title`, { patents: ['US10068022B2'], urls: noTitle.map((r) => ({ url: r.url })), total: idx.length }));
    const byTitle = new Map();
    for (const r of idx) if (r.title) byTitle.set(r.title.toLowerCase(), [...(byTitle.get(r.title.toLowerCase()) || []), r]);
    const dup = [...byTitle.values()].filter((g) => g.length > 1);
    if (dup.length)
      out.push(issue('duplicates', 'sf-duplicate-title', 'medium', `Screaming Frog: ${dup.length} nhóm title trùng nhau (${dup.reduce((a, g) => a + g.length, 0)} trang)`, { why: 'Title trùng làm Google khó phân biệt trang nào trả lời query nào, dễ gây cannibalization.', fix: 'Viết title riêng, nêu rõ chủ đề/entity của từng trang.', patents: ['US10068022B2', 'US8452766B1'], urls: dup.flatMap((g) => g.map((r) => ({ url: r.url, note: `"${r.title.slice(0, 70)}" · ${g.length} trang` }))), total: idx.length }));
  }
  if (idx.length && idx[0].meta !== undefined) {
    const noMeta = idx.filter((r) => !r.meta);
    if (noMeta.length) out.push(issue('duplicates', 'sf-missing-meta', 'low', `Screaming Frog: ${noMeta.length} trang indexable thiếu meta description`, { fix: 'Viết meta description tóm tắt đúng ý định tìm kiếm để tăng CTR.', urls: noMeta.map((r) => ({ url: r.url })), total: idx.length }));
  }
  if (idx.length && idx[0].h1 !== undefined) {
    const noH1 = idx.filter((r) => !r.h1);
    if (noH1.length) out.push(issue('topicality', 'sf-missing-h1', 'medium', `Screaming Frog: ${noH1.length} trang indexable không có H1`, { why: 'Entity chủ đề của trang được xác định qua title/URL/heading; thiếu H1 làm chủ đề kém rõ ràng.', fix: 'Mỗi trang một H1 mô tả entity/chủ đề chính.', patents: ['US10068022B2', 'US8166045B1'], urls: noH1.map((r) => ({ url: r.url })), total: idx.length }));
    const multi = idx.filter((r) => r.h1Second);
    if (multi.length) out.push(issue('topicality', 'sf-multiple-h1', 'low', `Screaming Frog: ${multi.length} trang có nhiều H1`, { fix: 'Giữ một H1; các tiêu đề còn lại dùng H2/H3.', patents: ['US8060501B1'], urls: multi.map((r) => ({ url: r.url, note: `"${r.h1.slice(0, 50)}" + "${r.h1Second.slice(0, 50)}"` })) }));
  }
  const thin = idx.filter((r) => r.words !== null && r.words < 250);
  if (thin.length)
    out.push(issue('site-quality', 'sf-thin', pct(thin.length, idx.length) > 20 ? 'high' : 'medium', `Screaming Frog: ${thin.length} trang indexable < 250 từ (${pct(thin.length, idx.length)}%)`, { why: 'Tỷ lệ trang mỏng cao kéo điểm chất lượng toàn site (Panda) xuống.', fix: 'Gộp, mở rộng hoặc noindex trang mỏng.', patents: ['US8682892B1', 'US8554759B1', 'US9195944B1'], urls: thin.map((r) => ({ url: r.url, note: `${r.words} từ` })), total: idx.length }));
  const deep = idx.filter((r) => r.depth !== null && r.depth > 4);
  if (deep.length)
    out.push(issue('crawl-index', 'sf-deep', pct(deep.length, idx.length) > 20 ? 'medium' : 'low', `Screaming Frog: ${deep.length} trang indexable cách trang chủ > 4 click`, { fix: 'Rút ngắn đường dẫn: link từ danh mục/hub/trang chủ tới trang quan trọng.', patents: ['US7509315B1'], urls: deep.map((r) => ({ url: r.url, note: `độ sâu ${r.depth}` })), total: idx.length }));
  const weak = idx.filter((r) => r.inlinks !== null && r.inlinks <= 1 && norm(r.url) !== norm(site.start));
  if (weak.length)
    out.push(issue('links', 'sf-weak-inlinks', pct(weak.length, idx.length) > 20 ? 'medium' : 'low', `Screaming Frog: ${weak.length} trang indexable chỉ có ≤ 1 inlink nội bộ`, { why: 'Trang ít link trỏ tới nhận ít PageRank nội bộ và bị coi là kém quan trọng.', fix: 'Thêm link ngữ cảnh từ bài liên quan, trang danh mục/hub.', patents: ['US6285999B1', 'US7509315B1'], urls: weak.map((r) => ({ url: r.url, note: `${r.inlinks} inlink` })), total: idx.length }));
  const slow = ok.filter((r) => r.responseTime !== null && r.responseTime > 1.5);
  if (slow.length)
    out.push(issue('page-experience', 'sf-slow', pct(slow.length, ok.length) > 30 ? 'high' : 'medium', `Screaming Frog: ${slow.length} trang phản hồi > 1,5 giây`, { why: 'Server chậm khiến Google giảm tốc độ crawl; tốc độ cũng là tín hiệu trải nghiệm.', fix: 'Bật cache trang/CDN, tối ưu database, nâng hosting.', patents: ['US8032518B2', 'US8645362B1'], urls: slow.map((r) => ({ url: r.url, note: `${r.responseTime.toFixed(2)} s` })), total: ok.length }));

  // coverage: URLs Screaming Frog reached that the built-in crawler did not
  const crawled = new Set(site.pages.map((p) => norm(p.url)));
  const missed = idx.filter((r) => !crawled.has(norm(r.url)));
  if (missed.length)
    out.push(issue('crawl-index', 'sf-coverage', 'info', `Screaming Frog tìm thấy ${missed.length} trang indexable mà lượt crawl của tool không quét tới`, { why: 'Do giới hạn số URL của tool hoặc nội dung/link chỉ hiện sau khi chạy JavaScript. Các mục "Screaming Frog: …" trong báo cáo đã bao phủ những trang này.', fix: 'Nếu site dựa vào JavaScript để hiện link, đảm bảo link quan trọng có trong HTML gốc (thẻ <a href>).', urls: missed.map((r) => ({ url: r.url })), total: idx.length }));
  return out;
}

// ── Keyword positions (Semrush Organic Positions / Ahrefs Organic keywords) ─
export function keywordChecks(rows, site) {
  const out = [];
  if (!rows.length) return out;
  const byKw = new Map();
  for (const r of rows) {
    const k = r.keyword.toLowerCase();
    const x = byKw.get(k) || { keyword: r.keyword, volume: 0, best: 999, urls: new Map() };
    x.volume = Math.max(x.volume, r.volume);
    x.best = Math.min(x.best, r.position);
    if (r.url) x.urls.set(norm(r.url), Math.min(x.urls.get(norm(r.url)) ?? 999, r.position));
    byKw.set(k, x);
  }
  const K = [...byKw.values()];
  site.keywordSummary = { keywords: K.length, top10: K.filter((k) => k.best <= 10).length, top3: K.filter((k) => k.best <= 3).length };

  const striking = K.filter((k) => k.best > 10 && k.best <= 20).sort((a, b) => b.volume - a.volume);
  if (striking.length)
    out.push(issue('query-understanding', 'kw-striking', 'info', `${striking.length} từ khoá đang ở vị trí 11–20 (Semrush/Ahrefs), sắp xếp theo search volume`, { why: 'Nhóm từ khoá sát top 10 thường cho kết quả nhanh nhất khi bổ sung nội dung và link nội bộ.', fix: 'Đối chiếu ý định SERP, bổ sung khía cạnh còn thiếu, thêm link nội bộ có anchor mô tả tới URL đang xếp hạng.', patents: ['US8458171B2', 'US9047278B1'], urls: striking.map((k) => ({ url: k.keyword, note: `vị trí ${k.best} · volume ${k.volume.toLocaleString('vi-VN')} · ${k.urls.size ? [...k.urls.keys()][0].replace(/^https?:\/\/[^/]+/, '') || '/' : ''}` })) }));

  const cann = K.filter((k) => [...k.urls.values()].filter((p) => p <= 30).length >= 2).sort((a, b) => b.volume - a.volume);
  if (cann.length)
    out.push(issue('query-understanding', 'kw-cannibalization', cann.length > 10 ? 'high' : 'medium', `${cann.length} từ khoá có ≥ 2 URL cùng xếp hạng top 30 (cannibalization)`, { why: 'Google chỉ hiển thị một trong các trang trả lời giống nhau; tín hiệu click và link bị chia giữa các trang.', fix: 'Chọn một trang chính cho mỗi từ khoá: gộp nội dung (301), đổi hướng nội dung trang còn lại, sửa link nội bộ trỏ về trang chính.', patents: ['US8452766B1', 'US9323806B2', 'US8868548B2'], urls: cann.map((k) => ({ url: k.keyword, note: [...k.urls.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3).map(([u, p]) => `${u.replace(/^https?:\/\/[^/]+/, '') || '/'} (#${p})`).join(' · ') })) }));

  return out;
}

// URLs that bring search traffic (keyword tools, GSC pages, GA4 organic landing pages) but are broken,
// redirected or not indexable in the crawl / Screaming Frog
export function trafficPagesBroken(site, { keywords = [], gsc = [], ga4 = [], sf = [] }) {
  const out = [];
  const rankTraffic = new Map();
  const add = (u, v) => { if (u) rankTraffic.set(norm(u), (rankTraffic.get(norm(u)) || 0) + v); };
  for (const r of keywords) add(r.url, r.traffic || r.volume / 100);
  for (const g of gsc) add(g.page, g.clicks);
  for (const g of ga4) add(`https://${g.host}${g.path}`, g.sessions);
  if (!rankTraffic.size) return out;
  const problems = new Map();
  for (const p of site.pages) {
    const u = norm(p.url);
    if (!rankTraffic.has(u)) continue;
    if (p.status !== 200) problems.set(u, `HTTP ${p.status || 'lỗi'}`);
    else if (!isIndexable(p)) problems.set(u, /noindex/i.test((p.robotsMeta || '') + (p.xRobots || '')) ? 'noindex' : 'canonical sang URL khác');
  }
  for (const r of sf) {
    const u = norm(r.url);
    if (!rankTraffic.has(u) || problems.has(u)) continue;
    if (r.status && r.status !== 200) problems.set(u, `HTTP ${r.status}`);
    else if (r.indexable === false) problems.set(u, r.reason || 'Non-Indexable');
  }
  if (problems.size)
    out.push(issue('crawl-index', 'ranking-pages-broken', 'high', `${problems.size} URL đang có thứ hạng/traffic nhưng bị lỗi, redirect hoặc không indexable`, { why: 'Trang đang mang traffic mà bị lỗi hoặc chặn index sẽ mất thứ hạng ở lần crawl kế tiếp.', fix: 'Ưu tiên sửa ngay: trả về 200, gỡ noindex hoặc canonical sai; nếu đã gộp trang thì redirect 301 về trang thay thế gần nhất.', patents: ['US7725452B1', 'US8868559B2'], urls: [...problems.entries()].sort((a, b) => rankTraffic.get(b[0]) - rankTraffic.get(a[0])).map(([u, why]) => ({ url: u, note: `${why} · ~${Math.round(rankTraffic.get(u)).toLocaleString('vi-VN')} click/phiên` })) }));
  return out;
}

// ── GA4 organic landing pages ─────────────────────────────────────────────
export function ga4Checks(rows, site) {
  const out = [];
  if (!rows.length) return out;
  const total = rows.reduce((a, r) => a + r.sessions, 0);
  const keyEvents = rows.reduce((a, r) => a + r.keyEvents, 0);
  site.ga4Summary = { pages: rows.length, sessions: total, keyEvents, engagementRate: total ? rows.reduce((a, r) => a + r.engagedSessions, 0) / total : 0 };
  const avg = site.ga4Summary.engagementRate;
  const minSessions = Math.max(30, Math.round(total * 0.005));
  const url = (r) => `https://${r.host}${r.path}`;

  const low = rows.filter((r) => r.sessions >= minSessions && r.engagementRate < Math.min(0.4, avg * 0.6)).sort((a, b) => b.sessions - a.sessions);
  if (low.length)
    out.push(issue('user-signals', 'ga4-low-engagement', low.length > 10 ? 'high' : 'medium', `${low.length} landing page organic có tỷ lệ tương tác thấp (GA4, dưới ${Math.round(Math.min(0.4, avg * 0.6) * 100)}%; trung bình site ${Math.round(avg * 100)}%)`, {
      why: 'Google đo mức hài lòng sau click (click dài/ngắn, quay lại SERP) để điều chỉnh xếp hạng (Navboost). Trang nhận nhiều phiên organic nhưng người dùng rời đi ngay là tín hiệu "click xấu".',
      fix: 'So nội dung đầu trang với ý định của truy vấn dẫn vào (xem tab GSC); đưa câu trả lời/CTA lên trên, giảm popup, tăng tốc tải trang trên mobile.',
      patents: ['US8661029B1', 'US8938463B1', 'US9195944B1'],
      urls: low.map((r) => ({ url: url(r), note: `${r.sessions.toLocaleString('vi-VN')} phiên · tương tác ${Math.round(r.engagementRate * 100)}% · ${Math.round(r.avgDuration)}s` })) }));

  const noConv = keyEvents > 0 ? rows.filter((r) => r.sessions >= minSessions * 3 && r.keyEvents === 0).sort((a, b) => b.sessions - a.sessions) : [];
  if (noConv.length)
    out.push(issue('user-signals', 'ga4-no-key-events', 'info', `${noConv.length} landing page organic nhiều traffic nhưng chưa tạo key event nào`, {
      fix: 'Kiểm tra CTA/form trên các trang này và tracking key event; cân nhắc thêm link nội bộ tới trang dịch vụ/landing page chuyển đổi.',
      urls: noConv.map((r) => ({ url: url(r), note: `${r.sessions.toLocaleString('vi-VN')} phiên · 0 key event` })) }));

  const crawled = new Set(site.pages.map((p) => norm(p.url)));
  const host = bare(site.host);
  const missed = rows.filter((r) => bare(r.host) === host && r.sessions >= minSessions && !crawled.has(norm(url(r))) && !/\?/.test(r.path));
  if (missed.length)
    out.push(issue('crawl-index', 'ga4-not-crawled', 'info', `${missed.length} landing page organic (GA4) không nằm trong lượt crawl`, {
      why: 'Có thể do giới hạn số URL, hoặc trang không có link nội bộ trỏ tới (trang mồ côi) nên crawler theo link không tìm thấy.',
      fix: 'Nếu là trang quan trọng: thêm link nội bộ từ trang danh mục/hub và đưa vào sitemap.',
      urls: missed.map((r) => ({ url: url(r), note: `${r.sessions.toLocaleString('vi-VN')} phiên` })) }));
  return out;
}

// ── Semrush Site Audit issues ─────────────────────────────────────────────
const AUDIT_GROUP = [
  [/title|meta|description|h1|heading/i, 'topicality'],
  [/duplicate|canonical|trung/i, 'duplicates'],
  [/speed|slow|size|javascript|css|load|compress|cache|image|anh/i, 'page-experience'],
  [/link|anchor|redirect|orphan/i, 'links'],
];
export function auditImportChecks(rows) {
  if (!rows.length) return [];
  const byIssue = new Map();
  for (const r of rows) byIssue.set(r.issue, [...(byIssue.get(r.issue) || []), r]);
  return [...byIssue.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 30).map(([name, list]) =>
    issue(AUDIT_GROUP.find(([re]) => re.test(name))?.[1] || 'crawl-index', 'semrush-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), 'info', `Semrush Site Audit: ${name} (${list.length})`, {
      why: 'Lỗi do Semrush Site Audit phát hiện, đưa vào để đối chiếu (không tính vào điểm để tránh trùng với lỗi tool đã tự kiểm tra).',
      urls: list.filter((r) => r.url).map((r) => ({ url: r.url, note: r.severity || '' })), metric: list.length,
    }));
}
