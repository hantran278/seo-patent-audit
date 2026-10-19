// Evaluate the Enosta technical SEO checklist (xlsx) against crawl + probe data.
// Each checklist row is matched by its "Hạng mục" text; rows without an evaluator become manual checks.
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { isHtml200, isNoindex, isIndexable } from './common.mjs';
import { pct } from '../lib/util.mjs';

export const S = { PASS: 'Đạt', FAIL: 'Chưa đạt', PART: 'Một phần', MANUAL: 'Cần kiểm tra thủ công', NA: 'Không áp dụng' };
// map to the checklist's own status dropdown
export const STATUS_TO_ENOSTA = { 'Đạt': 'Đã xong', 'Chưa đạt': 'Chưa làm', 'Một phần': 'Đang làm', 'Cần kiểm tra thủ công': 'Chờ review', 'Không áp dụng': 'N/A' };

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const cellText = (v) => (v && typeof v === 'object' ? v.text || v.result || (v.richText ? v.richText.map((r) => r.text).join('') : '') : v ?? '');
const R = (status, evidence, urls = [], patents = []) => ({ status, evidence, urls: urls.slice(0, 200), patents });
const list = (arr, n = 5) => arr.slice(0, n).join(', ') + (arr.length > n ? ` … (+${arr.length - n})` : '');
const byStatus = (bad, total, okMsg, badMsg, urls, patents, partialAt = 0.1) =>
  !bad ? R(S.PASS, okMsg, [], patents) : R(bad / Math.max(total, 1) <= partialAt ? S.PART : S.FAIL, badMsg, urls, patents);

export async function loadChecklist(file) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const rows = [];
  for (const ws of wb.worksheets) {
    let head = null;
    ws.eachRow({ includeEmpty: false }, (row, i) => {
      const vals = Array.from(row.values, (v) => String(cellText(v)));
      // only real checklist sheets (header has "Hạng mục" + "Tiêu chí"); template sheets are skipped
      if (!head && vals.some((v) => norm(v) === 'hang muc') && vals.some((v) => norm(v).startsWith('tieu chi'))) { head = vals.map(norm); return; }
      if (!head) return;
      const col = (name) => vals[head.findIndex((h) => h.startsWith(name))];
      const item = col('hang muc');
      if (!item) return;
      rows.push({ sheet: ws.name, row: i, group: col('nhom'), item: String(item).trim(), criteria: col('tieu chi'), owner: col('owner'), phase: col('giai doan'), priority: col('uu tien'), tool: col('check o dau'), note: col('evidence') });
    });
  }
  return rows;
}

