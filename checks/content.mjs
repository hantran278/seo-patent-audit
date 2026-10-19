// Site quality, topicality & structure, spam, entities/brand, authorship
import { issue, isHtml200, isIndexable } from './common.mjs';
import { tokenize, STOP, pct } from '../lib/util.mjs';

const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase();
const terms = (t) => tokenize(t).filter((w) => !STOP.has(w) && w.length > 2);

export function siteQuality(site) {
  const out = [];
  const pages = site.pages.filter(isIndexable);
  if (!pages.length) return out;

  const thin = pages.filter((p) => p.words < 250 && p.url !== site.start);
  if (thin.length)
    out.push(issue('site-quality', 'thin-content', pct(thin.length, pages.length) > 20 ? 'high' : 'medium', `${thin.length} trang indexable có nội dung chính < 250 từ (${pct(thin.length, pages.length)}%)`, {
      why: 'Chất lượng được tính ở cấp site/thư mục: tỷ lệ lớn trang mỏng kéo điểm cả site xuống và khiến trang bị loại khỏi index ("Đã thu thập – chưa lập chỉ mục").',
      fix: 'Với từng trang: bổ sung nội dung thực chất, gộp vào trang liên quan (301), hoặc noindex nếu là trang tiện ích (thẻ, lọc, trang trống).',
      patents: ['US8682892B1', 'US8554759B1', 'US9195944B1'], urls: thin.map((p) => ({ url: p.url, note: `${p.words} từ` })), total: pages.length }));

  // boilerplate paragraphs repeated across many pages (phrase-model site quality prediction)
  const df = new Map();
  for (const p of pages) for (const para of new Set(p.paragraphs)) df.set(para, (df.get(para) || 0) + 1);
  const minPages = Math.max(5, Math.ceil(pages.length * 0.3));
  const boiler = [...df.entries()].filter(([, n]) => n >= minPages).sort((a, b) => b[1] - a[1]);
  if (boiler.length)
    out.push(issue('site-quality', 'boilerplate', boiler.length >= 5 ? 'medium' : 'low', `${boiler.length} đoạn văn lặp lại trong nội dung chính của ≥ 30% số trang`, {
      why: 'Google dự đoán chất lượng site từ tần suất các cụm từ lặp trên nhiều trang; đoạn template lặp lại hàng loạt là đặc điểm thường gặp ở site chất lượng thấp/nội dung tự động.',
      fix: 'Bỏ đoạn giới thiệu/kêu gọi lặp lại khỏi nội dung chính; đưa thông tin chung vào một trang riêng và link tới.',
      patents: ['US9767157B2', 'US20120265757A1'], urls: boiler.map(([t, n]) => ({ url: t.slice(0, 140) + (t.length > 140 ? '…' : ''), note: `xuất hiện trên ${n} trang` })) }));

  // trust pages
  const allLinks = site.pages.filter(isHtml200).flatMap((p) => p.links.map((l) => deaccent(l.href + ' ' + l.text)));
  const need = { 'Giới thiệu / About': /gioi-thieu|about|ve-chung-toi|\bgioi thieu\b|ve chung toi/, 'Liên hệ / Contact': /lien-he|contact|lien he/, 'Chính sách / Privacy': /chinh-sach|privacy|bao-mat|dieu-khoan|terms|chinh sach/ };
  const missing = Object.entries(need).filter(([, re]) => !allLinks.some((s) => re.test(s))).map(([k]) => k);
  if (missing.length)
    out.push(issue('site-quality', 'trust-pages', 'medium', `Không tìm thấy link tới trang: ${missing.join(', ')}`, {
      why: 'Quality rater đánh giá thông tin về site (ai sở hữu, liên hệ thế nào); đánh giá này huấn luyện mô hình chấm chất lượng mọi site.',
      fix: 'Tạo trang Giới thiệu (fact về doanh nghiệp, đội ngũ), Liên hệ (địa chỉ, SĐT), Chính sách; link từ footer.',
      patents: ['US8442984B1', 'US9116945B1'], metric: missing.length }));

  // topic focus: pages whose main terms barely overlap the site's core vocabulary
  const pageTerms = pages.filter((p) => p.words >= 150).map((p) => {
    const tf = new Map();
    for (const w of terms(p.mainText)) tf.set(w, (tf.get(w) || 0) + 1);
    return { p, top: [...tf.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w) };
  });
  if (pageTerms.length >= 10) {
    const dfT = new Map();
    for (const x of pageTerms) for (const w of x.top) dfT.set(w, (dfT.get(w) || 0) + 1);
    const core = new Set([...dfT.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([w]) => w));
    const off = pageTerms.filter((x) => x.top.filter((w) => core.has(w)).length <= 1);
    site.coreTerms = [...core];
    site.offTopicPages = off.map((x) => x.p.url);
    if (off.length / pageTerms.length > 0.15)
      out.push(issue('site-quality', 'topic-drift', 'medium', `${off.length} trang (${pct(off.length, pageTerms.length)}%) có chủ đề lệch khỏi trọng tâm của site`, {
        why: 'Google cộng điểm liên quan của cả site vào từng trang và đo mức tập trung chủ đề (siteFocusScore/siteRadius trong leak); nội dung lạc đề làm loãng hồ sơ chủ đề.',
        fix: 'Xem xét xoá/tách/noindex nội dung không liên quan tới chủ đề cốt lõi; tập trung phát triển cụm chủ đề chính.',
        patents: ['US8548995B1', 'US8595225B1', 'US9244972B1'], urls: off.map((x) => ({ url: x.p.url, note: x.top.slice(0, 5).join(', ') })), total: pageTerms.length }));
  }
  return out;
}

