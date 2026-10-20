// Detect what an uploaded CSV is (GSC, Screaming Frog, Semrush/Ahrefs keywords or backlinks, Semrush Site Audit)
// from its column names, and normalise each kind into one schema the checks can use.
import { normalizeGsc } from '../checks/gsc.mjs';

export const deaccent = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const num = (v) => { const n = Number(String(v ?? '').replace(/[%\s]/g, '').replace(/,(?=\d{3}\b)/g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; };

export const SOURCE_LABELS = {
  gsc: 'Google Search Console',
  sf: 'Screaming Frog',
  keywords: 'Từ khoá (Semrush/Ahrefs)',
  backlinks: 'Backlink (Ahrefs/Semrush/GSC)',
  audit: 'Semrush Site Audit',
  unknown: 'Không nhận diện được',
};

function finder(header) {
  const cols = header.map((h) => [h, deaccent(h)]);
  return (...res) => cols.find(([, d]) => res.some((re) => re.test(d)))?.[0];
}

export function detect(header) {
  const f = finder(header);
  if (f(/^address$/) && f(/^indexability|^status code$|^crawl depth$|^content type$/)) return 'sf';
  if (f(/click|luot nhap/) && f(/impression|hien thi/)) return 'gsc';
  if (f(/^keyword$|^tu khoa$/) && f(/^position$|^current position$|^vi tri$/)) return 'keywords';
  if (f(/source url|referring page url|^url nguon|linking site|trang web lien ket|^referring domain$|^domain$/) && !f(/^keyword$/)) return 'backlinks';
  // GSC Links report "Top linking sites": Site · Linking pages · Target pages (Vietnamese UI: Trang web · Trang liên kết …)
  if (f(/^site$|^trang web$/) && f(/linking pages|trang lien ket/)) return 'backlinks';
  if (f(/^issue|^van de|^loi$/) && f(/url|^page|trang/)) return 'audit';
  // Semrush Site Audit "wide" export: one URL column + many issue columns
  if (f(/^page url$|^url$|^source url$/) && header.length >= 8) return 'audit-wide';
  return 'unknown';
}

function normSf(rows, header) {
  const f = finder(header);
  const c = {
    url: f(/^address$/), type: f(/^content type$/), status: f(/^status code$/), idx: f(/^indexability$/), reason: f(/^indexability status$/),
    title: f(/^title 1$/), titleLen: f(/^title 1 length$/), meta: f(/^meta description 1$/), h1: f(/^h1-1$/), h1b: f(/^h1-2$/),
    words: f(/^word count$/), depth: f(/^crawl depth$/), inl: f(/^unique inlinks$/) || f(/^inlinks$/), canon: f(/^canonical link element 1$/),
    rt: f(/^response time$/), redirect: f(/^redirect url$/), robots: f(/^meta robots 1$/),
  };
  return rows.map((r) => ({
    url: r[c.url], type: r[c.type] || '', status: num(r[c.status]), indexable: c.idx ? !/non/i.test(r[c.idx] || '') : null, reason: r[c.reason] || '',
    title: c.title ? r[c.title] : undefined, meta: c.meta ? r[c.meta] : undefined, h1: c.h1 ? r[c.h1] : undefined, h1Second: c.h1b ? r[c.h1b] : '',
    words: c.words ? num(r[c.words]) : null, depth: c.depth ? num(r[c.depth]) : null, inlinks: c.inl ? num(r[c.inl]) : null,
    canonical: r[c.canon] || '', responseTime: c.rt ? num(r[c.rt]) : null, redirect: r[c.redirect] || '',
  })).filter((r) => /^https?:\/\//.test(r.url || ''));
}

function normKeywords(rows, header) {
  const f = finder(header);
  const c = {
    kw: f(/^keyword$|^tu khoa$/), pos: f(/^position$|^current position$|^vi tri$/), vol: f(/search volume|^volume$|luong tim kiem/),
    url: f(/^url$|^current url$|^landing page$/), traffic: f(/^traffic$|^current organic traffic$|^organic traffic$/), kd: f(/keyword difficulty|^kd$/),
    prev: f(/^previous position$|^previous position$/),
  };
  return rows.map((r) => ({ keyword: r[c.kw], position: num(r[c.pos]), volume: num(r[c.vol]), url: r[c.url] || '', traffic: num(r[c.traffic]), kd: c.kd ? num(r[c.kd]) : null, prev: c.prev ? num(r[c.prev]) : null }))
    .filter((r) => r.keyword && r.position > 0);
}

// Backlink-level (Ahrefs/Semrush "Backlinks") or domain-level ("Referring domains", GSC "Top linking sites") exports.
// A field is null when the file has no such column.
export function normBacklinks(rows, header) {
  const f = finder(header);
  const c = {
    src: f(/referring page url|source url|^url nguon|^url$/) || f(/linking site|trang web lien ket|^referring domain$|^domain$|^site$|^trang web$/),
    anchor: f(/anchor|van ban lien ket/), dr: f(/domain rating|^dr$|domain ascore|^ascore$|page ascore|authority/), traffic: f(/domain traffic|^traffic$|luu luong/), ip: f(/\bip\b/),
    nofollow: f(/^nofollow$/), target: f(/target url|^target$|^url dich/), links: f(/^backlinks$|^links to target$|^dofollow links$|^linking pages$|^trang lien ket$/),
    country: f(/^country$|quoc gia/), first: f(/first seen|^first_seen$|ngay phat hien/), last: f(/last seen|last check|^last_seen$/),
    lost: f(/^lost link$|^lost status$|^lost$/), sitewide: f(/^sitewide$/), title: f(/referring page title|source title/), extLinks: f(/^external links$/),
  };
  const bool = (v) => /^(true|1|yes|x)$/i.test(String(v ?? '').trim());
  const date = (v) => { const s = String(v ?? '').trim(); if (!s) return null; const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s); return isNaN(d) ? null : d.toISOString().slice(0, 10); };
  return rows.map((r) => ({
    source: r[c.src] || '', anchor: c.anchor ? r[c.anchor] || '' : null, dr: c.dr && r[c.dr] !== '' ? num(r[c.dr]) : null,
    traffic: c.traffic ? num(r[c.traffic]) : null, ip: c.ip ? r[c.ip] || null : null, nofollow: c.nofollow ? bool(r[c.nofollow]) : null, target: c.target ? r[c.target] || '' : '',
    links: c.links ? num(r[c.links]) : null, country: c.country ? r[c.country] || '' : null, firstSeen: c.first ? date(r[c.first]) : null, lastSeen: c.last ? date(r[c.last]) : null,
    lost: c.lost ? (bool(r[c.lost]) || /lost|removed|deleted|broken/i.test(r[c.lost])) : null, sitewide: c.sitewide ? bool(r[c.sitewide]) : null,
    title: c.title ? r[c.title] || '' : null, extLinks: c.extLinks ? num(r[c.extLinks]) : null,
  })).filter((r) => r.source);
}

function normAudit(rows, header, wide) {
  const f = finder(header);
  if (!wide) {
    const ci = f(/^issue|^van de|^loi$/), cu = f(/url|^page|trang/), cs = f(/^type$|severity|muc do/);
    return rows.map((r) => ({ issue: r[ci], url: r[cu], severity: cs ? r[cs] : '' })).filter((r) => r.issue);
  }
  const cu = f(/^page url$|^url$|^source url$/);
  const issueCols = header.filter((h) => h !== cu && rows.some((r) => num(r[h]) > 0) && rows.every((r) => r[h] === '' || /^[\d.,]+$/.test(r[h])));
  return rows.flatMap((r) => issueCols.filter((h) => num(r[h]) > 0).map((h) => ({ issue: h, url: r[cu], severity: '' })));
}

// files: [{ name, header: [...], rows: [[...]] }] → grouped, normalised data + a summary of what was recognised
export function classifyFiles(files = []) {
  const out = { gsc: [], sf: [], keywords: [], backlinks: [], audit: [], summary: [] };
  for (const file of files) {
    const header = (file.header || []).map((h) => String(h).trim());
    const objs = (file.rows || []).map((r) => Object.fromEntries(header.map((h, i) => [h, String(r[i] ?? '').trim()])));
    let kind = detect(header), n = 0;
    if (kind === 'gsc') { const g = normalizeGsc(objs); out.gsc.push(...g); n = g.length; }
    else if (kind === 'sf') { const s = normSf(objs, header); out.sf.push(...s); n = s.length; }
    else if (kind === 'keywords') { const k = normKeywords(objs, header); out.keywords.push(...k); n = k.length; }
    else if (kind === 'backlinks') {
      const b = normBacklinks(objs, header);
      // referring-domain exports have no target column: the file name ("andersenlab.com-backlinks_refdomains.csv")
      // tells whose backlinks they are, so competitor files are not mistaken for our own profile
      // GSC names files after the property ("https___enosta.com_-Top linking sites-…"): drop the scheme part first
      const site = String(file.name || '').toLowerCase().replace(/^(?:https?_+|sc-domain_+)/, '').match(/^(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?=[-_ .](?!csv$))/)?.[1] || '';
      if (site) for (const r of b) if (!r.target) r.site = site;
      out.backlinks.push(...b); n = b.length;
    }
    else if (kind === 'audit' || kind === 'audit-wide') { const a = normAudit(objs, header, kind === 'audit-wide'); out.audit.push(...a); n = a.length; kind = 'audit'; }
    out.summary.push({ name: file.name, kind, label: SOURCE_LABELS[kind], rows: n, truncated: !!file.truncated });
  }
  return out;
}
