// Local stand-in for Vercel: serves public/ and api/*.js with Vercel-style req.body / res.status().json().
// usage: node dev-server.mjs   (reads APP_USERS / SESSION_SECRET / PSI_KEY from .env.local if present)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

process.chdir(path.dirname(fileURLToPath(import.meta.url)));

if (fs.existsSync('.env.local'))
  for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }

const PORT = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  if (url.pathname.startsWith('/api/')) {
    const file = path.join('api', url.pathname.slice(5) + '.js');
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'not found' });
    let raw = '';
    for await (const c of req) raw += c;
    try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
    const mod = await import(pathToFileURL(path.resolve(file)).href);
    if (mod.default) return mod.default(req, res);
    // Web-standard handlers (export async function POST(request) → Response), e.g. api/mcp.js
    const fn = mod[req.method];
    if (!fn) return res.status(405).json({ error: 'method not allowed' });
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
    const out = await fn(new Request(new URL(req.url, `http://${req.headers.host}`), { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw }));
    const buf = Buffer.from(await out.arrayBuffer());
    res.statusCode = out.status;
    out.headers.forEach((v, k) => { if (!/^(content-length|transfer-encoding|connection)$/i.test(k)) res.setHeader(k, v); });
    return res.end(buf);
  }
  const f = path.join('public', url.pathname === '/' ? 'index.html' : url.pathname);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) { res.setHeader('Content-Type', f.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream'); return res.end(fs.readFileSync(f)); }
  res.status(404).end('not found');
}).listen(PORT, () => console.log(`dev server http://localhost:${PORT}`));
