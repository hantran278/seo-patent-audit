// Remote MCP endpoint (Streamable HTTP, stateless, JSON responses) for Claude / ChatGPT connectors.
// Web-standard handler (Request → Response): Vercel does the HTTP framing itself.
// Auth: MCP_TOKENS="ten1:token1;ten2:token2" — token sent as "Authorization: Bearer <token>" or ?key=<token>.
import crypto from 'node:crypto';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from '../lib/mcp.mjs';

export const config = { maxDuration: 300 };
process.env.SSRF_GUARD = '1';

const rpcError = (status, code, message) => Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status });

function tokenOwner(request) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim() || new URL(request.url).searchParams.get('key') || '';
  if (!given) return null;
  for (const entry of (process.env.MCP_TOKENS || '').split(';').map((s) => s.trim()).filter(Boolean)) {
    const i = entry.indexOf(':');
    const [name, tok] = i > 0 ? [entry.slice(0, i), entry.slice(i + 1)] : ['mcp', entry];
    const a = Buffer.from(tok), b = Buffer.from(given);
    if (tok.length >= 24 && a.length === b.length && crypto.timingSafeEqual(a, b)) return name;
  }
  return null;
}

export async function POST(request) {
  const who = tokenOwner(request);
  if (!who) return rpcError(401, -32001, 'Thiếu hoặc sai MCP token.');
  let body;
  try { body = await request.json(); } catch { return rpcError(400, -32700, 'JSON không hợp lệ.'); }
  if (body?.method === 'tools/call') console.log(`[mcp] ${who} → ${body.params?.name} ${JSON.stringify(body.params?.arguments || {}).slice(0, 200)}`);
  const server = createServer({ remote: true });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    const out = await transport.handleRequest(request, { parsedBody: body });
    // re-emit as a plain buffered response so no hop-by-hop header from the transport leaks through
    const text = await out.text();
    const headers = new Headers();
    out.headers.forEach((v, k) => { if (!/^(transfer-encoding|content-length|connection)$/i.test(k)) headers.set(k, v); });
    return new Response(text, { status: out.status, headers });
  } finally {
    await transport.close(); await server.close();
  }
}

export async function GET(request) {
  if (!tokenOwner(request)) return rpcError(401, -32001, 'Thiếu hoặc sai MCP token.');
  return rpcError(405, -32000, 'Server MCP này là stateless: chỉ hỗ trợ POST.');
}
export const DELETE = GET;
