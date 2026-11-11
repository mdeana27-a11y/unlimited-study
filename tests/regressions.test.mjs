import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { makeApp, client, ADMIN } = require('./helpers');
const { loadConfig } = require('../server/config');
const { cairoDayBoundsUtc } = require('../server/lib/time');
const { toAsciiDigits } = require('../server/lib/arabic');

const S = { name: 'احمد بلال اسماعيل عبدالرحمن', code: '2570010' };
const S2 = { name: 'ابراهيم احمد رمضان احمد', code: '2570001' };

describe('config', () => {
  const base = { NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(40) };
  it('treats blank KEY= lines (as copied from .env.example / docker env_file) as unset instead of failing', () => {
    const cfg = loadConfig({ ...base, ADMIN_PASSWORD: '', ADMIN_TOTP_SECRET: '', GOOGLE_CLIENT_ID: '', COOKIE_SECURE: '' });
    expect(cfg.ADMIN_PASSWORD).toBeUndefined(); expect(cfg.ADMIN_TOTP_SECRET).toBeUndefined(); expect(cfg.GOOGLE_CLIENT_ID).toBeNull();
  });
  it('still rejects genuinely bad values', () => {
    expect(() => loadConfig({ ...base, ADMIN_PASSWORD: 'short' })).toThrow(/ADMIN_PASSWORD/);
    expect(() => loadConfig({ ...base, ADMIN_TOTP_SECRET: 'not base32!' })).toThrow(/ADMIN_TOTP_SECRET/);
    expect(() => loadConfig({ NODE_ENV: 'test', SESSION_SECRET: '' })).toThrow(/SESSION_SECRET/);
  });
});

describe('Cairo day boundaries (DST-aware)', () => {
  it('summer is UTC+3, winter is UTC+2, and a day is [start, next start)', () => {
    expect(cairoDayBoundsUtc('2026-07-10')).toEqual(['2026-07-09T21:00:00.000Z', '2026-07-10T21:00:00.000Z']);
    expect(cairoDayBoundsUtc('2026-01-15')).toEqual(['2026-01-14T22:00:00.000Z', '2026-01-15T22:00:00.000Z']);
    expect(cairoDayBoundsUtc('2026-12-31')[1]).toBe('2026-12-31T22:00:00.000Z');   // month/year roll-over
  });
});

describe('Arabic-Indic digits', () => {
  it('toAsciiDigits converts Arabic-Indic and Persian digits only', () => {
    expect(toAsciiDigits('٢٥٧٠٠١٠')).toBe('2570010'); expect(toAsciiDigits('۲۵۷۰۰۱۰')).toBe('2570010'); expect(toAsciiDigits('abc٣')).toBe('abc3');
  });
});

