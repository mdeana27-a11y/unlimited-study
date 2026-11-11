const { ZodError } = require('zod');
const { sha256, randomToken, hmac, safeEqual } = require('./lib/crypto');
const { parseUA } = require('./lib/ua');

const IDLE_MS = { student: 2 * 3600e3, admin: 30 * 60e3 };
const ABSOLUTE_MS = { student: 7 * 864e5, admin: 8 * 3600e3 };
const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

function makeMiddleware({ cfg, repo, bus }) {
  const cookieOpts = (maxAge) => ({ httpOnly: true, sameSite: 'lax', secure: cfg.cookieSecure, path: '/', maxAge });

  // Activity log + live push to the admin dashboard (SSE).
  function logEvent(req, f) {
    const u = req.user;
    const row = repo.log({
      actor_type: f.actor_type || u?.type || 'anonymous', actor_id: f.actor_id ?? u?.id,
      student_code: f.student_code ?? u?.code, student_name: f.student_name ?? u?.name, email: f.email ?? u?.email,
      event: f.event, method: f.method, ip: req.ip, user_agent: (req.headers['user-agent'] || '').slice(0, 300),
      path: f.path ?? req.originalUrl.split('?')[0], meta: { ...parseUA(req.headers['user-agent']), ...f.meta },
    });
    bus.emit('log', row);
    return row;
  }

  // Rotation on login: any session presented with the login request is revoked, a fresh token issued.
  function startSession(req, res, type, user) {
    const old = req.cookies?.sid; if (old) repo.revoke(sha256(old));
    const token = randomToken(32);
    repo.createSession({ id: sha256(token), type, userId: user.id, ip: req.ip, ua: (req.headers['user-agent'] || '').slice(0, 300),
      expiresAt: new Date(Date.now() + ABSOLUTE_MS[type]).toISOString() });
    res.cookie('sid', token, cookieOpts(ABSOLUTE_MS[type]));
  }

  function attachUser(req, _res, next) {
    req.user = null;
    const token = req.cookies?.sid; if (!token) return next();
    const id = sha256(token), s = repo.session(id); if (!s) return next();
    const now = Date.now();
    if (Date.parse(s.expires_at) < now || now - Date.parse(s.last_seen_at) > IDLE_MS[s.user_type]) { repo.revoke(id); return next(); }
    if (now - Date.parse(s.last_seen_at) > 60e3) repo.touchSession(id);   // throttled heartbeat
    if (s.user_type === 'admin') {
      const a = repo.adminById(s.user_id); if (a) req.user = { type: 'admin', id: a.id, name: a.display_name, email: a.email };
    } else {
      const st = repo.studentById(s.user_id);
      if (st?.is_active) req.user = { type: 'student', id: st.id, name: st.name, code: st.code, email: st.email, hall: st.hall };
    }
    req.sessionId = id; next();
  }

  const requireAuth = (req, res, next) => req.user ? next() : res.status(401).json({ error: 'unauthorized' });
  const requireAdmin = (req, res, next) => !req.user ? res.status(401).json({ error: 'unauthorized' })
    : req.user.type !== 'admin' ? (logEvent(req, { event: 'admin_denied' }), res.status(403).json({ error: 'forbidden' })) : next();

  // Double-submit CSRF: signed random token in a readable cookie must be echoed in X-CSRF-Token.
  const issueCsrf = (req, res) => {
    const rnd = randomToken(24), token = `${rnd}.${hmac(cfg.SESSION_SECRET, rnd)}`;
    res.cookie('csrf', token, { httpOnly: false, sameSite: 'lax', secure: cfg.cookieSecure, path: '/' });
    res.json({ token });
  };
  function csrfProtect(req, res, next) {
    if (SAFE.has(req.method)) return next();
    const c = req.cookies?.csrf, h = req.get('x-csrf-token');
    const [rnd, sig] = String(c || '').split('.');
    if (!c || !h || !rnd || !sig || !safeEqual(c, h) || !safeEqual(sig, hmac(cfg.SESSION_SECRET, rnd))) return res.status(403).json({ error: 'csrf' });
    next();
  }

  const validate = (schema, src = 'body') => (req, res, next) => {
    const r = schema.safeParse(req[src]);
    if (!r.success) return res.status(400).json({ error: 'invalid_input', fields: r.error.issues.map(i => i.path.join('.')) });
    Object.defineProperty(req, src, { value: r.data, writable: true, configurable: true });   // Express 5: req.query is a getter
    next();
  };

  // eslint-disable-next-line no-unused-vars
  const errorHandler = (err, req, res, _next) => {
    if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'invalid_input' });
    if (err instanceof ZodError) return res.status(400).json({ error: 'invalid_input' });
    if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: 'too_large' });
    if (err.code === 'FILE_TYPE' || err.name === 'MulterError') return res.status(400).json({ error: err.code === 'FILE_TYPE' ? 'file_type' : 'upload_failed' });
    req.log?.error({ err: { message: err.message, stack: err.stack } }, 'unhandled');
    res.status(500).json({ error: 'server_error' });
  };
  return { logEvent, startSession, attachUser, requireAuth, requireAdmin, issueCsrf, csrfProtect, validate, errorHandler, cookieOpts };
}
module.exports = { makeMiddleware };
