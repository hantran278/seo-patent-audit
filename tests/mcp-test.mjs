// Test the MCP endpoint with raw JSON-RPC over HTTP (same calls Claude / ChatGPT connectors make).
// usage: node tests/mcp-test.mjs <baseUrl> <token> [quick]
import http from 'node:http';
import https from 'node:https';
const [base = 'http://127.0.0.1:3009', token = '', quick] = process.argv.slice(2);
const endpoint = /\/api\/mcp$/.test(base) || /:3009$/.test(base) ? base : base + '/api/mcp';
let id = 0;
// one connection per call (no keep-alive): the local sandbox's loopback proxy mangles reused connections
const agent = new (endpoint.startsWith('https') ? https : http).Agent({ keepAlive: false });
function rpc(method, params, auth = true) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: id++, method, params });
  return new Promise((resolve, reject) => {
    const req = (endpoint.startsWith('https') ? https : http).request(endpoint, { method: 'POST', agent, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), Accept: 'application/json, text/event-stream', ...(auth ? { Authorization: 'Bearer ' + token, 'MCP-Protocol-Version': '2025-06-18' } : {}) } }, (res) => {
      let t = ''; res.setEncoding('utf8'); res.on('data', (d) => (t += d)); res.on('end', () => resolve({ status: res.statusCode, json: t ? JSON.parse(t) : null }));
    });
    req.on('error', reject); req.setTimeout(320000); req.end(body);
  });
}
console.log('no token →', (await rpc('tools/list', {}, false)).status);
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
console.log('initialize →', init.status, init.json.result?.serverInfo?.name, init.json.result?.protocolVersion);
const list = await rpc('tools/list', {});
console.log('tools:', list.json.result.tools.map((t) => `${t.name}(${Object.keys(t.inputSchema.properties || {}).join(',')})`).join(' · '));
const call = async (name, args, n = 600) => {
  const t = Date.now();
  const r = await rpc('tools/call', { name, arguments: args });
  const res = r.json.result || {};
  console.log(`\n== ${name} ${JSON.stringify(args)} → ${r.status} ${Math.round((Date.now() - t) / 1000)}s${res.isError ? ' ERROR' : ''} · ${res.content?.[0]?.text?.length || 0} ký tự\n` + (res.content?.[0]?.text || JSON.stringify(r.json)).slice(0, n));
};
await call('find_patent', { query: 'nội dung mỏng' }, 350);
await call('find_patent', { query: 'US8682892B1' }, 200);
await call('check_page', { url: 'https://books.toscrape.com/' }, 450);
await call('check_page', { url: 'http://127.0.0.1/' }, 200);
if (!quick) await call('audit_site', { url: 'books.toscrape.com', max_pages: 15 }, 1800);
