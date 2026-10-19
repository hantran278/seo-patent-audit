import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { makeEvidenceBundle, normalizeGa4, normalizeGsc, normalizeScreamingFrog, parseConnector, sourceFromArgs, writeEvidenceBundle } from '../lib/connectors.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'enosta-connectors-'));
process.env.ENOSTA_CONNECTOR_OUTPUT_ROOTS = tmp;

const gsc = normalizeGsc([
  { 'Top queries': 'máy soi da', 'Top pages': 'https://enosta.com/may-soi', Clicks: '10', Impressions: '100', CTR: '10%', Position: '4', Date: '2026-10-01' },
  { 'Top queries': 'máy soi da', 'Top pages': 'https://enosta.com/other', Clicks: '2', Impressions: '20', CTR: '10%', Position: '8', Date: '2026-10-02' },
], { property: 'sc-domain:enosta.com' });
assert.equal(gsc.rows.length, 2);
assert.equal(gsc.rows[0].ctr, 0.1);
assert.equal(gsc.date_range.start, '2026-10-01');

const ga4 = normalizeGa4([
  { landingPage: '/may-soi', hostName: 'enosta.com', sessions: '100', engagedSessions: '50', engagementRate: '50%', keyEvents: '3', averageSessionDuration: '42' },
  { path: '/other', host: 'enosta.com', sessions: 20, engagedSessions: 5, keyEvents: 0 },
], { property: 'properties/123' });
assert.equal(ga4.rows.length, 2);
assert.equal(ga4.rows[0].engagementRate, 0.5);
assert.equal(ga4.rows[0].url, 'https://enosta.com/may-soi');
assert.equal(ga4.rows[0].avgDuration, 42);

const sf = normalizeScreamingFrog([
  { Address: 'https://enosta.com/may-soi', 'Content Type': 'text/html', 'Status Code': '200', Indexability: 'Indexable', 'Title 1': 'Máy soi da', 'H1-1': 'Máy soi da', 'Word Count': '900', 'Unique Inlinks': '4', 'Crawl Depth': '2' },
  { Address: 'https://enosta.com/old', 'Content Type': 'text/html', 'Status Code': '404', Indexability: 'Non-Indexable' },
]);
assert.equal(sf.rows.length, 2);
assert.equal(sf.rows[1].status, 404);
assert.equal(sf.rows[0].indexable, true);
const counts = normalizeGsc([{query:'mvp',page:'https://enosta.com/a',clicks:'1,000',impressions:'10,000',position:'4,2'}]);
assert.equal(counts.rows[0].clicks, 1000);
assert.equal(counts.rows[0].impressions, 10000);
assert.equal(counts.rows[0].position, 4.2);
assert.equal(normalizeGsc([{query:'mvp',page:'https://enosta.com/a',clicks:'1.000',impressions:'10.000',position:4}]).rows[0].clicks, 1000);
assert.throws(() => normalizeGa4([{path:'/a',sessions:'bad'}]), /sessions/);
assert.throws(() => normalizeGsc([{query:'mvp',page:'https://enosta.com/a',clicks:'bad',impressions:10,position:4}]), /số liệu/);
const missingGa = normalizeGa4([{path:'/a',sessions:10}], {site:'https://enosta.com'}).rows[0];
assert.equal(missingGa.engagedSessions, null);
assert.equal(missingGa.engagementRate, null);
assert.equal(missingGa.keyEvents, null);
assert.equal(missingGa.url, 'https://enosta.com/a');
assert.equal(missingGa.host_inferred, true);
const booleanSf = normalizeScreamingFrog([{url:'https://enosta.com/a',indexable:false}]).rows[0];
assert.equal(booleanSf.indexable, false);
assert.equal(booleanSf.status, null);

const gscPath = path.join(tmp, 'gsc.csv');
fs.writeFileSync(gscPath, 'Query,Page,Clicks,Impressions,CTR,Position\nfoo,https://enosta.com/foo,1,10,10%,5\n', 'utf8');
const parsed = parseConnector({ kind: 'gsc', input: sourceFromArgs({ path: gscPath }), property: 'sc-domain:enosta.com' });
const bundle = makeEvidenceBundle({ site: 'https://enosta.com', gsc: parsed });
const written = writeEvidenceBundle(bundle);
assert.equal(fs.existsSync(written.path), true);
assert.equal(bundle.sources.gsc.total_rows, 1);

const cliOut = path.join(tmp, 'cli-bundle.json');
const cli = spawnSync(process.execPath, [path.join(process.cwd(), 'connector-bridge.mjs'), '--gsc', gscPath, '--out', cliOut], { encoding: 'utf8' });
assert.equal(cli.status, 0, cli.stderr);
assert.equal(JSON.parse(cli.stdout).sources.gsc.rows, 1);
assert.equal(fs.existsSync(cliOut), true);

assert.throws(() => sourceFromArgs({ path: path.join(tmp, '.env.mcp-tokens.txt') }), /credential/);
assert.throws(() => sourceFromArgs({ path: gscPath }, true), /remote/);
console.log('PASS: GSC, GA4, Screaming Frog normalization, bundle hash/output and path guards.');