export function topicality(site) {
  const out = [];
  const pages = site.pages.filter(isIndexable);
  const noH1 = pages.filter((p) => !p.h1.length);
  const multiH1 = pages.filter((p) => p.h1.length > 1);
  if (noH1.length)
    out.push(issue('topicality', 'h1-missing', 'medium', `${noH1.length} trang không có H1`, { why: 'Entity chủ đề của trang được xác định qua title/URL/heading; thiếu H1 làm chủ đề kém rõ ràng.', fix: 'Mỗi trang một H1 mô tả entity/chủ đề chính.', patents: ['US10068022B2', 'US8166045B1'], urls: noH1.map((p) => ({ url: p.url })), total: pages.length }));
  if (multiH1.length)
    out.push(issue('topicality', 'h1-multiple', 'low', `${multiH1.length} trang có nhiều H1`, { fix: 'Giữ một H1; các tiêu đề còn lại dùng H2/H3.', patents: ['US8060501B1'], urls: multiH1.map((p) => ({ url: p.url, note: p.h1.slice(0, 3).join(' | ') })) }));

  const skips = pages.filter((p) => p.headings.some((h, i) => i > 0 && h.level > p.headings[i - 1].level + 1));
  if (skips.length)
    out.push(issue('topicality', 'heading-skip', 'low', `${skips.length} trang có heading nhảy cấp (ví dụ H2 → H4)`, { why: 'Google tính "khoảng cách" giữa các từ theo cấu trúc heading/list; thứ bậc heading đúng giúp heading phủ nghĩa cho nội dung bên dưới.', fix: 'Dùng heading theo đúng thứ bậc H1 → H2 → H3.', patents: ['US8060501B1'], urls: skips.map((p) => ({ url: p.url })) }));

  const longNoSub = pages.filter((p) => p.words > 800 && !p.headings.some((h) => h.level === 2));
  if (longNoSub.length)
    out.push(issue('topicality', 'no-subheadings', 'medium', `${longNoSub.length} trang dài > 800 từ nhưng không có H2`, { why: 'Google chấm điểm passage theo ngữ cảnh heading chứa nó; thiếu H2 khiến từng đoạn khó được chọn làm câu trả lời.', fix: 'Chia nội dung thành các mục H2 theo từng khía cạnh/câu hỏi.', patents: ['US9959315B1', 'US8060501B1'], urls: longNoSub.map((p) => ({ url: p.url, note: `${p.words} từ` })) }));

  // topical entity: H1 terms should appear in title and URL
  const misaligned = [];
  for (const p of pages) {
    if (!p.h1[0] || !p.title) continue;
    const h = terms(p.h1[0]);
    if (h.length < 2) continue;
    const t = new Set(terms(p.title));
    const overlap = h.filter((w) => t.has(w)).length / h.length;
    const slug = deaccent(decodeURIComponent(new URL(p.url).pathname));
    const inSlug = h.filter((w) => slug.includes(deaccent(w))).length / h.length;
    if (overlap < 0.4 || (slug.length > 3 && inSlug === 0)) misaligned.push({ url: p.url, note: `title ${Math.round(overlap * 100)}% · URL ${Math.round(inSlug * 100)}% từ của H1` });
  }
  if (misaligned.length)
    out.push(issue('topicality', 'entity-alignment', 'medium', `${misaligned.length} trang có H1 không khớp title và/hoặc URL`, { why: 'Google xác định entity chủ đề của trang một phần qua việc entity xuất hiện trong title hoặc URL; ba vị trí này nên thống nhất một chủ đề.', fix: 'Đảm bảo entity/chủ đề chính của trang có trong H1, title và slug URL.', patents: ['US10068022B2'], urls: misaligned }));

  const fake = pages.filter((p) => p.fakeList > 0);
  if (fake.length)
    out.push(issue('topicality', 'fake-lists', 'low', `${fake.length} trang dùng danh sách giả (gạch đầu dòng bằng ký tự trong <p>)`, { fix: 'Dùng thẻ <ul>/<ol> thật để Google hiểu quan hệ giữa các mục.', patents: ['US8060501B1', 'US8954438B1'], urls: fake.map((p) => ({ url: p.url })) }));
  return out;
}

