// Polite same-host crawler: robots.txt, sitemap discovery, manual redirects, timing.
import { extract } from './extract.mjs';
import { normalizeUrl } from './util.mjs';
import { isAllowedUrl } from './guard.mjs';

const UA = 'Mozilla/5.0 (compatible; SeoPatentAudit/1.0; +local audit tool)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function timedFetch(url, { method = 'GET' } = {}) {
  if (!(await isAllowedUrl(url))) return { status: 0, error: 'blocked (non-public host)', ttfb: 0 };
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(url, { method, redirect: 'manual', headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }, signal: ctrl.signal });
    const ttfb = Date.now() - t0;
    const type = r.headers.get('content-type') || '';
    const body = method === 'GET' && (type.includes('html') || type.includes('xml') || type.includes('text')) ? await r.text() : '';
    return { status: r.status, location: r.headers.get('location'), type, body, ttfb, total: Date.now() - t0, xRobots: r.headers.get('x-robots-tag') || '' };
  } catch (e) {
    return { status: 0, error: e.name === 'AbortError' ? 'timeout' : e.message, ttfb: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

// Follow redirects manually so chains are recorded.
export async function fetchWithChain(url, maxHops = 10) {
  const chain = [];
  let cur = url;
  for (let i = 0; i < maxHops; i++) {
    const r = await timedFetch(cur);
    if (r.status >= 300 && r.status < 400 && r.location) {
      chain.push({ url: cur, status: r.status });
      cur = normalizeUrl(r.location, cur);
      if (!cur) break;
      continue;
    }
    return { ...r, url: cur, chain };
  }
  return { status: 0, error: 'redirect loop / too many hops', url: cur, chain };
}

function parseRobots(txt) {
  const rules = [];
  const sitemaps = [];
  let applies = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [, k, v] = m;
    const key = k.toLowerCase();
    if (key === 'user-agent') applies = v === '*';
    else if (key === 'sitemap') sitemaps.push(v.trim());
    else if (applies && (key === 'disallow' || key === 'allow') && v) rules.push({ allow: key === 'allow', path: v.trim() });
  }
  return { rules, sitemaps };
}

function robotsAllowed(rules, url) {
  const { pathname, search } = new URL(url);
  const p = pathname + search;
  let best = null;
  for (const r of rules) {
    const re = new RegExp('^' + r.path.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
    if (re.test(p) && (!best || r.path.length > best.path.length)) best = r;
  }
  return !best || best.allow;
}

async function readSitemaps(urls, limit = 5000) {
  const out = new Map(); // url -> lastmod
  const queue = [...urls];
  const seen = new Set();
  const errors = [];
  const media = { images: 0, videos: 0 }; // <image:image> / <video:video> entries (image & video sitemaps)
  while (queue.length && out.size < limit && seen.size < 50) {
    const sm = queue.shift();
    if (seen.has(sm)) continue;
    seen.add(sm);
    const r = await timedFetch(sm);
    if (r.status !== 200) { errors.push({ sitemap: sm, status: r.status || r.error }); continue; }
    for (const m of r.body.matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<]+?)\s*<\/loc>/g)) queue.push(m[1].replace(/&amp;/g, '&'));
    media.images += (r.body.match(/<image:image[\s>]/g) || []).length;
    media.videos += (r.body.match(/<video:video[\s>]/g) || []).length;
    for (const m of r.body.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
      const loc = m[1].match(/<loc>\s*([^<]+?)\s*<\/loc>/)?.[1]?.replace(/&amp;/g, '&');
      const lastmod = m[1].match(/<lastmod>\s*([^<]+?)\s*<\/lastmod>/)?.[1] || null;
      if (loc) out.set(loc, lastmod);
    }
  }
  return { urls: out, files: [...seen], errors, media };
}

// ── Resumable crawl: initCrawl → crawlStep (one or many times, e.g. one per serverless call) → finishCrawl ──
// The state is plain JSON (no Maps/Sets) so it can be stored between calls.
const sameSiteOf = (host) => (u) => { try { return new URL(u).host.replace(/^www\./, '') === host; } catch { return false; } };

export async function initCrawl(startUrl, { log = console.log, sitemapLimit = 5000 } = {}) {
  const start = normalizeUrl(startUrl);
  const origin = new URL(start).origin;
  const host = new URL(start).host.replace(/^www\./, '');

  // robots + sitemaps
  const robotsRes = await timedFetch(origin + '/robots.txt');
  const robots = robotsRes.status === 200 ? parseRobots(robotsRes.body) : { rules: [], sitemaps: [] };
  const smCandidates = robots.sitemaps.length ? robots.sitemaps : [origin + '/sitemap.xml', origin + '/sitemap_index.xml'];
  log(`robots.txt: ${robotsRes.status} · sitemap: ${smCandidates.join(', ')}`);
  const sitemap = await readSitemaps(smCandidates, sitemapLimit);
  log(`sitemap URLs: ${sitemap.urls.size}`);

  // host variants (http/https, www/non-www) → where do they end up?
  const variants = [];
  for (const proto of ['http:', 'https:']) for (const h of [host, 'www.' + host]) {
    const v = `${proto}//${h}/`;
    const r = await fetchWithChain(v, 5);
    variants.push({ from: v, to: r.url, status: r.status, hops: r.chain.length, error: r.error });
  }
  return {
    v: 1, start, origin, host, variants,
    robots: { status: robotsRes.status, raw: robotsRes.status === 200 ? robotsRes.body.slice(0, 20000) : '', ...robots },
    sitemap: { files: sitemap.files, errors: sitemap.errors, media: sitemap.media, entries: [...sitemap.urls.entries()] },
    pages: [], queue: [{ url: start, depth: 0, from: null }], queued: [start], orphanPhase: false, orphanCount: 0, timedOut: false,
  };
}

