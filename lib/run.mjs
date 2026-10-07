// Core audit pipeline shared by the CLI (audit.mjs) and the web API (api/audit.js).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { crawl } from './crawler.mjs';
import { score } from './score.mjs';
import { renderReport } from './report.mjs';
import { runProbes } from './probes.mjs';
import { isIndexable } from '../checks/common.mjs';
import { crawlIndex, duplicates, pageExperience } from '../checks/technical.mjs';
import { siteQuality, topicality, spam, entities, authorship } from '../checks/content.mjs';
import { links, backlinks } from '../checks/links.mjs';
import { normalizeGsc, gscChecks } from '../checks/gsc.mjs';
import { loadChecklist, evaluateChecklist, writeChecklist } from '../checks/enosta.mjs';
import { sfChecks, keywordChecks, auditImportChecks, trafficPagesBroken, ga4Checks } from '../checks/imports.mjs';
import { classifyFiles, normBacklinks } from './sources.mjs';
import { backlinkAudit } from '../checks/backlinks.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CHECKLIST = path.join(here, '..', 'checklists', 'Enosta Dev_SEO Checklist.xlsx');

export async function runAudit({
  url, brand = [], maxPages = 300, delay = 250, concurrency = 4,
  gscRows = [], backlinkRows = [], files = [], ga4Rows = [], sourcesExtra = [], checklistFile = DEFAULT_CHECKLIST,
  psi = true, psiKey = '', imageLimit = 120, deadline = Infinity,
  site: cachedSite = null, probes: cachedProbes = null, xlsxOut = null,
  jev = null,   // { key, niche, budget, threshold } → AI classification of referring domains
  log = console.log,
}) {
  const t0 = Date.now();
  // uploaded files (any mix of GSC / Screaming Frog / Semrush / Ahrefs) + legacy single-file inputs
  const imp = classifyFiles(files);
  for (const s of imp.summary) log(`${s.kind === 'unknown' ? '⚠' : '✓'} ${s.name} → ${s.label}${s.kind === 'unknown' ? '' : ` (${s.rows.toLocaleString('vi-VN')} dòng${s.truncated ? ', đã cắt bớt' : ''})`}`);
  const useJev = !!(jev?.key && (imp.backlinks.length || backlinkRows.length));

  let site = cachedSite;
  if (!site) {
    log(`▶ Crawl ${url} (tối đa ${maxPages} URL)…`);
    // leave time after the crawl for checks, probes and (if enabled) the Jev pass
    site = await crawl(url, { maxPages, delay, concurrency, log, deadline: deadline - (useJev ? 150000 : 90000) });
    log(`✓ Crawl xong: ${site.pages.length} URL trong ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  site.brand = brand;
  const gsc = [...normalizeGsc(gscRows), ...imp.gsc];
  const bl = [...(backlinkRows.length ? normBacklinks(backlinkRows, Object.keys(backlinkRows[0])) : []), ...imp.backlinks];
  // backlink rows whose target is another host come from a competitor export: only the link-gap check uses them
  const ownHost = site.host.replace(/^www\./, '');
  const blOwn = bl.filter((r) => { if (!r.target) return true; try { const h = new URL(r.target).host.replace(/^www\./, ''); return h === ownHost || h.endsWith('.' + ownHost); } catch { return true; } });
  const blAudit = await backlinkAudit(bl, site, { sf: imp.sf, jev: useJev ? { ...jev, log, deadline: Math.min(deadline - 60000, Date.now() + 120000) } : null });
  const issues = [
    ...crawlIndex(site), ...duplicates(site), ...pageExperience(site),
    ...siteQuality(site), ...topicality(site), ...spam(site), ...entities(site), ...authorship(site),
    ...links(site).filter((i) => !(bl.length && i.id === 'backlink-manual')), ...backlinks(blOwn, site), ...blAudit,
    ...gscChecks(gsc, site),
    ...sfChecks(imp.sf, site), ...keywordChecks(imp.keywords, site), ...auditImportChecks(imp.audit),
    ...ga4Checks(ga4Rows, site), ...trafficPagesBroken(site, { keywords: imp.keywords, gsc, ga4: ga4Rows, sf: imp.sf }),
  ];
  const sc = score(issues, { hasGsc: gsc.length > 0 || ga4Rows.length > 0, hasKeywords: imp.keywords.length > 0 });

  let checklist = null, probes = cachedProbes, xlsx = null;
  if (checklistFile && fs.existsSync(checklistFile)) {
    if (!probes) {
      log('▶ Thăm dò server (header, 404, user-agent, llms.txt, ảnh' + (psi ? ', PageSpeed Insights' : '') + ')…');
      const cand = site.pages.filter((p) => p.status === 200 && p.words && p.url !== site.start && (!p.canonical || p.canonical === p.url) && !/\/index\.html?$/.test(p.url))
        .sort((a, b) => (b.inlinks?.length || 0) - (a.inlinks?.length || 0)).map((p) => p.url);
      const pick = [cand.find((u) => /blog|tin|bai-viet|insight|news/.test(u)), cand.find((u) => /dich-vu|service|san-pham|product/.test(u)), cand.find((u) => /gioi-thieu|about/.test(u))].filter(Boolean);
      probes = await runProbes(site, { psi, psiKey, samples: [...new Set([...pick, ...cand])].slice(0, 3), log, imageLimit, deadline });
    }
    const rows = await loadChecklist(checklistFile);
    checklist = { file: path.basename(checklistFile), items: evaluateChecklist(rows, site, probes, { issues }), psi: probes.psi };
    const c = checklist.items.reduce((m, r) => ((m[r.status] = (m[r.status] || 0) + 1), m), {});
    log(`✓ Checklist: ${checklist.items.length} hạng mục · ` + Object.entries(c).map(([k, v]) => `${v} ${k}`).join(' · '));
    xlsx = await writeChecklist(checklistFile, checklist.items, xlsxOut, { date: new Date().toLocaleDateString('vi-VN') });
  }

  const perPage = new Map();
  for (const i of issues) for (const u of i.urls) if (/^https?:/.test(u.url)) perPage.set(u.url, (perPage.get(u.url) || 0) + 1);
  const patents = JSON.parse(fs.readFileSync(path.join(here, 'patents.json'), 'utf8'));
  const used = new Set([...issues.flatMap((i) => i.patents), ...(checklist?.items || []).flatMap((r) => r.patents)]);
  const data = {
    meta: { date: new Date().toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' }), patentCount: Object.keys(patents).length, vault: 'Obsidian Vault', version: 1, web: process.env.SSRF_GUARD === '1' },
    site: { url: site.start, host: site.host, crawled: site.pages.length, indexable: site.pages.filter(isIndexable).length, sitemapCount: site.sitemap.count, brand },
    sources: [...sourcesExtra, ...imp.summary],
    ga4: site.ga4Summary || null,
    backlinks: site.backlinkReport || null,
    score: sc, groups: sc.groups, issues,
    patents: Object.fromEntries([...used].filter((id) => patents[id]).map((id) => [id, patents[id]])),
    pages: site.pages.map((p) => ({ url: p.url, title: p.title, status: p.status, depth: p.depth, words: p.words, inl: new Set((p.inlinks || []).map((l) => l.from)).size, pagerank: p.pagerank, ttfb: p.ttfb, n: perPage.get(p.url) || 0 })),
    gsc: gsc.length ? { summary: site.gscSummary, curve: site.ctrCurve, points: site.gscPoints, brand: site.brandShare || null } : null,
    checklist,
  };
  return { html: renderReport(data), xlsx, data, site, probes, score: sc };
}
