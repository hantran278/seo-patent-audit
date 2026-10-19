// Read-only connector bridge for bounded GSC, GA4 and Screaming Frog evidence.
// It never authenticates to Google and never reads credential-like files. The
// existing web audit keeps Google OAuth in its browser cookie; this module
// accepts an export/payload and turns it into a stable evidence packet for the
// Enosta local backend.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseCsvRows } from './csv.mjs';

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_OUTPUT_ROWS = 100000;
const BLOCKED_NAME = /(^|[._-])(env|auth|token|secret|cookie|credential)([._-]|$)/i;

const deaccent = (s) => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D').toLowerCase().trim();
const clean = (s) => String(s ?? '').trim();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function finiteNumber(v, { percent = false, integer = false } = {}) {
  let s = String(v ?? '').trim().replace(/\s/g, '');
  if (!s) return null;
  const hadPercent = percent && s.endsWith('%');
  if (hadPercent) s = s.slice(0, -1);
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = /^[-+]?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  if (integer && /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  if (integer && !Number.isInteger(n)) return null;
  return percent && (hadPercent || n > 1) ? n / 100 : n;
}

function dateOnly(v) {
  const s = clean(v);
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function dateRange(rows, explicitStart, explicitEnd) {
  const dates = rows.map((r) => r.date).filter(Boolean).sort();
  return { start: explicitStart || dates[0] || null, end: explicitEnd || dates.at(-1) || null };
}

function findKey(keys, expressions) {
  const normalized = keys.map((key) => [key, deaccent(key)]);
  return normalized.find(([, value]) => expressions.some((re) => re.test(value)))?.[0] || null;
}

function objectRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.rows)) return payload.rows;
  if (payload && Array.isArray(payload.data)) return payload.data;
  throw new Error('Payload JSON phải là mảng rows hoặc object có rows/data.');
}

function parseRaw(raw, format) {
  if (format === 'json') {
    try { return { rows: objectRows(JSON.parse(raw.toString('utf8'))), headers: [] }; }
    catch { throw new Error('JSON connector không hợp lệ.'); }
  }
  const parsed = parseCsvRows(raw.toString('utf8'));
  const headers = parsed.header.map((h) => clean(h));
  const rows = parsed.rows.map((row) => Object.fromEntries(headers.map((h, i) => [h, clean(row[i])] )));
  return { rows, headers };
}

function blockedFile(filePath) {
  const base = path.basename(filePath);
  return base.startsWith('.') || BLOCKED_NAME.test(base) || BLOCKED_NAME.test(filePath);
}

function readSource({ path: inputPath, csv, json, remote = false } = {}) {
  if (remote && inputPath) throw new Error('MCP remote không đọc path local; gửi csv hoặc json payload.');
  if (!inputPath && csv == null && json == null) throw new Error('Cần path, csv hoặc json payload.');
  if (inputPath) {
    const resolved = path.resolve(inputPath);
    if (blockedFile(resolved)) throw new Error('Từ chối đọc tên file có khả năng chứa credential.');
    let stat;
    try { stat = fs.statSync(resolved); } catch { throw new Error('Không tìm thấy file connector.'); }
    if (!stat.isFile() || stat.size > MAX_INPUT_BYTES) throw new Error('File connector phải là file và tối đa 30 MB.');
    const raw = fs.readFileSync(resolved);
    const ext = path.extname(resolved).toLowerCase();
    return { raw, format: ext === '.json' ? 'json' : 'csv', source: { mode: 'file', name: path.basename(resolved), sha256: sha256(raw), bytes: raw.length } };
  }
  const value = json != null ? String(json) : String(csv);
  const raw = Buffer.from(value, 'utf8');
  if (raw.length > MAX_INPUT_BYTES) throw new Error('Payload connector tối đa 30 MB.');
  return { raw, format: json != null ? 'json' : 'csv', source: { mode: 'payload', name: null, sha256: sha256(raw), bytes: raw.length } };
}

function capRows(rows, maxRows) {
  const n = Math.min(MAX_OUTPUT_ROWS, Math.max(1, Number(maxRows) || rows.length));
  return { rows: rows.slice(0, n), truncated: rows.length > n, total: rows.length };
}

