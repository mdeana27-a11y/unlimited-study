import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const { makeApp, client, ADMIN } = require('./helpers');
const S = { name: 'احمد بلال اسماعيل عبدالرحمن', code: '2570010' };

describe('Path B: name + code', () => {
  let t, c;
  beforeEach(async () => { t = await makeApp(); c = await client(t.app); });

  it('logs in with the exact pair and exposes only that student', async () => {
    const r = await c.post('/api/auth/login').send(S);
    expect(r.status).toBe(200); expect(r.body.user.code).toBe('2570010');
    expect((await c.get('/api/me')).body.user.name).toBe(S.name);
    expect(r.headers['set-cookie'].join(';')).toMatch(/sid=.*HttpOnly.*SameSite=Lax/i);
  });
  it('tolerates hamza / ya / ta-marbuta / spacing variations', async () => {
    const r = await c.post('/api/auth/login').send({ name: 'أحمد بلال إسماعيل عبد الرحمن', code: '2570010' });
    expect(r.status).toBe(200);
    const c2 = await client(t.app);
    expect((await c2.post('/api/auth/login').send({ name: 'مصطفى عادل سعد مصطفى خميس', code: '2570272' })).status).toBe(200);
  });
  it('fails with the SAME generic answer for wrong name, wrong code and unknown code', async () => {
    const a = await c.post('/api/auth/login').send({ ...S, name: 'احمد بلال اسماعيل عبدالله' });
    const b = await c.post('/api/auth/login').send({ ...S, code: '2570011' });
    const u = await c.post('/api/auth/login').send({ ...S, code: '9999999' });
    for (const r of [a, b, u]) { expect(r.status).toBe(401); expect(r.body).toEqual({ error: 'invalid_credentials' }); }
  });
  it('requires CSRF on state-changing requests', async () => {
    const r = await require('supertest')(t.app).post('/api/auth/login').send(S);
    expect(r.status).toBe(403); expect(r.body.error).toBe('csrf');
  });
  it('validates input with zod (code must be 7 digits, any prefix)', async () => {
    expect((await c.post('/api/auth/login').send({ name: S.name, code: '12' })).status).toBe(400);
    expect((await c.post('/api/auth/login').send({ name: S.name })).status).toBe(400);
  });
  it('progressive lockout per code: 5 failures lock even the right name (429), and are logged', async () => {
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login').send({ ...S, name: 'خطأ خطأ خطأ خطأ' });
    const r = await c.post('/api/auth/login').send(S);
    expect(r.status).toBe(429); expect(r.body.error).toBe('locked');
    expect(t.repo.logs({ event: 'login_fail' }).total).toBeGreaterThanOrEqual(6);
  });
  it('per-IP rate limiter returns 429', async () => {
    const t2 = await makeApp({ RATE_LIMIT_AUTH: '3' }); const c2 = await client(t2.app);
    const codes = []; for (let i = 0; i < 5; i++) codes.push((await c2.post('/api/auth/login').send({ name: 'ابراهيم احمد رمضان احمد', code: '25700' + String(i).padStart(2, '0') + '9' })).status);
    expect(codes).toContain(429);
  });
  it('rotates the session on login and revokes it on logout', async () => {
    await c.post('/api/auth/login').send(S);
    const first = t.db.prepare('SELECT id FROM sessions').all();
    await c.post('/api/auth/login').send(S);
    expect(t.db.prepare('SELECT COUNT(*) c FROM sessions WHERE revoked_at IS NULL').get().c).toBe(1);
    expect(first[0].id).not.toBe(t.db.prepare('SELECT id FROM sessions WHERE revoked_at IS NULL').get().id);
    await c.post('/api/auth/logout'); expect((await c.get('/api/me')).body.user).toBeNull();
  });
  it('deactivated students cannot log in and lose their sessions', async () => {
    await c.post('/api/auth/login').send(S);
    t.repo.setActive(t.repo.studentByCode(S.code).id, false);
    expect((await c.get('/api/me')).body.user).toBeNull();
    expect((await (await client(t.app)).post('/api/auth/login').send(S)).status).toBe(401);
  });
  it('every success and failure shows up in the activity log with ip, browser and method', async () => {
    await c.agent.post('/api/auth/login').set('X-CSRF-Token', c.csrf).set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537').send({ ...S, name: 'غلط غلط غلط' });
    await c.agent.post('/api/auth/login').set('X-CSRF-Token', c.csrf).set('User-Agent', 'Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537').send(S);
    const rows = t.repo.logs({}).rows.filter(r => r.event.startsWith('login_'));
    expect(rows.map(r => r.event).sort()).toEqual(['login_fail', 'login_success']);
    const ok = rows.find(r => r.event === 'login_success');
    expect(ok).toMatchObject({ student_code: S.code, student_name: S.name, method: 'name_code' });
    expect(ok.ip).toBeTruthy(); expect(JSON.parse(ok.meta_json)).toMatchObject({ browser: 'Chrome', os: 'Android' });
  });
  it('sessions expire after the idle timeout', async () => {
    await c.post('/api/auth/login').send(S);
    t.db.prepare("UPDATE sessions SET last_seen_at=?").run(new Date(Date.now() - 3 * 3600e3).toISOString());
    expect((await c.get('/api/me')).body.user).toBeNull();
  });
});

