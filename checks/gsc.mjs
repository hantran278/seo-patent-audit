// Google Search Console data: CTR vs position expectation, brand demand, cannibalization, striking distance
import { issue } from './common.mjs';
import { pct } from '../lib/util.mjs';

// Fallback CTR curve (organic, rough industry average) used when the site has too little data at a position
const BASELINE = { 1: 0.28, 2: 0.16, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.045, 7: 0.035, 8: 0.028, 9: 0.023, 10: 0.02 };
const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();

// Normalise GSC exports in English/Vietnamese or API-style columns
export function normalizeGsc(rows) {
  if (!rows.length) return [];
  const cols = Object.keys(rows[0]);
  const find = (...res) => cols.find((c) => res.some((re) => re.test(deaccent(c))));
  const cQ = find(/query|truy van|tu khoa|top queries/);
  const cP = find(/page|landing|^trang|url/);
  const cC = find(/click|luot nhap/);
  const cI = find(/impression|hien thi/);
  const cPos = find(/position|vi tri/);
  const num = (v) => Number(String(v ?? '').replace('%', '').replace(/,/g, '').trim()) || 0;
  return rows.map((r) => ({ query: cQ ? r[cQ] : null, page: cP ? r[cP] : null, clicks: num(r[cC]), impressions: num(r[cI]), position: num(r[cPos]) })).filter((r) => r.impressions > 0);
}

