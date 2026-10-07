export function normalizeUrl(u, base) {
  try {
    const x = new URL(u, base);
    if (!/^https?:$/.test(x.protocol)) return null;
    x.hash = '';
    return x.href;
  } catch {
    return null;
  }
}

// Vietnamese + English stopwords for term statistics
export const STOP = new Set(
  ('và của là có cho các được trong một những với này không để đã khi từ người như thì cũng đến về theo tại nhiều hơn rất lại nên nếu vì mà đó ra sẽ bạn chúng tôi họ nó còn đang hay hoặc bị do trên dưới sau trước giữa vào làm năm ngày mới cách gì nào ai đây kia thế sao vậy chỉ mỗi mọi toàn bộ phải cần có_thể ' +
   'the a an and or of to in on for with is are was were be been by at as from that this it its not but if then so than can will your you we our they their he she his her them us more most all any some such')
    .split(/\s+/)
);

export function tokenize(text) {
  return (text || '').toLowerCase().normalize('NFC').split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !/^\d+$/.test(w));
}

// 64-bit simhash over word 3-shingles (BigInt)
function hash64(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
    h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
  }
  return (BigInt(h1) << 32n) | BigInt(h2);
}
export function simhash(text) {
  const w = tokenize(text);
  if (w.length < 20) return null;
  const v = new Array(64).fill(0);
  for (let i = 0; i + 2 < w.length; i++) {
    const h = hash64(w[i] + ' ' + w[i + 1] + ' ' + w[i + 2]);
    for (let b = 0; b < 64; b++) v[b] += (h >> BigInt(b)) & 1n ? 1 : -1;
  }
  let out = 0n;
  for (let b = 0; b < 64; b++) if (v[b] > 0) out |= 1n << BigInt(b);
  return out;
}
export function hamming(a, b) {
  let x = a ^ b, c = 0;
  while (x) { x &= x - 1n; c++; }
  return c;
}

export const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