describe('Path A: Google (server-side verification)', () => {
  const verifier = async cred => { if (cred.startsWith('good-')) return { email: cred.slice(5) + '@gmail.com' }; throw new Error('bad'); };
  it('rejects forged tokens; unlinked Gmail gets no session and sees nothing; link then login works', async () => {
    const t = await makeApp({}, { googleVerifier: verifier }); const c = await client(t.app);
    expect((await c.post('/api/auth/google').send({ credential: 'forged-token-forged-token' })).status).toBe(401);
    const r = await c.post('/api/auth/google').send({ credential: 'good-ahmed1234567890123' });
    expect(r.body.needsLink).toBe(true); expect((r.headers['set-cookie'] || []).join('')).not.toMatch(/sid=/);
    expect((await c.get('/api/subjects')).status).toBe(401);
    expect((await c.post('/api/auth/google/link').send({ linkToken: 'tampered.token', ...S })).status).toBe(401);
    expect((await c.post('/api/auth/google/link').send({ linkToken: r.body.linkToken, name: 'غلط غلط غلط', code: S.code })).status).toBe(401);
    expect((await c.post('/api/auth/google/link').send({ linkToken: r.body.linkToken, ...S })).status).toBe(200);
    const c2 = await client(t.app);
    const again = await c2.post('/api/auth/google').send({ credential: 'good-ahmed1234567890123' });
    expect(again.status).toBe(200); expect(again.body.user.code).toBe(S.code);
    expect(t.repo.logs({ method: 'google' }).rows.some(x => x.event === 'login_success' && x.email === 'ahmed1234567890123@gmail.com')).toBe(true);
  });
  it('a second Gmail cannot claim an already-linked student', async () => {
    const t = await makeApp({}, { googleVerifier: verifier }); const c = await client(t.app);
    const a = await c.post('/api/auth/google').send({ credential: 'good-first-account-aaaaaaaa' });
    await c.post('/api/auth/google/link').send({ linkToken: a.body.linkToken, ...S });
    const c2 = await client(t.app); const b = await c2.post('/api/auth/google').send({ credential: 'good-second-account-bbbbbbb' });
    expect((await c2.post('/api/auth/google/link').send({ linkToken: b.body.linkToken, ...S })).status).toBe(409);
  });
  it('is disabled (501) when no client id / verifier is configured', async () => {
    const t = await makeApp(); const c = await client(t.app);
    expect((await c.post('/api/auth/google').send({ credential: 'x'.repeat(30) })).status).toBe(501);
  });
});

describe('Admin', () => {
  it('logs in with argon2 password; wrong password fails generically; 2FA enforced when configured', async () => {
    const t = await makeApp(); const c = await client(t.app);
    expect((await c.post('/api/auth/admin').send({ email: ADMIN.email, password: 'wrong-password-1' })).status).toBe(401);
    expect((await c.post('/api/auth/admin').send({ email: 'nobody@x.com', password: 'wrong-password-1' })).body.error).toBe('invalid_credentials');
    const ok = await c.post('/api/auth/admin').send(ADMIN); expect(ok.status).toBe(200); expect(ok.body.user.type).toBe('admin');
    expect(t.db.prepare('SELECT password_hash h FROM admins').get().h).toMatch(/^\$argon2id\$/);
    const { totpAt } = require('../server/lib/crypto'); const secret = 'JBSWY3DPEHPK3PXP';
    const t2 = await makeApp({ ADMIN_TOTP_SECRET: secret }); const c2 = await client(t2.app);
    expect((await c2.post('/api/auth/admin').send(ADMIN)).status).toBe(401);
    expect((await c2.post('/api/auth/admin').send({ ...ADMIN, totp: totpAt(secret, Date.now()) })).status).toBe(200);
  });
  it('admin login has its own stricter lockout (3 failures)', async () => {
    const t = await makeApp(); const c = await client(t.app);
    for (let i = 0; i < 3; i++) await c.post('/api/auth/admin').send({ email: ADMIN.email, password: 'wrong-password-1' });
    expect((await c.post('/api/auth/admin').send(ADMIN)).status).toBe(429);
  });
});
