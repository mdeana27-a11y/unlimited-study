const crypto = require('crypto');
const sha256 = s => crypto.createHash('sha256').update(s).digest('hex');
const randomToken = (n = 32) => crypto.randomBytes(n).toString('base64url');
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('base64url');
function safeEqual(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
// Short-lived signed blobs (Google link token, CSRF token) — no extra dependency needed.
function signBlob(secret, payload, ttlSec) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + ttlSec * 1000 })).toString('base64url');
  return `${body}.${hmac(secret, body)}`;
}
function openBlob(secret, token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig || !safeEqual(sig, hmac(secret, body))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() ? p : null;
}
// RFC 6238 TOTP (SHA-1, 6 digits, 30 s) for the optional admin 2FA.
function b32decode(s) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = '';
  for (const ch of s.replace(/=+$/, '')) bits += A.indexOf(ch).toString(2).padStart(5, '0');
  return Buffer.from(bits.match(/.{8}/g).map(b => parseInt(b, 2)));
}
function totpAt(secret, t) {
  const msg = Buffer.alloc(8); msg.writeBigUInt64BE(BigInt(Math.floor(t / 30000)));
  const h = crypto.createHmac('sha1', b32decode(secret)).update(msg).digest();
  const o = h[19] & 15;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1e6)).padStart(6, '0');
}
const verifyTotp = (secret, code, now = Date.now()) =>
  [-1, 0, 1].some(w => safeEqual(totpAt(secret, now + w * 30000), String(code)));
module.exports = { sha256, randomToken, hmac, safeEqual, signBlob, openBlob, verifyTotp, totpAt };
