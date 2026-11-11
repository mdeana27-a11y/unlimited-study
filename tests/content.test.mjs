import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs'; import path from 'path';
const require = createRequire(import.meta.url);
const { makeApp, client, ADMIN } = require('./helpers');
const S = { name: 'احمد بلال اسماعيل عبدالرحمن', code: '2570010' };
const S2 = { name: 'ابراهيم احمد رمضان احمد', code: '2570001' };
const PDF = Buffer.from('%PDF-1.4 test file');

let t, admin, stu, stu2;
beforeAll(async () => {
  t = await makeApp();
  admin = await client(t.app); await admin.post('/api/auth/admin').send(ADMIN);
  stu = await client(t.app); await stu.post('/api/auth/login').send(S);
  stu2 = await client(t.app); await stu2.post('/api/auth/login').send(S2);
});
const subj = slug => t.repo.subjectBySlug(slug);

describe('authorization', () => {
  it('seeds exactly the 8 subjects with the specified doctors/TAs and tabs rules', () => {
    const all = t.repo.subjects(); expect(all).toHaveLength(8);
    expect(subj('data-engineering')).toMatchObject({ doctor_name: 'د. هند ذياده', ta_names: 'م. محمد إبراهيم' });
    expect(subj('history-of-technology')).toMatchObject({ has_sections: 0, has_tasks: 0 });
    expect(subj('health-safety')).toMatchObject({ has_sections: 0, has_tasks: 0 });
    expect(subj('subject-8').title_ar).toContain('قريباً');
  });
  it('anonymous users get 401 everywhere that matters', async () => {
    const anon = await client(t.app);
    for (const u of ['/api/subjects', '/api/subjects/expert-systems', '/api/announcements', '/api/files/1', '/api/admin/overview', '/api/admin/logs', '/api/admin/roster'])
      expect((await anon.get(u)).status, u).toBe(401);
  });
  it('a student gets 403 on every /api/admin route (reads and writes) and the attempt is logged', async () => {
    for (const u of ['/api/admin/overview', '/api/admin/charts', '/api/admin/logs', '/api/admin/logs.csv', '/api/admin/roster', '/api/admin/stream'])
      expect((await stu.get(u)).status, u).toBe(403);
    expect((await stu.post('/api/admin/lectures').send({ subject_id: 1, title: 'x' })).status).toBe(403);
    expect((await stu.patch('/api/admin/roster/1').send({ is_active: false })).status).toBe(403);
    expect((await stu.del('/api/admin/files/1')).status).toBe(403);
    expect(t.repo.logs({ event: 'admin_denied' }).total).toBeGreaterThan(5);
  });
  it('students cannot see another student’s data: no endpoint exposes roster/logs/other profiles', async () => {
    const me = (await stu.get('/api/me')).body.user; expect(me.code).toBe(S.code);
    expect((await (await client(t.app)).get('/api/me')).body.user).toBeNull();
    const body = JSON.stringify((await stu.get('/api/subjects')).body) + JSON.stringify((await stu.get('/api/subjects/ai')).body);
    expect(body).not.toContain(S2.code); expect(body).not.toContain(S2.name);
  });
});

