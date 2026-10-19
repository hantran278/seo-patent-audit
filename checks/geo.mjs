// GEO / AI-readiness and small on-page hygiene checks, measured on every crawled page at once
// (a single-page extension can only see one URL; here each issue lists all affected pages).
import { issue, isHtml200, isIndexable } from './common.mjs';
import { aiRobotsMatrix } from '../lib/robots-ai.mjs';

const SHARE = /facebook\.com\/(sharer|share\.php)|twitter\.com\/(intent|share)|x\.com\/intent|linkedin\.com\/(sharing|shareArticle)|pinterest\.com\/pin\/create|reddit\.com\/submit|t\.me\/share|wa\.me\/|api\.whatsapp\.com|^mailto:|^tel:/i;
// generic and call-to-action anchors say nothing about the target, so reusing them across targets is expected
const GENERIC = /^(xem thêm|đọc thêm|xem chi tiết|chi tiết|tại đây|bấm vào đây|tìm hiểu thêm|khám phá|liên hệ|liên hệ ngay|bắt đầu|click|click here|here|read more|learn more|more|see more|view more|view|view details|see details|details|explore|explore more|discover|discover more|find out more|get started|start now|contact|contact us|get in touch|book a call|let's talk|link|trang này|this page)$/i;
// short "verb + object" buttons ("view case study", "xem tất cả") are CTAs too
const CTA = /^(view|see|read|explore|discover|learn|get|book|try|xem|đọc|khám phá|tìm hiểu|đăng ký|nhận)\b/i;
// links to files (image lightboxes, PDFs) are not topical page links
const FILE = /\.(jpe?g|png|gif|webp|avif|svg|pdf|zip|mp4|webm|docx?|xlsx?|pptx?)(\?|#|$)/i;
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
const bare = (u) => { try { const x = new URL(u); x.hash = ''; return x.href.replace(/\/$/, ''); } catch { return u; } };
// pages crawled before these signals existed (cached runs) are skipped rather than flagged
const has = (p, k) => p[k] !== undefined;

export function geoChecks(site) {
  const out = [];
  const html = site.pages.filter(isHtml200);
  const idx = html.filter(isIndexable);
  const internal = (l) => hostOf(l.href) === site.host;
  const articles = idx.filter((p) => p.words >= 600 && has(p, 'paraCount'));
  // editorial pages (blog / insight / news): only these are expected to cite sources and give figures;
  // home, service and about pages are not held to that.
  const editorial = articles.filter((p) => p.schemaInfo?.article || p.datePublished || /\/(blog|insights?|news|tin-tuc|bai-viet|kien-thuc|knowledge|articles?|posts?|guides?|huong-dan)\//i.test(p.url));

  // ── hygiene ──
  const noUtf8 = html.filter((p) => has(p, 'charset') && !/^utf-?8$/.test(p.charset) && !/charset=utf-?8/i.test(p.type || ''));
  if (noUtf8.length)
    out.push(issue('page-experience', 'charset-not-utf8', 'low', `${noUtf8.length} trang không khai báo bảng mã UTF-8`, { why: 'Thiếu khai báo UTF-8 (thẻ meta charset hoặc header Content-Type) có thể làm trình duyệt và crawler giải mã sai ký tự tiếng Việt.', fix: 'Thêm <meta charset="utf-8"> ngay đầu <head> và trả header Content-Type: text/html; charset=utf-8.', urls: noUtf8.map((p) => ({ url: p.url, note: p.charset ? 'charset=' + p.charset : 'không khai báo' })), total: html.length }));

  const noDoctype = html.filter((p) => has(p, 'html5Doctype') && !p.html5Doctype);
  if (noDoctype.length)
    out.push(issue('page-experience', 'doctype-missing', 'low', `${noDoctype.length} trang thiếu <!DOCTYPE html>`, { why: 'Không có doctype HTML5, trình duyệt render ở quirks mode: bố cục và CSS có thể lệch, ảnh hưởng trải nghiệm và CLS.', fix: 'Đặt <!DOCTYPE html> ở dòng đầu tiên của mọi template.', urls: noDoctype.map((p) => ({ url: p.url })), total: html.length }));

  // a short H1 is normal on utility pages ("Liên hệ"); only content pages are held to the 10-character floor
  const badH1 = idx.filter((p) => p.h1?.length === 1 && (p.h1[0].length > 70 || (p.h1[0].length < 10 && p.words >= 300)));
  if (badH1.length)
    out.push(issue('topicality', 'h1-length', 'low', `${badH1.length} trang có H1 quá dài (> 70 ký tự) hoặc quá ngắn (< 10 ký tự trên trang nội dung)`, { why: 'H1 là ngữ cảnh heading cấp cao nhất cho các đoạn bên dưới; H1 quá dài làm loãng chủ đề, quá ngắn thì không mô tả được trang.', fix: 'Viết H1 10–70 ký tự, nêu rõ chủ đề chính của trang.', patents: ['US11409748B1'], urls: badH1.map((p) => ({ url: p.url, note: `${p.h1[0].length} ký tự: ${p.h1[0].slice(0, 90)}` })), total: idx.length }));

  const dupAlt = html.map((p) => {
    const by = new Map();
    for (const i of (p.images || []).filter((x) => x.inMain && x.alt && x.alt.trim().length > 2)) {
      const k = i.alt.trim().toLowerCase();
      by.set(k, (by.get(k) || new Set()).add(i.src));
    }
    const rep = [...by].filter(([, s]) => s.size >= 2);
    return rep.length ? { url: p.url, note: rep.slice(0, 3).map(([a, s]) => `"${a.slice(0, 50)}" × ${s.size} ảnh`).join('; ') } : null;
  }).filter(Boolean);
  if (dupAlt.length)
    out.push(issue('page-experience', 'alt-duplicate', 'low', `${dupAlt.length} trang dùng cùng một alt text cho nhiều ảnh khác nhau`, { why: 'Alt trùng nhau không mô tả được từng ảnh, nên ảnh khó được hiểu và tìm thấy riêng, và người dùng trình đọc màn hình không phân biệt được.', fix: 'Viết alt riêng cho từng ảnh, mô tả nội dung cụ thể của ảnh đó.', urls: dupAlt, total: html.length }));

  // ── links ──
  const nofollowPages = html.map((p) => ({ p, n: (p.links || []).filter((l) => l.nofollow && internal(l)).length })).filter((x) => x.n);
  if (nofollowPages.length)
    out.push(issue('links', 'internal-nofollow', 'medium', `${nofollowPages.length} trang có link nội bộ gắn nofollow`, { why: 'nofollow trên link nội bộ khiến Google có thể không theo link và không truyền tín hiệu tới trang đích của chính bạn.', fix: 'Bỏ rel="nofollow" khỏi link nội bộ. Trang không muốn index thì dùng noindex, không chặn bằng nofollow.', patents: ['US7716225B1'], urls: nofollowPages.map((x) => ({ url: x.p.url, note: `${x.n} link` })), total: html.length }));

  const anchorTargets = new Map();
  for (const p of idx) for (const l of (p.links || []).filter((x) => x.main && internal(x))) {
    const a = l.text.trim().toLowerCase();
    if (a.length < 3 || GENERIC.test(a) || CTA.test(a) && a.split(/\s+/).length <= 4 || FILE.test(l.href) || bare(l.href) === bare(p.url)) continue;
    const m = anchorTargets.get(a) || new Map();
    m.set(bare(l.href), (m.get(bare(l.href)) || 0) + 1);
    anchorTargets.set(a, m);
  }
  const ambiguous = [...anchorTargets].filter(([, m]) => m.size >= 2).sort((a, b) => b[1].size - a[1].size);
  if (ambiguous.length)
    out.push(issue('links', 'anchor-multi-target', ambiguous.length >= 10 ? 'medium' : 'low', `${ambiguous.length} anchor text giống nhau nhưng trỏ tới các URL khác nhau`, { why: 'Cùng một anchor trỏ tới nhiều trang là tín hiệu mâu thuẫn về việc trang nào phục vụ cụm từ đó, dễ góp phần gây cannibalization.', fix: 'Với mỗi cụm anchor, chọn một trang đích chính. Các trang còn lại dùng anchor mô tả riêng của chúng.', patents: ['US8959093B1', 'US8738643B1', 'US10210256B2'], urls: ambiguous.map(([a, m]) => ({ url: [...m.keys()][0], note: `"${a.slice(0, 60)}" → ${m.size} URL: ${[...m.keys()].slice(0, 4).join(', ')}` })) }));

  // ── AI readiness: structure that makes passages easy to extract and cite ──
  const noIds = articles.filter((p) => p.h23Count >= 3 && p.headingIds === 0);
  if (noIds.length)
    out.push(issue('ai-readiness', 'heading-ids-missing', 'low', `${noIds.length} bài dài có heading nhưng không heading nào có ID`, { why: 'Heading có ID cho phép link thẳng tới từng phần (#muc), giúp Google và trợ lý AI trỏ đúng đoạn trả lời; mục lục cũng cần ID này.', fix: 'Bật tự sinh ID cho H2/H3 (plugin mục lục hoặc theme) và giữ ID ổn định khi sửa bài.', patents: ['US8595270B2'], urls: noIds.map((p) => ({ url: p.url, note: `${p.h23Count} heading H2/H3` })), total: articles.length }));

  const noBlocks = articles.filter((p) => p.words >= 1000 && p.mainTables === 0 && p.mainLists === 0);
  if (noBlocks.length)
    out.push(issue('ai-readiness', 'no-structured-blocks', 'low', `${noBlocks.length} bài trên 1.000 từ không có bảng hay danh sách nào`, { why: 'Danh sách và bảng là dạng bán cấu trúc dễ trích dữ kiện. Bài toàn đoạn văn dài khó được chọn làm đoạn trả lời hoặc nguồn trích dẫn.', fix: 'Chuyển các bước, tiêu chí, so sánh hoặc thông số sang danh sách hoặc bảng HTML thật (<ul>, <ol>, <table>), không dùng ảnh chụp bảng.', patents: ['US7769579B2', 'US10180964B1'], urls: noBlocks.map((p) => ({ url: p.url, note: `${p.words} từ` })), total: articles.length }));

  const longParas = articles.filter((p) => p.longParas >= 2 || p.paraMedian > 100);
  if (longParas.length)
    out.push(issue('ai-readiness', 'long-paragraphs', 'low', `${longParas.length} bài có đoạn văn quá dài`, { why: 'Đoạn trả lời ứng viên thường là đoạn ngắn, trọn ý ngay dưới heading. Đoạn trên 150 từ khó trích nguyên vẹn và khó đọc trên di động.', fix: 'Tách đoạn còn khoảng 40–90 từ, mỗi đoạn một ý; câu đầu đoạn trả lời thẳng ý của heading.', patents: ['US10180964B1', 'US9940367B1'], urls: longParas.map((p) => ({ url: p.url, note: `${p.longParas} đoạn > 150 từ · trung vị ${p.paraMedian} từ/đoạn` })), total: articles.length }));

  const noFigures = editorial.filter((p) => p.words >= 800 && p.numericFacts === 0);
  if (noFigures.length)
    out.push(issue('ai-readiness', 'no-concrete-figures', 'low', `${noFigures.length} bài viết trên 800 từ không có số liệu cụ thể nào`, { why: 'Câu có số liệu kèm đơn vị (giá, thời gian, %) là dạng dữ kiện dễ được tóm tắt và trích dẫn. Bài chỉ nói chung chung ít cơ hội được chọn làm nguồn.', fix: 'Bổ sung số liệu có thật và có nguồn (giá, thời gian triển khai, tỉ lệ, quy mô). Không bịa số.', patents: ['US11900068B1'], urls: noFigures.map((p) => ({ url: p.url, note: `${p.words} từ` })), total: editorial.length }));

  const noSources = editorial.filter((p) => p.words >= 800 && !(p.links || []).some((l) => l.main && !internal(l) && /^https?:/.test(l.href) && !SHARE.test(l.href)));
  if (noSources.length)
    out.push(issue('ai-readiness', 'no-outbound-sources', 'low', `${noSources.length} bài viết trên 800 từ không link tới nguồn bên ngoài nào`, { why: 'Dẫn nguồn uy tín cho số liệu và nhận định giúp người đọc và hệ thống kiểm chứng được thông tin (tín hiệu E-E-A-T).', fix: 'Link tới nguồn gốc của số liệu, nghiên cứu hoặc tài liệu chính thức ngay tại câu dùng thông tin đó.', patents: ['US8682913B1'], urls: noSources.map((p) => ({ url: p.url, note: `${p.words} từ` })), total: editorial.length }));

  // ── multimodal ──
  const noCaption = idx.filter((p) => has(p, 'figcaptions') && (p.images || []).filter((i) => i.inMain).length >= 3 && p.figcaptions === 0);
  if (noCaption.length)
    out.push(issue('ai-readiness', 'figcaption-missing', 'low', `${noCaption.length} trang có từ 3 ảnh nội dung nhưng không có chú thích (figcaption)`, { why: 'Chú thích nằm cạnh ảnh cho biết ảnh minh hoạ điều gì; đây là ngữ cảnh mạnh hơn alt khi hiểu và trích ảnh.', fix: 'Dùng <figure><img><figcaption>…</figcaption></figure> cho ảnh có thông tin (biểu đồ, sơ đồ, ảnh sản phẩm).', urls: noCaption.map((p) => ({ url: p.url, note: `${(p.images || []).filter((i) => i.inMain).length} ảnh` })), total: idx.length }));

  const videoNoSchema = idx.filter((p) => p.videoEmbeds > 0 && !(p.schemaTypes || []).includes('VideoObject'));
  if (videoNoSchema.length)
    out.push(issue('ai-readiness', 'video-schema-missing', 'medium', `${videoNoSchema.length} trang có video nhưng thiếu schema VideoObject`, { why: 'Không có VideoObject (tên, mô tả, thumbnail, ngày đăng, thời lượng), Google khó hiểu video và trang không đủ điều kiện hiển thị kết quả video.', fix: 'Thêm JSON-LD VideoObject cho từng video nhúng (name, description, thumbnailUrl, uploadDate, duration, embedUrl).', patents: ['US8954438B1'], urls: videoNoSchema.map((p) => ({ url: p.url, note: `${p.videoEmbeds} video` })), total: idx.length }));

  const media = site.sitemap?.media;
  if (media && site.sitemap.count) {
    const imgPages = idx.filter((p) => (p.images || []).some((i) => i.inMain)).length;
    const vidPages = idx.filter((p) => p.videoEmbeds > 0).length;
    const miss = [imgPages >= 10 && !media.images ? `${imgPages} trang có ảnh nội dung nhưng sitemap không có <image:image>` : '', vidPages >= 1 && !media.videos ? `${vidPages} trang có video nhưng không có video sitemap` : ''].filter(Boolean);
    if (miss.length)
      out.push(issue('ai-readiness', 'media-sitemap-missing', 'low', 'Sitemap chưa khai báo ảnh/video', { why: 'Sitemap ảnh/video giúp Google phát hiện và hiểu media quan trọng, nhất là ảnh tải bằng JavaScript hoặc lazy-load.', fix: miss.join('. ') + '. Bật image/video sitemap trong plugin SEO, hoặc thêm thẻ <image:image>/<video:video> vào sitemap.', metric: 1 }));
  }

  const artSchema = idx.filter((p) => p.schemaInfo?.article);
  if (artSchema.length >= 5 && !artSchema.some((p) => p.speakable))
    out.push(issue('ai-readiness', 'speakable-missing', 'info', `${artSchema.length} bài có schema Article nhưng không dùng Speakable`, { why: 'Speakable đánh dấu đoạn phù hợp để trợ lý giọng nói đọc. Google mới hỗ trợ dạng beta, chủ yếu cho tin tức, nên chỉ là tham khảo.', fix: 'Nếu là trang tin, thêm thuộc tính speakable (cssSelector cho tiêu đề và đoạn tóm tắt) vào schema Article.', metric: artSchema.length }));

  return out;
}

// Day-0 foundations (rendering, semantic HTML, entity & site architecture): what an AI crawler can read and
// who it thinks the site is. No extra infrastructure: everything comes from the raw-HTML crawl.
export function architectureChecks(site) {
  const out = [];
  const html = site.pages.filter(isHtml200);
  const idx = html.filter(isIndexable);
  const path = (u) => { try { return new URL(u).pathname; } catch { return ''; } };

  // ── rendering: content must be in the raw HTML ──
  const csr = html.filter((p) => has(p, 'bodyWords') && p.bodyWords < 60 && (p.appShell || p.scriptCount >= 3));
  if (csr.length) {
    const homeHit = csr.some((p) => p.url === site.start);
    out.push(issue('crawl-index', 'raw-html-empty', homeHit || csr.length >= html.length * 0.2 ? 'high' : 'medium', `${csr.length} trang gần như không có chữ trong HTML thô (nội dung có thể chỉ hiện sau khi chạy JavaScript)`, { why: 'Bot AI (GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot) đọc HTML thô do server trả về và hầu như không chạy JavaScript. Googlebot render được nhưng chậm hơn và tốn tài nguyên. Nội dung chỉ dựng bằng JS (CSR) gần như vô hình với bot AI.', fix: 'Render nội dung chính phía server (SSR) hoặc tạo HTML tĩnh (SSG/ISR). Kiểm tra bằng: curl -A "GPTBot" <url> rồi tìm H1 và đoạn mở đầu trong kết quả.', urls: csr.map((p) => ({ url: p.url, note: `${p.bodyWords} từ trong HTML thô · ${p.scriptCount} script${p.appShell ? ' · khung app JS (#app/#root/#__next…)' : ''}` })), total: html.length }));
  }
  // older cached crawls have no jsNavLinks: fall back to nothing rather than counting UI toggles
  const jsNav = html.filter((p) => (p.jsNavLinks || 0) >= 1 || (p.hashRoutes || 0) > 0);
  if (jsNav.length)
    out.push(issue('links', 'js-only-links', jsNav.length >= html.length * 0.3 ? 'medium' : 'low', `${jsNav.length} trang có link điều hướng không phải thẻ <a href> thật`, { why: 'Link chạy bằng onclick, href="#" hoặc router JS (#/) không được crawler theo, nên trang đích có thể không được phát hiện và không nhận tín hiệu liên kết.', fix: 'Dùng <a href="/duong-dan-that"> cho mọi link điều hướng; router JS vẫn có thể chặn click nhưng href phải là URL thật.', patents: ['US10210256B2'], urls: jsNav.map((p) => ({ url: p.url, note: `${p.jsNavLinks || 0} link điều hướng bằng JS${p.hashRoutes ? ` · ${p.hashRoutes} route #/` : ''}` })), total: html.length }));

  // ── semantic HTML: structure, not style ──
  const sem = html.filter((p) => has(p, 'roles') && p.words >= 150);
  const noMain = sem.filter((p) => !p.landmarks?.main && !p.landmarks?.article && !p.roles.main);
  if (noMain.length)
    out.push(issue('ai-readiness', 'no-main-landmark', 'medium', `${noMain.length} trang không có thẻ <main> (hoặc <article>) bao nội dung chính`, { why: '<main> cho crawler biết đâu là nội dung chính, tách khỏi menu, sidebar và footer. Thiếu thẻ này (lỗi hay gặp trên theme WordPress), bot phải tự đoán và dễ lẫn nội dung lặp lại vào trang.', fix: 'Bọc vùng nội dung chính của template trong <main> (mỗi trang một thẻ); bài viết dùng thêm <article>.', patents: ['US7676745B2'], urls: noMain.map((p) => ({ url: p.url })), total: sem.length }));
  const noNav = sem.filter((p) => !p.landmarks?.nav && !p.roles.nav), noFooter = sem.filter((p) => !p.landmarks?.footer && !p.roles.footer);
  if (sem.length && (noNav.length >= sem.length * 0.5 || noFooter.length >= sem.length * 0.5))
    out.push(issue('ai-readiness', 'no-nav-footer-landmark', 'low', 'Menu hoặc footer không dùng thẻ <nav> / <footer>', { why: 'Menu và footer viết bằng <div> khiến crawler khó tách vùng điều hướng lặp lại khỏi nội dung chính của từng trang.', fix: `Dùng <nav> cho menu và <footer> cho chân trang trong template. ${noNav.length}/${sem.length} trang thiếu <nav>, ${noFooter.length}/${sem.length} trang thiếu <footer>.`, patents: ['US7676745B2'], urls: [...new Set([...noNav, ...noFooter])].slice(0, 200).map((p) => ({ url: p.url, note: [noNav.includes(p) && 'thiếu <nav>', noFooter.includes(p) && 'thiếu <footer>'].filter(Boolean).join(' · ') })), total: sem.length }));
  const chromeHeads = html.filter((p) => (p.headingsInChrome || []).length >= 2);
  if (chromeHeads.length)
    out.push(issue('ai-readiness', 'headings-in-chrome', 'low', `${chromeHeads.length} trang đặt heading (H1–H6) trong header, menu, sidebar hoặc footer`, { why: 'Heading nên thể hiện cấu trúc nội dung. Dùng H2/H3 cho tiêu đề widget, menu, footer chỉ để lấy cỡ chữ làm nhiễu dàn ý trang và ngữ cảnh heading của các đoạn.', fix: 'Đổi heading trong vùng giao diện chung thành <p>/<div>/<span> có class định dạng; giữ H1–H6 cho nội dung chính.', patents: ['US11409748B1'], urls: chromeHeads.map((p) => ({ url: p.url, note: p.headingsInChrome.slice(0, 3).join(' | ') })), total: html.length }));

  // ── entity anchor: the About page and one coherent site ──
  const ABOUT = /\/(about|about-us|gioi-thieu|ve-chung-toi|company|cong-ty|who-we-are)(\/|$)/i;
  const about = site.pages.find((p) => ABOUT.test(path(p.url)) && isHtml200(p));
  const home = site.pages.find((p) => p.url === site.start) || site.pages[0];
  const strip = (u) => String(u).replace(/\/$/, '');
  const homeLinks = new Set([...(home?.links || []).map((l) => strip(l.href)), ...(home?.navLinks || []).map(strip)]);
  if (!about)
    out.push(issue('entities', 'about-page-missing', 'medium', 'Không tìm thấy trang Giới thiệu / About', { why: 'Trang About là nguồn chính thức để Google và trợ lý AI xác định doanh nghiệp là ai, làm gì, ở đâu. AI ngày càng ưu tiên trích website chính chủ; thiếu trang này, thực thể dễ bị mô tả sai.', fix: 'Tạo trang About (vd. /about-us) mô tả doanh nghiệp, lĩnh vực, thị trường, năm thành lập, đội ngũ, bằng chứng; link từ menu chính và khai báo Organization schema.', patents: ['US8682913B1'], metric: 1 }));
  else {
    const org = [about, home].map((p) => p?.org).find(Boolean);
    const weak = [!homeLinks.has(strip(about.url)) && 'chưa được link từ trang chủ/menu', about.words < 300 && `chỉ ${about.words} từ`, !isIndexable(about) && 'không index được', !org && 'chưa có Organization schema (trên About hoặc trang chủ)', org && org.sameAs < 2 && `Organization chỉ có ${org.sameAs} sameAs`].filter(Boolean);
    if (weak.length)
      out.push(issue('entities', 'about-page-weak', 'low', 'Trang About chưa đủ mạnh để làm "nguồn sự thật" về doanh nghiệp', { why: 'AI gợi ý thực thể (doanh nghiệp) chứ không chỉ gợi ý từng trang. Trang About cần dễ tìm, đủ thông tin và nối với các hồ sơ chính chủ để doanh nghiệp được mô tả nhất quán.', fix: 'Link About từ menu chính; viết ≥ 300 từ có dữ kiện (lĩnh vực, thị trường, năm thành lập, quy mô, khách hàng tiêu biểu); thêm Organization schema với sameAs tới LinkedIn, Crunchbase, Clutch, mạng xã hội.', patents: ['US8682913B1'], urls: [{ url: about.url, note: weak.join(' · ') }] }));
  }
  const mdot = [...new Set([...html.map((p) => p.mobileAlternate).filter(Boolean), ...html.flatMap((p) => (p.links || []).map((l) => l.href)).filter((h) => hostOf(h) === 'm.' + site.host)].map((u) => hostOf(u)))].filter((h) => h && h !== site.host);
  if (mdot.length)
    out.push(issue('duplicates', 'separate-mobile-site', 'medium', `Có site mobile tách riêng (${mdot.join(', ')})`, { why: 'Google và Bing đều khuyên "một URL cho mỗi trang". Site mobile riêng (m-dot) chia đôi tín hiệu, dễ làm crawler (nhất là bot AI) đọc nhầm bản và làm phân mảnh thực thể.', fix: 'Chuyển sang thiết kế responsive một URL; trong lúc chưa chuyển, giữ rel=alternate/canonical hai chiều chính xác giữa bản desktop và mobile.', metric: mdot.length }));
  const social = html.filter((p) => (p.placeholderSocial || []).length);
  if (social.length)
    out.push(issue('entities', 'placeholder-social-links', 'medium', `Link mạng xã hội để trống (href="#") trên ${social.length} trang`, { why: 'Link tới hồ sơ chính chủ (LinkedIn, YouTube, Facebook…) giúp Google và AI nối website với các kênh khác của cùng doanh nghiệp. Để "#" là link chết, người dùng bấm không đi đâu và mất tín hiệu thực thể.', fix: 'Điền URL hồ sơ thật cho từng icon mạng xã hội ở header/footer (hoặc gỡ icon chưa có kênh), và đưa cùng các URL đó vào sameAs của Organization schema.', patents: ['US8682913B1'], urls: social.map((p) => ({ url: p.url, note: p.placeholderSocial.join(', ') })), total: html.length }));
  const subs = new Map();
  for (const p of html) for (const l of p.links || []) { const h = hostOf(l.href); if (h.endsWith('.' + site.host) && h !== site.host && !h.startsWith('m.')) subs.set(h, (subs.get(h) || 0) + 1); }
  if (subs.size >= 4)
    out.push(issue('entities', 'subdomain-sprawl', 'info', `Site link tới ${subs.size} subdomain khác nhau`, { why: 'Nhiều subdomain rời rạc (mỗi bộ phận một subdomain) khiến cả người lẫn AI khó xác định đâu là website chính thức của doanh nghiệp.', fix: 'Gom nội dung quan trọng về domain chính hoặc thư mục con; subdomain còn giữ phải có thương hiệu, liên kết và Organization nhất quán với site chính.', urls: [...subs].sort((a, b) => b[1] - a[1]).map(([h, n]) => ({ url: 'https://' + h + '/', note: `${n} link` })) }));
  const langs = idx.map((p) => (p.lang || '').toLowerCase());
  const viPages = idx.filter((p, i) => langs[i].startsWith('vi') || (p.viRatio ?? 0) > 0.5).length;
  const hasEn = langs.some((l) => l.startsWith('en')) || idx.some((p) => (p.hreflang || []).some((h) => /^en/i.test(h.lang))) || idx.some((p) => /\/en(\/|$)/.test(path(p.url)));
  if (idx.length >= 5 && viPages >= idx.length * 0.8 && !hasEn)
    out.push(issue('entities', 'no-english-entity', 'low', 'Site chỉ có tiếng Việt, chưa có trang tiếng Anh mô tả doanh nghiệp', { why: 'ChatGPT, Claude, Perplexity chủ yếu suy luận và tìm nguồn bằng tiếng Anh. Doanh nghiệp chỉ có nội dung tiếng Việt dễ "không tồn tại" hoặc bị mô tả sai trong câu trả lời của AI.', fix: 'Tối thiểu có bản tiếng Anh cho trang chủ, About và các dịch vụ chính (hreflang vi/en), dùng cùng tên thương hiệu và mô tả định vị giữa hai ngôn ngữ.', metric: 1 }));
  return out;
}

// Checks that need the server probes (run once per audit, after the crawl).
export function geoProbeChecks(probes, site = null) {
  const out = [];
  if (!probes?.llms) return out;
  out.push(...aiAccessChecks(probes, site));
  if (probes.llms.status !== 200)
    out.push(issue('ai-readiness', 'llms-missing', 'low', 'Chưa có /llms.txt', { why: 'llms.txt (đề xuất llmstxt.org) là bản hướng dẫn dạng Markdown giúp trợ lý AI tìm nội dung chính. Google chưa xác nhận dùng file này, nên ưu tiên thấp, chủ yếu cho ChatGPT, Claude, Perplexity.', fix: 'Tạo /llms.txt gồm: tên và mô tả ngắn của doanh nghiệp, các nhóm trang chính kèm link và một câu mô tả mỗi trang.', metric: 1 }));
  else if (probes.llmsFull && probes.llmsFull.status !== 200)
    out.push(issue('ai-readiness', 'llms-full-missing', 'info', 'Có /llms.txt nhưng chưa có /llms-full.txt', { why: 'llms-full.txt chứa toàn văn nội dung chính để trợ lý AI đọc một lần. Đây là tuỳ chọn trong đề xuất llmstxt.org.', fix: 'Nếu muốn, xuất nội dung các trang dịch vụ và bài chủ lực thành /llms-full.txt (Markdown).', metric: 1 }));
  return out;
}

// What each crawler actually received, and what robots.txt allows each AI crawler to fetch.
const BLOCK_STATUS = new Set([0, 401, 403, 406, 429, 451, 503]);
const PURPOSE = { search: 'tìm kiếm/trích dẫn', user: 'theo yêu cầu người dùng', training: 'huấn luyện' };
function aiAccessChecks(probes, site) {
  const out = [];
  const ua = probes.ua || {};
  const ref = new Map((ua.browser || []).map((r) => [r.url, r]));
  const blocked = [], thin = [];
  for (const name of ['googlebot', 'OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'ClaudeBot', 'PerplexityBot']) {
    for (const r of ua[name] || []) {
      const b = ref.get(r.url);
      if (!b || b.status !== 200 || b.challenge) continue; // fails for browsers too: not a bot-specific problem
      if (BLOCK_STATUS.has(r.status) || r.challenge) blocked.push({ url: r.url, note: `${name}: ${r.status || 'không phản hồi'}${r.challenge ? ' (trang chặn bot)' : ''}` });
      else if (b.words >= 100 && r.words < b.words * 0.6) thin.push({ url: r.url, note: `${name}: ${r.words}/${b.words} từ${b.h1 && !r.h1 ? ', mất H1' : ''}` });
    }
  }
  if (blocked.length)
    out.push(issue('crawl-index', 'ai-bot-blocked', 'high', `Bot tìm kiếm/AI bị chặn trên ${new Set(blocked.map((x) => x.url)).size} trang (firewall, CDN hoặc rate limit)`, { why: 'Trình duyệt mở được nhưng bot nhận lỗi 403/429/503 hoặc trang thử thách (Cloudflare, WAF). Mỗi bot AI thấy site khác nhau; bị chặn ở tầng server thì robots.txt cho phép cũng vô nghĩa.', fix: 'Kiểm tra quy tắc bot của Cloudflare/WAF/hosting: cho phép (hoặc xác minh) Googlebot, OAI-SearchBot, ChatGPT-User, PerplexityBot; xem log server để xác nhận bot thật nhận 200. Lưu ý: tool giả user-agent, một số firewall chặn bot giả nhưng vẫn cho bot thật (xác minh bằng IP), nên đối chiếu thêm log.', urls: blocked }));
  if (thin.length)
    out.push(issue('crawl-index', 'ai-bot-less-content', 'medium', `Bot nhận ít nội dung hơn trình duyệt trên ${new Set(thin.map((x) => x.url)).size} trang`, { why: 'Server trả nội dung khác nhau theo user-agent (dynamic rendering, chặn một phần, bản rút gọn). Bot AI chỉ trích được những gì nó nhận.', fix: 'Trả cùng một HTML cho mọi user-agent; nếu dùng dynamic rendering, đảm bảo bản cho bot đầy đủ nội dung chính.', urls: thin }));

  if (site?.robots?.status === 200) {
    const paths = [...new Set(['/', ...(ua.browser || []).map((r) => { try { return new URL(r.url).pathname; } catch { return '/'; } })])].slice(0, 16);
    const m = aiRobotsMatrix(site.robots.raw || '', paths);
    const robotsUrl = site.origin + '/robots.txt';
    const searchBlocked = m.filter((b) => b.purpose !== 'training' && b.blocked.length);
    if (searchBlocked.length)
      out.push(issue('crawl-index', 'robots-blocks-ai-search', searchBlocked.some((b) => /^(Googlebot|Bingbot)$/.test(b.token) && !b.home) ? 'high' : 'medium', `robots.txt chặn ${searchBlocked.length} bot tìm kiếm/trích dẫn`, { why: 'Các bot này lấy trang để hiển thị và trích dẫn trong câu trả lời (Google, ChatGPT Search, Perplexity, Claude, Copilot). Chặn chúng thì trang không thể được trích dẫn.', fix: 'Cho phép các bot tìm kiếm/trích dẫn; nếu không muốn dữ liệu bị dùng để huấn luyện, chỉ chặn các bot huấn luyện (GPTBot, ClaudeBot, Google-Extended, CCBot).', urls: searchBlocked.map((b) => ({ url: robotsUrl, note: `${b.token} (${b.engine}): chặn ${b.home ? b.blocked.length + ' trang mẫu' : 'cả site'}` })) }));
    out.push(issue('ai-readiness', 'ai-robots-matrix', 'info', 'Quyền truy cập robots.txt theo từng bot tìm kiếm và AI', { why: 'Mỗi công cụ dùng bot riêng. Bot tìm kiếm/trích dẫn cần được cho phép; bot huấn luyện là lựa chọn chính sách (chặn không làm mất khỏi câu trả lời AI).', fix: 'Đối chiếu bảng này với chính sách AI của doanh nghiệp (checklist mục 08 GEO & AI Search).', urls: m.map((b) => ({ url: robotsUrl, note: `${b.token} · ${b.engine} · ${PURPOSE[b.purpose]} · ${b.home ? (b.blocked.length ? `chặn ${b.blocked.length} trang mẫu` : 'cho phép') : 'CHẶN cả site'}${b.named ? ' (có nhóm riêng)' : ''}` })) }));
  }
  return out;
}
