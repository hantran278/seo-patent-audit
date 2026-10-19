// Extra server-level probes for the technical checklist: headers, 404, trailing slash, user-agents, llms.txt, images, PageSpeed.
import * as cheerio from 'cheerio';
import { isAllowedUrl } from './guard.mjs';

export const UAS = {
  browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36',
  mobile: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36',
  googlebot: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  GPTBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)',
  ClaudeBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)',
  PerplexityBot: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)',
  'OAI-SearchBot': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot',
  'ChatGPT-User': 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot',
};
// bot-protection / challenge pages (Cloudflare, Akamai, Imperva, DataDome, PerimeterX, generic captcha)
const CHALLENGE = /cf-chl|challenge-platform|<title>just a moment\.\.\.<\/title>|attention required! \| cloudflare|cf-error-details|request unsuccessful\. incapsula|_incapsula_resource|datadome|px-captcha|perimeterx|verify you are human|are you a robot/i;
const pageInfo = (html) => {
  if (!html) return { words: 0, h1: false, main: false };
  const $ = cheerio.load(html);
  const info = { h1: $('h1').length > 0, main: $('main, [role=main]').length > 0 };
  $('script, style, noscript, svg').remove();
  return { words: $('body').text().split(/s+/).filter(Boolean).length, ...info };
};

