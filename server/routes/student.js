const express = require('express');
const path = require('path');
const { z } = require('zod');

module.exports = function studentRoutes({ cfg, repo, mw }) {
  const r = express.Router();
  // /me is public on purpose: anonymous -> { user: null } (200) so the SPA boots without a console error.
  r.get('/me', (req, res) => res.json({ user: req.user && { type: req.user.type, name: req.user.name, code: req.user.code, email: req.user.email, hall: req.user.hall } }));
  r.use(mw.requireAuth);                       // admins may browse too; everything below is read-only
  r.get('/subjects', (req, res) => res.json({ subjects: repo.subjects(req.user.type === 'student' ? req.user.id : -1) }));
  r.get('/announcements', (_q, res) => res.json({ announcements: repo.announcements() }));

  r.get('/subjects/:slug', mw.validate(z.object({ slug: z.string().regex(/^[a-z0-9-]{1,60}$/) }), 'params'), (req, res) => {
    const s = repo.subjectBySlug(req.params.slug);
    if (!s) return res.status(404).json({ error: 'not_found' });
    const since = req.user.type === 'student' ? repo.lastVisit(req.user.id, s.id) : null;
    const files = repo.filesOfSubject(s.id);
    const isNew = ts => since ? ts > since : req.user.type === 'student';   // first visit: everything is new (same rule everywhere)
    const withFiles = (kind, rows) => rows.map(x => ({ ...x, is_new: isNew(x.created_at),
      files: files.filter(f => f.owner_kind === kind && f.owner_id === x.id) }));
    if (req.user.type === 'student') repo.markVisit(req.user.id, s.id);
    mw.logEvent(req, { event: 'view_subject', meta: { subject: s.slug } });
    res.json({
      subject: s,
      lectures: withFiles('lecture', repo.content('lectures', s.id)),
      sections: s.has_sections ? withFiles('section', repo.content('sections', s.id)) : [],
      tasks: s.has_tasks ? withFiles('task', repo.content('tasks', s.id)) : [],
      materials: files.filter(f => f.owner_kind === 'subject').map(f => ({ ...f, is_new: isNew(f.uploaded_at) })),
    });
  });

  // Files are never served statically: auth first, then a DB lookup — the client never supplies a path.
  r.get('/files/:id', mw.validate(z.object({ id: z.coerce.number().int().positive() }), 'params'), (req, res) => {
    const f = repo.file(req.params.id);
    if (!f || !/^[a-f0-9]{32}\.[a-z0-9]{1,8}$/.test(f.stored_name)) return res.status(404).json({ error: 'not_found' });
    mw.logEvent(req, { event: 'download_file', path: `/files/${f.id}`, meta: { fileId: f.id, name: f.original_name, subject: repo.fileSubjectSlug(f) } });
    res.set('X-Content-Type-Options', 'nosniff');
    res.download(path.join(cfg.UPLOAD_DIR, f.stored_name), f.original_name, err => { if (err && !res.headersSent) res.status(404).json({ error: 'not_found' }); });
  });
  return r;
};