// Crawl until maxPages pages exist in total, the queue is exhausted, or the deadline passes. Returns { done }.
export async function crawlStep(state, { maxPages = 300, concurrency = 4, delay = 250, log = console.log, deadline = Infinity } = {}) {
  const sameSite = sameSiteOf(state.host);
  const sitemap = new Map(state.sitemap.entries);
  const pages = new Map(state.pages.map((p) => [p.url, p]));
  const queued = new Set(state.queued);
  const queue = state.queue;
  let inFlight = 0;
  state.timedOut = false;

  async function worker() {
    while (pages.size + inFlight < maxPages) {
      if (Date.now() >= deadline) { state.timedOut = true; break; }
      // queue momentarily empty while other workers are still fetching pages that may add links: wait, don't quit
      if (!queue.length) { if (!inFlight) break; await sleep(50); continue; }
      const item = queue.shift();
      if (!item || pages.has(item.url)) continue;
      inFlight++;
      try { await crawlOne(item); } catch (e) { pages.set(item.url, { url: item.url, depth: item.depth, status: 0, error: e.message }); } finally { inFlight--; }
      await sleep(delay);
    }
  }
  async function crawlOne(item) {
    if (!robotsAllowed(state.robots.rules, item.url)) {
      pages.set(item.url, { url: item.url, depth: item.depth, blockedByRobots: true, status: null });
      return;
    }
    const r = await fetchWithChain(item.url);
    const page = { url: item.url, finalUrl: r.url, depth: item.depth, status: r.status, error: r.error, chain: r.chain, ttfb: r.ttfb, bytes: r.body ? Buffer.byteLength(r.body) : 0, type: r.type, xRobots: r.xRobots, inSitemap: sitemap.has(item.url), lastmod: sitemap.get(item.url) || null };
    if (r.status === 200 && (r.type || '').includes('html')) {
      Object.assign(page, extract(r.body, r.url));
      for (const l of page.links) {
        if (!sameSite(l.href) || l.nofollow || queued.has(l.href) || queued.size >= maxPages * 3) continue;
        queued.add(l.href);
        queue.push({ url: l.href, depth: item.depth + 1, from: item.url });
      }
    }
    pages.set(item.url, page);
    if (pages.size % 25 === 0) log(`  crawled ${pages.size} pages…`);
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  // link-discovered URLs exhausted: queue sitemap URLs no internal link pointed to (orphans) so they get checked too
  if (!queue.length && !state.orphanPhase && pages.size < maxPages && !state.timedOut) {
    const orphans = [...sitemap.keys()].filter((x) => !queued.has(x) && sameSite(x));
    state.orphanPhase = true;
    state.orphanCount = orphans.length;
    for (const url of orphans.slice(0, Math.max(0, maxPages - pages.size))) { queue.push({ url, depth: null, from: null }); queued.add(url); }
    if (queue.length) await Promise.all(Array.from({ length: concurrency }, worker));
  }
  state.pages = [...pages.values()];
  state.queued = [...queued];
  const done = pages.size >= maxPages || (!queue.length && state.orphanPhase);
  return { done, crawled: pages.size, queued: queue.length };
}

// Build the site object the checks expect (inlinks are derived from every page's links here).
export function finishCrawl(state) {
  const inlinks = new Map();
  const sameSite = sameSiteOf(state.host);
  for (const p of state.pages) for (const l of p.links || []) {
    if (!sameSite(l.href)) continue;
    const arr = inlinks.get(l.href) || [];
    arr.push({ from: p.url, anchor: l.text, main: l.main, nofollow: l.nofollow });
    inlinks.set(l.href, arr);
  }
  for (const p of state.pages) p.inlinks = inlinks.get(p.url) || [];
  const smUrls = state.sitemap.entries.map(([u]) => u);
  return { start: state.start, origin: state.origin, host: state.host, robots: state.robots, sitemap: { files: state.sitemap.files, errors: state.sitemap.errors, media: state.sitemap.media || null, count: smUrls.length, urls: smUrls }, variants: state.variants, pages: state.pages, orphanCount: state.orphanCount };
}

// Single-call crawl (CLI, MCP, normal web audit).
export async function crawl(startUrl, { maxPages = 300, concurrency = 4, delay = 250, log = console.log, deadline = Infinity } = {}) {
  const state = await initCrawl(startUrl, { log });
  await crawlStep(state, { maxPages, concurrency, delay, log, deadline });
  if (state.timedOut) log(`⚠ Hết thời gian crawl: dừng ở ${state.pages.length}/${maxPages} URL (site phản hồi chậm). Báo cáo dựa trên số URL đã quét; site lớn nên dùng chế độ "Toàn bộ site" hoặc kèm file Screaming Frog.`);
  return finishCrawl(state);
}