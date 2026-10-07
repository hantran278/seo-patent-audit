// SSRF guard: only allow public http(s) hosts on standard ports. Enabled when process.env.SSRF_GUARD === '1' (the web app).
import dns from 'node:dns/promises';
import net from 'node:net';

const cache = new Map();

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::1' || x === '::' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe80') || x.startsWith('::ffff:') && isPrivateIp(x.slice(7));
}

export async function isAllowedUrl(url) {
  if (process.env.SSRF_GUARD !== '1') return true;
  let u;
  try { u = new URL(url); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || (u.port && !['80', '443'].includes(u.port))) return false;
  const host = u.hostname;
  if (/^(localhost|.*\.local|.*\.internal|metadata\.google\.internal)$/i.test(host)) return false;
  if (cache.has(host)) return cache.get(host);
  let ok = false;
  try {
    const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch { ok = false; }
  cache.set(host, ok);
  return ok;
}
