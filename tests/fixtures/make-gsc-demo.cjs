// Synthetic GSC "query + page" export for the sample report (books.toscrape.com demo). Deterministic.
const fs = require('fs');
const B = 'https://books.toscrape.com/';
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pages = [B, B + 'catalogue/category/books/travel_2/index.html', B + 'catalogue/category/books/mystery_3/index.html', B + 'catalogue/category/books/poetry_23/index.html', B + 'catalogue/a-light-in-the-attic_1000/index.html', B + 'catalogue/tipping-the-velvet_999/index.html', B + 'catalogue/category/books/historical-fiction_4/index.html'];
const topics = ['books to scrape', 'scrape books', 'buy books online', 'cheap books', 'mystery books', 'travel books', 'poetry books', 'historical fiction books', 'a light in the attic', 'tipping the velvet', 'book store online', 'best mystery novels', 'travel guide books', 'poetry collection', 'used books', 'books sandbox', 'web scraping practice site', 'book prices', 'new books 2026', 'classic novels'];
const mods = ['', ' online', ' cheap', ' review', ' price', ' best', ' list', ' uk', ' free shipping', ' paperback'];
const rows = [['Query', 'Page', 'Clicks', 'Impressions', 'CTR', 'Position']];
const expected = (p) => [0.28, 0.16, 0.11, 0.08, 0.06, 0.045, 0.035, 0.028, 0.023, 0.02][Math.round(p) - 1] ?? 0.012;
for (const t of topics) for (const m of mods) {
  if (rnd() < 0.35) continue;
  const q = t + m;
  const pos = Math.max(1, Math.min(28, (t.includes('scrape') || t === 'books sandbox' ? 1 : 3) + rnd() * 18));
  const imp = Math.round(40 + rnd() ** 2 * 6000);
  const factor = rnd() < 0.2 ? 0.3 : rnd() < 0.15 ? 1.8 : 0.7 + rnd() * 0.6;   // some under/over-performers
  const clicks = Math.round(imp * expected(pos) * factor);
  const pg = pages[Math.floor(rnd() * pages.length)];
  rows.push([q, pg, clicks, imp, ((clicks / imp) * 100).toFixed(2) + '%', pos.toFixed(1)]);
  if (rnd() < 0.12) {   // second page on the same query → cannibalization
    const pg2 = pages[(pages.indexOf(pg) + 1) % pages.length];
    const imp2 = Math.round(imp * (0.3 + rnd() * 0.6));
    rows.push([q, pg2, Math.round(clicks * 0.3), imp2, '0.5%', (pos + 3).toFixed(1)]);
  }
}
fs.writeFileSync(__dirname + '/gsc_query_page_demo.csv', rows.map((r) => r.map((x) => JSON.stringify(String(x))).join(',')).join('\r\n'));
console.log(rows.length - 1, 'rows');