describe('content + uploads', () => {
  let lectureId, fileId, storedName;
  it('admin creates a lecture and uploads a file; the student sees it with a "new" flag', async () => {
    const s = subj('artificial-intelligence');
    const r = await admin.post('/api/admin/lectures').send({ subject_id: s.id, title: 'مقدمة في الذكاء الاصطناعي', description: 'week 1', week_no: 1 });
    expect(r.status).toBe(201); lectureId = r.body.id;
    const up = await admin.post('/api/admin/files').field('owner_kind', 'lecture').field('owner_id', String(lectureId))
      .attach('files', PDF, { filename: 'محاضرة-1.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201); fileId = up.body.files[0].id;
    const row = t.repo.file(fileId); storedName = row.stored_name;
    expect(row.stored_name).toMatch(/^[a-f0-9]{32}\.pdf$/); expect(row.sha256).toMatch(/^[a-f0-9]{64}$/); expect(row.original_name).toBe('محاضرة-1.pdf');
    expect(fs.existsSync(path.join(t.cfg.UPLOAD_DIR, storedName))).toBe(true);
    expect(path.resolve(t.cfg.UPLOAD_DIR).startsWith(path.resolve(__dirname, '..', 'client'))).toBe(false);   // outside web root
    const list = (await stu.get('/api/subjects')).body.subjects.find(x => x.slug === 'artificial-intelligence');
    expect(list.new_count).toBe(1);   // one new lecture (its files belong to it)
    const hub = (await stu.get('/api/subjects/artificial-intelligence')).body;
    expect(hub.lectures[0]).toMatchObject({ title: 'مقدمة في الذكاء الاصطناعي', is_new: true });
    expect(hub.lectures[0].files[0].id).toBe(fileId);
    const after = (await stu.get('/api/subjects')).body.subjects.find(x => x.slug === 'artificial-intelligence');
    expect(after.new_count).toBe(0);                                         // visit cleared the badge
  });
  it('student downloads it (200, attachment, logged); unauthenticated download is 401', async () => {
    const ok = await stu.get(`/api/files/${fileId}`);
    expect(ok.status).toBe(200); expect(ok.headers['content-disposition']).toMatch(/attachment/); expect(ok.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.from(ok.body).toString()).toContain('%PDF');
    expect((await (await client(t.app)).get(`/api/files/${fileId}`)).status).toBe(401);
    expect(t.repo.logs({ event: 'download_file' }).rows[0]).toMatchObject({ student_code: S.code });
    expect(t.repo.charts().topFiles[0]).toMatchObject({ id: fileId, n: 1 });
  });
  it('rejects disallowed types (.exe, .html, double extension tricks, no extension) and oversize files', async () => {
    const s = subj('artificial-intelligence');
    for (const name of ['evil.exe', 'page.html', 'x.pdf.exe', 'noext', 'shell.php', 'a.svg']) {
      const r = await admin.post('/api/admin/files').field('owner_kind', 'subject').field('owner_id', String(s.id)).attach('files', Buffer.from('x'), name);
      expect(r.status, name).toBe(400);
    }
    const small = await makeApp({ MAX_UPLOAD_MB: '1' }); const a = await client(small.app); await a.post('/api/auth/admin').send(ADMIN);
    const big = await a.post('/api/admin/files').field('owner_kind', 'subject').field('owner_id', '1').attach('files', Buffer.alloc(1.5 * 1024 * 1024), 'big.zip');
    expect(big.status).toBe(413);
    expect(fs.readdirSync(t.cfg.UPLOAD_DIR).filter(f => !f.endsWith('.pdf'))).toHaveLength(0);   // nothing left behind
  });
  it('path traversal: ids only, never paths; poisoned stored_name is refused', async () => {
    expect((await stu.get('/api/files/..%2F..%2F.env')).status).toBe(400);
    expect((await stu.get('/api/files/1%2F..%2F..')).status).toBe(400);
    t.db.prepare("UPDATE files SET stored_name='../../.env' WHERE id=?").run(fileId);
    expect((await stu.get(`/api/files/${fileId}`)).status).toBe(404);
    t.db.prepare('UPDATE files SET stored_name=? WHERE id=?').run(storedName, fileId);
    expect((await stu.get('/api/subjects/..%2F..%2Fetc')).status).toBe(400);
    expect((await stu.get('/api/subjects/nope')).status).toBe(404);
  });
  it('admin edits subject/doctor names, tasks with due dates, announcements (pinned first), and deletion removes files from disk', async () => {
    const s = subj('subject-8');
    expect((await admin.patch(`/api/admin/subjects/${s.id}`).send({ title_ar: 'قواعد البيانات', doctor_name: 'د. جديد', color: '#22D3EE' })).status).toBe(200);
    expect(subj('subject-8').title_ar).toBe('قواعد البيانات');
    expect((await admin.patch(`/api/admin/subjects/${s.id}`).send({ color: 'red' })).status).toBe(400);
    expect((await admin.patch(`/api/admin/subjects/${s.id}`).send({ slug: 'hack' })).status).toBe(400);   // strict schema
    const task = await admin.post('/api/admin/tasks').send({ subject_id: s.id, title: 'تاسك 1', due_at: '2026-12-01' }); expect(task.status).toBe(201);
    const hub8 = await stu.get('/api/subjects/subject-8');     expect(hub8.body.tasks[0].due_at).toBe('2026-12-01');
    await admin.post('/api/admin/announcements').send({ title: 'عادي' }); await admin.post('/api/admin/announcements').send({ title: 'مهم', pinned: true });
    expect((await stu.get('/api/announcements')).body.announcements[0].title).toBe('مهم');
    expect((await admin.del(`/api/admin/lectures/${lectureId}`)).status).toBe(200);
    expect(fs.existsSync(path.join(t.cfg.UPLOAD_DIR, storedName))).toBe(false);
    expect((await stu.get(`/api/files/${fileId}`)).status).toBe(404);
  });
  it('subjects without sections/tasks hide those tabs from the API', async () => {
    const hub = (await stu.get('/api/subjects/history-of-technology')).body;
    expect(hub.sections).toEqual([]); expect(hub.tasks).toEqual([]);
  });
  it('rejects bad payloads with zod (400) and missing CSRF on admin writes (403)', async () => {
    expect((await admin.post('/api/admin/lectures').send({ title: '' })).status).toBe(400);
    expect((await admin.post('/api/admin/lectures').send({ subject_id: 999, title: 'x' })).status).toBe(404);
    expect((await require('supertest').agent(t.app).post('/api/admin/lectures').send({})).status).toBe(403);
  });
});

describe('activity, roster & exports', () => {
  it('admin sees every access in the activity table with filters, and in CSV (formula-injection safe)', async () => {
    const all = (await admin.get('/api/admin/logs?pageSize=100')).body;
    expect(all.total).toBeGreaterThan(10);
    expect(all.rows.some(r => r.event === 'login_success' && r.student_code === S.code && r.method === 'name_code' && r.ip && r.user_agent !== undefined)).toBe(true);
    expect((await admin.get('/api/admin/logs?q=2570010&method=name_code')).body.rows.every(r => r.student_code === '2570010')).toBe(true);
    expect((await admin.get('/api/admin/logs?method=bogus')).status).toBe(400);
    t.repo.log({ actor_type: 'anonymous', event: 'login_fail', method: 'name_code', ip: '1.1.1.1', user_agent: '=HYPERLINK("http://evil")' });
    const csv = await admin.get('/api/admin/logs.csv'); expect(csv.status).toBe(200); expect(csv.headers['content-type']).toMatch(/csv/);
    expect(csv.text).toContain("\"'=HYPERLINK"); expect(csv.text).not.toContain('"=HYPERLINK');
  });
  it('overview + charts numbers are consistent', async () => {
    const o = (await admin.get('/api/admin/overview')).body;
    expect(o.rosterTotal).toBe(384); expect(o.online).toBeGreaterThanOrEqual(2); expect(o.loginsToday).toBeGreaterThanOrEqual(2); expect(o.everLoggedIn).toBeGreaterThanOrEqual(2);
    const c = (await admin.get('/api/admin/charts')).body; expect(c.perDay).toHaveLength(14); expect(c.perHour).toHaveLength(24);
    expect(c.perHall.some(h => h.hall === 'A1')).toBe(true); expect(c.perSubject.length).toBeGreaterThan(0);
  });
  it('roster: search, never-logged-in filter, deactivate/reactivate, unlink Google', async () => {
    const never = (await admin.get('/api/admin/roster?never=1&pageSize=100')).body; expect(never.total).toBe(384 - 2);
    const found = (await admin.get('/api/admin/roster?q=2570272')).body.rows[0]; expect(found.name).toContain('مصطفى عادل');
    expect((await admin.patch(`/api/admin/roster/${found.id}`).send({ is_active: false })).status).toBe(200);
    expect(t.repo.studentById(found.id).is_active).toBe(0);
    await admin.patch(`/api/admin/roster/${found.id}`).send({ is_active: true });
    t.repo.linkEmail(found.id, 'm@gmail.com'); expect((await admin.post(`/api/admin/roster/${found.id}/unlink`)).status).toBe(200); expect(t.repo.studentById(found.id).email).toBeNull();
    expect(t.repo.logs({ event: 'admin_action' }).total).toBeGreaterThan(5);
  });
  it('retention purge removes only old logs', () => {
    t.db.prepare("UPDATE activity_logs SET ts='2020-01-01T00:00:00.000Z' WHERE id=(SELECT MIN(id) FROM activity_logs)").run();
    const before = t.repo.logs({}).total; expect(t.repo.purgeLogs(12)).toBe(1); expect(t.repo.logs({}).total).toBe(before - 1);
  });
  it('seed is idempotent and keeps admin edits', async () => {
    const { seedAll } = require('../server/seed');
    await seedAll(t.db, t.cfg, { log: () => {} });
    expect(t.db.prepare('SELECT COUNT(*) c FROM students').get().c).toBe(384);
    expect(subj('subject-8').title_ar).toBe('قواعد البيانات');
  });
});
