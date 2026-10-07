// Internal PageRank, link placement, anchor text, outbound neighbourhood
import { issue, isHtml200, isIndexable } from './common.mjs';
import { pct } from '../lib/util.mjs';
import { isCdnIp } from './backlinks.mjs';

const GENERIC = /^(xem thêm|xem chi tiết|chi tiết|đọc thêm|đọc tiếp|tại đây|ở đây|click|bấm vào đây|nhấn vào đây|link|here|click here|read more|more|learn more|xem|tiếp)$/i;

export function internalPageRank(site, d = 0.85, iters = 40) {
  const nodes = site.pages.filter(isHtml200);
  const idx = new Map(nodes.map((p, i) => [p.url, i]));
  // resolve redirects so links to redirecting URLs count for the target
  const alias = new Map(site.pages.filter((p) => p.finalUrl && p.finalUrl !== p.url).map((p) => [p.url, p.finalUrl]));
  const out = nodes.map((p) => [...new Set(p.links.filter((l) => !l.nofollow).map((l) => alias.get(l.href) || l.href).filter((h) => idx.has(h) && h !== p.url))].map((h) => idx.get(h)));
  const N = nodes.length;
  let pr = new Array(N).fill(1 / N);
  for (let it = 0; it < iters; it++) {
    const next = new Array(N).fill((1 - d) / N);
    let dangling = 0;
    for (let i = 0; i < N; i++) {
      if (!out[i].length) { dangling += pr[i]; continue; }
      const share = (d * pr[i]) / out[i].length;
      for (const j of out[i]) next[j] += share;
    }
    for (let i = 0; i < N; i++) next[i] += (d * dangling) / N;
    pr = next;
  }
  const max = Math.max(...pr);
  nodes.forEach((p, i) => (p.pagerank = Math.round((pr[i] / max) * 1000) / 10)); // 0–100 scale
}

