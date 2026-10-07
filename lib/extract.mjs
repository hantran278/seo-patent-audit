// Per-page extraction: meta, headings, main content, links (with position), schema, hidden text.
import * as cheerio from 'cheerio';
import { normalizeUrl } from './util.mjs';

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
const BOILER = 'header, nav, footer, aside, [role=navigation], [role=banner], [role=contentinfo], .sidebar, #sidebar, .menu, .breadcrumb, .breadcrumbs, .footer, .header, .comments, #comments, .related, .share, .social';

function mainRoot($) {
  for (const sel of ['main', '[role=main]', 'article', '#content', '.content', '.post', '.entry-content']) {
    const el = $(sel).first();
    if (el.length && clean(el.text()).length > 200) return el;
  }
  return $('body');
}

function flattenSchema(node, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { node.forEach((n) => flattenSchema(n, out)); return out; }
  if (node['@type']) out.push(node);
  if (node['@graph']) flattenSchema(node['@graph'], out);
  for (const v of Object.values(node)) if (v && typeof v === 'object') flattenSchema(v, out);
  return out;
}

export function extract(html, url) {
  const $ = cheerio.load(html);
  const lang = $('html').attr('lang') || '';
  const title = clean($('title').first().text());
  const metaDesc = clean($('meta[name="description"]').attr('content'));
  const robotsMeta = ($('meta[name="robots"]').attr('content') || '') + ' ' + ($('meta[name="googlebot"]').attr('content') || '');
  const canonicalRaw = $('link[rel="canonical"]').attr('href');
  const canonical = canonicalRaw ? normalizeUrl(canonicalRaw, url) : null;
  const canonicalCount = $('link[rel="canonical"]').length;
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  const hreflang = $('link[rel="alternate"][hreflang]').map((_, e) => ({ lang: $(e).attr('hreflang'), href: normalizeUrl($(e).attr('href'), url) })).get();

  // schema.org JSON-LD
  const schema = [];
  let schemaErrors = 0;
  $('script[type="application/ld+json"]').each((_, e) => {
    try { flattenSchema(JSON.parse($(e).contents().text()), schema); } catch { schemaErrors++; }
  });
  const schemaTypes = [...new Set(schema.flatMap((s) => [].concat(s['@type'])))];

  // hidden text (inline styles only — rendered CSS is out of scope for a static crawler)
  const hidden = [];
  $('[style]').each((_, e) => {
    const st = ($(e).attr('style') || '').toLowerCase().replace(/\s/g, '');
    if (/display:none|visibility:hidden|font-size:0|text-indent:-\d{3,}|left:-\d{4,}/.test(st)) {
      const t = clean($(e).text());
      if (t.length > 40) hidden.push(t.slice(0, 120));
    }
  });

  // mixed content
  const mixed = url.startsWith('https:') ? $('img[src^="http:"], script[src^="http:"], link[href^="http:"][rel="stylesheet"], iframe[src^="http:"]').length : 0;
  const imgs = $('img');
  const imgNoAlt = imgs.filter((_, e) => !$(e).attr('alt')).length;

  // links (mark which ones are inside the main content)
  const root = mainRoot($);
  const mainSet = new Set();
  root.find('a[href]').not(root.find(BOILER).find('a')).each((_, e) => mainSet.add(e));
  const links = [];
  $('a[href]').each((_, e) => {
    const href = normalizeUrl($(e).attr('href'), url);
    if (!href) return;
    const rel = ($(e).attr('rel') || '').toLowerCase();
    links.push({ href, text: clean($(e).text()) || clean($(e).find('img').attr('alt')) || '', nofollow: /nofollow|sponsored|ugc/.test(rel), main: mainSet.has(e) });
  });

  // main text
  const main = root.clone();
  main.find('script, style, noscript, svg, form, ' + BOILER).remove();
  const paragraphs = main.find('p, li').map((_, e) => clean($(e).text())).get().filter((t) => t.length >= 40);
  const mainText = clean(main.text());
  const words = mainText ? mainText.split(/\s+/).length : 0;

  const headings = $('h1, h2, h3, h4, h5, h6').map((_, e) => ({ level: Number(e.tagName[1]), text: clean($(e).text()) })).get();
  const fakeList = main.find('p').filter((_, e) => /(^|<br\s*\/?>)\s*([-•*+]|\d+[.)])\s/.test($(e).html() || '')).length;

  // authorship & dates
  const authorSchema = schema.some((s) => s.author);
  const byline = $('[rel="author"], .author, .byline, [itemprop="author"], .post-author').length > 0;
  const datePublished = schema.find((s) => s.datePublished)?.datePublished || $('meta[property="article:published_time"]').attr('content') || null;
  const dateModified = schema.find((s) => s.dateModified)?.dateModified || $('meta[property="article:modified_time"]').attr('content') || null;

  const org = schema.find((s) => [].concat(s['@type']).some((t) => /Organization|LocalBusiness|Corporation|Store|Restaurant|Hotel|MedicalBusiness|ProfessionalService/.test(t)));

  // ---- extra signals for the technical checklist ----
  const meta = (sel) => $(sel).attr('content') || '';
  const og = { title: meta('meta[property="og:title"]'), description: meta('meta[property="og:description"]'), image: meta('meta[property="og:image"]'), twitter: meta('meta[name="twitter:card"]') };
  const favicon = $('link[rel~="icon"]').length > 0;
  const appleIcon = $('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]').length > 0;
  const mainImgs = new Set(root.find('img').get());
  const images = $('img').map((i, e) => {
    const $e = $(e);
    const src = normalizeUrl($e.attr('src') || $e.attr('data-src') || '', url);
    return { src, alt: $e.attr('alt'), hasAlt: $e.attr('alt') !== undefined, w: !!$e.attr('width'), h: !!$e.attr('height'), lazy: ($e.attr('loading') || '').toLowerCase() === 'lazy' || !!$e.attr('data-src'), inMain: mainImgs.has(e), idx: i };
  }).get().filter((x) => x.src);
  const iframes = $('iframe').map((_, e) => ({ lazy: ($(e).attr('loading') || '') === 'lazy' || !!$(e).attr('data-src') })).get();
  const videos = $('video').map((_, e) => ({ poster: !!$(e).attr('poster'), autoplay: $(e).attr('autoplay') !== undefined })).get();
  const headingsInChrome = $('header, footer, aside, nav').find('h1, h2, h3, h4, h5, h6').map((_, e) => e.tagName.toUpperCase() + ': ' + clean($(e).text()).slice(0, 50)).get();
  const breadcrumbUi = $('[class*="breadcrumb"], [id*="breadcrumb"], nav[aria-label*="readcrumb"], [itemtype*="BreadcrumbList"]').length > 0;
  const navLinks = $('header a[href], nav a[href]').map((_, e) => normalizeUrl($(e).attr('href'), url)).get().filter(Boolean);
  const landmarks = Object.fromEntries(['main', 'article', 'nav', 'header', 'footer', 'section'].map((t) => [t, $(t).length]));
  const jsLinks = $('a:not([href]), a[href^="javascript:"], a[href="#"]').length + $('[onclick*="location"]').not('a[href]').length;
  const hashRoutes = $('a[href^="#/"], a[href^="#!"], a[href*="/#/"]').length;
  const scripts = $('script').map((_, e) => ($(e).attr('src') || '') + ' ' + $(e).html()).get().join('\n');
  const gaIds = [...new Set(scripts.match(/G-[A-Z0-9]{6,12}/g) || [])];
  const gtmIds = [...new Set((scripts + html).match(/GTM-[A-Z0-9]{4,9}/g) || [])];
  const gtmLoads = (html.match(/googletagmanager\.com\/gtm\.js/g) || []).length;
  const gtagLoads = (html.match(/googletagmanager\.com\/gtag\/js/g) || []).length;
  const consent = /gtag\(\s*['"]consent['"]\s*,\s*['"]default['"]|cookieyes|cookiebot|onetrust|complianz|cookie-law-info|iubenda|usercentrics/i.test(html);
  const siteVerification = $('meta[name="google-site-verification"]').length > 0;
  const scriptCount = $('script[src]').length;
  const schemaCount = schema.reduce((m, s) => { for (const t of [].concat(s['@type'])) m[t] = (m[t] || 0) + 1; return m; }, {});
  const pick = (re) => schema.find((s) => [].concat(s['@type']).some((t) => re.test(t)));
  const art = pick(/^(Article|BlogPosting|NewsArticle|TechArticle)$/);
  const person = pick(/^Person$/);
  const faq = pick(/^FAQPage$/);
  const bc = pick(/^BreadcrumbList$/);
  const schemaInfo = {
    article: art ? { headline: !!art.headline, author: !!art.author, datePublished: !!art.datePublished, dateModified: !!art.dateModified, image: !!art.image } : null,
    person: person ? { name: !!person.name, sameAs: [].concat(person.sameAs || []).length, jobTitle: !!person.jobTitle, worksFor: !!person.worksFor } : null,
    faqQuestions: faq ? [].concat(faq.mainEntity || []).map((q) => clean(q.name || '')).filter(Boolean) : [],
    breadcrumbLast: bc ? (() => { const items = [].concat(bc.itemListElement || []); const last = items[items.length - 1]; const it = last?.item; return normalizeUrl(typeof it === 'string' ? it : it?.['@id'] || it?.url || '', url); })() : null,
    orgFull: org ? { url: !!org.url, contactPoint: !!org.contactPoint, areaServed: !!org.areaServed, priceRange: !!org.priceRange, sameAsList: [].concat(org.sameAs || []), description: clean(org.description || '') } : null,
    websiteDesc: clean(pick(/^WebSite$/)?.description || ''),
    navElement: !!pick(/SiteNavigationElement/),
  };
  const questionHeadings = headings.filter((h) => h.level >= 2 && h.level <= 3 && (/\?$/.test(h.text) || /^(là gì|tại sao|vì sao|như thế nào|làm sao|có nên|bao nhiêu|khi nào|ở đâu|what|why|how|when|which|who)\b/i.test(h.text) || /(là gì|như thế nào|bao nhiêu)\??$/i.test(h.text))).length;
  const viRatio = (() => { const w = mainText.split(/\s+/).slice(0, 1500); if (w.length < 80) return null; const vi = w.filter((x) => /[àáảãạăằắẳẵặâầấẩẫậđèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵ]/i.test(x)).length; return vi / w.length; })();

  return {
    lang, title, metaDesc, robotsMeta: robotsMeta.trim().toLowerCase(), canonical, canonicalCount, viewport, hreflang,
    schemaTypes, schemaErrors, org: org ? { name: org.name || null, logo: !!org.logo, sameAs: [].concat(org.sameAs || []).length, address: !!org.address, telephone: !!org.telephone } : null,
    hidden, mixed, imgCount: imgs.length, imgNoAlt,
    links, headings, h1: headings.filter((h) => h.level === 1).map((h) => h.text),
    words, paragraphs, mainText: mainText.slice(0, 20000), fakeList,
    authorSchema, byline, datePublished, dateModified,
    og, favicon, appleIcon, images, iframes, videos, headingsInChrome, breadcrumbUi, navLinks, landmarks, jsLinks, hashRoutes,
    gaIds, gtmIds, gtmLoads, gtagLoads, consent, siteVerification, scriptCount, schemaCount, schemaInfo, questionHeadings, viRatio,
  };
}
