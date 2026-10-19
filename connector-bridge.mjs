#!/usr/bin/env node
// Local, read-only connector bridge for Enosta. It reads bounded export files,
// normalizes them and writes an evidence bundle; it never authenticates to
// Google and never writes WordPress.
import { makeEvidenceBundle, parseConnector, sourceFromArgs, writeEvidenceBundle } from './lib/connectors.mjs';

const USAGE = `Usage:
  node connector-bridge.mjs --gsc <file> --ga4 <file> --screaming-frog <file> [options]

Options:
  --site <url>                 Site label in the bundle
  --gsc-property <property>    GSC property label
  --ga4-property <property>    GA4 property label
  --start-date <YYYY-MM-DD>    Explicit connector start date
  --end-date <YYYY-MM-DD>      Explicit connector end date
  --out <path>                 Output JSON (must be in ENOSTA_CONNECTOR_OUTPUT_ROOTS)
  --gsc-max-rows <n>           GSC row cap (default 50000)
  --ga4-max-rows <n>           GA4 row cap (default 20000)
  --sf-max-rows <n>            Screaming Frog row cap (default 50000)
  --help                       Show this message
`;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--help') { console.log(USAGE); process.exit(0); }
    if (!token.startsWith('--')) throw new Error(`Tham số không hợp lệ: ${token}`);
    const key = token.slice(2).replaceAll('-', '_');
    const value = argv[++i];
    if (value == null || value.startsWith('--')) throw new Error(`Thiếu giá trị cho --${key.replaceAll('_', '-')}`);
    args[key] = value;
  }
  return args;
}

function numberArg(args, key, fallback) {
  if (args[key] == null) return fallback;
  const value = Number(args[key]);
  if (!Number.isInteger(value) || value < 1 || value > 100000) throw new Error(`--${key.replaceAll('_', '-')} phải là số nguyên 1–100000.`);
  return value;
}

function parseOptional(kind, file, args, extra = {}) {
  if (!file) return null;
  const input = sourceFromArgs({ path: file });
  return parseConnector({
    kind,
    input,
    property: extra.property,
    site: args.site,
    startDate: args.start_date,
    endDate: args.end_date,
    maxRows: extra.maxRows,
  });
}

try {
  const args = parseArgs(process.argv.slice(2));
  const gsc = parseOptional('gsc', args.gsc, args, { property: args.gsc_property, maxRows: numberArg(args, 'gsc_max_rows', 50000) });
  const ga4 = parseOptional('ga4', args.ga4, args, { property: args.ga4_property, maxRows: numberArg(args, 'ga4_max_rows', 20000) });
  const screamingFrog = parseOptional('screaming_frog', args.screaming_frog, args, { maxRows: numberArg(args, 'sf_max_rows', 50000) });
  if (!gsc && !ga4 && !screamingFrog) throw new Error('Cần ít nhất một trong --gsc, --ga4 hoặc --screaming-frog.');
  const bundle = makeEvidenceBundle({ site: args.site, gsc, ga4, screamingFrog });
  const written = writeEvidenceBundle(bundle, args.out);
  console.log(JSON.stringify({ ...written, next: 'Nạp đường dẫn này vào backend.py init --evidence.' }, null, 2));
} catch (error) {
  console.error(`Connector bridge lỗi: ${error.message}`);
  console.error(USAGE);
  process.exitCode = 1;
}
