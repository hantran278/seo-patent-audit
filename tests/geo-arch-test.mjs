// Day-0 foundations: rendering, semantic HTML, entity architecture, AI crawler access (no network).
import assert from 'node:assert/strict';
import { extract } from '../lib/extract.mjs';
import { architectureChecks, geoProbeChecks } from '../checks/geo.mjs';
import { aiRobotsMatrix, parseGroups, allowedFor } from '../lib/robots-ai.mjs';

const HOST = 'ex.com';
const words = (n) => Array.from({ length: n }, () => 'nội dung').join(' ');
const page = (path, html, extra = {}) => { const url = `https://${HOST}${path}`; return { url, finalUrl: url, status: 200, type: 'text/html', depth: 1, ...extract(html, url), ...extra }; };
const semantic = (body, lang = 'en') => `<!DOCTYPE html><html lang="${lang}"><head><meta charset="utf-8"><title>T</title></head><body><header><nav><a href="/about-us/">About</a><a href="/svc/">Services</a></nav></header><main><h1>Title here</h1><p>${body}</p></main><footer>f</footer></body></html>`;

// ── rendering ──
const csr = page('/app/', '<!DOCTYPE html><html><head><title>App</title></head><body><div id="root"></div><script src="/a.js"></script><script src="/b.js"></script><script src="/c.js"></script></body></html>');
assert.equal(csr.appShell, true); assert.ok(csr.bodyWords < 60);
const jsnav = page('/jsnav/', semantic(words(200)).replace('<main>', '<main><a onclick="location.href=\x27/x\x27">a</a><div data-href="/y">b</div><a class="view-toggle">Read more</a><a href="#" aria-label="LinkedIn"><i class="icon-linkedin"></i></a>'));
// ── semantic ──
const divsoup = page('/div/', `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>T</title></head><body><div class="header"><h3>Menu title</h3><h4>Hotline</h4></div><div class="content"><h1>Div page</h1><p>${words(200)}</p></div><div class="footer">f</div></body></html>`);
const home = page('/', semantic(words(300)));
const about = page('/about-us/', semantic(words(100)));
const site = { host: HOST, start: `https://${HOST}/`, origin: `https://${HOST}`, pages: [home, about, csr, jsnav, divsoup], sitemap: { count: 5 } };

const issues = architectureChecks(site);
const by = Object.fromEntries(issues.map((i) => [i.id, i]));
const urls = (id) => (by[id]?.urls || []).map((u) => u.url);

assert.deepEqual(urls('raw-html-empty'), [csr.url]);
assert.equal(by['raw-html-empty'].severity, 'high', '1 of 5 pages = 20% of the site');
assert.deepEqual(urls('js-only-links'), [jsnav.url]);
assert.equal(jsnav.jsNavLinks, 2, 'a "Read more" toggle is UI, not navigation');
assert.deepEqual(urls('placeholder-social-links'), [jsnav.url]);
assert.equal(by['placeholder-social-links'].urls[0].note, 'linkedin');
assert.deepEqual(urls('no-main-landmark'), [divsoup.url]);
assert.ok(urls('no-nav-footer-landmark').length === 0 || !urls('no-nav-footer-landmark').includes(home.url));
assert.deepEqual(urls('headings-in-chrome'), [divsoup.url]);
// About exists and is linked from the homepage nav, but is thin and the site has no Organization schema
assert.equal(by['about-page-missing'], undefined);
assert.match(by['about-page-weak'].urls[0].note, /chỉ 20[0-9] từ/);
assert.match(by['about-page-weak'].urls[0].note, /chưa có Organization schema/);
assert.doesNotMatch(by['about-page-weak'].urls[0].note, /chưa được link/);

// no About page at all; m-dot mobile site; subdomain sprawl; Vietnamese-only site
const vi = (p, extra = '') => page(p, semantic(words(200)).replace('lang="en"', 'lang="vi"').replace('</main>', extra + '</main>'));
const site2 = { host: HOST, start: `https://${HOST}/`, origin: `https://${HOST}`, sitemap: { count: 5 }, pages: [
  vi('/', '<a href="https://m.ex.com/">mobile</a><a href="https://a.ex.com/">a</a><a href="https://b.ex.com/">b</a><a href="https://c.ex.com/">c</a><a href="https://d.ex.com/">d</a>'),
  vi('/dich-vu/'), vi('/tin-tuc/'), vi('/lien-he/'), vi('/bang-gia/')] };
