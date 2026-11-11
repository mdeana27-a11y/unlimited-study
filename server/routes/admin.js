const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { cairoDayBoundsUtc } = require('../lib/time');

const ALLOWED = new Set(['pdf', 'pptx', 'docx', 'xlsx', 'zip', 'png', 'jpg', 'jpeg', 'mp4', 'txt', 'ipynb']);
const ICONS = ['book', 'brain', 'database', 'cpu', 'globe', 'chart', 'clock', 'shield', 'sparkles'];
const optStr = (n) => z.string().trim().max(n).nullish().transform(v => v || null);
const idParam = z.object({ id: z.coerce.number().int().positive() });
const KIND = z.enum(['lectures', 'sections', 'tasks']);
// Generic content routes only claim real kinds; anything else (files, announcements, …) falls through to its own route.
const kindOnly = (req, _res, next) => KIND.safeParse(req.params.kind).success ? next() : next('route');
const kindIdParam = z.object({ kind: KIND, id: z.coerce.number().int().positive() });

// 'YYYY-MM-DD' and a real calendar day (rejects 2026-02-30, which Date.parse would silently roll over).
const isRealDay = s => { const d = new Date(s + 'T00:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s); };
const dayKey = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDay);
const contentBody = z.object({ subject_id: z.coerce.number().int().positive().optional(), title: z.string().trim().min(1).max(200),
  description: optStr(5000), week_no: z.coerce.number().int().min(0).max(60).nullish().transform(v => v ?? null),
  due_at: z.union([z.literal(''), dayKey]).nullish().transform(v => v || null) });

module.exports = function adminRoutes({ cfg, repo, mw, bus }) {
  const r = express.Router();
  r.use(mw.requireAdmin);
  const audit = (req, action, meta) => mw.logEvent(req, { event: 'admin_action', meta: { action, ...meta } });

  // ── live feed (Server-Sent Events) ──
  r.get('/stream', (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    const send = (ev, d) => res.write(`event: ${ev}\ndata: ${JSON.stringify(d)}\n\n`);
    const onLog = row => send('log', row);
    bus.on('log', onLog);
    send('online', { online: repo.onlineStudents() });
    const t = setInterval(() => send('online', { online: repo.onlineStudents() }), 10e3);
    const hb = setInterval(() => res.write(': hb\n\n'), 25e3);
    req.on('close', () => { clearInterval(t); clearInterval(hb); bus.off('log', onLog); });
  });

  r.get('/overview', (_q, res) => res.json(repo.overview()));
  r.get('/charts', (_q, res) => res.json(repo.charts()));

  // ── activity ──
  // from/to: a plain 'YYYY-MM-DD' means that Cairo calendar day (DST-aware); a full ISO timestamp is still accepted.
  const tsParam = z.string().max(40).refine(v => dayKey.safeParse(v).success || (/T/.test(v) && !Number.isNaN(Date.parse(v))));
  const dayRange = q => ({ ...q, from: dayKey.safeParse(q.from).success ? cairoDayBoundsUtc(q.from)[0] : q.from, to: dayKey.safeParse(q.to).success ? cairoDayBoundsUtc(q.to)[1] : q.to });
  const logQuery = z.object({ q: z.string().trim().max(80).optional(), from: tsParam.optional(), to: tsParam.optional(),
    method: z.enum(['google', 'name_code', 'admin']).optional(), event: z.string().max(40).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(25) });
  r.get('/logs', mw.validate(logQuery, 'query'), (req, res) => res.json(repo.logs(dayRange(req.query))));
  const csvCell = v => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };  // blocks CSV/formula injection
  r.get('/logs.csv', mw.validate(logQuery, 'query'), (req, res) => {
    const { rows } = repo.logs({ ...dayRange(req.query), all: true });
    audit(req, 'export_logs', { rows: rows.length });
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="activity-logs.csv"' });
    const head = ['time_utc', 'actor', 'student_code', 'student_name', 'email', 'event', 'method', 'ip', 'user_agent', 'path'];
    res.send('\uFEFF' + [head.join(','), ...rows.map(x => [x.ts, x.actor_type, x.student_code, x.student_name, x.email, x.event, x.method, x.ip, x.user_agent, x.path].map(csvCell).join(','))].join('\r\n'));
  });

  // ── roster ──
  r.get('/roster', mw.validate(z.object({ q: z.string().trim().max(80).optional(), never: z.enum(['1', '0']).optional(),
    page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(5).max(100).default(25) }), 'query'),
    (req, res) => res.json(repo.roster({ ...req.query, never: req.query.never === '1' })));
  r.patch('/roster/:id', mw.validate(idParam, 'params'), mw.validate(z.object({ is_active: z.boolean() })), (req, res) => {
    if (!repo.studentById(req.params.id)) return res.status(404).json({ error: 'not_found' });
    repo.setActive(req.params.id, req.body.is_active); audit(req, 'student_active', { id: req.params.id, active: req.body.is_active }); res.json({ ok: true });
  });
  r.post('/roster/:id/unlink', mw.validate(idParam, 'params'), (req, res) => {
    if (!repo.studentById(req.params.id)) return res.status(404).json({ error: 'not_found' });
    repo.unlinkEmail(req.params.id); audit(req, 'unlink_google', { id: req.params.id }); res.json({ ok: true });
  });

  // ── subjects ──
  r.patch('/subjects/:id', mw.validate(idParam, 'params'), mw.validate(z.object({
    title_ar: z.string().trim().min(1).max(120).optional(), title_en: z.string().trim().min(1).max(120).optional(),
    doctor_name: optStr(120).optional(), ta_names: optStr(200).optional(), has_sections: z.boolean().optional(), has_tasks: z.boolean().optional(),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(), icon: z.enum(ICONS).optional() }).strict()), (req, res) => {
    if (!repo.subjectById(req.params.id)) return res.status(404).json({ error: 'not_found' });
    const f = { ...req.body }; ['has_sections', 'has_tasks'].forEach(k => { if (k in f) f[k] = f[k] ? 1 : 0; });
    repo.updateSubject(req.params.id, f); audit(req, 'edit_subject', { id: req.params.id }); res.json({ ok: true });
  });

  // ── lectures / sections / tasks ──
  r.post('/:kind', kindOnly, mw.validate(z.object({ kind: KIND }), 'params'), mw.validate(contentBody.required({ subject_id: true })), (req, res) => {
    const kind = req.params.kind;
    if (!repo.subjectById(req.body.subject_id)) return res.status(404).json({ error: 'not_found' });
    const id = repo.createContent(kind, req.body.subject_id, req.body); audit(req, 'create_' + kind, { id }); res.status(201).json({ id });
  });
  r.patch('/:kind/:id', kindOnly, mw.validate(kindIdParam, 'params'), mw.validate(contentBody.partial()), (req, res) => {
    const kind = req.params.kind;
    if (!repo.contentItem(kind, req.params.id)) return res.status(404).json({ error: 'not_found' });
    repo.updateContent(kind, req.params.id, req.body); audit(req, 'edit_' + kind, { id: req.params.id }); res.json({ ok: true });
  });
  r.delete('/:kind/:id', kindOnly, mw.validate(kindIdParam, 'params'), (req, res) => {
    const kind = req.params.kind;
    if (!repo.contentItem(kind, req.params.id)) return res.status(404).json({ error: 'not_found' });
    repo.removeContent(kind, req.params.id).forEach(n => fs.rmSync(path.join(cfg.UPLOAD_DIR, n), { force: true }));
    audit(req, 'delete_' + kind, { id: req.params.id }); res.json({ ok: true });
  });

  // ── announcements ──
  const ann = z.object({ title: z.string().trim().min(1).max(200), body: optStr(3000), pinned: z.boolean().default(false) });
  r.post('/announcements', mw.validate(ann), (req, res) => { const id = repo.addAnnouncement(req.body); audit(req, 'create_announcement', { id }); res.status(201).json({ id }); });
  r.patch('/announcements/:id', mw.validate(idParam, 'params'), mw.validate(ann.partial()), (req, res) => { repo.updateAnnouncement(req.params.id, req.body); audit(req, 'edit_announcement', { id: req.params.id }); res.json({ ok: true }); });
  r.delete('/announcements/:id', mw.validate(idParam, 'params'), (req, res) => { repo.removeAnnouncement(req.params.id); audit(req, 'delete_announcement', { id: req.params.id }); res.json({ ok: true }); });

  // ── uploads: allow-list, size cap, random stored name, outside web root, sha-256 recorded ──
  fs.mkdirSync(cfg.UPLOAD_DIR, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({ destination: cfg.UPLOAD_DIR, filename: (_q, f, cb) => cb(null, crypto.randomBytes(16).toString('hex') + '.' + f.originalname.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)) }),
    limits: { fileSize: cfg.MAX_UPLOAD_MB * 1024 * 1024, files: 10 },
    fileFilter: (_q, f, cb) => ALLOWED.has(f.originalname.split('.').pop().toLowerCase()) && f.originalname.includes('.')
      ? cb(null, true) : cb(Object.assign(new Error('type'), { code: 'FILE_TYPE' })),
  });
  const sha = file => new Promise((ok, no) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('data', d => h.update(d)).on('end', () => ok(h.digest('hex'))).on('error', no); });
  r.post('/files', upload.array('files', 10), async (req, res, next) => {
    const cleanup = () => (req.files || []).forEach(f => fs.rm(f.path, { force: true }, () => {}));
    try {
      const b = z.object({ owner_kind: z.enum(['lecture', 'section', 'task', 'subject']), owner_id: z.coerce.number().int().positive() }).parse(req.body);
      if (!req.files?.length || !repo.ownerExists(b.owner_kind, b.owner_id)) { cleanup(); return res.status(400).json({ error: 'invalid_input' }); }
      const out = [];
      for (const f of req.files) {
        const original = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\\/\u0000-\u001f]/g, '_').slice(0, 200);   // multer hands us latin1
        const id = repo.addFile({ kind: b.owner_kind, ownerId: b.owner_id, original, stored: f.filename, mime: f.mimetype, size: f.size, sha: await sha(f.path), by: req.user.id });
        out.push({ id, name: original });
      }
      audit(req, 'upload_files', { count: out.length, owner: `${b.owner_kind}:${b.owner_id}` }); res.status(201).json({ files: out });
    } catch (e) { cleanup(); next(e); }
  });
  r.delete('/files/:id', mw.validate(idParam, 'params'), (req, res) => {
    const f = repo.removeFile(req.params.id); if (!f) return res.status(404).json({ error: 'not_found' });
    fs.rmSync(path.join(cfg.UPLOAD_DIR, f.stored_name), { force: true }); audit(req, 'delete_file', { id: f.id }); res.json({ ok: true });
  });
  return r;
};
