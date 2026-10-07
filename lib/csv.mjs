import fs from 'node:fs';

// Minimal RFC-4180 CSV reader with delimiter sniffing (, ; tab), BOM / UTF-16 handling
// and header-row detection (skips "sep=," lines and Screaming Frog's old "Internal - All" title row).
export function readCsv(file) {
  return parseCsvText(decodeBuffer(fs.readFileSync(file)));
}

export function decodeBuffer(buf) {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  return new TextDecoder('utf-8').decode(buf);
}

export function parseCsvRows(input) {
  const text = String(input).replace(/^﻿/, '').replace(/^sep=.?\r?\n/i, '');
  const sample = text.split(/\r?\n/, 5).sort((a, b) => b.length - a.length)[0] || '';
  const delim = [',', ';', '\t'].sort((a, b) => sample.split(b).length - sample.split(a).length)[0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x !== '')) rows.push(row);
  // header = first of the opening rows that has the most columns
  const widest = Math.max(0, ...rows.slice(0, 5).map((r) => r.length));
  const h = Math.max(0, rows.findIndex((r) => r.length === widest));
  return { header: (rows[h] || []).map((x) => x.trim()), rows: rows.slice(h + 1) };
}

export const toObjects = ({ header, rows }) => rows.map((r) => Object.fromEntries(header.map((k, i) => [k, (r[i] ?? '').trim()])));

export function parseCsvText(input) {
  return toObjects(parseCsvRows(input));
}