export function spam(site) {
  const out = [];
  const pages = site.pages.filter(isHtml200);
  const stuffed = [];
  for (const p of pages) {
    const w = terms(p.mainText);
    if (w.length < 200) continue;
    const tf = new Map();
    for (const x of w) tf.set(x, (tf.get(x) || 0) + 1);
    const bi = new Map();
    for (let i = 0; i + 1 < w.length; i++) { const k = w[i] + ' ' + w[i + 1]; bi.set(k, (bi.get(k) || 0) + 1); }
    const [t1, c1] = [...tf.entries()].sort((a, b) => b[1] - a[1])[0];
    const [t2, c2] = [...bi.entries()].sort((a, b) => b[1] - a[1])[0] || ['', 0];
    const share = c1 / w.length, share2 = c2 / (w.length - 1);
    if (share > 0.06 || share2 > 0.03) stuffed.push({ url: p.url, note: share2 > 0.03 ? `"${t2}" ${c2} lần (${(share2 * 100).toFixed(1)}%)` : `"${t1}" ${c1} lần (${(share * 100).toFixed(1)}%)` });
  }
  if (stuffed.length)
    out.push(issue('spam', 'keyword-stuffing', stuffed.length > 5 ? 'high' : 'medium', `${stuffed.length} trang có dấu hiệu nhồi từ khoá (một từ/cụm chiếm tỷ lệ bất thường)`, { why: 'Google phát hiện spam khi số lần xuất hiện của từ/cụm liên quan vượt xa mức kỳ vọng (keywordStuffingScore trong leak).', fix: 'Viết lại tự nhiên: dùng đồng nghĩa, đại từ, thuật ngữ liên quan thay vì lặp một cụm.', patents: ['US7603345B2', 'US8752184B1'], urls: stuffed }));

  const hidden = pages.filter((p) => p.hidden.length);
  if (hidden.length)
    out.push(issue('spam', 'hidden-text', 'high', `${hidden.length} trang có khối văn bản bị ẩn bằng CSS inline`, { why: 'Google so DOM với render tree để phát hiện văn bản ẩn; văn bản ẩn bị loại khỏi snippet và có thể bị phạt.', fix: 'Xoá văn bản ẩn; nội dung hợp lệ (tab/accordion) nên hiển thị mặc định phần quan trọng. Kiểm tra thủ công vì công cụ chỉ thấy style inline.', patents: ['US9336279B2'], urls: hidden.map((p) => ({ url: p.url, note: p.hidden[0] })) }));
  return out;
}

