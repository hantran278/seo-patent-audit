// Synthetic exports in the formats of each tool, for local testing of lib/sources.mjs
const fs = require('fs');
const d = __dirname + '/';
const B = 'https://books.toscrape.com/';
const csv = (rows) => rows.map((r) => r.map((x) => JSON.stringify(String(x))).join(',')).join('\r\n') + '\r\n';
fs.writeFileSync(d + 'internal_all.csv', '"Internal - All"\r\n' + csv([
  ['Address', 'Content Type', 'Status Code', 'Status', 'Indexability', 'Indexability Status', 'Title 1', 'Title 1 Length', 'Meta Description 1', 'H1-1', 'H1-2', 'Meta Robots 1', 'Word Count', 'Crawl Depth', 'Inlinks', 'Unique Inlinks', 'Response Time', 'Redirect URL', 'Canonical Link Element 1', 'Size (bytes)'],
  [B, 'text/html; charset=utf-8', 200, 'OK', 'Indexable', '', 'All products | Books to Scrape', 31, '', 'All products', '', '', 400, 0, 1000, 1000, 0.2, '', B, 5000],
  [B + 'catalogue/a-light-in-the-attic_1000/index.html', 'text/html', 200, 'OK', 'Indexable', '', 'A Light in the Attic', 20, '', 'A Light in the Attic', '', '', 180, 2, 3, 1, 2.1, '', '', 4000],
  [B + 'catalogue/page-99.html', 'text/html', 200, 'OK', 'Indexable', '', 'All products', 12, '', '', '', '', 300, 6, 1, 1, 0.3, '', '', 4000],
  [B + 'catalogue/page-98.html', 'text/html', 200, 'OK', 'Indexable', '', 'All products', 12, '', 'Books', 'Extra', '', 300, 6, 2, 2, 0.3, '', '', 4000],
  [B + 'old-page', 'text/html', 404, 'Not Found', 'Non-Indexable', 'Client Error', '', '', '', '', '', '', 0, 2, 5, 4, 0.1, '', '', 100],
  [B + 'moved', '', 301, 'Moved Permanently', 'Non-Indexable', 'Redirected', '', '', '', '', '', '', 0, 2, 3, 3, 0.1, B, '', 0],
  [B + 'hidden.html', 'text/html', 200, 'OK', 'Non-Indexable', 'noindex', 'Hidden', 6, '', 'Hidden', '', 'noindex', 500, 3, 2, 2, 0.2, '', '', 4000],
  [B + 'static/style.css', 'text/css', 200, 'OK', 'Indexable', '', '', '', '', '', '', '', 0, 1, 10, 10, 0.1, '', '', 300],
]));
fs.writeFileSync(d + 'semrush_positions.csv', csv([
  ['Keyword', 'Position', 'Previous position', 'Search Volume', 'Keyword Difficulty', 'CPC', 'URL', 'Traffic', 'Traffic (%)'],
  ['books to scrape', 12, 14, 2400, 40, 0.5, B, 20, 10],
  ['books to scrape', 18, 0, 2400, 40, 0.5, B + 'catalogue/page-98.html', 2, 1],
  ['light in the attic', 15, 15, 880, 30, 0.2, B + 'catalogue/a-light-in-the-attic_1000/index.html', 5, 2],
  ['old book', 4, 4, 300, 10, 0.1, B + 'old-page', 30, 5],
]));
const ah = 'Referring page URL\tReferring page title\tDomain rating\tDomain traffic\tAnchor\tNofollow\r\nhttps://blog.a.com/x\tX\t5\t0\tbooks to scrape\tfalse\r\nhttps://b.net/y\tY\t3\t0\tbooks to scrape\tfalse\r\nhttps://c.org/z\tZ\t50\t1200\tbooks.toscrape.com\tfalse\r\n';
fs.writeFileSync(d + 'ahrefs_backlinks.csv', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(ah, 'utf16le')]));
fs.writeFileSync(d + 'Queries.csv', '﻿' + csv([['Truy vấn hàng đầu', 'Lượt nhấp', 'Lượt hiển thị', 'CTR', 'Vị trí'], ['books to scrape', 10, 2000, '0.5%', 3.2], ['scrape books', 40, 500, '8%', 5]]));
fs.writeFileSync(d + 'Pages.csv', '﻿' + csv([['Trang hàng đầu', 'Lượt nhấp', 'Lượt hiển thị', 'CTR', 'Vị trí'], [B + 'hidden.html', 30, 900, '3.3%', 6]]));
fs.writeFileSync(d + 'semrush_audit.csv', csv([['Issue', 'Page URL', 'Type'], ['Duplicate title tag', B + 'catalogue/page-99.html', 'Error'], ['Duplicate title tag', B + 'catalogue/page-98.html', 'Error'], ['Broken internal link', B + 'old-page', 'Error']]));
fs.writeFileSync(d + 'random.csv', csv([['foo', 'bar'], [1, 2]]));
