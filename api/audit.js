// Streaming audit endpoint: NDJSON lines {type:'log'|'batch'|'done'|'error'}.
//  - normal audit: one call crawls (≤ 500 URL) and analyses
//  - full-site mode: {mode:'batch'} calls crawl in batches (state kept in private Vercel Blob, see lib/jobs.mjs),
//    then a final call with {jobId} analyses everything that was crawled
import { gunzipSync, gzipSync } from 'node:zlib';
import { currentUser } from '../lib/auth.mjs';
import { runAudit } from '../lib/run.mjs';
import { parseCsvText } from '../lib/csv.mjs';
import { isAllowedUrl } from '../lib/guard.mjs';
import { connection, fetchGsc, fetchGa4 } from '../lib/google.mjs';
import { initCrawl, crawlStep, finishCrawl } from '../lib/crawler.mjs';
import { jobsAvailable, newJobId, saveJob, loadJob, deleteJob, cleanupJobs } from '../lib/jobs.mjs';

export const config = { maxDuration: 300 };
process.env.SSRF_GUARD = '1';
const MAX_FULL_SITE = 5000;

export default async function handler(req, res) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Chưa đăng nhập.' });
  if (req.method !== 'POST') return res.status(405).end();

  const { url = '', brand = '', maxPages = 100, psi = true, gscCsv = '', backlinksCsv = '', filesGz = '', mode = '', jobId = '' } = req.body || {};
  let files = req.body?.files || [];
  if (filesGz) {   // uploaded CSVs arrive gzipped + base64 to stay under Vercel's 4.5 MB body limit
    try { files = JSON.parse(gunzipSync(Buffer.from(filesGz, 'base64'), { maxOutputLength: 200 * 1024 * 1024 }).toString('utf8')); }
    catch { return res.status(400).json({ error: 'Không giải nén được dữ liệu file tải lên.' }); }
  }
  if ((mode === 'batch' || jobId) && !jobsAvailable()) return res.status(503).json({ error: 'Chế độ crawl nhiều đợt chưa được cấu hình (thiếu Vercel Blob).' });
  let start;
  try { start = new URL(/^https?:\/\//.test(url) ? url : 'https://' + url).href; } catch { return res.status(400).json({ error: 'URL không hợp lệ.' }); }
  if (!(await isAllowedUrl(start))) return res.status(400).json({ error: 'Chỉ audit được website công khai (http/https).' });

  res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'X-Accel-Buffering': 'no' });
  const send = (o) => res.write(JSON.stringify(o) + '\n');
  const log = (m) => send({ type: 'log', message: m });
  const deadline = Date.now() + 270 * 1000;
  console.log(`[audit] ${user} → ${start}${mode ? ' (' + mode + ')' : ''}${jobId ? ' job ' + jobId.slice(0, 8) : ''}`);
  try {
    // ── full-site mode: one crawl batch per call ──
    if (mode === 'batch') {
      let job, id = jobId;
      if (id) {
        job = await loadJob(id);
        if (!job || job.owner !== user) throw new Error('Không tìm thấy đợt crawl (có thể đã hết hạn sau 24 giờ). Hãy chạy lại.');
      } else {
        cleanupJobs();
        id = newJobId();
        job = { owner: user, url: start, maxPages: Math.min(Math.max(Number(maxPages) || 1000, 100), MAX_FULL_SITE), batches: 0, created: Date.now(), state: await initCrawl(start, { log, sitemapLimit: 20000 }) };
      }
      job.batches++;
      log(`▶ Đợt ${job.batches}: crawl tiếp từ ${job.state.pages.length} URL (mục tiêu tối đa ${job.maxPages})…`);
      const step = await crawlStep(job.state, { maxPages: job.maxPages, concurrency: 8, delay: 100, log, deadline: Date.now() + (Number(process.env.BATCH_SECONDS) || 215) * 1000 });   // BATCH_SECONDS: shorter batches for local tests
      const size = await saveJob(id, job);
      log(`✓ Đợt ${job.batches}: ${step.crawled} URL · còn ${step.queued} URL trong hàng đợi · lưu ${Math.round(size / 1024)} KB`);
      send({ type: 'batch', jobId: id, batch: job.batches, crawled: step.crawled, queued: step.queued, done: step.done, maxPages: job.maxPages });
      return res.end();
    }

    // ── analysis (normal audit, or the final step of a full-site job) ──
    let cachedSite = null;
    if (jobId) {
      const job = await loadJob(jobId);
      if (!job || job.owner !== user) throw new Error('Không tìm thấy dữ liệu crawl của đợt này (có thể đã hết hạn). Hãy chạy lại.');
      cachedSite = finishCrawl(job.state);
      log(`✓ Đã gộp ${job.batches} đợt crawl: ${cachedSite.pages.length} URL`);
    }
    // live Google data for the member's own connected account (fetched in parallel, failures don't stop the audit)
    const { gscSite = '', ga4Property = '' } = req.body || {};
    const google = (gscSite || ga4Property) ? connection(req) : null;
    if ((gscSite || ga4Property) && !google) log('⚠ Chưa kết nối Google: bỏ qua dữ liệu Search Console / GA4.');
    const [gscLive, ga4Live] = google ? await Promise.all([
      gscSite ? fetchGsc(google, gscSite, { log }).catch((e) => (log('⚠ Search Console: ' + e.message), [])) : [],
      ga4Property ? fetchGa4(google, ga4Property, { log }).catch((e) => (log('⚠ GA4: ' + e.message), [])) : [],
    ]) : [[], []];
    const sourcesExtra = [
      ...(gscLive.length ? [{ name: gscSite, kind: 'gsc', label: 'Search Console (API, 90 ngày)', rows: gscLive.length }] : []),
      ...(ga4Live.length ? [{ name: ga4Property, kind: 'ga4', label: 'GA4 organic (API, 90 ngày)', rows: ga4Live.length }] : []),
    ];
    const r = await runAudit({
      url: start, site: cachedSite,
      brand: String(brand).split(',').map((s) => s.trim()).filter(Boolean),
      maxPages: Math.min(Math.max(Number(maxPages) || 100, 10), 500),
      delay: 100, concurrency: Number(maxPages) > 250 ? 8 : 6, imageLimit: 40, deadline,
      gscRows: gscLive.length ? gscLive : gscCsv ? parseCsvText(gscCsv) : [],
      ga4Rows: ga4Live, sourcesExtra,
      // Jev: the member's own key (sent from their browser) or the team key on the server
      jev: (() => {
        const j = req.body?.jev || {};
        const key = String(j.key || process.env.JEV_API_KEY || '').trim();
        return key ? { key, niche: String(j.niche || '').slice(0, 200), budget: Math.min(Math.max(Number(j.budget) || 1, 0.01), 20), threshold: Math.min(Math.max(Number(j.threshold) || 0.8, 0.5), 0.99) } : null;
      })(),
      backlinkRows: backlinksCsv ? parseCsvText(backlinksCsv) : [],
      files: Array.isArray(files) ? files.slice(0, 20) : [],
      psi: !!psi && !!process.env.PSI_KEY, psiKey: process.env.PSI_KEY || '',
      log,
    });
    if (jobId) await deleteJob(jobId);
    // reports of big sites are large: ship the HTML gzipped (the page inflates it with DecompressionStream)
    send({ type: 'done', host: r.site.host, score: r.score.overall, htmlGz: gzipSync(Buffer.from(r.html)).toString('base64'), xlsx: r.xlsx ? r.xlsx.toString('base64') : null, decisionsXlsx: r.decisionsXlsx ? r.decisionsXlsx.toString('base64') : null });
  } catch (e) {
    send({ type: 'error', message: e.message });
  }
  res.end();
}
