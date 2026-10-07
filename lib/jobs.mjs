// Multi-batch crawl jobs: the crawl state lives in the private Vercel Blob store between serverless calls.
// Env: BLOB_READ_WRITE_TOKEN (added by `vercel blob create-store … --access private`).
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { put, get, del, list } from '@vercel/blob';

const PREFIX = 'crawl-jobs/';
export const jobsAvailable = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const newJobId = () => crypto.randomBytes(16).toString('hex');
const pathOf = (id) => {
  if (!/^[a-f0-9]{32}$/.test(String(id))) throw new Error('Mã đợt crawl không hợp lệ.');
  return `${PREFIX}${id}.json.gz`;
};

export async function saveJob(id, job) {
  const body = gzipSync(Buffer.from(JSON.stringify(job)), { level: 6 });
  await put(pathOf(id), body, { access: 'private', allowOverwrite: true, addRandomSuffix: false, contentType: 'application/gzip', multipart: body.length > 8 * 1024 * 1024 });
  return body.length;
}

export async function loadJob(id) {
  const r = await get(pathOf(id), { access: 'private', useCache: false });
  if (!r) return null;
  const chunks = [];
  for await (const c of r.stream) chunks.push(Buffer.from(c));
  return JSON.parse(gunzipSync(Buffer.concat(chunks)).toString('utf8'));
}

export async function deleteJob(id) {
  try { await del(pathOf(id)); } catch {}
}

// remove jobs nobody finished (closed tab etc.) after a day
export async function cleanupJobs(maxAgeMs = 24 * 3600 * 1000) {
  try {
    const { blobs } = await list({ prefix: PREFIX, limit: 100 });
    const old = blobs.filter((b) => Date.now() - new Date(b.uploadedAt).getTime() > maxAgeMs).map((b) => b.url);
    if (old.length) await del(old);
  } catch {}
}