export function evaluateChecklist(rows, site, probes, extra) {
  const P = site.pages;
  const html = P.filter(isHtml200);
  const idx = html.filter(isIndexable);
  const home = html.find((p) => p.url === site.start) || html[0] || {};
  const nonHome = idx.filter((p) => p !== home);
  const H = probes.homeHeaders || {};
  const byUrl = new Map(P.map((p) => [p.url, p]));
  const isArticle = (p) => p.schemaTypes?.some((t) => /Article|BlogPosting|NewsArticle/.test(t)) || (/\/(blog|tin-tuc|tin|news|bai-viet|insights?|kien-thuc|huong-dan)\//.test(p.url) && p.words > 400);
  const articles = idx.filter(isArticle);
  const psi = (probes.psi || []).filter((x) => !x.error);
  const psiErr = (probes.psi || []).find((x) => x.error)?.error;
  const noPsi = psiErr === 429 || psiErr === 403 ? `PageSpeed Insights API từ chối (lỗi ${psiErr} — hết quota dùng chung). Chạy lại với --psi-key <API key> (tạo miễn phí trong Google Cloud Console).` : psiErr ? `PageSpeed Insights lỗi: ${psiErr}.` : 'Chưa chạy PageSpeed Insights (bỏ --no-psi để chạy).';
  const issue = (id) => extra.issues.find((i) => i.id === id);
  const urlsOf = (id) => issue(id)?.urls || [];
  const hreflangPages = html.filter((p) => p.hreflang?.length);
  const fieldOf = (k) => psi.map((x) => ({ url: x.url, v: x.field[k] ?? x.origin?.[k] ?? null, src: x.field[k] != null ? 'URL' : x.origin?.[k] != null ? 'origin' : null })).filter((x) => x.v !== null);
  const cwv = (k, good, unit, fmt = (v) => v) => {
    const f = fieldOf(k);
    if (!f.length) return R(S.MANUAL, psi.length ? `Không có dữ liệu field (CrUX) cho các URL mẫu. Lab: ${psi.map((x) => `${x.url.replace(site.origin, '') || '/'} ${k === 'lcp' ? Math.round(x.lab.lcp) + 'ms' : k === 'cls' ? (x.lab.cls ?? 0).toFixed(3) : 'TBT ' + Math.round(x.lab.tbt) + 'ms'}`).join('; ')}` : noPsi, [], ['US8645362B1']);
    const bad = f.filter((x) => x.v > good);
    return R(bad.length ? S.FAIL : S.PASS, f.map((x) => `${x.url.replace(site.origin, '') || '/'}: ${fmt(x.v)}${unit} (${x.src})`).join('; '), bad.map((x) => ({ url: x.url, note: fmt(x.v) + unit })), ['US8645362B1']);
  };
  const header = (name, test = (v) => !!v, label = name) => (H[name] && test(H[name]) ? R(S.PASS, `${label}: ${H[name]}`) : R(S.FAIL, H[name] ? `${label} có nhưng giá trị chưa đạt: ${H[name]}` : `Trang chủ không trả header ${label}.`));
  const ua = probes.ua || {};
  const words0 = (name) => (ua[name] || []).map((x) => x.words);
  const variantsOk = site.variants.every((v) => v.to === site.variants.find((x) => x.status === 200)?.to);

  const E = {
    // ---------- 01 Planning ----------
    'indexability matrix': () => {
      const seg = new Map();
      for (const p of html) {
        const k = '/' + (new URL(p.url).pathname.split('/').filter(Boolean)[0] || '') + (new URL(p.url).search ? '?…' : '');
        const x = seg.get(k) || { n: 0, idx: 0, noidx: 0, canon: 0, sm: 0 };
        x.n++; if (isIndexable(p)) x.idx++; if (isNoindex(p)) x.noidx++; if (p.canonical && p.canonical !== p.url) x.canon++; if (p.inSitemap) x.sm++;
        seg.set(k, x);
      }
      const rows = [...seg.entries()].sort((a, b) => b[1].n - a[1].n);
      return R(S.MANUAL, 'Bản nháp matrix theo nhóm URL (từ crawl) — cần SEO/PM duyệt: ' + rows.slice(0, 12).map(([k, x]) => `${k} ${x.n} URL (index ${x.idx}, noindex ${x.noidx}, canonical khác ${x.canon}, trong sitemap ${x.sm})`).join(' · '), rows.map(([k, x]) => ({ url: k, note: `${x.n} URL · index ${x.idx} · noindex ${x.noidx} · canonical khác ${x.canon} · sitemap ${x.sm}` })), ['US8554759B1']);
    },
    'baseline crawl url inventory': () => R(S.PART, `Crawl hiện tại đã lưu (${P.length} URL, status/canonical/indexability) trong reports/${site.host}.crawl.json. Cần bổ sung URL có traffic (GSC/GA4) và backlink.`),
    'redirect mapping khi migration': () => { const r = P.filter((p) => p.chain?.length); return R(S.MANUAL, `Chỉ đánh giá được khi có danh sách URL cũ/mới. Hiện có ${r.length} URL redirect trong crawl${r.filter((p) => new URL(p.finalUrl).pathname === '/').length ? `, trong đó ${r.filter((p) => new URL(p.finalUrl).pathname === '/').length} URL redirect về homepage (cần kiểm tra)` : ''}.`, r.map((p) => ({ url: p.url, note: '→ ' + p.finalUrl }))); },
    'staging access index protection': () => {
      const open = (probes.staging || []).filter((s) => s.status === 200 && !s.noindex);
      return open.length ? R(S.FAIL, `Host staging/dev truy cập công khai, không noindex: ${open.map((s) => s.host).join(', ')}`, open.map((s) => ({ url: 'https://' + s.host }))) : R(S.PASS, (probes.staging || []).length ? `Đã thử ${probes.staging.map((s) => `${s.host} (${s.status}${s.auth ? ', có xác thực' : s.noindex ? ', noindex' : ''})`).join(', ')}` : 'Không phát hiện subdomain staging/dev/test công khai.');
    },

    // ---------- 02 Nền tảng & Crawl ----------
    'https ssl': () => (site.start.startsWith('https:') && probes.homeStatus === 200 ? R(S.PASS, 'Trang chủ chạy HTTPS, kết nối TLS hợp lệ (fetch thành công).') : R(S.FAIL, 'Trang chủ không chạy HTTPS hoặc chứng chỉ lỗi.')),
    'http https redirect': () => {
      const httpV = site.variants.filter((v) => v.from.startsWith('http:'));
      const bad = httpV.filter((v) => !v.to.startsWith('https:'));
      const mixed = html.filter((p) => p.mixed);
      return !bad.length && !mixed.length ? R(S.PASS, 'http:// redirect sang https://; không phát hiện mixed content.', [], ['US7930400B1']) : R(S.FAIL, [bad.length && `http không redirect sang https: ${bad.map((v) => v.from).join(', ')}`, mixed.length && `${mixed.length} trang có mixed content`].filter(Boolean).join(' · '), [...bad.map((v) => ({ url: v.from, note: '→ ' + v.to })), ...mixed.map((p) => ({ url: p.url, note: p.mixed + ' tài nguyên http' }))], ['US7930400B1']);
    },
    'cache config': () => { const k = ['cache-control', 'x-litespeed-cache', 'x-cache', 'cf-cache-status', 'age', 'x-proxy-cache'].filter((x) => H[x]); return k.length ? R(/hit/i.test(H['x-litespeed-cache'] || H['cf-cache-status'] || H['x-cache'] || '') ? S.PASS : S.PART, 'Header cache trang chủ: ' + k.map((x) => `${x}: ${H[x]}`).join(' · ')) : R(S.FAIL, 'Trang chủ không trả header cache nào (cache-control/x-litespeed-cache/cf-cache-status).'); },
    'cdn cloudflare': () => (H['cf-ray'] || /cloudflare/i.test(H.server || '') ? R(S.PASS, `Qua Cloudflare (server: ${H.server || ''}, cf-cache-status: ${H['cf-cache-status'] || '—'}).`) : R(S.FAIL, `Không thấy Cloudflare (server: ${H.server || 'không rõ'}).`)),
    'hsts': () => header('strict-transport-security', (v) => /max-age=\d{6,}/.test(v), 'Strict-Transport-Security'),
    'x content type options': () => header('x-content-type-options', (v) => /nosniff/i.test(v), 'X-Content-Type-Options'),
    'x frame options': () => (H['x-frame-options'] ? R(S.PASS, 'X-Frame-Options: ' + H['x-frame-options']) : /frame-ancestors/.test(H['content-security-policy'] || '') ? R(S.PASS, 'Dùng CSP frame-ancestors thay X-Frame-Options.') : R(S.FAIL, 'Thiếu X-Frame-Options (và không có CSP frame-ancestors).')),
    'referrer policy': () => header('referrer-policy', (v) => !!v, 'Referrer-Policy'),
    'permissions policy': () => header('permissions-policy', (v) => !!v, 'Permissions-Policy'),
    'content security policy': () => (H['content-security-policy'] ? R(S.PASS, 'Có CSP (' + H['content-security-policy'].slice(0, 80) + '…)') : H['content-security-policy-report-only'] ? R(S.PART, 'Chỉ có CSP report-only.') : R(S.FAIL, 'Trang chủ không có Content-Security-Policy.')),
    'robots txt': () => {
      if (site.robots.status !== 200) return R(S.FAIL, `robots.txt trả ${site.robots.status}.`, [], ['US9355177B2']);
      const bad = site.robots.rules.filter((r) => !r.allow && /\.css|\.js|wp-content|wp-includes|\/assets|\/static|\/images?\b|\.png|\.jpe?g|\.webp/i.test(r.path));
      return bad.length ? R(S.FAIL, 'robots.txt chặn tài nguyên cần cho render: ' + bad.map((r) => r.path).join(', '), [], ['US20160314215A1']) : R(S.PASS, `robots.txt tồn tại (${site.robots.rules.length} rule cho *), không chặn CSS/JS/ảnh.${site.robots.sitemaps.length ? ' Khai báo sitemap: ' + site.robots.sitemaps.join(', ') : ' Chưa khai báo Sitemap.'}`);
    },
    'xml sitemap': () => { if (!site.sitemap.count) return R(S.FAIL, 'Không tìm thấy sitemap XML.', [], ['US9355177B2']); const bad = urlsOf('sitemap-non-canonical').length + urlsOf('sitemap-noindex').length; return byStatus(bad, site.sitemap.count, `Sitemap có ${site.sitemap.count} URL (${site.sitemap.files.length} file); các URL đã crawl đều hợp lệ.`, `${bad} URL trong sitemap là lỗi/redirect/noindex/canonical sang trang khác.`, [...urlsOf('sitemap-non-canonical'), ...urlsOf('sitemap-noindex')], ['US9355177B2'], 0.02); },
    'compression protocol': () => {
      const enc = H['content-encoding'];
      const h2 = psi.map((x) => x.fails['uses-http2']).find(Boolean);
      const proto = h2 ? (h2.score === 1 || h2.score === null ? 'PSI: HTTP/2 đạt' : 'PSI: chưa dùng HTTP/2 cho mọi tài nguyên') : 'HTTP/2/3: cần kiểm tra DevTools (công cụ không đo được)';
      return R(enc && /br|gzip|zstd/.test(enc) ? (h2 && h2.score === 0 ? S.PART : S.PASS) : S.FAIL, `HTML content-encoding: ${enc || 'không nén'} · ${proto}`);
    },
    'uptime va 5xx monitoring': () => { const e5 = P.filter((p) => p.status >= 500); return R(S.MANUAL, `Cần xác nhận công cụ monitoring và người nhận cảnh báo.${e5.length ? ` Crawl gặp ${e5.length} URL lỗi 5xx.` : ' Crawl không gặp lỗi 5xx.'}`, e5.map((p) => ({ url: p.url, note: String(p.status) }))); },
    'sitemap lastmod chinh xac': () => (issue('fake-lastmod') ? R(S.FAIL, issue('fake-lastmod').title, [], ['US9355177B2', 'US8868541B2']) : P.some((p) => p.lastmod) ? R(S.PASS, 'lastmod trong sitemap phân bố theo nhiều ngày khác nhau (không đồng loạt).', [], ['US9355177B2']) : R(site.sitemap.count ? S.FAIL : S.NA, site.sitemap.count ? 'Sitemap không có lastmod.' : 'Không có sitemap.', [], ['US9355177B2'])),
    'loai noindex khoi sitemap': () => byStatus(urlsOf('sitemap-noindex').length + urlsOf('sitemap-non-canonical').length, site.sitemap.count, 'Không có URL noindex/redirect/canonical khác trong sitemap (trong phạm vi đã crawl).', 'Sitemap chứa URL noindex/redirect/canonical sang trang khác.', [...urlsOf('sitemap-noindex'), ...urlsOf('sitemap-non-canonical')], ['US9355177B2'], 0),
    'url parameter faceted search policy': () => { const q = html.filter((p) => /\?/.test(p.url)); const qi = q.filter(isIndexable); return !q.length ? R(S.PASS, 'Crawl không gặp URL có tham số qua link nội bộ.', [], ['US7509315B1']) : R(qi.length ? S.FAIL : S.PART, `${q.length} URL tham số được link nội bộ, ${qi.length} URL trong đó indexable (không noindex/canonical về URL gốc).`, qi.map((p) => ({ url: p.url })), ['US7509315B1', 'US8548972B1']); },
    'canonical signals dong nhat': () => {
      const conflicts = [...urlsOf('sitemap-non-canonical'), ...urlsOf('links-to-noncanonical'), ...urlsOf('canonical-broken'), ...urlsOf('links-to-redirects')];
      return !conflicts.length && variantsOk ? R(S.PASS, 'Redirect, canonical, sitemap và link nội bộ cùng trỏ về một phiên bản URL.', [], ['US8868559B2']) : R(S.FAIL, `${conflicts.length} tín hiệu mâu thuẫn (sitemap chứa URL không chuẩn, link nội bộ tới URL canonical khác/redirect, canonical hỏng)${variantsOk ? '' : '; biến thể host chưa hợp nhất'}.`, conflicts, ['US8868559B2', 'US7930400B1']);
    },
    'mobile content parity': () => {
      const d = (ua.mobile || []).map((m, i) => ({ url: m.url, m: m.words, d: ua.browser?.[i]?.words || 0 })).filter((x) => x.d > 50);
      const bad = d.filter((x) => x.m < x.d * 0.8);
      return !d.length ? R(S.MANUAL, 'Không so sánh được (thiếu dữ liệu).') : R(bad.length ? S.FAIL : S.PASS, d.map((x) => `${x.url.replace(site.origin, '') || '/'}: mobile ${x.m} từ / desktop ${x.d} từ`).join('; ') + ' (HTML thô, user-agent mobile vs desktop).', bad.map((x) => ({ url: x.url, note: `mobile ${x.m} / desktop ${x.d}` })), ['US20160314215A1', 'US11036804B1']);
    },

    // ---------- 03 Kiến trúc & URL ----------
    'url khong dung': () => { const bad = html.filter((p) => p.hashRoutes); return byStatus(bad.length, html.length, 'Không phát hiện điều hướng bằng # (#/, #!).', `${bad.length} trang có link điều hướng dạng #/ hoặc #!.`, bad.map((p) => ({ url: p.url, note: p.hashRoutes + ' link' })), [], 0); },
    'url sach': () => { const bad = html.filter((p) => { const path = decodeURIComponent(new URL(p.url).pathname); return /[A-Z]|_|\s|[^\x00-\x7F]/.test(path); }); return byStatus(bad.length, html.length, 'URL chữ thường, dùng gạch ngang, không ký tự lạ.', `${bad.length} URL có chữ hoa, gạch dưới, khoảng trắng hoặc ký tự có dấu.`, bad.map((p) => ({ url: p.url })), [], 0.02); },
    'do sau url': () => { const bad = idx.filter((p) => new URL(p.url).pathname.split('/').filter(Boolean).length > 3); return byStatus(bad.length, idx.length, 'Không URL indexable nào quá 3 cấp thư mục.', `${bad.length} URL indexable sâu hơn 3 cấp thư mục.`, bad.map((p) => ({ url: p.url, note: new URL(p.url).pathname.split('/').filter(Boolean).length + ' cấp' })), ['US7509315B1'], 0.1); },
    'trailing slash nhat quan': () => {
      const paths = idx.map((p) => new URL(p.url).pathname).filter((x) => x.length > 1 && !/\.\w{2,5}$/.test(x));
      if (!paths.length) return R(S.NA, 'URL của site dạng file (.html…) — không áp dụng quy tắc trailing slash.');
      const w = paths.filter((x) => x.endsWith('/')).length, wo = paths.length - w;
      const t = probes.trailing;
      const redirectOk = t && [301, 308].includes(t.status);
      const mixed = w && wo;
      return R(!mixed && redirectOk ? S.PASS : !mixed || redirectOk ? S.PART : S.FAIL, `URL indexable: ${w} có "/", ${wo} không có "/". ${t ? `Thử ${t.tested} → ${t.status}${t.location ? ' ' + t.location : ''}${redirectOk ? ' (301 về bản chuẩn)' : ' (không redirect 301 về bản chuẩn)'}` : ''}`, [], ['US8868559B2']);
    },
    'www vs non www': () => R(variantsOk ? S.PASS : S.FAIL, site.variants.map((v) => `${v.from} → ${v.to} (${v.status}, ${v.hops} bước)`).join(' · '), [], ['US7930400B1', 'US8713071B1']),
    'breadcrumb hien thi': () => { const bad = nonHome.filter((p) => !p.breadcrumbUi && !p.schemaTypes.includes('BreadcrumbList')); return byStatus(bad.length, nonHome.length, 'Mọi trang (trừ homepage) có breadcrumb.', `${bad.length}/${nonHome.length} trang không phát hiện breadcrumb (UI hoặc schema).`, bad.map((p) => ({ url: p.url })), [], 0.1); },
    'breadcrumb khop url': () => { const withBc = nonHome.filter((p) => p.schemaInfo?.breadcrumbLast !== undefined && p.schemaTypes.includes('BreadcrumbList')); if (!withBc.length) return R(S.FAIL, 'Không có BreadcrumbList schema để đối chiếu.'); const bad = withBc.filter((p) => p.schemaInfo.breadcrumbLast && p.schemaInfo.breadcrumbLast !== p.url && p.schemaInfo.breadcrumbLast !== p.canonical); return byStatus(bad.length, withBc.length, `BreadcrumbList của ${withBc.length} trang có mục cuối khớp URL trang.`, `${bad.length} trang có mục cuối BreadcrumbList không khớp URL trang (cần kiểm tra tay phân cấp UI).`, bad.map((p) => ({ url: p.url, note: 'breadcrumb → ' + p.schemaInfo.breadcrumbLast })), [], 0.05); },
    'menu khong link chet': () => { const nav = [...new Set(html.flatMap((p) => p.navLinks || []))].filter((u) => u.includes(site.host)); const bad = nav.filter((u) => byUrl.get(u) && (byUrl.get(u).status !== 200 || byUrl.get(u).chain?.length)); return byStatus(bad.length, nav.length, `${nav.length} link menu/header đều trả 200.`, `${bad.length} link menu trỏ tới URL lỗi/redirect.`, bad.map((u) => ({ url: u, note: String(byUrl.get(u).status) + (byUrl.get(u).chain?.length ? ' (redirect)' : '') })), ['US7725452B1'], 0); },
    'canonical tu tham chieu': () => { const cand = html.filter((p) => !isNoindex(p)); const bad = cand.filter((p) => !p.canonical || p.canonical !== p.url); return byStatus(bad.length, cand.length, 'Mọi trang có canonical tự trỏ.', `${bad.length}/${cand.length} trang thiếu canonical hoặc canonical không tự trỏ.`, bad.map((p) => ({ url: p.url, note: p.canonical ? '→ ' + p.canonical : 'thiếu' })), ['US8868559B2'], 0.05); },
    'pagination load more': () => { const pg = html.filter((p) => p.links.some((l) => /\/page\/\d+|[?&]page=\d+|\/trang\/\d+/.test(l.href))); return R(S.MANUAL, pg.length ? `${pg.length} trang có link phân trang dạng a href (crawlable). Cần kiểm tra tay các listing dùng load-more/infinite scroll.` : 'Không phát hiện link phân trang dạng a href — nếu site có listing dài, kiểm tra load-more có fallback URL.'); },
    'html lang va locale': () => { const bad = html.filter((p) => !p.lang); return byStatus(bad.length, html.length, `Mọi trang có lang (ví dụ "${home.lang}").`, `${bad.length} trang thiếu thuộc tính lang.`, bad.map((p) => ({ url: p.url })), [], 0); },
    'hreflang reciprocal x default': () => {
      if (!hreflangPages.length) return R(S.NA, 'Site không khai báo hreflang (không đa ngôn ngữ, hoặc chưa triển khai).');
      const noReturn = [];
      for (const p of hreflangPages) for (const h of p.hreflang) { const t = byUrl.get(h.href); if (t?.hreflang?.length && !t.hreflang.some((x) => x.href === p.url)) noReturn.push({ url: p.url, note: `${h.lang} → ${h.href} không trỏ lại` }); }
      const noX = hreflangPages.filter((p) => !p.hreflang.some((h) => h.lang === 'x-default'));
      return R(noReturn.length ? S.FAIL : noX.length ? S.PART : S.PASS, `${hreflangPages.length} trang có hreflang; ${noReturn.length} cặp thiếu link trả lại; ${noX.length} trang thiếu x-default.`, [...noReturn, ...noX.map((p) => ({ url: p.url, note: 'thiếu x-default' }))]);
    },
    'canonical cung ngon ngu': () => { if (!hreflangPages.length) return R(S.NA, 'Không có hreflang.'); const bad = hreflangPages.filter((p) => p.canonical && p.canonical !== p.url); return byStatus(bad.length, hreflangPages.length, 'Trang có hreflang đều canonical về chính nó.', `${bad.length} trang có hreflang nhưng canonical sang URL khác.`, bad.map((p) => ({ url: p.url, note: '→ ' + p.canonical })), ['US8868559B2'], 0); },

    // ---------- 04 Template & Metadata ----------
    'header footer sidebar khong co heading': () => { const bad = html.filter((p) => p.headingsInChrome?.length); return byStatus(bad.length, html.length, 'Không có thẻ H1–H6 trong header/footer/sidebar/nav.', `${bad.length} trang có heading trong header/footer/sidebar (ví dụ: ${list(bad[0]?.headingsInChrome || [], 3)}).`, bad.map((p) => ({ url: p.url, note: list(p.headingsInChrome, 3) })), ['US8060501B1'], 0); },
    '1 h1 moi trang': () => { const bad = idx.filter((p) => p.h1.length !== 1); return byStatus(bad.length, idx.length, 'Mỗi trang đúng 1 H1.', `${bad.length} trang có 0 hoặc nhiều H1.`, bad.map((p) => ({ url: p.url, note: p.h1.length + ' H1' })), ['US10068022B2'], 0); },
    'thu tu heading': () => byStatus(urlsOf('heading-skip').length, idx.length, 'Không trang nào nhảy cấp heading.', `${urlsOf('heading-skip').length} trang nhảy cấp heading.`, urlsOf('heading-skip'), ['US8060501B1'], 0.05),
    'h1 title': () => { const mis = urlsOf('entity-alignment'); return R(mis.length ? S.PART : S.PASS, `${idx.filter((p) => p.h1[0] && p.title && p.h1[0].trim() === p.title.trim()).length} trang có H1 trùng title (chấp nhận được nếu tự nhiên). ${mis.length} trang có H1 không khớp chủ đề với title/URL.`, mis, ['US10068022B2']); },
    'title 60 ky tu 580px': () => { const long = idx.filter((p) => p.title && p.title.length > 65); const dup = urlsOf('dup-title'); return R(!long.length && !dup.length ? S.PASS : long.length / Math.max(idx.length, 1) > 0.2 || dup.length ? S.FAIL : S.PART, `${long.length} title > 65 ký tự (có thể bị cắt); ${dup.length} trang trùng title; ${urlsOf('missing-title').length} trang thiếu title.`, [...long.map((p) => ({ url: p.url, note: p.title.length + ' ký tự' })), ...dup], ['US10068022B2']); },
    'meta desc 160 ky tu': () => { const long = idx.filter((p) => p.metaDesc && p.metaDesc.length > 170); const miss = urlsOf('missing-metaDesc'); return R(!long.length && !miss.length ? S.PASS : S.PART, `${miss.length} trang thiếu meta description; ${long.length} meta description > 170 ký tự.`, [...miss, ...long.map((p) => ({ url: p.url, note: p.metaDesc.length + ' ký tự' }))]); },
    'khong duplicate title meta': () => { const d = [...urlsOf('dup-title'), ...urlsOf('dup-metaDesc')]; return byStatus(d.length, idx.length, 'Không trùng title/meta description.', `${urlsOf('dup-title').length} trang trùng title, ${urlsOf('dup-metaDesc').length} trang trùng meta description.`, d, ['US10068022B2'], 0); },
    'robots meta': () => { const util = idx.filter((p) => /\/(tag|tags|author|search|tim-kiem|cart|gio-hang|checkout|thanh-toan|my-account|tai-khoan|wp-login|feed|attachment)\b|[?&](s|q|sort|orderby|filter)=/.test(p.url)); const noi = html.filter(isNoindex); return R(util.length ? S.FAIL : S.PASS, `${noi.length} trang noindex; ${util.length} trang tiện ích (tag/author/search/cart…) đang indexable.`, util.map((p) => ({ url: p.url, note: 'nên noindex?' })), ['US8554759B1']); },
    'open graph': () => { const bad = idx.filter((p) => !p.og?.title || !p.og?.image); return byStatus(bad.length, idx.length, 'Mọi trang có og:title và og:image.', `${bad.length} trang thiếu og:title/og:image.`, bad.map((p) => ({ url: p.url, note: [!p.og?.title && 'og:title', !p.og?.description && 'og:description', !p.og?.image && 'og:image'].filter(Boolean).join(', ') })), [], 0.05); },
    'organization localbusiness': () => {
      const o = html.map((p) => p.schemaInfo?.orgFull && { ...p.org, ...p.schemaInfo.orgFull }).find(Boolean);
      if (!o) return R(S.FAIL, 'Không có schema Organization/LocalBusiness.', [], ['US8682913B1', 'US10331706B1']);
      const need = { name: o.name, url: o.url, logo: o.logo, sameAs: o.sameAsList?.length, contactPoint: o.contactPoint, areaServed: o.areaServed, priceRange: o.priceRange };
      const miss = Object.entries(need).filter(([, v]) => !v).map(([k]) => k);
      return R(!miss.length ? S.PASS : miss.length <= 2 ? S.PART : S.FAIL, `Có Organization "${o.name || '?'}"; thiếu: ${miss.join(', ') || 'không'}; sameAs: ${o.sameAsList?.length || 0} hồ sơ.`, [], ['US8682913B1', 'US10331706B1', 'US9710549B2']);
    },
    'sitenavigationelement': () => R(home.schemaInfo?.navElement ? S.PASS : S.FAIL, home.schemaInfo?.navElement ? 'Homepage có SiteNavigationElement.' : 'Homepage chưa có SiteNavigationElement.'),
    'breadcrumb schema': () => { const bad = nonHome.filter((p) => !p.schemaTypes.includes('BreadcrumbList')); return byStatus(bad.length, nonHome.length, 'Mọi trang (trừ homepage) có BreadcrumbList.', `${bad.length}/${nonHome.length} trang thiếu BreadcrumbList.`, bad.map((p) => ({ url: p.url })), [], 0.05); },
    'article schema': () => { if (!articles.length) return R(S.NA, 'Không phát hiện trang bài viết/blog.'); const bad = articles.filter((p) => { const a = p.schemaInfo?.article; return !a || !a.headline || !a.author || !a.datePublished || !a.dateModified; }); return byStatus(bad.length, articles.length, `${articles.length} bài viết có Article schema đủ headline, author, datePublished, dateModified.`, `${bad.length}/${articles.length} bài viết thiếu Article schema hoặc thiếu trường.`, bad.map((p) => { const a = p.schemaInfo?.article; return { url: p.url, note: a ? 'thiếu ' + ['headline', 'author', 'datePublished', 'dateModified'].filter((k) => !a[k]).join(', ') : 'không có Article' }; }), ['US8150842B2', 'US9177074B2'], 0); },
    'aboutpage contactpage': () => { const about = html.find((p) => /gioi-thieu|about|ve-chung-toi/.test(p.url)); const contact = html.find((p) => /lien-he|contact/.test(p.url)); const r = [about ? `About (${about.url.replace(site.origin, '')}): ${about.schemaTypes.includes('AboutPage') ? 'có AboutPage' : 'chưa có AboutPage'}` : 'không tìm thấy trang About', contact ? `Contact (${contact.url.replace(site.origin, '')}): ${contact.schemaTypes.includes('ContactPage') ? 'có ContactPage' : 'chưa có ContactPage'}` : 'không tìm thấy trang Contact']; const ok = about?.schemaTypes.includes('AboutPage') && contact?.schemaTypes.includes('ContactPage'); return R(ok ? S.PASS : about || contact ? S.FAIL : S.MANUAL, r.join(' · '), [], ['US8442984B1']); },
    'collectionpage': () => { const lst = idx.filter((p) => /\/(category|danh-muc|chuyen-muc|blog|insights?|tin-tuc|works|du-an)\/?$|\/(category|danh-muc|chuyen-muc)\//.test(p.url)); if (!lst.length) return R(S.MANUAL, 'Không nhận diện được trang listing theo URL; kiểm tra tay.'); const bad = lst.filter((p) => !p.schemaTypes.includes('CollectionPage')); return byStatus(bad.length, lst.length, `${lst.length} trang listing có CollectionPage.`, `${bad.length}/${lst.length} trang listing chưa có CollectionPage.`, bad.map((p) => ({ url: p.url })), [], 0); },
    'service graph': () => { const sv = idx.filter((p) => /\/(dich-vu|services?|giai-phap|solutions?)\//.test(p.url)); if (!sv.length) return R(S.MANUAL, 'Không nhận diện được trang dịch vụ theo URL.'); const bad = sv.filter((p) => !p.schemaTypes.includes('Service')); return byStatus(bad.length, sv.length, `${sv.length} trang dịch vụ có Service schema.`, `${bad.length}/${sv.length} trang dịch vụ chưa có Service schema.`, bad.map((p) => ({ url: p.url })), [], 0); },
    'person schema author': () => { const au = html.filter((p) => /\/(author|tac-gia|team|chuyen-gia)\//.test(p.url)); if (!au.length) return R(S.MANUAL, 'Không tìm thấy trang tác giả (/author/…); nếu có bài viết chuyên môn nên có trang hồ sơ tác giả.', [], ['US8150842B2']); const bad = au.filter((p) => !p.schemaInfo?.person || !p.schemaInfo.person.sameAs || !p.schemaInfo.person.jobTitle); return byStatus(bad.length, au.length, `${au.length} trang tác giả có Person (sameAs, jobTitle).`, `${bad.length}/${au.length} trang tác giả thiếu Person schema hoặc thiếu sameAs/jobTitle.`, bad.map((p) => ({ url: p.url })), ['US8150842B2', 'US9177074B2'], 0); },
    'khong loi validation': () => { const e = urlsOf('schema-json-error'); return R(e.length ? S.FAIL : S.PART, e.length ? `${e.length} trang có JSON-LD lỗi cú pháp.` : 'JSON-LD parse được trên mọi trang; cần chạy Rich Results Test để kiểm tra lỗi thuộc tính.', e); },
    'khong duplicate schema': () => { const bad = html.filter((p) => ['Organization', 'BreadcrumbList', 'Article', 'BlogPosting', 'WebSite', 'LocalBusiness'].some((t) => (p.schemaCount?.[t] || 0) > 1)); return byStatus(bad.length, html.length, 'Không có node Organization/Breadcrumb/Article/WebSite trùng trên cùng trang.', `${bad.length} trang có node schema trùng loại (thường do plugin + code cùng xuất).`, bad.map((p) => ({ url: p.url, note: Object.entries(p.schemaCount).filter(([, n]) => n > 1).map(([t, n]) => `${t}×${n}`).join(', ') })), [], 0); },
    'structured data khop noi dung hien thi': () => { const faq = html.filter((p) => p.schemaInfo?.faqQuestions?.length); const bad = faq.filter((p) => p.schemaInfo.faqQuestions.some((q) => !p.mainText.toLowerCase().includes(q.toLowerCase().slice(0, 40)))); return R(bad.length ? S.FAIL : S.MANUAL, `${faq.length} trang có FAQPage; ${bad.length} trang có câu hỏi trong schema không thấy trên nội dung. Các loại schema khác cần đối chiếu tay.`, bad.map((p) => ({ url: p.url }))); },
    'social cards day du': () => { const bad = idx.filter((p) => !p.og?.title || !p.og?.image || !/^https?:\/\//.test(p.og.image) || !p.og?.twitter); return byStatus(bad.length, idx.length, 'Mọi trang có OG + twitter:card, og:image URL tuyệt đối.', `${bad.length} trang thiếu OG/twitter:card hoặc og:image không phải URL tuyệt đối.`, bad.map((p) => ({ url: p.url })), [], 0.05); },
    'seo fields fallback editable': () => R(S.MANUAL, `Kiểm tra trong CMS. Gợi ý từ crawl: ${urlsOf('missing-title').length} trang thiếu title, ${urlsOf('missing-metaDesc').length} thiếu meta description, ${urlsOf('canonical-missing').length} thiếu canonical.`),

    // ---------- 05 Content & Media ----------
    'cai plugin auto repleace name cua team dev cau hinh luon dinh dang webp hoac avif': () => { const imgs = [...new Set(html.flatMap((p) => p.images.map((i) => i.src)))].filter((s) => !/\.svg(\?|$)/i.test(s)); const modern = imgs.filter((s) => /\.(webp|avif)(\?|$)/i.test(s)); return imgs.length ? R(modern.length / imgs.length >= 0.9 ? S.PASS : modern.length ? S.PART : S.FAIL, `${modern.length}/${imgs.length} ảnh dùng WebP/AVIF (theo đuôi file).`, imgs.filter((s) => !/\.(webp|avif)(\?|$)/i.test(s)).map((s) => ({ url: s }))) : R(S.NA, 'Không có ảnh.'); },
    'alt text': () => { const bad = html.flatMap((p) => p.images.filter((i) => i.inMain && !i.hasAlt).map((i) => ({ url: i.src, note: 'trên ' + p.url }))); const total = html.reduce((a, p) => a + p.images.filter((i) => i.inMain).length, 0); return byStatus(bad.length, total, 'Mọi ảnh trong nội dung chính có thuộc tính alt.', `${bad.length}/${total} ảnh trong nội dung chính thiếu thuộc tính alt.`, bad, ['US8732187B1'], 0.02); },
    'ten file anh': () => { const imgs = [...new Set(html.flatMap((p) => p.images.map((i) => i.src)))]; const bad = imgs.filter((s) => { const f = decodeURIComponent(s.split('/').pop().split('?')[0]); return (/[A-Z_%\s]|[^\x00-\x7F]/.test(f) || /^(img|dsc|image|screenshot|photo|untitled|unnamed)[-_ ]?\d|^[\d-]+\.\w+$|^[a-f0-9]{24,}\.\w+$/i.test(f)) && !/\.svg$/i.test(f); }); return byStatus(bad.length, imgs.length, 'Tên file ảnh dạng slug có nghĩa.', `${bad.length}/${imgs.length} ảnh có tên file chưa chuẩn (chữ hoa, gạch dưới, có dấu, IMG_1234, chuỗi hash vô nghĩa…).`, bad.map((s) => ({ url: s })), [], 0.1); },
    'dinh dang dung luong': () => { const s = (probes.images || []).filter((i) => i.bytes); if (!s.length) return R(S.MANUAL, 'Không lấy được dung lượng ảnh (server không trả content-length).'); const big = s.filter((i) => i.bytes > 150 * 1024); return byStatus(big.length, s.length, `${s.length} ảnh mẫu đều < 150KB.`, `${big.length}/${s.length} ảnh mẫu > 150KB.`, big.sort((a, b) => b.bytes - a.bytes).map((i) => ({ url: i.src, note: Math.round(i.bytes / 1024) + ' KB' })), ['US8645362B1'], 0.05); },
    'kich thuoc anh chong cls': () => { const bad = html.flatMap((p) => p.images.filter((i) => !(i.w && i.h) && !/\.svg/i.test(i.src)).map((i) => ({ url: i.src, note: 'trên ' + p.url }))); const total = html.reduce((a, p) => a + p.images.length, 0); return byStatus(bad.length, total, 'Ảnh đều khai báo width/height.', `${bad.length}/${total} ảnh thiếu width/height.`, bad, ['US8645362B1'], 0.05); },
    'lazy loading': () => { const off = html.flatMap((p) => p.images.filter((i) => i.idx >= 3)); const bad = off.filter((i) => !i.lazy); return byStatus(bad.length, off.length, 'Ảnh ngoài màn hình đầu đều lazy-load.', `${bad.length}/${off.length} ảnh (từ ảnh thứ 4 trở đi trên trang) không có loading="lazy".`, bad.map((i) => ({ url: i.src })), ['US8645362B1'], 0.1); },
    'khong internal link 404': () => { const bad = P.filter((p) => (p.status >= 400 || p.status === 0) && p.inlinks.length); return byStatus(bad.length, P.length, 'Không link nội bộ nào trỏ tới URL lỗi.', `${bad.length} URL lỗi đang được link nội bộ.`, bad.map((p) => ({ url: p.url, note: `${p.status || p.error} · từ ${p.inlinks[0]?.from}` })), ['US7725452B1'], 0); },
    'khong redirect chain': () => { const bad = [...urlsOf('redirect-chains'), ...urlsOf('links-to-redirects')]; return byStatus(bad.length, P.length, 'Link nội bộ trỏ thẳng URL đích, không qua redirect.', `${urlsOf('links-to-redirects').length} URL redirect vẫn được link nội bộ; ${urlsOf('redirect-chains').length} chuỗi redirect ≥ 2 bước.`, bad, ['US7725452B1'], 0); },
    'khong trang orphan': () => byStatus(urlsOf('orphans').length, site.sitemap.count || idx.length, 'Mọi URL trong sitemap đều có link nội bộ trỏ tới.', issue('orphans')?.title || '', urlsOf('orphans'), ['US7509315B1', 'US6285999B1'], 0),
    'anchor text mo ta': () => (issue('generic-anchors') ? R(S.FAIL, issue('generic-anchors').title, urlsOf('generic-anchors'), ['US10210256B2', 'US8577893B1']) : R(S.PASS, 'Tỷ lệ anchor chung chung trong thân bài < 10%.', [], ['US10210256B2'])),
    'hreflang': () => (hreflangPages.length ? E['hreflang reciprocal x default']() : R(S.NA, 'Không có hreflang (site một ngôn ngữ?).')),
    'khong tron ngon ngu': () => { const bad = idx.filter((p) => p.viRatio !== null && ((/^vi/i.test(p.lang) && p.viRatio < 0.15) || (/^en/i.test(p.lang) && p.viRatio > 0.25))); return byStatus(bad.length, idx.length, 'Ngôn ngữ nội dung khớp thuộc tính lang.', `${bad.length} trang có ngôn ngữ nội dung không khớp lang (nghi trộn VI/EN).`, bad.map((p) => ({ url: p.url, note: `lang=${p.lang}, tỷ lệ từ có dấu ${(p.viRatio * 100).toFixed(0)}%` })), [], 0); },
    'decorative image alt rong': () => { const alts = html.flatMap((p) => p.images.filter((i) => i.alt).map((i) => i.alt.trim().toLowerCase())); const freq = new Map(); for (const a of alts) freq.set(a, (freq.get(a) || 0) + 1); const rep = [...freq.entries()].filter(([a, n]) => n >= 10 && a.length > 3); return R(rep.length ? S.PART : S.PASS, rep.length ? `Alt lặp hàng loạt: ${rep.slice(0, 5).map(([a, n]) => `"${a}" ×${n}`).join(', ')} (kiểm tra có phải ảnh trang trí/nhồi keyword).` : 'Không phát hiện alt lặp hàng loạt.', rep.map(([a, n]) => ({ url: a, note: '×' + n }))); },
    'hero lcp image khong lazy load': () => { const psiBad = psi.filter((x) => x.fails['lcp-lazy-loaded'] && x.fails['lcp-lazy-loaded'].score === 0); const bad = html.filter((p) => p.images.find((i) => i.inMain)?.lazy && p.images.find((i) => i.inMain).idx < 2); return R(psiBad.length || bad.length ? S.FAIL : S.PASS, `${psiBad.length ? `PSI: ảnh LCP bị lazy-load trên ${psiBad.map((x) => x.url).join(', ')}. ` : ''}${bad.length} trang có ảnh đầu tiên (above-the-fold) dùng lazy-load.`, [...psiBad.map((x) => ({ url: x.url, note: 'PSI lcp-lazy-loaded' })), ...bad.map((p) => ({ url: p.url }))], ['US8645362B1']); },
    'video embed budget': () => { const ifr = html.flatMap((p) => p.iframes.map((f) => ({ ...f, url: p.url }))); const vids = html.flatMap((p) => p.videos.map((v) => ({ ...v, url: p.url }))); if (!ifr.length && !vids.length) return R(S.NA, 'Không có iframe/video.'); const bad = [...ifr.filter((f) => !f.lazy).map((f) => ({ url: f.url, note: 'iframe không lazy' })), ...vids.filter((v) => !v.poster || v.autoplay).map((v) => ({ url: v.url, note: [!v.poster && 'thiếu poster', v.autoplay && 'autoplay'].filter(Boolean).join(', ') }))]; return R(bad.length ? S.PART : S.PASS, `${ifr.length} iframe, ${vids.length} video; ${bad.length} vấn đề (iframe không lazy, video thiếu poster/autoplay).`, bad); },
    'thin duplicate content review': () => { const t = urlsOf('thin-content'), d = urlsOf('near-duplicates'); return R(!t.length && !d.length ? S.PASS : S.FAIL, `${t.length} trang indexable < 250 từ; ${d.length} cặp trang gần trùng lặp.`, [...t, ...d], ['US8682892B1', 'US8554759B1', 'US9275143B2']); },
    'author editorial transparency': () => { if (!articles.length) return R(S.NA, 'Không phát hiện bài viết.'); const a = urlsOf('no-author'), d = urlsOf('no-date'); return R(!a.length && !d.length ? S.PASS : a.length > articles.length / 2 ? S.FAIL : S.PART, `${articles.length} bài viết: ${a.length} thiếu tác giả, ${d.length} thiếu ngày đăng/cập nhật.`, [...a, ...d], ['US8150842B2', 'US9177074B2', 'US8442984B1']); },

    // ---------- 06 Performance & CWV ----------
    'lcp 2 5s': () => cwv('lcp', 2500, ' ms'),
    'inp 200ms': () => cwv('inp', 200, ' ms'),
    'cls 0 1': () => cwv('cls', 0.1, '', (v) => v.toFixed(2)),
    'ttfb 800ms': () => { const f = fieldOf('ttfb'); const crawl = html.map((p) => p.ttfb).sort((a, b) => a - b); const med = crawl[Math.floor(crawl.length / 2)]; return f.length ? R(f.some((x) => x.v > 800) ? S.FAIL : S.PASS, 'Field p75: ' + f.map((x) => `${x.url.replace(site.origin, '') || '/'} ${x.v}ms`).join('; ') + ` · crawl trung vị ${med}ms`, [], ['US8645362B1', 'US8032518B2']) : R(med > 800 ? S.FAIL : S.PASS, `TTFB trung vị khi crawl: ${med}ms (đo từ máy chạy audit, không phải field data).`, urlsOf('slow-server'), ['US8645362B1', 'US8032518B2']); },
    'minify js css': () => { const f = psi.flatMap((x) => ['unminified-css', 'unminified-javascript'].filter((k) => x.fails[k] && x.fails[k].score !== null && x.fails[k].score < 0.9).map((k) => ({ url: x.url, note: `${x.fails[k].title} ${x.fails[k].value}` }))); return psi.length ? R(f.length ? S.FAIL : S.PASS, f.length ? `${f.length} cảnh báo minify từ PSI.` : 'PSI không báo CSS/JS chưa minify.', f) : R(S.MANUAL, noPsi); },
    'giam render blocking': () => { const f = psi.filter((x) => x.fails['render-blocking-resources'] && x.fails['render-blocking-resources'].score !== null && x.fails['render-blocking-resources'].score < 0.9).map((x) => ({ url: x.url, note: x.fails['render-blocking-resources'].value })); return psi.length ? R(f.length ? S.FAIL : S.PASS, f.length ? `PSI báo tài nguyên chặn render trên ${f.length}/${psi.length} URL mẫu.` : 'PSI không báo tài nguyên chặn render đáng kể.', f, ['US8645362B1']) : R(S.MANUAL, noPsi); },
    'best practices 90': () => (psi.length ? R(psi.every((x) => x.lab.bp >= 90) ? S.PASS : S.FAIL, psi.map((x) => `${x.url.replace(site.origin, '') || '/'}: ${x.lab.bp}`).join('; '), psi.filter((x) => x.lab.bp < 90).map((x) => ({ url: x.url, note: 'Best Practices ' + x.lab.bp }))) : R(S.MANUAL, noPsi)),
    'test da trang': () => (psi.length >= 3 ? R(S.PASS, `Đã chạy PSI mobile cho ${psi.length} URL: ` + psi.map((x) => `${x.url.replace(site.origin, '') || '/'} (Perf ${x.lab.perf}, BP ${x.lab.bp})`).join('; ')) : R(psi.length ? S.PART : S.MANUAL, psi.length ? `Mới chạy PSI cho ${psi.length} URL.` : noPsi)),
    'phan biet lab va field data': () => { const withField = psi.filter((x) => x.field.source); return R(psi.length ? (withField.length ? S.PASS : S.PART) : S.MANUAL, psi.length ? `${withField.length}/${psi.length} URL mẫu có field data CrUX (${withField.map((x) => x.field.source).join(', ') || 'không có'}); còn lại chỉ có lab. Báo cáo này ghi rõ nguồn cho từng chỉ số.` : noPsi, [], ['US8645362B1']); },
    'performance budget': () => { const s = html.map((p) => p.scriptCount).sort((a, b) => a - b); return R(S.MANUAL, `Cần đặt budget. Tham chiếu hiện tại: trung vị ${s[Math.floor(s.length / 2)] || 0} script/trang, HTML trung vị ${Math.round((html.map((p) => p.bytes).sort((a, b) => a - b)[Math.floor(html.length / 2)] || 0) / 1024)} KB${psi.length ? ', Lighthouse Perf ' + psi.map((x) => x.lab.perf).join('/') : ''}.`); },
    'font loading': () => { const f = psi.filter((x) => x.fails['font-display'] && x.fails['font-display'].score === 0).map((x) => ({ url: x.url })); return psi.length ? R(f.length ? S.FAIL : S.PASS, f.length ? 'PSI: font chưa dùng font-display phù hợp.' : 'PSI không báo lỗi font-display.', f) : R(S.MANUAL, noPsi); },
    'third party script governance': () => { const dup = html.filter((p) => p.gtmLoads > 1 || p.gtagLoads > 1 || p.gaIds.length > 1 || p.gtmIds.length > 1); const tp = psi.map((x) => x.fails['third-party-summary']).filter(Boolean); return R(dup.length ? S.FAIL : S.MANUAL, `${dup.length} trang tải GA/GTM nhiều lần hoặc nhiều ID (${[...new Set(html.flatMap((p) => [...p.gaIds, ...p.gtmIds]))].join(', ') || 'không thấy ID'}). ${tp.length ? 'PSI third-party: ' + tp.map((t) => t.value).filter(Boolean).join('; ') : ''} Cần đối chiếu tag inventory.`, dup.map((p) => ({ url: p.url, note: `gtm.js×${p.gtmLoads}, gtag.js×${p.gtagLoads}, ${[...p.gaIds, ...p.gtmIds].join(' ')}` }))); },

    // ---------- 07 Tracking & Pre-launch ----------
    'google analytics 4': () => (home.gaIds?.length || home.gtmIds?.length ? R(S.PART, `Trang chủ có ${[...(home.gaIds || []), ...(home.gtmIds || [])].join(', ')} (GA4 có thể nạp qua GTM). Cần xác nhận quyền Editor+ và DebugView.`) : R(S.FAIL, 'Không thấy GA4 (G-…) hoặc GTM trên trang chủ.')),
    'google search console': () => R(S.MANUAL, home.siteVerification ? 'Có meta google-site-verification; cần xác nhận property và sitemap đã submit.' : 'Không thấy meta google-site-verification (có thể verify bằng DNS); cần xác nhận trong GSC.'),
    'gtm consent mode v2': () => { const gtm = home.gtmIds?.length; const c = home.consent; return R(gtm && c ? S.PART : S.FAIL, `GTM: ${gtm ? home.gtmIds.join(', ') : 'không thấy'} · Consent/CMP: ${c ? 'có dấu hiệu (consent default hoặc CMP)' : 'không thấy'}. Cần Tag Assistant để xác nhận Consent Mode v2.`); },
    'status code toan site': () => { const nf = probes.notFound; const soft = nf && nf.status === 200; const err = P.filter((p) => p.status >= 400 || p.status === 0); return R(soft || err.length ? S.FAIL : S.PASS, `URL không tồn tại (${nf?.url}) trả ${nf?.status}${soft ? ' → soft-404' : ''}. Crawl: ${err.length} URL lỗi.`, err.map((p) => ({ url: p.url, note: String(p.status || p.error) }))); },
    'trang 404 custom': () => { const nf = probes.notFound || {}; return R(nf.status === 404 && nf.hasHomeLink && nf.words > 20 ? S.PASS : nf.status === 404 ? S.PART : S.FAIL, `Trang 404: status ${nf.status}, ${nf.hasHomeLink ? 'có' : 'không thấy'} link về trang chủ, ${nf.words} từ.`); },
    'kiem tra render googlebot': () => {
      const g = ua.googlebot || [], b = ua.browser || [];
      const bad = g.filter((x, i) => x.status !== 200 || (b[i]?.words > 50 && x.words < b[i].words * 0.8));
      const csr = html.filter((p) => p.words < 60 && p.scriptCount > 10);
      return R(bad.length || csr.length ? S.FAIL : S.PASS, `Googlebot UA: ${g.map((x, i) => `${x.url.replace(site.origin, '') || '/'} ${x.status} · ${x.words}/${b[i]?.words} từ`).join('; ')}. ${csr.length} trang gần như rỗng trong HTML thô (nghi render bằng JS).`, [...bad.map((x) => ({ url: x.url, note: `status ${x.status}, ${x.words} từ` })), ...csr.map((p) => ({ url: p.url, note: `${p.words} từ, ${p.scriptCount} script` }))], ['US20160314215A1']);
    },
    'khong noindex sot': () => { const homeNo = isNoindex(home); const share = html.filter(isNoindex).length / Math.max(html.length, 1); return R(homeNo ? S.FAIL : share > 0.5 ? S.PART : S.PASS, `Trang chủ ${homeNo ? 'đang NOINDEX' : 'index được'}; ${pct(html.filter(isNoindex).length, html.length)}% trang crawl được là noindex.`, html.filter(isNoindex).map((p) => ({ url: p.url }))); },
    'crawl sach lan cuoi': () => { const b = urlsOf('broken-pages').length, o = urlsOf('orphans').length, d = urlsOf('dup-title').length + urlsOf('dup-metaDesc').length; return R(!b && !o && !d ? S.PASS : S.FAIL, `${b} URL lỗi · ${o} trang mồ côi · ${d} trang trùng title/meta.`, [...urlsOf('broken-pages'), ...urlsOf('orphans')]); },
    'favicon': () => R(home.favicon && home.appleIcon ? S.PASS : home.favicon ? S.PART : S.FAIL, `favicon: ${home.favicon ? 'có' : 'không'} · apple-touch-icon: ${home.appleIcon ? 'có' : 'không'}.`),
    'analytics duplicate consent qa': () => E['third party script governance'](),
    'launch day smoke test': () => R(S.MANUAL, 'Có thể chạy lại công cụ này ngay sau deploy (tối đa ~50 URL, --max 50) làm smoke test: status, robots, canonical, noindex, hreflang, schema, tracking.'),

    // ---------- 08 GEO & AI Search ----------
    'cho phep bot ai robots txt': () => {
      const raw = site.robots.raw || '';
      const bots = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'PerplexityBot', 'Google-Extended', 'CCBot', 'Applebot-Extended', 'Bytespider'];
      const groups = raw.split(/\n(?=\s*user-agent)/i);
      const status = bots.map((b) => { const g = groups.find((x) => new RegExp('user-agent\\s*:\\s*' + b, 'i').test(x)); return `${b}: ${g ? (/disallow\s*:\s*\/\s*$/im.test(g) ? 'chặn' : 'cho phép (nhóm riêng)') : 'theo User-agent: *'}`; });
      return R(S.MANUAL, 'Policy cần client/Legal duyệt. Hiện trạng: ' + status.join(' · '));
    },
    'llms txt': () => { const l = probes.llms || {}; return R(l.status === 200 && l.markdown ? S.PASS : l.status === 200 ? S.PART : S.FAIL, l.status === 200 ? `/llms.txt trả 200 (${l.type}, ${l.size} byte${l.markdown ? ', dạng Markdown' : ', không thấy heading Markdown'}).` : `/llms.txt trả ${l.status}.`); },
    'noi dung trong raw html ssr': () => { const csr = html.filter((p) => p.words < 60 && p.scriptCount > 10); const noH1 = idx.filter((p) => !p.h1.length); return R(csr.length ? S.FAIL : noH1.length > idx.length * 0.3 ? S.PART : S.PASS, `Công cụ đọc HTML thô (không chạy JS): ${csr.length} trang gần như rỗng; ${noH1.length} trang không có H1 trong HTML thô.`, [...csr.map((p) => ({ url: p.url, note: p.words + ' từ' })), ...noH1.map((p) => ({ url: p.url, note: 'không có H1' }))]); },
    // navigation done in JS only (onclick that changes page, data-href, #/ routes); UI toggles like "Read more" or a menu button are not links.
    // Crawls cached before jsNavLinks existed fall back to the old, broader count.
    'internal link la the a href that': () => { const nav = (p) => (p.jsNavLinks !== undefined ? p.jsNavLinks + (p.hashRoutes || 0) : p.jsLinks > 3 ? p.jsLinks : 0); const bad = html.filter((p) => nav(p) > 0); return byStatus(bad.length, html.length, 'Link điều hướng dùng a href thật (nút giao diện như "Read more", mở menu không tính).', `${bad.length} trang có link điều hướng bằng JavaScript (onclick chuyển trang, data-href, route #/) thay vì a href thật.`, bad.map((p) => ({ url: p.url, note: nav(p) + ' link điều hướng bằng JS' })), [], 0.05); },
    'html5 landmarks': () => { const bad = html.filter((p) => !p.landmarks?.main && !p.landmarks?.article); const noNav = html.filter((p) => !p.landmarks?.nav || !p.landmarks?.header || !p.landmarks?.footer); return R(!bad.length && !noNav.length ? S.PASS : bad.length > html.length / 2 ? S.FAIL : S.PART, `${bad.length} trang không có <main>/<article>; ${noNav.length} trang thiếu nav/header/footer.`, bad.map((p) => ({ url: p.url })), ['US7676745B2']); },
    'mot chu de ro moi trang': () => (urlsOf('entity-alignment').length ? R(S.PART, `${urlsOf('entity-alignment').length} trang có H1 không khớp title/URL (chủ đề chưa nhất quán).`, urlsOf('entity-alignment'), ['US10068022B2']) : R(S.PASS, 'H1, title và URL nhất quán chủ đề.', [], ['US10068022B2'])),
    'organization sameas day du': () => { const o = html.map((p) => p.schemaInfo?.orgFull).find(Boolean); if (!o) return R(S.FAIL, 'Không có Organization schema.', [], ['US8682913B1']); const s = o.sameAsList || []; const has = (re) => s.some((x) => re.test(x)); return R(s.length >= 4 && has(/linkedin/) ? S.PASS : s.length ? S.PART : S.FAIL, `sameAs ${s.length} hồ sơ: ${list(s.map((x) => { try { return new URL(x).host.replace(/^www\./, ''); } catch { return x; } }), 8)}${has(/linkedin/) ? '' : ' · thiếu LinkedIn'}${has(/crunchbase/) ? '' : ' · thiếu Crunchbase'}.`, [], ['US8682913B1', 'US10331706B1', 'US8738643B1']); },
    'mo ta brand nhat quan da nguon': () => {
      const src = { 'meta description': home.metaDesc, 'og:description': home.og?.description, 'Organization.description': html.map((p) => p.schemaInfo?.orgFull?.description).find(Boolean), 'WebSite.description': home.schemaInfo?.websiteDesc }; const have = Object.entries(src).filter(([, v]) => v);
      const tok = (s) => new Set(s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));
      const sims = []; for (let i = 0; i < have.length; i++) for (let j = i + 1; j < have.length; j++) { const a = tok(have[i][1]), b = tok(have[j][1]); sims.push([have[i][0] + ' ↔ ' + have[j][0], [...a].filter((x) => b.has(x)).length / Math.max(1, new Set([...a, ...b]).size)]); }
      const low = sims.filter(([, s]) => s < 0.4);
      return R(have.length < 2 ? S.FAIL : low.length ? S.PART : S.PASS, have.length ? `Có ${have.length}/4 nguồn mô tả trên site (${have.map(([k]) => k).join(', ')}).${sims.length ? ' ' + sims.map(([k, s]) => `${k}: ${Math.round(s * 100)}% giống`).join('; ') + '.' : ''} Cần đối chiếu thêm với LinkedIn/Crunchbase.` : 'Trang chủ chưa có meta description, og:description hay description trong schema — chưa có câu định vị thương hiệu nào trên site.', [], ['US8682913B1']);
    },
    'person author entity day du': () => { if (!articles.length) return R(S.NA, 'Không có bài viết.'); const withP = html.filter((p) => p.schemaInfo?.person); const full = withP.filter((p) => p.schemaInfo.person.sameAs && p.schemaInfo.person.jobTitle && p.schemaInfo.person.worksFor); return R(full.length ? S.PASS : withP.length ? S.PART : S.FAIL, `${withP.length} trang có Person schema; ${full.length} đủ sameAs + jobTitle + worksFor. ${urlsOf('no-author').length}/${articles.length} bài viết không hiển thị tác giả.`, urlsOf('no-author'), ['US8150842B2', 'US9177074B2', 'US11868724B2']); },
    'faqpage schema khi phu hop': () => { const faq = html.filter((p) => p.schemaInfo?.faqQuestions?.length); if (!faq.length) return R(S.NA, 'Không dùng FAQPage.'); return E['structured data khop noi dung hien thi'](); },
    'heading dang cau hoi noi dung co cau truc': () => { if (!articles.length) return R(S.NA, 'Không có bài viết.'); const q = articles.filter((p) => p.questionHeadings > 0); return R(q.length / articles.length >= 0.5 ? S.PASS : S.PART, `${q.length}/${articles.length} bài viết có H2/H3 dạng câu hỏi; ${articles.filter((p) => p.headings.filter((h) => h.level === 2).length >= 3).length} bài có ≥ 3 mục H2.`, articles.filter((p) => !p.questionHeadings).map((p) => ({ url: p.url })), ['US9959315B1', 'US9679027B1']); },
    'datemodified cap nhat that': () => { if (!articles.length) return R(S.NA, 'Không có bài viết.'); const bad = articles.filter((p) => !p.dateModified); return byStatus(bad.length, articles.length, 'Bài viết đều có dateModified.', `${bad.length}/${articles.length} bài viết thiếu dateModified.`, bad.map((p) => ({ url: p.url })), ['US8868541B2', 'US7346839B2'], 0); },
    'test bang user agent bot ai': () => { const b = ua.browser || []; const rows = ['GPTBot', 'ClaudeBot', 'PerplexityBot'].flatMap((n) => (ua[n] || []).map((x, i) => ({ n, ...x, ref: b[i]?.words || 0 }))); const bad = rows.filter((x) => x.status !== 200 || (x.ref > 50 && x.words < x.ref * 0.8)); return R(bad.length ? S.FAIL : S.PASS, rows.filter((x) => x.url === site.start).map((x) => `${x.n}: ${x.status}, ${x.words}/${x.ref} từ`).join(' · ') + (bad.length ? ` · ${bad.length} lượt bị chặn/thiếu nội dung` : ''), bad.map((x) => ({ url: x.url, note: `${x.n} → ${x.status}, ${x.words} từ` }))); },

    // ---------- 09 Post-launch ----------
    'crawl lai 24 72 gio': () => R(S.PART, 'Chạy lại công cụ sau launch và so với file crawl đã lưu (reports/*.crawl.json) làm baseline.'),
    'bot crawl log review': () => E['test bang user agent bot ai'](),
    'redirect 404 monitoring': () => R(S.MANUAL, `Cần log/GSC. Crawl hiện tại: ${urlsOf('broken-pages').length} URL lỗi, ${urlsOf('redirect-chains').length} chuỗi redirect.`, urlsOf('broken-pages')),
    'cwv field review': () => E['phan biet lab va field data'](),
  };

  return rows.map((r) => {
    const key = norm(r.item);
    const fn = E[key] || Object.entries(E).find(([k]) => key.startsWith(k) || k.startsWith(key))?.[1];
    let res;
    try { res = fn ? fn() : R(S.MANUAL, `Hạng mục cần kiểm tra thủ công. Công cụ gợi ý: ${r.tool || '—'}`); }
    catch (e) { res = R(S.MANUAL, 'Lỗi khi đánh giá tự động: ' + e.message); }
    return { ...r, ...res, auto: !!fn };
  });
}


// Write a copy of the checklist workbook with the audit results filled in.
// The original .xlsx package is edited in place (only the touched cells, 3 column widths and a few appended
// styles): a full exceljs round-trip drops the custom table styles and rewrites tables/filters in a way Excel
// refuses to open.
const COLOR = { 'Đạt': 'FFD9F2E3', 'Chưa đạt': 'FFFBDAD7', 'Một phần': 'FFFDEFD2', 'Cần kiểm tra thủ công': 'FFE8EEF8', 'Không áp dụng': 'FFEFEFEF' };
const colName = (n) => { let s = ''; for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s; return s; };
const colNum = (s) => [...s].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
const xmlEsc = (s) => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function setCell(xml, ref, text, style) {
  const rowNum = Number(ref.match(/\d+/)[0]);
  const cell = (s) => `<c r="${ref}"${s != null ? ` s="${s}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(text).slice(0, 32000)}</t></is></c>`;
  const rowRe = new RegExp(`<row r="${rowNum}"[^>]*?(?:/>|>[\\s\\S]*?</row>)`);
  const row = xml.match(rowRe)?.[0];
  if (!row) return xml;   // rows always exist in the Enosta template; never invent one
  const cellRe = new RegExp(`<c r="${ref}"([^>]*?)(?:/>|>[\\s\\S]*?</c>)`);
  let next;
  if (cellRe.test(row)) next = row.replace(cellRe, (m, attrs) => cell(style ?? attrs.match(/ s="(\d+)"/)?.[1]));
  else {
    const open = row.endsWith('/>') ? row.slice(0, -2) + '>' : row.slice(0, row.length - '</row>'.length);
    const cells = [...open.matchAll(/<c r="([A-Z]+)\d+"[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)];
    const after = cells.find((m) => colNum(m[1]) > colNum(ref.match(/[A-Z]+/)[0]));
    next = after ? open.replace(after[0], cell(style) + after[0]) + '</row>' : open + cell(style) + '</row>';
  }
  return xml.replace(row, next);
}

function setWidths(xml, widths) {
  const cols = new Map();
  for (const m of (xml.match(/<cols>([\s\S]*?)<\/cols>/)?.[1] || '').matchAll(/<col ([^>]*?)\/>/g)) {
    const a = m[1], min = +a.match(/min="(\d+)"/)[1], max = +a.match(/max="(\d+)"/)[1];
    for (let i = min; i <= Math.min(max, 200); i++) cols.set(i, a.replace(/min="\d+"/, `min="${i}"`).replace(/max="\d+"/, `max="${i}"`));
  }
  for (const [i, w] of Object.entries(widths)) cols.set(+i, `min="${i}" max="${i}" width="${w}" customWidth="1"`);
  const body = [...cols.entries()].sort((a, b) => a[0] - b[0]).map(([, a]) => `<col ${a}/>`).join('');
  return /<cols>/.test(xml) ? xml.replace(/<cols>[\s\S]*?<\/cols>/, `<cols>${body}</cols>`) : xml.replace('<sheetData', `<cols>${body}</cols><sheetData`);
}

// append fonts/fills/xfs to styles.xml; returns { xml, wrap, status: {status: xfId} }
function addStyles(styles) {
  const append = (tag, items) => {
    const m = styles.match(new RegExp(`<${tag} count="(\\d+)"([^>]*)>([\\s\\S]*?)</${tag}>`));
    const base = Number(m[1]);
    styles = styles.replace(m[0], `<${tag} count="${base + items.length}"${m[2]}>${m[3]}${items.join('')}</${tag}>`);
    return base;
  };
  const font = append('fonts', ['<font><b/><sz val="10"/><name val="Arial"/></font>', '<font><sz val="10"/><name val="Arial"/></font>']);
  const statuses = Object.keys(COLOR);
  const fill = append('fills', statuses.map((s) => `<fill><patternFill patternType="solid"><fgColor rgb="${COLOR[s]}"/><bgColor indexed="64"/></patternFill></fill>`));
  const align = '<alignment vertical="top" wrapText="1"/>';
  const xf = append('cellXfs', [
    `<xf numFmtId="0" fontId="${font + 1}" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1">${align}</xf>`,
    ...statuses.map((s, i) => `<xf numFmtId="0" fontId="${font}" fillId="${fill + i}" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1">${align}</xf>`),
  ]);
  return { xml: styles, wrap: xf, status: Object.fromEntries(statuses.map((s, i) => [s, xf + 1 + i])) };
}

export async function writeChecklist(file, results, outFile, meta) {
  // layout (header row, status column, last used column) read with exceljs; the package itself is edited directly
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const wbXml = await zip.file('xl/workbook.xml').async('string');
  const wbRels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
  const sheetPath = (name) => {
    const esc = xmlEsc(name);
    const rid = [...wbXml.matchAll(/<sheet [^>]*>/g)].map((m) => m[0]).find((s) => s.includes(`name="${esc}"`))?.match(/r:id="([^"]+)"/)?.[1];
    const target = [...wbRels.matchAll(/<Relationship [^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`))?.match(/Target="([^"]+)"/)?.[1];
    return target && (target.startsWith('/') ? target.slice(1) : 'xl/' + target);
  };
  const st = addStyles(await zip.file('xl/styles.xml').async('string'));
  zip.file('xl/styles.xml', st.xml);

  for (const ws of wb.worksheets) {
    const mine = results.filter((r) => r.sheet === ws.name);
    const p = mine.length && sheetPath(ws.name);
    if (!p || !zip.file(p)) continue;
    let headRow = null, statusCol = null;
    ws.eachRow((row, i) => { const vals = Array.from(row.values, (v) => norm(cellText(v))); if (!headRow && vals.includes('hang muc')) { headRow = i; statusCol = vals.findIndex((v) => v.startsWith('trang thai')); if (statusCol < 0) statusCol = null; } });
    const headVals = Array.from(ws.getRow(headRow).values, (v) => String(cellText(v)).trim());
    const lastCol = headVals.reduce((m, v, i) => (v ? i : m), 1);
    const [cA, cE, cP] = [lastCol + 1, lastCol + 2, lastCol + 3].map(colName);
    let xml = await zip.file(p).async('string');
    const headStyle = xml.match(new RegExp(`<c r="${colName(lastCol)}${headRow}"[^>]*? s="(\\d+)"`))?.[1];
    [[cA, `Kết quả audit tự động (${meta.date})`], [cE, 'Bằng chứng audit'], [cP, 'Patent căn cứ']].forEach(([c, t]) => { xml = setCell(xml, c + headRow, t, headStyle); });
    xml = setWidths(xml, { [lastCol + 1]: 22, [lastCol + 2]: 70, [lastCol + 3]: 22 });
    for (const r of mine) {
      if (statusCol) xml = setCell(xml, colName(statusCol) + r.row, STATUS_TO_ENOSTA[r.status], null);
      xml = setCell(xml, cA + r.row, r.status + (r.auto ? '' : ' (thủ công)'), st.status[r.status]);
      const ev = r.evidence + (r.urls.length ? '\n' + r.urls.slice(0, 8).map((u) => '• ' + u.url + (u.note ? ' — ' + u.note : '')).join('\n') + (r.urls.length > 8 ? `\n… +${r.urls.length - 8} mục (xem báo cáo HTML)` : '') : '');
      xml = setCell(xml, cE + r.row, ev, st.wrap);
      xml = setCell(xml, cP + r.row, r.patents.join(', '), st.wrap);
    }
    zip.file(p, xml);
  }
  const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  if (outFile) fs.writeFileSync(outFile, buf);
  return buf;
}