export function entities(site) {
  const out = [];
  const home = site.pages.find((p) => p.url === site.start) || site.pages.find(isHtml200);
  const all = site.pages.filter(isHtml200);
  const org = all.map((p) => p.org).find(Boolean);
  if (!org)
    out.push(issue('entities', 'org-schema-missing', 'high', 'Không tìm thấy schema Organization/LocalBusiness', { why: 'Thương hiệu là một entity; Google gộp và chứng thực fact về entity từ nhiều nguồn — schema trên site chính thức là nguồn fact rõ ràng nhất.', fix: 'Thêm JSON-LD Organization (hoặc LocalBusiness) trên trang chủ: name, url, logo, sameAs (Facebook, LinkedIn, YouTube…), address, telephone, foundingDate.', patents: ['US8682913B1', 'US10331706B1', 'US7970766B1'], metric: 1 }));
  else {
    const miss = ['name', 'logo', 'sameAs', 'address', 'telephone'].filter((k) => (k === 'sameAs' ? !org.sameAs : !org[k]));
    if (miss.length)
      out.push(issue('entities', 'org-schema-incomplete', 'medium', `Schema tổ chức thiếu trường: ${miss.join(', ')}`, { why: 'sameAs liên kết entity với các hồ sơ chính thức; fact đầy đủ và nhất quán giúp Google chứng thực entity.', fix: 'Bổ sung các trường còn thiếu, đảm bảo khớp với Google Business Profile và mạng xã hội.', patents: ['US8682913B1', 'US9710549B2'], metric: miss.length }));
  }
  const errs = all.filter((p) => p.schemaErrors);
  if (errs.length)
    out.push(issue('entities', 'schema-json-error', 'medium', `${errs.length} trang có JSON-LD lỗi cú pháp`, { fix: 'Sửa JSON-LD (kiểm tra bằng Rich Results Test).', urls: errs.map((p) => ({ url: p.url })) }));
  const noSchema = all.filter((p) => !p.schemaTypes.length);
  if (all.length && noSchema.length / all.length > 0.5)
    out.push(issue('entities', 'schema-coverage', 'low', `${pct(noSchema.length, all.length)}% trang không có dữ liệu có cấu trúc`, { fix: 'Thêm schema phù hợp loại trang: Article, Product, BreadcrumbList, FAQPage, LocalBusiness…', patents: ['US7970766B1', 'US9558186B2'], urls: noSchema.map((p) => ({ url: p.url })), total: all.length }));
  if (home && site.brand?.length) {
    const t = deaccent(home.title || '');
    if (!site.brand.some((b) => t.includes(deaccent(b))))
      out.push(issue('entities', 'brand-home-title', 'medium', 'Title trang chủ không chứa tên thương hiệu', { fix: 'Đưa tên thương hiệu chuẩn vào title trang chủ.', patents: ['US9336211B1', 'US8805867B2'], urls: [{ url: home.url, note: home.title }] }));
  }
  return out;
}

export function authorship(site) {
  const out = [];
  const articles = site.pages.filter((p) => isIndexable(p) && (p.schemaTypes.some((t) => /Article|BlogPosting|NewsArticle/.test(t)) || (/\/(blog|tin-tuc|tin|news|bai-viet|kien-thuc|huong-dan)\//.test(p.url) && p.words > 400)));
  if (!articles.length) return out;
  const noAuthor = articles.filter((p) => !p.authorSchema && !p.byline);
  if (noAuthor.length)
    out.push(issue('authorship', 'no-author', noAuthor.length / articles.length > 0.5 ? 'medium' : 'low', `${noAuthor.length}/${articles.length} bài viết không có thông tin tác giả`, { why: 'Google có các patent chấm điểm uy tín tác giả và xác nhận quyền tác giả; quality rater đánh giá E-E-A-T qua người viết.', fix: 'Hiển thị tác giả (tên, link trang hồ sơ có chuyên môn) và khai báo author trong schema Article.', patents: ['US8150842B2', 'US9177074B2', 'US11868724B2'], urls: noAuthor.map((p) => ({ url: p.url })), total: articles.length }));
  const noDate = articles.filter((p) => !p.datePublished && !p.dateModified);
  if (noDate.length)
    out.push(issue('authorship', 'no-date', 'low', `${noDate.length}/${articles.length} bài viết không khai báo ngày đăng/cập nhật`, { why: 'Google dùng dữ liệu lịch sử và độ tươi của tài liệu; ngày rõ ràng giúp đánh giá đúng.', fix: 'Thêm datePublished/dateModified (schema) và hiển thị ngày trên trang; chỉ cập nhật dateModified khi nội dung chính thay đổi thật.', patents: ['US7346839B2', 'US8868541B2'], urls: noDate.map((p) => ({ url: p.url })), total: articles.length }));
  return out;
}
