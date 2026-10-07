// Synthetic Semrush "Referring domains" export (+ a competitor backlinks export) for testing checks/backlinks.mjs.
const fs = require('fs');
let seed = 11;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const day = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const rows = [['Domain ascore', 'Domain', 'Backlinks', 'IP Address', 'Country', 'First seen', 'Last seen']];
const words = ['travel', 'books', 'reading', 'library', 'novel', 'review', 'lit', 'story', 'culture', 'news', 'daily', 'press', 'guide', 'blog', 'world', 'city'];
// legit domains spread over 2 years
for (let i = 0; i < 70; i++) rows.push([20 + Math.floor(rnd() * 60), `${pick(words)}${pick(words)}${i}.com`, 1 + Math.floor(rnd() * 20), `${50 + i}.${Math.floor(rnd() * 250)}.${Math.floor(rnd() * 250)}.${Math.floor(rnd() * 250)}`, pick(['us', 'gb', 'vn', 'de', '']), day(2024 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)), day(2026, 9, 1 + Math.floor(rnd() * 28))]);
// low-AS blogspot/cloudflare sites (CDN IPs → must NOT form clusters)
for (let i = 0; i < 25; i++) rows.push([2 + Math.floor(rnd() * 8), `bookreader${i}.blogspot.com`, 1 + Math.floor(rnd() * 5), `172.67.${Math.floor(rnd() * 250)}.${Math.floor(rnd() * 250)}`, 'us', day(2026, 7, 1 + i), day(2026, 9, 28)]);
// spam network on 3 subnets, mostly created in the spike month 2026-09
const tlds = ['shop', 'store', 'monster', 'website', 'online', 'xyz', 'top', 'com'];
const nets = ['118.139.181', '195.20.18', '184.168.115'];
for (let i = 0; i < 160; i++) rows.push([Math.floor(rnd() * 6), `${pick(['pol', 'seo', 'arch', 'kno', 'allw', 'best', 'link', 'rank', 'top'])}${pick(['hub', 'dir', 'zone', 'spot', 'pro', 'net'])}${i}.${pick(tlds)}`, 1 + Math.floor(rnd() * 400), `${pick(nets)}.${Math.floor(rnd() * 250)}`, pick(['', 'ru', 'us']), day(2026, rnd() < 0.85 ? 9 : 8, 1 + Math.floor(rnd() * 28)), day(2026, 10, 1)]);
// casino / stat / scraper sites
for (const d of ['ufabet168.com', '888slotgacor.online', 'betting-tips99.shop', 'websiteoutlook.com', 'siteprice.org', 'statshow.com', 'hypestat.com', 'sitelike.org', 'seo-stats-checker.xyz', 'backlinkfree.top'])
  rows.push([Math.floor(rnd() * 15), d, 1 + Math.floor(rnd() * 10), `${100 + Math.floor(rnd() * 100)}.${Math.floor(rnd() * 250)}.1.${Math.floor(rnd() * 250)}`, 'us', day(2026, 6, 10), day(2026, 9, 20)]);
// brand-token domains and stale links
rows.push([5, 'toscrape-books-mirror.com', 40, '45.10.20.30', 'us', day(2026, 5, 1), day(2026, 9, 30)]);
for (let i = 0; i < 6; i++) rows.push([12, `oldlink${i}.net`, 2, `81.2.${i}.9`, 'gb', day(2024, 3, 1), day(2025, 11, 1 + i)]);
fs.writeFileSync(__dirname + '/semrush_referring_domains.csv', rows.map((r) => r.join(',')).join('\r\n'));

// competitor backlinks (target = competitor host): some domains overlap with ours
const comp = [['Source url', 'Target url', 'Anchor', 'Page ascore', 'Nofollow']];
for (let i = 0; i < 40; i++) comp.push([`https://${i < 10 ? `${pick(words)}${pick(words)}${i}.com` : `bookblog${i}.org`}/post-${i}`, 'https://competitor-books.com/', pick(['competitor books', 'buy books', 'https://competitor-books.com']), 15 + Math.floor(rnd() * 60), 'false']);
fs.writeFileSync(__dirname + '/competitor_backlinks.csv', comp.map((r) => r.join(',')).join('\r\n'));
console.log(rows.length - 1, 'referring domains ·', comp.length - 1, 'competitor backlinks');