const i2 = Object.fromEntries(architectureChecks(site2).map((i) => [i.id, i]));
assert.ok(i2['about-page-missing']);
assert.match(i2['separate-mobile-site'].title, /m\.ex\.com/);
assert.equal(i2['subdomain-sprawl'].urls.length, 4);
assert.ok(i2['no-english-entity']);
// an English version (hreflang) removes the language issue
site2.pages[0] = page('/', semantic(words(200)).replace('lang="en"', 'lang="vi"').replace('<head>', '<head><link rel="alternate" hreflang="en" href="https://ex.com/en/">'));
assert.equal(architectureChecks(site2).find((i) => i.id === 'no-english-entity'), undefined);

// ── robots.txt per AI crawler ──
const robots = 'User-agent: *\nDisallow: /wp-admin/\n\nUser-agent: GPTBot\nUser-agent: Google-Extended\nDisallow: /\n\nUser-agent: OAI-SearchBot\nDisallow: /blog/\n';
const g = parseGroups(robots);
assert.equal(allowedFor(g, 'GPTBot', '/'), false);
assert.equal(allowedFor(g, 'OAI-SearchBot', '/wp-admin/'), true, 'a named group replaces the * group');
assert.equal(allowedFor(g, 'OAI-SearchBot', '/blog/x'), false);
const m = aiRobotsMatrix(robots, ['/', '/blog/x']);
assert.equal(m.find((b) => b.token === 'GPTBot').home, false);
assert.deepEqual(m.find((b) => b.token === 'OAI-SearchBot').blocked, ['/blog/x']);

// ── what each crawler received ──
const U = (path) => `https://${HOST}${path}`;
const row = (path, status, w, extra = {}) => ({ url: U(path), status, words: w, h1: true, main: true, challenge: false, ...extra });
const probes = {
  llms: { status: 200 }, llmsFull: { status: 200 },
  ua: {
    browser: [row('/', 200, 900), row('/blog/x', 200, 1200), row('/down/', 503, 0)],
    googlebot: [row('/', 200, 900), row('/blog/x', 200, 1200), row('/down/', 503, 0)],
    'OAI-SearchBot': [row('/', 403, 10), row('/blog/x', 200, 1200), row('/down/', 503, 0)],
    PerplexityBot: [row('/', 200, 40, { challenge: true }), row('/blog/x', 200, 300, { h1: false }), row('/down/', 503, 0)],
    GPTBot: [row('/', 200, 900), row('/blog/x', 200, 1100), row('/down/', 503, 0)],
  },
};
const ps = Object.fromEntries(geoProbeChecks(probes, { origin: `https://${HOST}`, robots: { status: 200, raw: robots } }).map((i) => [i.id, i]));
assert.deepEqual(ps['ai-bot-blocked'].urls.map((u) => u.note).sort(), ['OAI-SearchBot: 403', 'PerplexityBot: 200 (trang chặn bot)']);
assert.ok(!ps['ai-bot-blocked'].urls.some((u) => u.url === U('/down/')), 'a page that fails for browsers too is not a bot issue');
assert.deepEqual(ps['ai-bot-less-content'].urls.map((u) => u.note), ['PerplexityBot: 300/1200 từ, mất H1']);
assert.equal(ps['robots-blocks-ai-search'].severity, 'medium');
assert.match(ps['robots-blocks-ai-search'].urls[0].note, /OAI-SearchBot/);
assert.ok(!ps['robots-blocks-ai-search'].urls.some((u) => /GPTBot|Google-Extended/.test(u.note)), 'training bots are a policy choice, not an issue');
assert.equal(ps['ai-robots-matrix'].severity, 'info');
assert.match(ps['ai-robots-matrix'].urls.find((u) => u.note.startsWith('GPTBot')).note, /CHẶN cả site/);

console.log('PASS architecture: CSR shell, JS links, <main>/<nav>/<footer>, chrome headings, About, m-dot, subdomains, language; robots per AI bot; bot access');
