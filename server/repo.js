// The ONLY place that talks SQL. Swap this file (and db.js migrations) to move to PostgreSQL.
const { normalizeArabic } = require('./lib/arabic');
const { cairoMidnightUtc, cairoDayKey, cairoHour, lastDayKeys } = require('./lib/time');

const KINDS = {
  lectures: { fileKind: 'lecture', cols: ['title', 'description', 'week_no'] },
  sections: { fileKind: 'section', cols: ['title', 'description', 'week_no'] },
  tasks: { fileKind: 'task', cols: ['title', 'description', 'due_at'] },
};
const iso = (ms = 0) => new Date(Date.now() + ms).toISOString();

function makeRepo(db) {
  const q = (sql) => db.prepare(sql);
  const r = {
    KINDS,
    // ───────── students ─────────
    studentByCode: c => q('SELECT * FROM students WHERE code=?').get(c),
    studentById: id => q('SELECT * FROM students WHERE id=?').get(id),
    studentByEmail: e => q('SELECT * FROM students WHERE email=?').get(e),
    linkEmail: (id, email) => q('UPDATE students SET email=?, email_verified_at=? WHERE id=?').run(email, iso(), id),
    unlinkEmail: id => q('UPDATE students SET email=NULL, email_verified_at=NULL WHERE id=?').run(id),
    setActive(id, on) {
      q('UPDATE students SET is_active=? WHERE id=?').run(on ? 1 : 0, id);
      if (!on) r.revokeAll('student', id);
    },
    roster({ q: term, never, page = 1, pageSize = 25 }) {
      const w = [], p = [];
      if (term) { w.push('(s.code LIKE ? OR s.name_normalized LIKE ? OR s.email LIKE ?)'); p.push(`%${term}%`, `%${normalizeArabic(term)}%`, `%${term}%`); }   // names are stored normalised
      if (never) w.push("NOT EXISTS (SELECT 1 FROM activity_logs a WHERE a.student_code=s.code AND a.event='login_success')");
      const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) c FROM students s ${where}`).get(...p).c;
      const rows = db.prepare(`SELECT s.id,s.code,s.name,s.hall,s.seq,s.email,s.is_active,
          (SELECT MAX(ts) FROM activity_logs a WHERE a.student_code=s.code AND a.event='login_success') AS last_login,
          (SELECT COUNT(*) FROM activity_logs a WHERE a.student_code=s.code AND a.event='login_success') AS logins
        FROM students s ${where} ORDER BY s.seq, s.code LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize);
      return { rows, total };
    },
    // ───────── admins & sessions ─────────
    adminByEmail: e => q('SELECT * FROM admins WHERE email=?').get(e),
    adminById: id => q('SELECT * FROM admins WHERE id=?').get(id),
    createSession: s => q('INSERT INTO sessions (id,user_type,user_id,created_at,last_seen_at,expires_at,ip,user_agent) VALUES (?,?,?,?,?,?,?,?)')
      .run(s.id, s.type, s.userId, iso(), iso(), s.expiresAt, s.ip, s.ua),
    session: id => q('SELECT * FROM sessions WHERE id=? AND revoked_at IS NULL').get(id),
    touchSession: id => q('UPDATE sessions SET last_seen_at=? WHERE id=?').run(iso(), id),
    revoke: id => q('UPDATE sessions SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(iso(), id),
    revokeAll: (type, uid) => q('UPDATE sessions SET revoked_at=? WHERE user_type=? AND user_id=? AND revoked_at IS NULL').run(iso(), type, uid),
    onlineStudents: () => q(`SELECT COUNT(DISTINCT user_id) c FROM sessions WHERE user_type='student' AND revoked_at IS NULL
      AND expires_at > ? AND last_seen_at > ?`).get(iso(), iso(-5 * 60e3)).c,
    // ───────── progressive lockout ─────────
    lockedUntil(key) {
      const row = q('SELECT locked_until FROM lockouts WHERE key=?').get(key);
      return row?.locked_until && row.locked_until > iso() ? row.locked_until : null;
    },
    registerFail(key, threshold) {
      const row = q('SELECT fails FROM lockouts WHERE key=?').get(key);
      const fails = (row?.fails || 0) + 1;
      const lock = fails >= threshold ? iso(Math.min(2 ** (fails - threshold), 60) * 60e3) : null;  // 1,2,4,…,60 min
      q(`INSERT INTO lockouts (key,fails,locked_until,updated_at) VALUES (?,?,?,?)
         ON CONFLICT(key) DO UPDATE SET fails=excluded.fails, locked_until=excluded.locked_until, updated_at=excluded.updated_at`)
        .run(key, fails, lock, iso());
    },
    clearFails: key => q('DELETE FROM lockouts WHERE key=?').run(key),
    // ───────── activity log ─────────
    log(e) {
      const info = q(`INSERT INTO activity_logs (ts,actor_type,actor_id,student_code,student_name,email,event,method,ip,user_agent,path,meta_json)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(iso(), e.actor_type, e.actor_id ?? null, e.student_code ?? null, e.student_name ?? null,
        e.email ?? null, e.event, e.method ?? null, e.ip, e.user_agent, e.path ?? null, e.meta ? JSON.stringify(e.meta) : null);
      return q('SELECT * FROM activity_logs WHERE id=?').get(info.lastInsertRowid);
    },
    logs({ q: term, from, to, method, event, page = 1, pageSize = 25, all = false }) {
      const w = [], p = [];
      if (term) { w.push('(student_name LIKE ? OR student_code LIKE ? OR email LIKE ?)'); p.push(`%${term}%`, `%${term}%`, `%${term}%`); }
      if (from) { w.push('ts >= ?'); p.push(from); }
      if (to) { w.push('ts < ?'); p.push(to); }
      if (method) { w.push('method = ?'); p.push(method); }
      if (event) { w.push('event = ?'); p.push(event); }
      const where = w.length ? 'WHERE ' + w.join(' AND ') : '';
      const total = db.prepare(`SELECT COUNT(*) c FROM activity_logs ${where}`).get(...p).c;
      const rows = all ? db.prepare(`SELECT * FROM activity_logs ${where} ORDER BY id DESC`).all(...p)
        : db.prepare(`SELECT * FROM activity_logs ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...p, pageSize, (page - 1) * pageSize);
      return { rows, total };
    },
    purgeLogs: months => q('DELETE FROM activity_logs WHERE ts < ?').run(iso(-months * 30.44 * 864e5)).changes,
    // ───────── subjects & content ─────────
    subjects(studentId = -1) {
      return db.prepare(`SELECT s.*,
        (SELECT COUNT(*) FROM lectures WHERE subject_id=s.id)+(SELECT COUNT(*) FROM sections WHERE subject_id=s.id)+(SELECT COUNT(*) FROM tasks WHERE subject_id=s.id)
          +(SELECT COUNT(*) FROM files WHERE owner_kind='subject' AND owner_id=s.id) AS items_count,
        (SELECT COUNT(*) FROM lectures x WHERE x.subject_id=s.id AND x.created_at > COALESCE(v.last_visit,''))
          +(SELECT COUNT(*) FROM sections x WHERE x.subject_id=s.id AND x.created_at > COALESCE(v.last_visit,''))
          +(SELECT COUNT(*) FROM tasks x WHERE x.subject_id=s.id AND x.created_at > COALESCE(v.last_visit,''))
          +(SELECT COUNT(*) FROM files x WHERE x.owner_kind='subject' AND x.owner_id=s.id AND x.uploaded_at > COALESCE(v.last_visit,'')) AS new_count
        FROM subjects s LEFT JOIN subject_visits v ON v.subject_id=s.id AND v.student_id=? ORDER BY s.sort_order`).all(studentId);
    },
    subjectBySlug: s => q('SELECT * FROM subjects WHERE slug=?').get(s),
    subjectById: id => q('SELECT * FROM subjects WHERE id=?').get(id),
    updateSubject(id, f) {
      const cols = Object.keys(f); if (!cols.length) return;
      db.prepare(`UPDATE subjects SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...f, id });
    },
    lastVisit: (sid, subj) => q('SELECT last_visit FROM subject_visits WHERE student_id=? AND subject_id=?').get(sid, subj)?.last_visit || null,
    markVisit: (sid, subj) => q(`INSERT INTO subject_visits VALUES (?,?,?) ON CONFLICT(student_id,subject_id) DO UPDATE SET last_visit=excluded.last_visit`).run(sid, subj, iso()),
    content(kind, subjectId) {
      const order = kind === 'tasks' ? "COALESCE(due_at,'9999') ASC, id DESC" : 'COALESCE(week_no,999) ASC, id DESC';   // SQLite: single quotes for literals
      return db.prepare(`SELECT * FROM ${kind} WHERE subject_id=? ORDER BY ${order}`).all(subjectId);
    },
    contentItem: (kind, id) => db.prepare(`SELECT * FROM ${kind} WHERE id=?`).get(id),
    createContent(kind, subjectId, d) {
      const cols = KINDS[kind].cols;
      return db.prepare(`INSERT INTO ${kind} (subject_id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`)
        .run(subjectId, ...cols.map(c => d[c] ?? null)).lastInsertRowid;
    },
    updateContent(kind, id, d) {
      const cols = KINDS[kind].cols.filter(c => c in d); if (!cols.length) return;
      db.prepare(`UPDATE ${kind} SET ${cols.map(c => `${c}=?`).join(',')} WHERE id=?`).run(...cols.map(c => d[c]), id);
    },
    removeContent(kind, id) {                    // returns stored filenames so the caller can unlink them
      const fk = KINDS[kind].fileKind;
      const names = db.prepare('SELECT stored_name FROM files WHERE owner_kind=? AND owner_id=?').all(fk, id).map(x => x.stored_name);
      db.transaction(() => {
        db.prepare('DELETE FROM files WHERE owner_kind=? AND owner_id=?').run(fk, id);
        db.prepare(`DELETE FROM ${kind} WHERE id=?`).run(id);
      })();
      return names;
    },
    // ───────── files ─────────
    addFile: f => q('INSERT INTO files (owner_kind,owner_id,original_name,stored_name,mime,size,sha256,uploaded_by) VALUES (?,?,?,?,?,?,?,?)')
      .run(f.kind, f.ownerId, f.original, f.stored, f.mime, f.size, f.sha, f.by).lastInsertRowid,
    file: id => q('SELECT * FROM files WHERE id=?').get(id),
    filesOfSubject(subjectId) {
      return db.prepare(`SELECT id,owner_kind,owner_id,original_name,mime,size,uploaded_at FROM files WHERE
        (owner_kind='subject' AND owner_id=@s) OR (owner_kind='lecture' AND owner_id IN (SELECT id FROM lectures WHERE subject_id=@s))
        OR (owner_kind='section' AND owner_id IN (SELECT id FROM sections WHERE subject_id=@s))
        OR (owner_kind='task' AND owner_id IN (SELECT id FROM tasks WHERE subject_id=@s)) ORDER BY id`).all({ s: subjectId });
    },
    fileSubjectSlug(f) {
      const t = { lecture: 'lectures', section: 'sections', task: 'tasks' }[f.owner_kind];
      return (f.owner_kind === 'subject'
        ? q('SELECT slug FROM subjects WHERE id=?').get(f.owner_id)
        : db.prepare(`SELECT s.slug FROM ${t} x JOIN subjects s ON s.id=x.subject_id WHERE x.id=?`).get(f.owner_id))?.slug;
    },
    removeFile(id) { const f = r.file(id); if (f) q('DELETE FROM files WHERE id=?').run(id); return f; },
    ownerExists(kind, id) {
      const t = { lecture: 'lectures', section: 'sections', task: 'tasks', subject: 'subjects' }[kind];
      return !!db.prepare(`SELECT 1 FROM ${t} WHERE id=?`).get(id);
    },
    // ───────── announcements ─────────
    announcements: () => q('SELECT * FROM announcements ORDER BY pinned DESC, id DESC').all(),
    addAnnouncement: a => q('INSERT INTO announcements (title,body,pinned) VALUES (?,?,?)').run(a.title, a.body ?? null, a.pinned ? 1 : 0).lastInsertRowid,
    updateAnnouncement(id, a) {
      const cols = Object.keys(a); if (!cols.length) return;
      db.prepare(`UPDATE announcements SET ${cols.map(c => `${c}=@${c}`).join(',')} WHERE id=@id`).run({ ...a, pinned: a.pinned ? 1 : 0, id });
    },
    removeAnnouncement: id => q('DELETE FROM announcements WHERE id=?').run(id),
    // ───────── dashboard numbers ─────────
    overview() {
      const now = new Date(), day = cairoMidnightUtc(now).toISOString(), week = iso(-7 * 864e5), hour = iso(-3600e3);
      const c = (sql, ...p) => db.prepare(sql).get(...p).c;
      const active = c('SELECT COUNT(*) c FROM students WHERE is_active=1');
      const ever = c("SELECT COUNT(DISTINCT student_code) c FROM activity_logs WHERE event='login_success' AND actor_type='student'");
      return {
        online: r.onlineStudents(), loginsToday: c("SELECT COUNT(*) c FROM activity_logs WHERE event='login_success' AND actor_type='student' AND ts>=?", day),
        loginsWeek: c("SELECT COUNT(*) c FROM activity_logs WHERE event='login_success' AND actor_type='student' AND ts>=?", week),
        rosterTotal: active, everLoggedIn: ever, everPct: active ? Math.round(ever / active * 100) : 0,
        failedHour: c("SELECT COUNT(*) c FROM activity_logs WHERE event='login_fail' AND ts>=?", hour),
        failedDay: c("SELECT COUNT(*) c FROM activity_logs WHERE event='login_fail' AND ts>=?", iso(-864e5)),
        methods: db.prepare("SELECT method, COUNT(*) c FROM activity_logs WHERE event='login_success' AND actor_type='student' GROUP BY method").all(),
      };
    },
    charts() {
      const rows = db.prepare("SELECT ts FROM activity_logs WHERE event='login_success' AND actor_type='student' AND ts>=?").all(iso(-14 * 864e5));
      const perDay = {}, perHour = Array(24).fill(0);
      lastDayKeys(14).forEach(k => { perDay[k] = 0; });
      const since24 = iso(-864e5);
      rows.forEach(x => { const k = cairoDayKey(x.ts); if (k in perDay) perDay[k]++; if (x.ts >= since24) perHour[cairoHour(x.ts)]++; });
      return {
        perDay: Object.entries(perDay).map(([day, n]) => ({ day, n })), perHour,
        perHall: db.prepare(`SELECT COALESCE(s.hall,'—') hall, COUNT(*) n FROM activity_logs a JOIN students s ON s.code=a.student_code
          WHERE a.event='login_success' GROUP BY s.hall ORDER BY n DESC`).all(),
        perSubject: db.prepare(`SELECT json_extract(a.meta_json,'$.subject') slug, sb.title_ar, sb.title_en, COUNT(*) n FROM activity_logs a
          JOIN subjects sb ON sb.slug=json_extract(a.meta_json,'$.subject') WHERE a.event='view_subject' AND a.actor_type='student' GROUP BY slug ORDER BY n DESC`).all(),
        topFiles: db.prepare(`SELECT f.id, f.original_name name, COUNT(*) n FROM activity_logs a JOIN files f ON f.id=json_extract(a.meta_json,'$.fileId')
          WHERE a.event='download_file' AND a.actor_type='student' GROUP BY f.id ORDER BY n DESC LIMIT 8`).all(),
      };
    },
  };
  return r;
}
module.exports = { makeRepo, KINDS };