export function gscChecks(rows, site) {
  const out = [];
  if (!rows.length) {
    out.push(issue('user-signals', 'gsc-missing', 'info', 'Chưa có dữ liệu Google Search Console', { why: 'Tín hiệu người dùng (Navboost) là nhóm P1; phân tích CTR theo vị trí, nhu cầu thương hiệu, cannibalization cần dữ liệu GSC.', fix: 'Xuất GSC → Hiệu suất (Truy vấn, hoặc Truy vấn + Trang qua API) rồi chạy lại với --gsc <file.csv>.', patents: ['US8661029B1', 'US8938463B1'], metric: 0 }));
    return out;
  }
  const hasQuery = rows.some((r) => r.query);
  const hasPage = rows.some((r) => r.page);

  // aggregate per query (and per query+page when available)
  const byQ = new Map();
  for (const r of rows) {
    if (!r.query) continue;
    const q = byQ.get(r.query) || { query: r.query, clicks: 0, impressions: 0, posW: 0, pages: new Map() };
    q.clicks += r.clicks; q.impressions += r.impressions; q.posW += r.position * r.impressions;
    if (r.page) q.pages.set(r.page, (q.pages.get(r.page) || 0) + r.impressions);
    byQ.set(r.query, q);
  }
  const Q = [...byQ.values()].map((q) => ({ ...q, position: q.posW / q.impressions, ctr: q.clicks / q.impressions }));

  // expected CTR by rounded position from the site's own data, blended with baseline
  const bucket = new Map();
  for (const q of Q) {
    const b = Math.round(q.position);
    if (b < 1 || b > 20) continue;
    const x = bucket.get(b) || { c: 0, i: 0 };
    x.c += q.clicks; x.i += q.impressions;
    bucket.set(b, x);
  }
  const expected = (pos) => {
    const b = Math.max(1, Math.round(pos));
    const own = bucket.get(b);
    const base = BASELINE[b] ?? 0.015;
    if (!own || own.i < 500) return base;
    const w = Math.min(1, own.i / 5000);
    return w * (own.c / own.i) + (1 - w) * base;
  };
  site.ctrCurve = [...Array(20)].map((_, i) => ({ pos: i + 1, expected: +(expected(i + 1) * 100).toFixed(2), impressions: bucket.get(i + 1)?.i || 0 }));

  const minImp = Math.max(50, [...Q].sort((a, b) => b.impressions - a.impressions)[Math.min(Q.length - 1, 200)]?.impressions || 50);
  const under = Q.filter((q) => q.position <= 10 && q.impressions >= minImp && q.ctr < 0.6 * expected(q.position)).sort((a, b) => b.impressions - a.impressions);
  if (under.length)
    out.push(issue('user-signals', 'ctr-below-expected', under.length > 20 ? 'high' : 'medium', `${under.length} query top 10 có CTR thấp hơn 60% mức kỳ vọng theo vị trí`, {
      why: 'Navboost dùng dữ liệu click theo từng cặp query–trang và loại bỏ thiên lệch vị trí: điều quan trọng là CTR so với kỳ vọng của vị trí đó. Bị "thua" kết quả cạnh bên kéo thứ hạng xuống dần.',
      fix: 'Viết lại title/meta description hấp dẫn và khớp ý định; bổ sung rich result (review, FAQ, giá); kiểm tra SERP xem đối thủ có snippet nổi bật hơn không.',
      patents: ['US8938463B1', 'US8661029B1', 'US9020927B1', 'US8615514B1'],
      urls: under.map((q) => ({ url: q.query, note: `vị trí ${q.position.toFixed(1)} · CTR ${(q.ctr * 100).toFixed(1)}% (kỳ vọng ${(expected(q.position) * 100).toFixed(1)}%) · ${q.impressions} hiển thị` })) }));

  const over = Q.filter((q) => q.position > 3 && q.position <= 15 && q.impressions >= minImp && q.ctr > 1.3 * expected(q.position)).sort((a, b) => b.impressions - a.impressions);
  if (over.length)
    out.push(issue('user-signals', 'ctr-above-expected', 'info', `${over.length} query vị trí 4–15 có CTR vượt kỳ vọng — ứng viên ưu tiên đẩy lên top`, {
      why: 'Người dùng đã ưu tiên kết quả của bạn hơn mức vị trí dự đoán; củng cố nội dung/link nội bộ cho các trang này thường cho hiệu quả nhanh.',
      fix: 'Bổ sung nội dung còn thiếu so với top 3, thêm link nội bộ từ trang mạnh, cải thiện trải nghiệm trang.',
      patents: ['US8938463B1', 'US9218397B1'],
      urls: over.map((q) => ({ url: q.query, note: `vị trí ${q.position.toFixed(1)} · CTR ${(q.ctr * 100).toFixed(1)}% (kỳ vọng ${(expected(q.position) * 100).toFixed(1)}%)` })) }));

  const striking = Q.filter((q) => q.position > 10 && q.position <= 20 && q.impressions >= minImp).sort((a, b) => b.impressions - a.impressions);
  if (striking.length)
    out.push(issue('query-understanding', 'striking-distance', 'info', `${striking.length} query đang ở vị trí 11–20 với lượng hiển thị đáng kể`, {
      fix: 'Kiểm tra ý định SERP, bổ sung khía cạnh/thuộc tính còn thiếu, thêm link nội bộ có anchor mô tả.',
      patents: ['US8458171B2', 'US9047278B1'], urls: striking.map((q) => ({ url: q.query, note: `vị trí ${q.position.toFixed(1)} · ${q.impressions} hiển thị` })) }));

  // brand demand share
  if (site.brand?.length) {
    const brandRe = new RegExp(site.brand.map((b) => deaccent(b).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'));
    const bc = Q.filter((q) => brandRe.test(deaccent(q.query))).reduce((a, q) => a + q.clicks, 0);
    const tc = Q.reduce((a, q) => a + q.clicks, 0);
    site.brandShare = { brandClicks: bc, totalClicks: tc, share: pct(bc, tc) };
    if (tc > 100 && bc / tc < 0.1)
      out.push(issue('site-quality', 'low-brand-demand', 'medium', `Chỉ ${pct(bc, tc)}% lượt click đến từ query có tên thương hiệu`, {
        why: 'Điểm chất lượng site (Panda/site quality score) dựa trên tỷ lệ query nhắm đích danh tới site so với tổng lượng query site nhận click. Site sống nhờ từ khoá chung mà ít người tìm thương hiệu dễ bị ảnh hưởng khi core update.',
        fix: 'Đầu tư tạo nhu cầu tìm thương hiệu: PR, social, email, video, cộng đồng; tên thương hiệu nhất quán, dễ nhớ.',
        patents: ['US9031929B1', 'US8682892B1', 'US9244972B1'], metric: bc, total: tc }));
  }

  // cannibalization (needs query+page rows)
  if (hasQuery && hasPage) {
    const cann = Q.filter((q) => q.impressions >= 50 && [...q.pages.values()].filter((i) => i / q.impressions >= 0.15).length >= 2).sort((a, b) => b.impressions - a.impressions);
    if (cann.length)
      out.push(issue('query-understanding', 'cannibalization', cann.length > 10 ? 'high' : 'medium', `${cann.length} query có ≥ 2 trang cùng nhận ≥ 15% lượt hiển thị (cannibalization)`, {
        why: 'Google chỉ hiển thị một trong các trang trả lời giống nhau cho cùng query; tín hiệu click và link bị chia giữa các trang.',
        fix: 'Chọn một trang chính cho mỗi query: gộp nội dung (301), đổi hướng nội dung trang còn lại sang ý định khác, sửa link nội bộ trỏ về trang chính.',
        patents: ['US8452766B1', 'US9323806B2', 'US8868548B2'],
        urls: cann.map((q) => ({ url: q.query, note: [...q.pages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([p, i]) => `${p.replace(/^https?:\/\/[^/]+/, '')} (${pct(i, q.impressions)}%)`).join(' · ') })) }));
  } else if (hasQuery) {
    out.push(issue('query-understanding', 'cannibalization-needs-data', 'info', 'Cần dữ liệu Truy vấn + Trang để phát hiện cannibalization', { fix: 'Xuất GSC theo cả hai chiều query và page (API/Looker Studio/Search Analytics for Sheets) rồi chạy lại.', patents: ['US8452766B1'], metric: 0 }));
  }
  const underSet = new Set(under.map((q) => q.query)), overSet = new Set(over.map((q) => q.query));
  site.gscPoints = [...Q].filter((q) => q.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 400)
    .map((q) => ({ q: q.query, pos: q.position, ctr: q.ctr * 100, flag: underSet.has(q.query) ? 'under' : overSet.has(q.query) ? 'over' : '' }));
  site.gscSummary = { queries: Q.length, clicks: Q.reduce((a, q) => a + q.clicks, 0), impressions: Q.reduce((a, q) => a + q.impressions, 0) };
  return out;
}