describe('behaviour fixes', () => {
  let t, admin, stu;
  beforeAll(async () => {
    t = await makeApp();
    admin = await client(t.app); await admin.post('/api/auth/admin').send(ADMIN);
    stu = await client(t.app);
  });

  it('student can sign in with the code typed in Arabic-Indic digits', async () => {
    const r = await (await client(t.app)).post('/api/auth/login').send({ name: S.name, code: '٢٥٧٠٠١٠' });
    expect(r.status).toBe(200); expect(r.body.user.code).toBe('2570010');
    expect((await (await client(t.app)).post('/api/auth/login').send({ name: S.name, code: '٢٥٧٠٠١' })).status).toBe(400);   // still must be 7 digits
  });

  it('the login response has the same shape as /api/me (hall included)', async () => {
    const login = (await stu.post('/api/auth/login').send(S)).body.user;
    const me = (await stu.get('/api/me')).body.user;
    expect(login.hall).toBe('A1'); expect(login).toEqual(me);
  });

  it('roster name search ignores hamza / ya / ta-marbuta variants like the login does', async () => {
    const total = async q => (await admin.get('/api/admin/roster?pageSize=100&q=' + encodeURIComponent(q))).body.total;
    const plain = await total('احمد');
    expect(plain).toBeGreaterThan(0);
    expect(await total('أحمد')).toBe(plain);
    expect(await total('مصطفى')).toBe(await total('مصطفي'));
    expect(await total('مصطفى')).toBeGreaterThan(0);
    expect(await total('2570010')).toBe(1);                                   // code search still works
  });

  it('first visit marks lectures AND subject materials as new (same rule), and a second visit clears both', async () => {
    const s = t.repo.subjectBySlug('history-of-technology');
    await admin.post('/api/admin/lectures').send({ subject_id: s.id, title: 'L1', week_no: 1 });
    await admin.post('/api/admin/files').field('owner_kind', 'subject').field('owner_id', String(s.id)).attach('files', Buffer.from('%PDF-1.4'), 'reading.pdf');
    const fresh = await client(t.app); await fresh.post('/api/auth/login').send(S2);
    const first = (await fresh.get('/api/subjects/history-of-technology')).body;
    expect(first.lectures[0].is_new).toBe(true); expect(first.materials[0].is_new).toBe(true);
    const second = (await fresh.get('/api/subjects/history-of-technology')).body;
    expect(second.lectures[0].is_new).toBe(false); expect(second.materials[0].is_new).toBe(false);
    const adminView = (await admin.get('/api/subjects/history-of-technology')).body;   // admins never see "new" badges
    expect(adminView.lectures[0].is_new).toBe(false); expect(adminView.materials[0].is_new).toBe(false);
  });

  it('admin browsing does not inflate the student charts (views and downloads)', async () => {
    const viewsOf = slug => t.repo.charts().perSubject.find(x => x.slug === slug)?.n ?? 0;
    const before = viewsOf('expert-systems');
    await admin.get('/api/subjects/expert-systems'); await admin.get('/api/subjects/expert-systems');
    expect(viewsOf('expert-systems')).toBe(before);
    await stu.get('/api/subjects/expert-systems');
    expect(viewsOf('expert-systems')).toBe(before + 1);
  });

  it('task due dates must be real YYYY-MM-DD days (or empty)', async () => {
    const id = t.repo.subjectBySlug('subject-8').id;
    const post = due_at => admin.post('/api/admin/tasks').send({ subject_id: id, title: 'x', due_at });
    for (const bad of ['not-a-date', '2026-02-30', '2026-13-45', '12/20/2026', '2026-12-01T10:00:00Z']) expect((await post(bad)).status, bad).toBe(400);
    expect((await post('2026-12-01')).status).toBe(201);
    const none = await post(''); expect(none.status).toBe(201);
    expect(t.repo.contentItem('tasks', none.body.id).due_at).toBeNull();
  });

  it('activity date filters use the Cairo calendar day (UTC+3 in July) and reject impossible dates', async () => {
    const put = (code, ts) => { const row = t.repo.log({ actor_type: 'anonymous', event: 'login_fail', method: 'name_code', ip: '1.1.1.1', user_agent: 'x', student_code: code }); t.db.prepare('UPDATE activity_logs SET ts=? WHERE id=?').run(ts, row.id); };
    put('9990001', '2026-07-09T20:30:00.000Z');   // 23:30 Cairo on 9 July
    put('9990002', '2026-07-09T21:30:00.000Z');   // 00:30 Cairo on 10 July
    put('9990003', '2026-07-10T20:59:00.000Z');   // 23:59 Cairo on 10 July
    put('9990004', '2026-07-10T21:00:00.000Z');   // 00:00 Cairo on 11 July
    const codes = async qs => (await admin.get('/api/admin/logs?pageSize=100&q=99900&' + qs)).body.rows.map(r => r.student_code).sort();
    expect(await codes('from=2026-07-10&to=2026-07-10')).toEqual(['9990002', '9990003']);
    expect(await codes('from=2026-07-09&to=2026-07-09')).toEqual(['9990001']);
    expect(await codes('from=2026-07-10T21:00:00.000Z')).toEqual(['9990004']);          // full ISO still works
    const csv = await admin.get('/api/admin/logs.csv?q=99900&from=2026-07-10&to=2026-07-10');
    expect(csv.text).toContain('9990002'); expect(csv.text).not.toContain('9990001'); expect(csv.text).not.toContain('9990004');
    for (const bad of ['from=2026-13-45', 'to=2026-02-30', 'from=garbage']) expect((await admin.get('/api/admin/logs?' + bad)).status, bad).toBe(400);
  });
});