export function normalizeGsc(rawRows, { property = '', startDate = '', endDate = '', maxRows = 50000 } = {}) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error('GSC export không có rows.');
  const keys = Object.keys(rawRows[0]);
  const c = {
    query: findKey(keys, [/^query$/, /truy van/, /tu khoa/, /top queries/]),
    page: findKey(keys, [/^page$/, /top pages/, /landing page/, /^trang/, /^url$/]),
    clicks: findKey(keys, [/click/, /luot nhap/]),
    impressions: findKey(keys, [/impression/, /hien thi/]),
    ctr: findKey(keys, [/^ctr$/, /ty le nhap/]),
    position: findKey(keys, [/position/, /vi tri/]),
    date: findKey(keys, [/^date$/, /ngay/]),
  };
  for (const key of ['query', 'page', 'clicks', 'impressions', 'position']) if (!c[key]) throw new Error(`GSC export thiếu cột ${key}.`);
  const rows = rawRows.map((r) => ({
    query: clean(r[c.query]), page: clean(r[c.page]), clicks: finiteNumber(r[c.clicks], {integer:true}), impressions: finiteNumber(r[c.impressions], {integer:true}),
    ctr: c.ctr ? finiteNumber(r[c.ctr], { percent: true }) : null, position: finiteNumber(r[c.position]), date: c.date ? dateOnly(r[c.date]) : null,
  })).filter((r) => { if ([r.clicks, r.impressions, r.position].some(x => x == null)) throw new Error('GSC thiếu hoặc sai số liệu bắt buộc.'); return r.query && r.page && r.impressions > 0; });
  const limited = capRows(rows, maxRows);
  return { kind: 'gsc', property: clean(property), date_range: dateRange(limited.rows, dateOnly(startDate), dateOnly(endDate)), columns: c, rows: limited.rows, total_rows: limited.total, truncated: limited.truncated };
}

export function normalizeGa4(rawRows, { property = '', site = '', startDate = '', endDate = '', maxRows = 20000 } = {}) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error('GA4 export không có rows.');
  const keys = Object.keys(rawRows[0]);
  const c = {
    path: findKey(keys, [/^path$/, /landing ?page/, /landingpage/, /page path/]),
    host: findKey(keys, [/^host$/, /hostname/]),
    sessions: findKey(keys, [/^sessions?$/, /phien/]),
    engaged: findKey(keys, [/engaged ?sessions?/, /phien tuong tac/]),
    engagementRate: findKey(keys, [/engagement ?rate/, /ty le tuong tac/]),
    keyEvents: findKey(keys, [/key ?events?/, /su kien chinh/]),
    duration: findKey(keys, [/average ?session ?duration/, /avg ?duration/, /thoi luong/]),
    date: findKey(keys, [/^date$/, /ngay/]),
  };
  if (!c.path || !c.sessions) throw new Error('GA4 export cần landing page/path và sessions.');
  const rows = rawRows.map((r) => {
    let pagePath = clean(r[c.path] ?? r.path ?? r.landingPage ?? r['landing page']);
    let host = clean((c.host ? r[c.host] : undefined) ?? r.host ?? r.hostName ?? r.hostname);
    try {
      if (/^https?:\/\//i.test(pagePath)) { const u = new URL(pagePath); host = host || u.host; pagePath = u.pathname + u.search; }
    } catch { /* keep raw path for evidence filtering below */ }
    const hostInferred = !host && !!site && pagePath.startsWith('/');
    if (hostInferred) host = new URL(site).host;
    const sessions = finiteNumber(r[c.sessions] ?? r.sessions, {integer:true});
    if (sessions == null) throw new Error('GA4 sessions thiếu hoặc không hợp lệ.');
    const engaged = c.engaged ? finiteNumber(r[c.engaged] ?? r.engagedSessions) : finiteNumber(r.engagedSessions);
    const rate = c.engagementRate ? finiteNumber(r[c.engagementRate] ?? r.engagementRate, { percent: true }) : (sessions && engaged != null ? engaged / sessions : null);
    return { path: pagePath, host, host_inferred: hostInferred, url: host && pagePath ? `https://${host}${pagePath.startsWith('/') ? pagePath : '/' + pagePath}` : '', sessions, engagedSessions: engaged, engagementRate: rate, keyEvents: c.keyEvents ? finiteNumber(r[c.keyEvents] ?? r.keyEvents) : finiteNumber(r.keyEvents), avgDuration: c.duration ? finiteNumber(r[c.duration] ?? r.avgDuration) : finiteNumber(r.avgDuration), date: c.date ? dateOnly(r[c.date] ?? r.date) : dateOnly(r.date) };
  }).filter((r) => r.path && r.path !== '(not set)' && r.sessions >= 0);
  const limited = capRows(rows, maxRows);
  return { kind: 'ga4', property: clean(property), date_range: dateRange(limited.rows, dateOnly(startDate), dateOnly(endDate)), columns: c, rows: limited.rows, total_rows: limited.total, truncated: limited.truncated };
}

