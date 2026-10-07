// Shared fixture for the offline tests: a crawl of books.toscrape.com (public scraping sandbox), cached in reports/.
import fs from 'node:fs';
import { crawl } from '../lib/crawler.mjs';

export async function demoSite(maxPages = 120) {
  const file = 'reports/books.toscrape.com.crawl.json';
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  console.log(`(chưa có ${file}: crawl books.toscrape.com ${maxPages} URL một lần…)`);
  const site = await crawl('https://books.toscrape.com/', { maxPages, concurrency: 6, delay: 50, log: () => {} });
  fs.mkdirSync('reports', { recursive: true });
  fs.writeFileSync(file, JSON.stringify(site));
  return site;
}
