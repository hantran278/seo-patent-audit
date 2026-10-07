// Generate team accounts + session secret for the web app. Run it yourself; values are printed only to your terminal.
// usage: node gen-users.mjs an binh chi
import crypto from 'node:crypto';

const names = process.argv.slice(2);
if (!names.length) { console.log('Cách dùng: node gen-users.mjs <tên1> <tên2> ...'); process.exit(1); }
const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const pw = () => Array.from(crypto.randomBytes(14), (b) => alphabet[b % alphabet.length]).join('');
const users = names.map((n) => [n.toLowerCase(), pw()]);

console.log('\nTài khoản (gửi riêng cho từng người):');
for (const [u, p] of users) console.log(`  ${u.padEnd(12)} ${p}`);
console.log('\nBiến môi trường cho Vercel (Settings → Environment Variables → Production):');
console.log(`  APP_USERS      = ${users.map(([u, p]) => `${u}:${p}`).join(';')}`);
console.log(`  SESSION_SECRET = ${crypto.randomBytes(32).toString('hex')}`);
console.log('  PSI_KEY        = <API key PageSpeed Insights của bạn> (không bắt buộc)\n');
