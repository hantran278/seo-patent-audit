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
import { makeEvidenceBundle, parseConnector, sourceFromArgs, writeEvidenceBundle } from './connectors.mjs';

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
    instructions: 'Công cụ audit SEO nội bộ dựa trên ~260 patent Google và checklist kỹ thuật Enosta. Dùng audit_site cho cả website (mất 1–4 phút), check_page để xem nhanh một URL, get_gsc_snapshot/get_ga4_snapshot/inspect_screaming_frog_csv để chuẩn hoá evidence connector, và find_patent để giải thích cơ chế Google. Connector output là evidence, không phải CMS authorization. Trả lời người dùng bằng tiếng Việt, giữ nguyên thuật ngữ SEO tiếng Anh.',
  });

  server.registerTool('audit_site', {
    title: 'Audit SEO website',
    description: 'Crawl một website và chấm điểm SEO theo 12 nhóm yếu tố (crawl/index, trùng lặp, chất lượng site, liên kết, nội dung, thực thể, trải nghiệm trang, sẵn sàng cho AI…), trả về danh sách vấn đề xếp theo ưu tiên kèm URL ví dụ, cách sửa và patent Google làm căn cứ. Mất khoảng 1–4 phút tuỳ số URL. Dùng được cho site của mình lẫn site đối thủ.',
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

  // Connector bridge. Local stdio callers may pass a file path. Remote MCP
  // callers must send bounded CSV/JSON payloads because a remote server cannot
  // safely read the caller's filesystem or Google OAuth cookie.
  const sourceFields = {
    path: z.string().max(1000).optional().describe('Path local, chỉ dùng với MCP stdio.'),
    csv: z.string().max(3_500_000).optional().describe('CSV payload; dùng được với remote MCP.'),
    json: z.string().max(3_500_000).optional().describe('JSON rows payload; dùng được với remote MCP.'),
  };
  const commonFields = {
    property: z.string().max(300).optional(), start_date: z.string().max(20).optional(), end_date: z.string().max(20).optional(), max_rows: z.number().int().min(1).max(100000).default(5000),
  };
  const sourceResult = (kind, args) => {
    const input = sourceFromArgs({ path: args.path, csv: args.csv, json: args.json }, remote);
    const parsed = parseConnector({ kind, input, property: args.property, site: args.site, startDate: args.start_date, endDate: args.end_date, maxRows: args.max_rows });
    return { source: parsed.source, ...parsed.packet };
  };

  server.registerTool('get_gsc_snapshot', {
    title: 'Đọc snapshot Google Search Console',
    description: 'Đọc CSV/JSON GSC ở chế độ read-only và chuẩn hoá query × page, clicks, impressions, CTR, position, date thành evidence packet. MCP stdio nhận path local; MCP remote nhận csv/json payload. Không gọi Google và không đọc credential.',
    inputSchema: { ...sourceFields, ...commonFields, property: z.string().max(300).optional().describe('Property GSC, ví dụ sc-domain:enosta.com') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try { return text(JSON.stringify(sourceResult('gsc', args))); }
    catch (e) { return fail('GSC bridge lỗi: ' + e.message); }
  });

  server.registerTool('get_ga4_snapshot', {
    title: 'Đọc snapshot GA4',
    description: 'Đọc CSV/JSON GA4 organic landing page ở chế độ read-only và chuẩn hoá path, host, sessions, engaged sessions, engagement rate, key events, duration. MCP stdio nhận path local; MCP remote nhận csv/json payload. Không gọi Google và không đọc credential.',
    inputSchema: { ...sourceFields, ...commonFields, property: z.string().max(300).optional().describe('GA4 property, ví dụ properties/123') },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try { return text(JSON.stringify(sourceResult('ga4', args))); }
    catch (e) { return fail('GA4 bridge lỗi: ' + e.message); }
  });

  server.registerTool('inspect_screaming_frog_csv', {
    title: 'Đọc export Screaming Frog',
    description: 'Đọc export Internal - All/HTML của Screaming Frog ở chế độ read-only và chuẩn hoá URL, status, indexability, title, meta, H1, words, crawl depth, inlinks, canonical, response time. MCP stdio nhận path local; MCP remote nhận csv/json payload.',
    inputSchema: { ...sourceFields, site: z.string().max(300).optional(), max_rows: z.number().int().min(1).max(100000).default(50000) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async (args) => {
    try { return text(JSON.stringify(sourceResult('screaming_frog', args))); }
    catch (e) { return fail('Screaming Frog bridge lỗi: ' + e.message); }
  });

  server.registerTool('write_connector_bundle', {
    title: 'Ghi evidence bundle connector cho Enosta',
    description: 'Gộp các nguồn GSC/GA4/Screaming Frog thành một evidence packet có hash và coverage. Chỉ MCP stdio được ghi file local trong output root; remote MCP chỉ trả summary/bundle, không ghi filesystem. Không sửa WordPress.',
    inputSchema: {
      site: z.string().max(300).optional(), out_path: z.string().max(1000).optional(),
      gsc_path: z.string().max(1000).optional(), gsc_csv: z.string().max(3_500_000).optional(), gsc_json: z.string().max(3_500_000).optional(), gsc_property: z.string().max(300).optional(),
      ga4_path: z.string().max(1000).optional(), ga4_csv: z.string().max(3_500_000).optional(), ga4_json: z.string().max(3_500_000).optional(), ga4_property: z.string().max(300).optional(),
      screaming_frog_path: z.string().max(1000).optional(), screaming_frog_csv: z.string().max(3_500_000).optional(), screaming_frog_json: z.string().max(3_500_000).optional(),
      start_date: z.string().max(20).optional(), end_date: z.string().max(20).optional(),
    },
    annotations: { readOnlyHint: false, openWorldHint: false },
  }, async (args) => {
    try {
      if (remote && (args.out_path || args.gsc_path || args.ga4_path || args.screaming_frog_path)) throw new Error('Remote MCP chỉ nhận payload, không đọc/ghi path local.');
      const parseOptional = (kind, pathValue, csvValue, jsonValue, extra = {}) => {
        if (!pathValue && csvValue == null && jsonValue == null) return null;
        const parsed = parseConnector({ kind, input: sourceFromArgs({ path: pathValue, csv: csvValue, json: jsonValue }, remote), property: extra.property, site: args.site, startDate: args.start_date, endDate: args.end_date, maxRows: extra.maxRows });
        return parsed;
      };
      const bundle = makeEvidenceBundle({ site: args.site, gsc: parseOptional('gsc', args.gsc_path, args.gsc_csv, args.gsc_json, { property: args.gsc_property, maxRows: 50000 }), ga4: parseOptional('ga4', args.ga4_path, args.ga4_csv, args.ga4_json, { property: args.ga4_property, maxRows: 20000 }), screamingFrog: parseOptional('screaming_frog', args.screaming_frog_path, args.screaming_frog_csv, args.screaming_frog_json, { maxRows: 50000 }) });
      if (!Object.keys(bundle.sources).length) throw new Error('Cần ít nhất một nguồn GSC, GA4 hoặc Screaming Frog.');
      if (remote) return text(JSON.stringify({ bundle, written: false, note: 'Remote MCP không ghi file local. Lưu bundle này thành input cho Enosta backend.' }));
      return text(JSON.stringify({ bundle_summary: writeEvidenceBundle(bundle, args.out_path), written: true }));
    } catch (e) { return fail('Connector bundle lỗi: ' + e.message); }
  });

  return server;
}
