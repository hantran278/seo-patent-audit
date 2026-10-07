// MCP server exposing the audit to Claude / ChatGPT. Shared by api/mcp.js (remote, Vercel) and mcp-stdio.mjs (local).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { runAudit, DEFAULT_CHECKLIST } from './run.mjs';
import { crawl } from './crawler.mjs';
import { isAllowedUrl } from './guard.mjs';
import { GROUPS } from '../checks/common.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PATENTS = JSON.parse(fs.readFileSync(path.join(here, 'patents.json'), 'utf8'));
// common SEO wording (vi/en) → terms that actually appear in the patent summaries
const ALIASES = [
  [/mỏng|thin|panda|helpful|hữu ích|chất lượng nội dung/, ['panda', 'chất lượng site', 'site quality']],
  [/trùng|duplicate|canonical|chuẩn hóa/, ['trùng lặp', 'canonical', 'đại diện']],
  [/click|navboost|ctr|hành vi|user signal|tín hiệu người dùng/, ['phản hồi ngầm', 'click', 'navboost']],
  [/backlink|liên kết|link building|pagerank/, ['link', 'pagerank', 'anchor']],
  [/eeat|e-e-a-t|tác giả|author|chuyên gia|expert/, ['tác giả', 'uy tín']],
  [/fresh|độ tươi|cập nhật|lastmod/, ['độ tươi', 'cập nhật', 'lịch sử']],
  [/thực thể|entity|knowledge graph|thương hiệu|brand/, ['thực thể', 'entity', 'knowledge']],
  [/spam|nhồi|stuffing|ẩn|cloak/, ['spam', 'nhồi', 'ẩn']],
  [/tốc độ|speed|core web vitals|cwv|tải trang/, ['tốc độ', 'thời gian tải', 'load']],
  [/ai overview|sge|generative|tạo sinh|ai mode/, ['tạo sinh', 'ai overviews', 'mô hình ngôn ngữ']],
];
const SEV = { high: 'CAO', medium: 'TRUNG BÌNH', low: 'THẤP', info: 'THÔNG TIN' };
const text = (s) => ({ content: [{ type: 'text', text: s }] });
const fail = (s) => ({ content: [{ type: 'text', text: s }], isError: true });

