// Crawl & index, duplicates/canonical, page experience
import { issue, isHtml200, isNoindex, isIndexable } from './common.mjs';
import { simhash, hamming, pct } from '../lib/util.mjs';

export function crawlIndex(site) {
  const out = [];
  const P = site.pages;
  const byUrl = new Map(P.map((p) => [p.url, p]));
  const html = P.filter(isHtml200);

  if (site.robots.status !== 200)
    out.push(issue('crawl-index', 'robots-missing', 'low', 'Không tìm thấy robots.txt', { why: 'robots.txt là nơi khai báo sitemap cho crawler.', fix: 'Tạo robots.txt và khai báo dòng Sitemap:.', patents: ['US9355177B2'], metric: 1 }));
  if (!site.sitemap.count)
    out.push(issue('crawl-index', 'sitemap-missing', 'high', 'Không tìm thấy sitemap XML (hoặc sitemap rỗng)', { why: 'Google dùng sitemap + lastmod để lập lịch crawl và phát hiện trang mới/thay đổi.', fix: 'Tạo sitemap XML chỉ chứa URL indexable, khai báo trong robots.txt và GSC.', patents: ['US9355177B2'], metric: 1 }));
  else if (!site.robots.sitemaps.length)
    out.push(issue('crawl-index', 'sitemap-not-in-robots', 'low', 'Sitemap chưa được khai báo trong robots.txt', { fix: 'Thêm dòng "Sitemap: <url>" vào robots.txt.', patents: ['US9355177B2'], metric: 1 }));

  const errors = P.filter((p) => p.status >= 400 || p.status === 0);
  if (errors.length)
    out.push(issue('crawl-index', 'broken-pages', 'high', `${errors.length} URL trả lỗi (4xx/5xx/timeout)`, { why: 'URL lỗi lặp lại bị loại khỏi lịch crawl; link nội bộ trỏ tới URL lỗi lãng phí crawl budget và PageRank.', fix: 'Sửa link nội bộ trỏ tới URL lỗi; redirect 301 URL đã xoá có giá trị về trang thay thế.', patents: ['US7725452B1'], urls: errors.map((p) => ({ url: p.url, note: `${p.status || p.error} · ${p.inlinks.length} link nội bộ trỏ tới` })), total: P.length }));

  const chains = P.filter((p) => p.chain?.length >= 2);
  if (chains.length)
    out.push(issue('crawl-index', 'redirect-chains', 'medium', `${chains.length} URL qua chuỗi redirect ≥ 2 bước`, { fix: 'Trỏ link nội bộ thẳng tới URL đích cuối cùng; rút chuỗi redirect còn 1 bước.', patents: ['US7725452B1'], urls: chains.map((p) => ({ url: p.url, note: p.chain.map((c) => c.status).join(' → ') + ' → ' + p.finalUrl })) }));
  const internalRedirectTargets = P.filter((p) => p.chain?.length && p.inlinks.length);
  if (internalRedirectTargets.length)
    out.push(issue('crawl-index', 'links-to-redirects', 'low', `${internalRedirectTargets.length} URL bị redirect nhưng vẫn được link nội bộ`, { fix: 'Cập nhật link nội bộ trỏ thẳng tới URL cuối.', patents: ['US7725452B1'], urls: internalRedirectTargets.map((p) => ({ url: p.url, note: `→ ${p.finalUrl} · ${p.inlinks.length} link` })) }));

  const blocked = P.filter((p) => p.blockedByRobots);
  if (blocked.length)
    out.push(issue('crawl-index', 'robots-blocked', 'medium', `${blocked.length} URL được link nội bộ nhưng bị robots.txt chặn`, { fix: 'Kiểm tra URL này có cần index không; nếu không, bỏ link nội bộ hoặc dùng noindex thay vì chặn robots.', urls: blocked.map((p) => ({ url: p.url })) }));

  const noindex = html.filter(isNoindex);
  const noindexInSitemap = noindex.filter((p) => p.inSitemap);
  if (noindexInSitemap.length)
    out.push(issue('crawl-index', 'sitemap-noindex', 'medium', `${noindexInSitemap.length} URL noindex nằm trong sitemap`, { why: 'Sitemap chỉ nên chứa URL muốn index; tín hiệu mâu thuẫn làm giảm độ tin cậy của sitemap.', fix: 'Loại URL noindex khỏi sitemap.', patents: ['US9355177B2'], urls: noindexInSitemap.map((p) => ({ url: p.url })) }));
  const badInSitemap = P.filter((p) => p.inSitemap && (p.status !== 200 || p.chain?.length || (p.canonical && p.canonical !== p.url)));
  if (badInSitemap.length)
    out.push(issue('crawl-index', 'sitemap-non-canonical', 'medium', `${badInSitemap.length} URL trong sitemap không phải URL chuẩn (lỗi/redirect/canonical sang trang khác)`, { fix: 'Sitemap chỉ chứa URL trả 200, không redirect, canonical tự trỏ.', patents: ['US9355177B2', 'US8868559B2'], urls: badInSitemap.map((p) => ({ url: p.url, note: p.chain?.length ? `redirect → ${p.finalUrl}` : p.status !== 200 ? String(p.status) : `canonical → ${p.canonical}` })) }));

  const lastmods = [...P.filter((p) => p.lastmod).map((p) => p.lastmod.slice(0, 10))];
  if (lastmods.length >= 20) {
    const top = Object.entries(lastmods.reduce((m, d) => ((m[d] = (m[d] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1])[0];
    if (top[1] / lastmods.length > 0.8)
      out.push(issue('crawl-index', 'fake-lastmod', 'medium', `${pct(top[1], lastmods.length)}% URL trong sitemap có cùng lastmod (${top[0]})`, { why: 'Google chỉ tin lastmod khi nó phản ánh thay đổi thật ở nội dung chính; lastmod đồng loạt bị bỏ qua.', fix: 'Cấu hình lastmod = ngày nội dung chính thay đổi thật.', patents: ['US9355177B2', 'US8868541B2'], metric: top[1], total: lastmods.length }));
  }

  const orphans = P.filter((p) => p.inSitemap && !p.inlinks.length && isHtml200(p));
  if (orphans.length || site.orphanCount)
    out.push(issue('crawl-index', 'orphans', 'medium', `${Math.max(orphans.length, site.orphanCount)} URL trong sitemap không có link nội bộ nào trỏ tới (trang mồ côi)`, { why: 'Trang mồ côi không nhận PageRank nội bộ và bị coi là kém quan trọng khi chọn trang để crawl/index.', fix: 'Thêm link nội bộ từ trang liên quan/danh mục, hoặc loại khỏi sitemap nếu không cần.', patents: ['US7509315B1', 'US6285999B1'], urls: orphans.map((p) => ({ url: p.url })) }));

  const deep = html.filter((p) => p.depth !== null && p.depth > 3 && isIndexable(p));
  if (deep.length)
    out.push(issue('crawl-index', 'deep-pages', 'low', `${deep.length} trang indexable cách trang chủ > 3 click`, { fix: 'Rút ngắn đường dẫn: link từ danh mục/hub/trang chủ tới trang quan trọng.', patents: ['US7509315B1'], urls: deep.map((p) => ({ url: p.url, note: `độ sâu ${p.depth}` })) }));

  const param = html.filter((p) => /\?/.test(p.url));
  if (html.length && param.length / html.length > 0.2)
    out.push(issue('crawl-index', 'param-urls', 'medium', `${pct(param.length, html.length)}% URL crawl được có tham số (?)`, { why: 'Crawl budget có giới hạn; URL tham số (lọc, sắp xếp, tìm kiếm) làm trang quan trọng bị crawl ít hơn.', fix: 'Canonical về URL gốc, noindex hoặc chặn các tham số không cần index; không link nội bộ tới URL tham số.', patents: ['US7509315B1', 'US8548972B1'], urls: param.map((p) => ({ url: p.url })), total: html.length }));

  const slow = html.filter((p) => p.ttfb > 1000);
  if (slow.length)
    out.push(issue('crawl-index', 'slow-server', slow.length / Math.max(html.length, 1) > 0.3 ? 'high' : 'medium', `${slow.length} trang có thời gian phản hồi server > 1 giây`, { why: 'Server chậm khiến Google giảm tốc độ crawl; thời gian tải cũng là tín hiệu xếp hạng.', fix: 'Bật cache trang/CDN, tối ưu truy vấn database, nâng hosting.', patents: ['US8032518B2', 'US8645362B1'], urls: slow.map((p) => ({ url: p.url, note: `${p.ttfb} ms` })), total: html.length }));
  return out;
}

export function duplicates(site) {
  const out = [];
  const html = site.pages.filter(isHtml200);
  const indexable = html.filter((p) => !isNoindex(p));

  const variantTargets = new Set(site.variants.filter((v) => v.status === 200).map((v) => v.to));
  const badVariants = site.variants.filter((v) => v.status !== 200 || v.hops > 1);
  if (variantTargets.size > 1)
    out.push(issue('duplicates', 'host-variants', 'high', `Có ${variantTargets.size} phiên bản host cùng truy cập được (http/https, www/non-www)`, { why: 'Nhiều phiên bản host có cùng nội dung bị coi là mirror; Google tự chọn một bản và tín hiệu bị chia nhỏ.', fix: 'Redirect 301 mọi biến thể về một phiên bản duy nhất (https + www hoặc non-www).', patents: ['US7930400B1', 'US8713071B1'], urls: site.variants.map((v) => ({ url: v.from, note: `→ ${v.to} (${v.status}, ${v.hops} bước)` })) }));
  else if (badVariants.length)
    out.push(issue('duplicates', 'host-variant-hops', 'low', 'Biến thể host redirect nhiều hơn 1 bước', { fix: 'Redirect thẳng http://, www về URL chuẩn trong 1 bước.', patents: ['US7930400B1'], urls: badVariants.map((v) => ({ url: v.from, note: `→ ${v.to} (${v.status || v.error}, ${v.hops} bước)` })) }));

  const noCanon = indexable.filter((p) => !p.canonical);
  if (noCanon.length)
    out.push(issue('duplicates', 'canonical-missing', 'medium', `${noCanon.length} trang không có thẻ canonical`, { why: 'Không chỉ định canonical, Google tự chọn URL đại diện theo PageRank — có thể không phải URL bạn muốn.', fix: 'Thêm <link rel="canonical"> tự trỏ cho mọi trang indexable.', patents: ['US8868559B2', 'US7627613B1'], urls: noCanon.map((p) => ({ url: p.url })), total: indexable.length }));
  const multiCanon = html.filter((p) => p.canonicalCount > 1);
  if (multiCanon.length)
    out.push(issue('duplicates', 'canonical-multiple', 'high', `${multiCanon.length} trang có nhiều thẻ canonical`, { fix: 'Chỉ giữ một thẻ canonical (thường do theme + plugin SEO cùng chèn).', patents: ['US8868559B2'], urls: multiCanon.map((p) => ({ url: p.url })) }));
  const byUrl = new Map(site.pages.map((p) => [p.url, p]));
  const canonBad = html.filter((p) => p.canonical && p.canonical !== p.url && byUrl.has(p.canonical) && byUrl.get(p.canonical).status !== 200);
  if (canonBad.length)
    out.push(issue('duplicates', 'canonical-broken', 'high', `${canonBad.length} trang có canonical trỏ tới URL lỗi/redirect`, { fix: 'Canonical phải trỏ tới URL trả 200, indexable.', patents: ['US8868559B2'], urls: canonBad.map((p) => ({ url: p.url, note: `→ ${p.canonical} (${byUrl.get(p.canonical).status})` })) }));
  const canonOther = html.filter((p) => p.canonical && p.canonical !== p.url && p.inlinks.length >= 3);
  if (canonOther.length)
    out.push(issue('duplicates', 'links-to-noncanonical', 'low', `${canonOther.length} URL không chuẩn (canonical sang trang khác) vẫn nhận nhiều link nội bộ`, { why: 'Link nội bộ nên trỏ nhất quán tới URL canonical để dồn PageRank về đúng URL.', fix: 'Sửa link nội bộ trỏ tới URL canonical.', patents: ['US8868559B2'], urls: canonOther.map((p) => ({ url: p.url, note: `canonical → ${p.canonical} · ${p.inlinks.length} link` })) }));

  // duplicate titles / descriptions
  for (const [field, label, sev] of [['title', 'title', 'medium'], ['metaDesc', 'meta description', 'low']]) {
    const groups = new Map();
    for (const p of indexable) if (p[field]) groups.set(p[field], [...(groups.get(p[field]) || []), p]);
    const dups = [...groups.values()].filter((g) => g.length > 1);
    if (dups.length)
      out.push(issue('duplicates', `dup-${field}`, sev, `${dups.reduce((a, g) => a + g.length, 0)} trang dùng chung ${label} (${dups.length} nhóm)`, { fix: `Viết ${label} riêng cho từng trang, phản ánh entity/chủ đề riêng của trang.`, patents: ['US10068022B2'], urls: dups.flatMap((g) => g.map((p) => ({ url: p.url, note: p[field].slice(0, 80) }))) }));
    const missing = indexable.filter((p) => !p[field]);
    if (missing.length)
      out.push(issue('duplicates', `missing-${field}`, field === 'title' ? 'high' : 'low', `${missing.length} trang thiếu ${label}`, { patents: field === 'title' ? ['US10068022B2'] : [], urls: missing.map((p) => ({ url: p.url })) }));
  }

  // near-duplicate main content (simhash)
  const hashed = indexable.map((p) => ({ p, h: simhash(p.mainText) })).filter((x) => x.h !== null);
  const pairs = [];
  for (let i = 0; i < hashed.length; i++)
    for (let j = i + 1; j < hashed.length; j++) {
      const d = hamming(hashed[i].h, hashed[j].h);
      if (d <= 4) pairs.push({ a: hashed[i].p.url, b: hashed[j].p.url, d });
    }
  if (pairs.length)
    out.push(issue('duplicates', 'near-duplicates', pairs.length > 10 ? 'high' : 'medium', `${pairs.length} cặp trang có nội dung chính gần trùng lặp`, { why: 'Google gom các trang gần trùng lặp và chỉ index một bản; nội dung template chỉ đổi vài từ (ví dụ tên tỉnh) vẫn bị phát hiện và có thể bị coi là doorway.', fix: 'Gộp các trang (301 + canonical), hoặc viết lại nội dung thực sự khác biệt cho từng trang.', patents: ['US9275143B2', 'US8548972B1', 'US7711679B2', 'US7302645B1'], urls: pairs.map((x) => ({ url: x.a, note: `≈ ${x.b} (khác ${x.d}/64 bit)` })) }));
  return out;
}

export function pageExperience(site) {
  const out = [];
  const html = site.pages.filter(isHtml200);
  if (!site.start.startsWith('https:'))
    out.push(issue('page-experience', 'no-https', 'high', 'Site không dùng HTTPS', { fix: 'Cài SSL và redirect toàn bộ http → https.', patents: ['US8019700B2'], metric: 1 }));
  const noViewport = html.filter((p) => !/width\s*=\s*device-width/i.test(p.viewport));
  if (noViewport.length)
    out.push(issue('page-experience', 'no-viewport', 'high', `${noViewport.length} trang thiếu meta viewport cho mobile`, { why: 'Google render trang và chấm điểm mobile-friendly; thiếu viewport là lỗi cơ bản nhất.', fix: 'Thêm <meta name="viewport" content="width=device-width, initial-scale=1">.', patents: ['US20160314215A1', 'US11036804B1'], urls: noViewport.map((p) => ({ url: p.url })), total: html.length }));
  const mixed = html.filter((p) => p.mixed > 0);
  if (mixed.length)
    out.push(issue('page-experience', 'mixed-content', 'medium', `${mixed.length} trang HTTPS tải tài nguyên qua HTTP (mixed content)`, { fix: 'Đổi mọi src/href tài nguyên sang https.', patents: ['US8019700B2'], urls: mixed.map((p) => ({ url: p.url, note: `${p.mixed} tài nguyên` })) }));
  const heavy = html.filter((p) => p.bytes > 500 * 1024);
  if (heavy.length)
    out.push(issue('page-experience', 'heavy-html', 'low', `${heavy.length} trang có HTML > 500 KB`, { fix: 'Giảm inline CSS/JS/SVG, dữ liệu nhúng, DOM quá lớn.', patents: ['US8645362B1'], urls: heavy.map((p) => ({ url: p.url, note: `${Math.round(p.bytes / 1024)} KB` })) }));
  const noAlt = html.filter((p) => p.imgCount >= 3 && p.imgNoAlt / p.imgCount > 0.5);
  if (noAlt.length)
    out.push(issue('page-experience', 'img-alt', 'low', `${noAlt.length} trang có > 50% ảnh thiếu alt`, { fix: 'Thêm alt mô tả cho ảnh nội dung (ảnh trang trí dùng alt="").', patents: ['US8732187B1'], urls: noAlt.map((p) => ({ url: p.url, note: `${p.imgNoAlt}/${p.imgCount} ảnh` })) }));
  out.push(issue('page-experience', 'cwv-manual', 'info', 'Cần kiểm tra Core Web Vitals bằng dữ liệu thật (GSC → Chỉ số thiết yếu về trang web)', { why: 'Google dùng thời gian tải đo từ người dùng thật (field data), không phải điểm Lighthouse. Công cụ crawl không đo được dữ liệu này.', fix: 'Xem báo cáo CWV trong GSC hoặc PageSpeed Insights (phần "Dữ liệu thực tế"); ưu tiên nhóm URL "Kém" có traffic lớn.', patents: ['US8645362B1'], metric: 0 }));
  return out;
}