export function links(site) {
  const out = [];
  internalPageRank(site);
  const html = site.pages.filter(isHtml200);
  const indexable = html.filter(isIndexable);

  const weak = indexable.filter((p) => new Set(p.inlinks.map((l) => l.from)).size <= 1 && p.url !== site.start);
  if (weak.length)
    out.push(issue('links', 'weak-inlinks', pct(weak.length, indexable.length) > 20 ? 'medium' : 'low', `${weak.length} trang indexable chỉ nhận link nội bộ từ ≤ 1 trang`, { why: 'PageRank nội bộ phân phối qua link; trang ít link trỏ tới nhận ít PageRank và bị coi là kém quan trọng khi crawl/index.', fix: 'Thêm link từ bài liên quan (trong thân bài), trang danh mục/hub.', patents: ['US6285999B1', 'US7509315B1'], urls: weak.map((p) => ({ url: p.url, note: `PR nội bộ ${p.pagerank}` })), total: indexable.length }));

  // anchors of internal links inside main content
  const internal = html.flatMap((p) => p.links.filter((l) => l.main && l.href.includes(site.host)));
  const generic = internal.filter((l) => GENERIC.test(l.text.trim()));
  if (internal.length >= 20 && generic.length / internal.length > 0.1)
    out.push(issue('links', 'generic-anchors', 'medium', `${pct(generic.length, internal.length)}% link nội bộ trong thân bài dùng anchor chung chung ("xem thêm", "tại đây"…)`, { why: 'Anchor text và đoạn văn quanh link được index cho trang đích; anchor chung chung lãng phí tín hiệu chủ đề.', fix: 'Dùng anchor mô tả nội dung trang đích (entity/chủ đề), đặt trong câu có ngữ cảnh.', patents: ['US10210256B2', 'US8577893B1', 'US7716225B1'], urls: [...new Map(generic.map((l) => [l.href, l])).values()].map((l) => ({ url: l.href, note: `"${l.text}"` })), total: internal.length }));

  const noContextLinks = indexable.filter((p) => p.words > 400 && !p.links.some((l) => l.main && l.href.includes(site.host) && l.href !== p.url));
  if (noContextLinks.length)
    out.push(issue('links', 'no-contextual-links', 'low', `${noContextLinks.length} trang nội dung dài không có link nội bộ nào trong thân bài`, { why: 'Theo mô hình Reasonable Surfer, link trong nội dung chính có trọng số cao hơn nhiều link menu/footer.', fix: 'Thêm 2–5 link ngữ cảnh tới bài liên quan và trang chủ lực.', patents: ['US7716225B1', 'US8447760B1'], urls: noContextLinks.map((p) => ({ url: p.url })) }));

  // outbound: external domains linked from most pages (sitewide)
  const domPages = new Map();
  for (const p of html) for (const dom of new Set(p.links.filter((l) => !l.href.includes(site.host)).map((l) => new URL(l.href).host.replace(/^www\./, ''))))
    domPages.set(dom, (domPages.get(dom) || 0) + 1);
  const social = /facebook|youtube|instagram|tiktok|twitter|x\.com|linkedin|zalo|pinterest|google|messenger|t\.me|shopee|lazada/;
  const sitewide = [...domPages.entries()].filter(([dom, n]) => html.length >= 10 && n / html.length > 0.5 && !social.test(dom));
  if (sitewide.length)
    out.push(issue('links', 'sitewide-outbound', 'medium', `${sitewide.length} domain bên ngoài được link từ > 50% số trang (link sitewide)`, { why: 'Chất lượng của "hàng xóm" (site link đến/đi) ảnh hưởng điểm chất lượng; link sitewide ở footer/sidebar là mẫu hình của link mua bán/trao đổi.', fix: 'Kiểm tra từng domain: nếu là đối tác/quảng cáo, gắn rel="sponsored"/"nofollow" hoặc chỉ đặt ở trang liên quan.', patents: ['US9183499B1', 'US7716225B1', 'US8719276B1'], urls: sitewide.map(([dom, n]) => ({ url: dom, note: `${n}/${html.length} trang` })) }));

  const extDomains = [...domPages.keys()].filter((d) => !social.test(d));
  site.outboundDomains = [...domPages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  out.push(issue('links', 'backlink-manual', 'info', 'Backlink chưa được phân tích — cần dữ liệu từ Ahrefs/Semrush/GSC', { why: 'Nhóm Liên kết quan trọng nhất (độc lập nguồn, khoảng cách tới seed, vị trí link, tỷ lệ link chất lượng) cần danh sách backlink.', fix: 'Xuất backlink (GSC → Liên kết, hoặc Ahrefs) rồi chạy lại với --backlinks <file.csv>.', patents: ['US9165040B1', 'US8825645B1', 'US9002832B1'], metric: extDomains.length }));
  return out;
}

// Backlinks normalised by lib/sources.mjs (GSC "Top linking sites", Ahrefs or Semrush backlink exports):
// rows = [{ source, anchor, dr, traffic, ip }]; a field is null when no uploaded file had that column.
export function backlinks(rows, site) {
  const out = [];
  if (!rows.length) return out;
  const has = (k) => rows.some((r) => r[k] !== null && r[k] !== undefined);
  const host = (s) => { try { return new URL(/^https?:/.test(s) ? s : 'http://' + s).host.replace(/^www\./, ''); } catch { return s; } };
  const domains = new Map();
  for (const r of rows) {
    const d = host(r.source || '');
    if (!d) continue;
    const x = domains.get(d) || { d, n: 0, anchors: [], dr: r.dr, traffic: r.traffic || 0, ip: r.ip || null };
    x.n++;
    if (r.anchor) x.anchors.push(r.anchor);
    if (x.dr === null && r.dr !== null) x.dr = r.dr;
    x.traffic = Math.max(x.traffic, r.traffic || 0);
    domains.set(d, x);
  }
  const D = [...domains.values()];
  site.backlinkSummary = { domains: D.length, rows: rows.length };
  const cDr = has('dr'), cTraffic = has('traffic'), cIp = has('ip'), cAnchor = has('anchor');

  if (cDr) {
    const low = D.filter((x) => x.dr !== null && x.dr < 10);
    if (low.length / D.length > 0.5)
      out.push(issue('links', 'bl-low-quality-share', 'high', `${pct(low.length, D.length)}% referring domain có DR < 10`, { why: 'Google phân nhóm các trang link tới site theo chất lượng; nếu tỷ lệ link từ nhóm kém quá cao, cả site có thể bị phân loại là chất lượng thấp.', fix: 'Ưu tiên xây link từ site có traffic thật và liên quan; cân nhắc disavow nhóm rác rõ ràng.', patents: ['US9002832B1', 'US9558233B1'], urls: low.slice(0, 200).map((x) => ({ url: x.d, note: `DR ${x.dr}` })), total: D.length }));
  }
  if (cTraffic) {
    const noTraffic = D.filter((x) => !x.traffic);
    if (noTraffic.length / D.length > 0.6)
      out.push(issue('links', 'bl-no-traffic', 'medium', `${pct(noTraffic.length, D.length)}% referring domain không có traffic organic`, { why: 'Link có người click thật giá trị hơn link không ai click; site nguồn không traffic thường là PBN/site rác.', fix: 'Đánh giá lại nguồn link; ưu tiên site có traffic thật.', patents: ['US9558233B1', 'US7716225B1'], urls: noTraffic.slice(0, 200).map((x) => ({ url: x.d })), total: D.length }));
  }
  if (cIp) {
    const byIp = new Map();
    for (const x of D) if (x.ip && !isCdnIp(x.ip)) { const c = x.ip.split('.').slice(0, 3).join('.'); byIp.set(c, [...(byIp.get(c) || []), x.d]); }
    const clusters = [...byIp.entries()].filter(([, ds]) => ds.length >= 3);
    if (clusters.length)
      out.push(issue('links', 'bl-ip-clusters', 'medium', `${clusters.length} cụm ≥ 3 referring domain cùng dải IP (C-class)`, { why: 'Link từ các site cùng chủ/cùng mạng chỉ được tính như một nguồn (thậm chí chia nhỏ theo kích thước cụm).', fix: 'Không tính các cụm này là nguồn độc lập; kiểm tra có phải mạng vệ tinh không.', patents: ['US8825645B1', 'US8719276B1', 'US7302645B1'], urls: clusters.map(([ip, ds]) => ({ url: ip + '.*', note: ds.slice(0, 6).join(', ') })) }));
  }
  if (cAnchor) {
    const all = D.flatMap((x) => x.anchors);
    const brand = (site.brand || []).map((b) => b.toLowerCase());
    const isBrand = (a) => brand.some((b) => a.toLowerCase().includes(b)) || a.toLowerCase().includes(site.host.split('.')[0]);
    const nonBrand = all.filter((a) => a && !isBrand(a) && !/^https?:|www\./i.test(a));
    const freq = new Map();
    for (const a of nonBrand) freq.set(a.toLowerCase(), (freq.get(a.toLowerCase()) || 0) + 1);
    const top = [...freq.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top && all.length >= 30 && top[1] / all.length > 0.15)
      out.push(issue('links', 'bl-anchor-overopt', 'high', `Anchor "${top[0]}" chiếm ${pct(top[1], all.length)}% backlink`, { why: 'Tỷ lệ anchor khớp chính xác bất thường là dấu hiệu thao túng; tăng đột biến anchor spam được Google theo dõi (anchor spam info trong leak).', fix: 'Đa dạng hoá anchor: thương hiệu, URL, mô tả tự nhiên.', patents: ['US10210256B2', 'US8244722B1'], metric: top[1], total: all.length }));
  }
  return out;
}