async function normUrl(u) {
  let start;
  try { start = new URL(/^https?:\/\//.test(u) ? u : 'https://' + u).href; } catch { throw new Error('URL không hợp lệ.'); }
  if (!(await isAllowedUrl(start))) throw new Error('Chỉ kiểm tra được website công khai (http/https).');
  return start;
}

// Compact, LLM-friendly report: score, groups, prioritised issues with evidence and fixes
function summarize(data, { maxIssues = 30, urlsPerIssue = 8 } = {}) {
  const L = [];
  L.push(`# SEO audit: ${data.site.host}`);
  L.push(`Ngày: ${data.meta.date} · ${data.site.crawled} URL đã crawl · ${data.site.indexable} trang indexable · sitemap ${data.site.sitemapCount} URL`);
  L.push(`\n## Điểm tổng: ${data.score.overall}/100`);
  for (const g of Object.values(data.groups)) L.push(`- ${g.priority} ${g.label}: ${g.score ?? 'chưa có dữ liệu'} (${g.counts.high} cao, ${g.counts.medium} TB, ${g.counts.low} thấp)`);
  const issues = [...data.issues].sort((a, b) => (b.rank - a.rank) || (b.count - a.count));
  const real = issues.filter((i) => i.severity !== 'info');
  L.push(`\n## Vấn đề cần xử lý (${real.length}, xếp theo mức ưu tiên)`);
  for (const i of real.slice(0, maxIssues)) {
    L.push(`\n### [${SEV[i.severity]}] ${i.title}`);
    L.push(`Nhóm: ${GROUPS[i.group]?.label || i.group} · mã: ${i.id}`);
    if (i.why) L.push(`Vì sao: ${i.why}`);
    if (i.fix) L.push(`Cách sửa: ${i.fix}`);
    if (i.patents?.length) L.push(`Patent: ${i.patents.map((p) => `${p}${PATENTS[p] ? ` (${PATENTS[p].title})` : ''}`).join('; ')}`);
    if (i.urls?.length) {
      L.push(`Ví dụ (${i.urls.length}${i.count > i.urls.length ? '+' : ''}):`);
      for (const u of i.urls.slice(0, urlsPerIssue)) L.push(`- ${u.url}${u.note ? ` · ${u.note}` : ''}`);
    }
  }
  if (real.length > maxIssues) L.push(`\n…và ${real.length - maxIssues} vấn đề mức thấp hơn.`);
  const info = issues.filter((i) => i.severity === 'info');
  if (info.length) {
    L.push('\n## Ghi chú / cơ hội');
    for (const i of info) L.push(`- ${i.title}${i.urls?.length ? `: ${i.urls.slice(0, 5).map((u) => u.url + (u.note ? ` (${u.note})` : '')).join('; ')}` : ''}`);
  }
  if (data.gsc?.summary) L.push(`\n## GSC: ${data.gsc.summary.queries} query · ${data.gsc.summary.clicks} click · ${data.gsc.summary.impressions} hiển thị`);
  if (data.checklist) {
    const items = data.checklist.items;
    const c = items.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
    L.push(`\n## Checklist Enosta (${items.length} hạng mục): ` + Object.entries(c).map(([k, v]) => `${v} ${k}`).join(' · '));
    for (const r of items.filter((r) => r.status === 'Chưa đạt').slice(0, 40)) L.push(`- [Chưa đạt] ${r.sheet ? r.sheet + ' · ' : ''}${r.item || r.criteria || ''}${r.evidence ? ` · ${String(r.evidence).slice(0, 160)}` : ''}`);
  }
  return L.join('\n');
}

export function createServer({ remote = false } = {}) {
  const server = new McpServer({ name: 'seo-patent-audit', version: '1.0.0' }, {
    instructions: 'Công cụ audit SEO nội bộ dựa trên ~260 patent Google và checklist kỹ thuật Enosta. Dùng audit_site cho cả website (mất 1–4 phút), check_page để xem nhanh một URL (vài giây), find_patent để giải thích cơ chế Google đằng sau một vấn đề. Trả lời người dùng bằng tiếng Việt, giữ nguyên thuật ngữ SEO tiếng Anh.',
  });

  server.registerTool('audit_site', {
    title: 'Audit SEO website',
    description: 'Crawl một website và chấm điểm SEO theo 11 nhóm yếu tố (crawl/index, trùng lặp, chất lượng site, liên kết, nội dung, thực thể, trải nghiệm trang…), trả về danh sách vấn đề xếp theo ưu tiên kèm URL ví dụ, cách sửa và patent Google làm căn cứ. Mất khoảng 1–4 phút tuỳ số URL. Dùng được cho site của mình lẫn site đối thủ.',
    inputSchema: {
      url: z.string().describe('Domain hoặc URL trang chủ, ví dụ enosta.com'),
      max_pages: z.number().int().min(5).max(remote ? 150 : 500).default(40).describe('Số URL tối đa crawl. 40 ≈ 1 phút; 150 ≈ 3–4 phút.'),
      brand: z.string().optional().describe('Tên thương hiệu, nhiều tên cách nhau bằng dấu phẩy'),
      include_checklist: z.boolean().default(false).describe('Đánh giá thêm 124 hạng mục checklist kỹ thuật Enosta (thêm ~30–60 giây)'),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url, max_pages = 40, brand = '', include_checklist = false }) => {
    try {
      const start = await normUrl(url);
      const deadline = Date.now() + (remote ? 250 : 900) * 1000;
      const r = await runAudit({
        url: start, maxPages: max_pages, brand: brand.split(',').map((s) => s.trim()).filter(Boolean),
        delay: remote ? 100 : 200, concurrency: remote ? 6 : 4, imageLimit: 30, deadline,
        checklistFile: include_checklist ? DEFAULT_CHECKLIST : null,
        psi: include_checklist && !!process.env.PSI_KEY, psiKey: process.env.PSI_KEY || '',
        log: () => {},
      });
      return text(summarize(r.data));
    } catch (e) { return fail('Audit lỗi: ' + e.message); }
  });

  server.registerTool('check_page', {
    title: 'Kiểm tra nhanh một trang',
    description: 'Tải một URL và trả về các yếu tố on-page: status, title, meta description, H1–H3, canonical, meta robots, số từ, schema, link nội bộ/ngoài, ảnh thiếu alt, Open Graph, tác giả/ngày đăng. Mất vài giây. Hợp để so sánh trang của mình với trang đối thủ đang xếp hạng.',
    inputSchema: { url: z.string().describe('URL đầy đủ của trang') },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    try {
      const start = await normUrl(url);
      const site = await crawl(start, { maxPages: 1, delay: 0, concurrency: 1, log: () => {}, deadline: Date.now() + 40000 });
      const p = site.pages[0];
      if (!p) return fail('Không tải được trang.');
      const internal = (p.links || []).filter((l) => l.href.includes(site.host));
      const out = {
        url: p.url, finalUrl: p.finalUrl, status: p.status, ...(p.error ? { error: p.error } : {}), ttfb_ms: p.ttfb, redirectChain: p.chain, xRobotsTag: p.xRobots || null,
        title: p.title, titleLength: p.title?.length ?? 0, metaDescription: p.metaDesc, metaDescriptionLength: p.metaDesc?.length ?? 0,
        canonical: p.canonical, metaRobots: p.robotsMeta || null, lang: p.lang, hreflang: p.hreflang,
        h1: p.h1, headings: (p.headings || []).filter((h) => h.level <= 3).slice(0, 40).map((h) => `H${h.level}: ${h.text}`),
        words: p.words, questionHeadings: p.questionHeadings,
        schemaTypes: p.schemaTypes, schemaErrors: p.schemaErrors, organization: p.org,
        links: { internal: internal.length, internalInContent: internal.filter((l) => l.main).length, external: (p.links || []).length - internal.length, nofollow: (p.links || []).filter((l) => l.nofollow).length },
        images: { total: p.imgCount, missingAlt: p.imgNoAlt },
        openGraph: p.og, author: p.byline || p.authorSchema || null, datePublished: p.datePublished, dateModified: p.dateModified,
        inSitemap: p.inSitemap, robotsTxt: site.robots?.status,
        mainTextExcerpt: (p.mainText || '').slice(0, 1500),
      };
      return text(JSON.stringify(out, null, 1));
    } catch (e) { return fail('Lỗi: ' + e.message); }
  });

  server.registerTool('find_patent', {
    title: 'Tra cứu patent Google',
    description: 'Tìm trong kho ~260 patent Google đã phân tích (tiếng Việt) theo mã patent (ví dụ US8682892B1) hoặc từ khoá (ví dụ "nội dung mỏng", "anchor", "navboost", "canonical"). Trả về tên, năm và cơ chế hoạt động để giải thích vì sao một vấn đề SEO quan trọng.',
    inputSchema: { query: z.string().describe('Mã patent hoặc từ khoá') },
    annotations: { readOnlyHint: true },
  }, async ({ query }) => {
    const q = query.trim().toLowerCase();
    const id = Object.keys(PATENTS).find((k) => k.toLowerCase() === q.replace(/\s/g, '') || k.toLowerCase().startsWith(q.replace(/\s/g, '')) && q.length >= 7);
    // rank: whole phrase in title ≫ phrase in text ≫ rare words (IDF) in title/text
    const docs = Object.entries(PATENTS).map(([k, p]) => [k, (p.title || '').toLowerCase(), `${p.mech || ''} ${p.note || ''}`.toLowerCase()]);
    const extra = ALIASES.filter(([re]) => re.test(q)).flatMap(([, terms]) => terms);
    const words = [...new Set([...q.split(/\s+/).filter((w) => w.length > 1), ...extra])];
    const idf = Object.fromEntries(words.map((w) => [w, Math.log(1 + docs.length / (1 + docs.filter(([, t, b]) => t.includes(w) || b.includes(w)).length))]));
    const hits = id ? [id] : docs
      .map(([k, t, b]) => [k, (t.includes(q) ? 20 : 0) + (b.includes(q) ? 8 : 0) + words.reduce((s, w) => s + (t.includes(w) ? 2 * idf[w] : 0) + (b.includes(w) ? idf[w] : 0), 0)])
      .filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k]) => k);
    if (!hits.length) return text('Không tìm thấy patent phù hợp. Thử từ khoá khác (tiếng Việt hoặc tiếng Anh).');
    return text(hits.map((k) => `## ${k}: ${PATENTS[k].title} (${PATENTS[k].year || '?'})\n${PATENTS[k].mech || ''}\nhttps://patents.google.com/patent/${k}`).join('\n\n'));
  });

  return server;
}