async function get(url, { ua = UAS.browser, method = 'GET', redirect = 'manual', timeout = 20000 } = {}) {
  // googleapis (PageSpeed) is always allowed; everything else must be a public host
  if (!/^https:\/\/www\.googleapis\.com\//.test(url) && !(await isAllowedUrl(url))) return { status: 0, error: 'blocked', headers: {}, body: '' };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  const t0 = Date.now();
  try {
    const r = await fetch(url, { method, redirect, headers: { 'User-Agent': ua, 'Accept-Encoding': 'br, gzip, deflate' }, signal: ctrl.signal });
    const body = method === 'GET' ? await r.text() : '';
    return { status: r.status, headers: Object.fromEntries(r.headers), body, ms: Date.now() - t0, location: r.headers.get('location') };
  } catch (e) {
    return { status: 0, error: e.message, headers: {}, body: '' };
  } finally {
    clearTimeout(t);
  }
}

const words = (html) => {
  if (!html) return 0;
  const $ = cheerio.load(html);
  $('script, style, noscript, svg').remove();
  return $('body').text().split(/\s+/).filter(Boolean).length;
};

export async function runProbes(site, { psi = true, psiKey = '', samples = [], aiSamples = [], log = console.log, imageLimit = 120, deadline = Infinity } = {}) {
  const P = {};
  const home = site.start;

  // homepage headers & encoding
  const h = await get(home);
  P.homeHeaders = h.headers;
  P.homeStatus = h.status;

  // 404 behaviour
  const rnd = new URL('/khong-ton-tai-' + Math.random().toString(36).slice(2, 10) + '/', home).href;
  const nf = await get(rnd, { redirect: 'follow' });
  const $nf = cheerio.load(nf.body || '');
  P.notFound = { url: rnd, status: nf.status, hasHomeLink: $nf(`a[href="/"], a[href="${site.origin}/"], a[href="${site.origin}"]`).length > 0, words: words(nf.body) };

  // trailing slash: pick a sample non-root URL and request the other variant
  const sample = site.pages.find((p) => p.status === 200 && new URL(p.url).pathname.length > 1 && !/\.\w{2,4}$/.test(new URL(p.url).pathname));
  if (sample) {
    const u = new URL(sample.url);
    u.pathname = u.pathname.endsWith('/') ? u.pathname.slice(0, -1) : u.pathname + '/';
    const r = await get(u.href);
    P.trailing = { tested: u.href, canonical: sample.url, status: r.status, location: r.location };
  }

  // user-agent comparison: homepage + key pages, each fetched as a browser, Googlebot and the AI crawlers
  const urls = [home, ...samples.filter((x) => x !== home)].slice(0, 4);
  const uaUrls = [...new Set([home, ...samples, ...aiSamples])].slice(0, 16);
  P.ua = {};
  await Promise.all(Object.entries(UAS).map(async ([name, ua]) => {
    P.ua[name] = new Array(uaUrls.length);
    for (let i = 0; i < uaUrls.length; i += 4) {
      if (Date.now() > deadline - 60000) break;
      await Promise.all(uaUrls.slice(i, i + 4).map(async (url, j) => {
        const r = await get(url, { ua, redirect: 'follow', timeout: 12000 });
        P.ua[name][i + j] = { url, status: r.status, bytes: r.body.length, ms: r.ms ?? null, challenge: CHALLENGE.test(r.body.slice(0, 20000)) && pageInfo(r.body).words < 300, ...pageInfo(r.body) };
      }));
    }
    P.ua[name] = P.ua[name].filter(Boolean);
  }));

  // publicly reachable staging/dev hosts
  const bare = new URL(home).host.replace(/^www\./, '');
  const st = await Promise.all(['staging', 'stg', 'dev', 'test', 'beta', 'demo'].map(async (sub) => {
    const r = await get(`https://${sub}.${bare}/`, { redirect: 'follow', timeout: 6000 });
    return r.status ? { host: `${sub}.${bare}`, status: r.status, noindex: /noindex/i.test(r.headers['x-robots-tag'] || '') || /<meta[^>]+robots[^>]+noindex/i.test(r.body), auth: r.status === 401 || r.status === 403 } : null;
  }));
  P.staging = st.filter(Boolean);

  // llms.txt
  const l = await get(new URL('/llms.txt', home).href, { redirect: 'follow' });
  P.llms = { status: l.status, type: l.headers['content-type'] || '', size: l.body.length, markdown: /^#\s/m.test(l.body) };
  const lf = await get(new URL('/llms-full.txt', home).href, { redirect: 'follow' });
  P.llmsFull = { status: lf.status, size: lf.body.length };

  // image weight sample (HEAD)
  const imgs = [...new Set(site.pages.filter((p) => p.images).flatMap((p) => p.images.map((i) => i.src)))].filter((s) => /^https?:/.test(s)).slice(0, imageLimit);
  P.images = [];
  for (let i = 0; i < imgs.length; i += 8) {
    const batch = await Promise.all(imgs.slice(i, i + 8).map(async (src) => {
      const r = await get(src, { method: 'HEAD', redirect: 'follow', timeout: 10000 });
      return { src, status: r.status, bytes: Number(r.headers['content-length']) || null, type: r.headers['content-type'] || '' };
    }));
    P.images.push(...batch);
  }

  // PageSpeed Insights (field + lab)
  P.psi = [];
  if (psi) {
    for (const url of urls) {
      if (Date.now() > deadline - 45000) { P.psi.push({ url, error: 'bỏ qua do hết thời gian' }); continue; }
      log(`  PageSpeed Insights (mobile): ${url}`);
      const api = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&category=best-practices${psiKey ? '&key=' + psiKey : ''}`;
      const r = await get(api, { redirect: 'follow', timeout: Math.max(15000, Math.min(90000, deadline - Date.now() - 20000)) });
      if (r.status !== 200) {
        P.psi.push({ url, error: r.status || r.error });
        if (r.status === 429 || r.status === 403) { log('  ⚠ PageSpeed API hết quota/không có quyền — cần API key (--psi-key hoặc biến môi trường PSI_KEY).'); break; }
        continue;
      }
      try {
        const j = JSON.parse(r.body);
        const m = j.loadingExperience?.metrics || {};
        const om = j.originLoadingExperience?.metrics || {};
        const f = (k) => m[k]?.percentile ?? null;
        const a = j.lighthouseResult?.audits || {};
        P.psi.push({
          url,
          field: { lcp: f('LARGEST_CONTENTFUL_PAINT_MS'), inp: f('INTERACTION_TO_NEXT_PAINT'), cls: m.CUMULATIVE_LAYOUT_SHIFT_SCORE ? m.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null, ttfb: f('EXPERIMENTAL_TIME_TO_FIRST_BYTE'), source: Object.keys(m).length ? 'url' : Object.keys(om).length ? 'origin' : null },
          origin: { lcp: om.LARGEST_CONTENTFUL_PAINT_MS?.percentile ?? null, inp: om.INTERACTION_TO_NEXT_PAINT?.percentile ?? null, cls: om.CUMULATIVE_LAYOUT_SHIFT_SCORE ? om.CUMULATIVE_LAYOUT_SHIFT_SCORE.percentile / 100 : null },
          lab: { perf: Math.round((j.lighthouseResult?.categories?.performance?.score ?? 0) * 100), bp: Math.round((j.lighthouseResult?.categories?.['best-practices']?.score ?? 0) * 100), lcp: a['largest-contentful-paint']?.numericValue ?? null, cls: a['cumulative-layout-shift']?.numericValue ?? null, tbt: a['total-blocking-time']?.numericValue ?? null },
          fails: Object.fromEntries(['unminified-css', 'unminified-javascript', 'render-blocking-resources', 'font-display', 'third-party-summary', 'uses-text-compression', 'uses-http2', 'modern-image-formats', 'unsized-images', 'lcp-lazy-loaded', 'offscreen-images'].map((k) => [k, a[k] ? { score: a[k].score, title: a[k].title, value: a[k].displayValue || '' } : null])),
        });
      } catch (e) {
        P.psi.push({ url, error: 'parse ' + e.message });
      }
    }
  }
  return P;
}