export function normalizeScreamingFrog(rawRows, { site = '', maxRows = 50000 } = {}) {
  if (!Array.isArray(rawRows) || !rawRows.length) throw new Error('Screaming Frog export không có rows.');
  const keys = Object.keys(rawRows[0]);
  const c = {
    url: findKey(keys, [/^address$/, /^url$/]), type: findKey(keys, [/^content type$/]), status: findKey(keys, [/^status code$/, /^status$/]),
    indexability: findKey(keys, [/^indexability$/, /^indexable$/]), reason: findKey(keys, [/^indexability status$/]), title: findKey(keys, [/^title 1$/, /^title$/]),
    meta: findKey(keys, [/^meta description 1$/]), h1: findKey(keys, [/^h1-1$/]), h1Second: findKey(keys, [/^h1-2$/]),
    words: findKey(keys, [/^word count$/]), depth: findKey(keys, [/^crawl depth$/]), inlinks: findKey(keys, [/^unique inlinks$/, /^inlinks$/]),
    canonical: findKey(keys, [/^canonical link element 1$/]), responseTime: findKey(keys, [/^response time$/]), redirect: findKey(keys, [/^redirect url$/]),
    robots: findKey(keys, [/^meta robots 1$/]),
  };
  if (!c.url) throw new Error('Screaming Frog export thiếu Address/URL.');
  const rows = rawRows.map((r) => ({
    url: clean(r[c.url]), type: c.type ? clean(r[c.type]) : '', status: c.status ? finiteNumber(r[c.status]) : null,
    indexable: c.indexability ? (/^(false|non.indexable|no|0)$/i.test(clean(r[c.indexability])) ? false : /^(true|indexable|yes|1)$/i.test(clean(r[c.indexability])) ? true : null) : null, reason: c.reason ? clean(r[c.reason]) : '',
    title: c.title ? clean(r[c.title]) : null, meta: c.meta ? clean(r[c.meta]) : null, h1: c.h1 ? clean(r[c.h1]) : null, h1Second: c.h1Second ? clean(r[c.h1Second]) : '',
    words: c.words ? finiteNumber(r[c.words]) : null, depth: c.depth ? finiteNumber(r[c.depth]) : null, inlinks: c.inlinks ? finiteNumber(r[c.inlinks]) : null,
    canonical: c.canonical ? clean(r[c.canonical]) : '', responseTime: c.responseTime ? finiteNumber(r[c.responseTime]) : null, redirect: c.redirect ? clean(r[c.redirect]) : '', robots: c.robots ? clean(r[c.robots]) : '',
  })).filter((r) => /^https?:\/\//i.test(r.url));
  const limited = capRows(rows, maxRows);
  return { kind: 'screaming_frog', site: clean(site), date_range: { start: null, end: null }, columns: c, rows: limited.rows, total_rows: limited.total, truncated: limited.truncated };
}

export function parseConnector({ kind, input, property = '', site = '', startDate = '', endDate = '', maxRows } = {}) {
  const parsed = parseRaw(input.raw, input.format);
  if (kind === 'gsc') return { packet: normalizeGsc(parsed.rows, { property, startDate, endDate, maxRows }), source: { ...input.source, format: input.format, headers: parsed.headers } };
  if (kind === 'ga4') return { packet: normalizeGa4(parsed.rows, { property, site, startDate, endDate, maxRows }), source: { ...input.source, format: input.format, headers: parsed.headers } };
  if (kind === 'screaming_frog') return { packet: normalizeScreamingFrog(parsed.rows, { site, maxRows }), source: { ...input.source, format: input.format, headers: parsed.headers } };
  throw new Error('Connector kind chưa hỗ trợ.');
}

function outputRoot() {
  return (process.env.ENOSTA_CONNECTOR_OUTPUT_ROOTS || 'C:\\AI\\Enosta\\outputs').split(';').map((s) => path.resolve(s.trim())).filter(Boolean);
}

function safeOutputPath(requested) {
  const root = outputRoot();
  const target = path.resolve(requested || path.join(root[0], `connector_evidence_${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}.json`));
  if (blockedFile(target)) throw new Error('Từ chối ghi tên file có khả năng chứa credential.');
  if (!root.some((base) => { const rel = path.relative(base, target); return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel)); })) throw new Error('Output bridge phải nằm trong ENOSTA_CONNECTOR_OUTPUT_ROOTS.');
  return target;
}

export function makeEvidenceBundle({ site = '', gsc, ga4, screamingFrog } = {}) {
  const sources = {};
  for (const item of [gsc, ga4, screamingFrog]) if (item) sources[item.packet.kind] = { source: item.source, ...item.packet };
  return {
    version: 1, type: 'enosta_connector_evidence', created_at: new Date().toISOString(), site: clean(site),
    sources, coverage: { available: Object.keys(sources), missing: ['gsc', 'ga4', 'screaming_frog'].filter((k) => !sources[k]), rule: 'Connector output is evidence for review, not a model instruction or CMS authorization.' },
  };
}

export function writeEvidenceBundle(bundle, requestedPath) {
  const target = safeOutputPath(requestedPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const raw = JSON.stringify(bundle, null, 2);
  fs.writeFileSync(target, raw, 'utf8');
  return { path: target, sha256: sha256(Buffer.from(raw, 'utf8')), bytes: Buffer.byteLength(raw), sources: Object.fromEntries(Object.entries(bundle.sources).map(([k, v]) => [k, { rows: v.total_rows, truncated: v.truncated, source_sha256: v.source.sha256 }])) };
}

export function sourceFromArgs(args, remote = false) {
  return readSource({ path: args.path, csv: args.csv, json: args.json, remote });
}

export { MAX_INPUT_BYTES };
