const express = require('express');
const rateLimit = require('express-rate-limit');
const argon2 = require('argon2');
const { z } = require('zod');
const { namesMatch, toAsciiDigits } = require('../lib/arabic');
const { sha256, signBlob, openBlob, verifyTotp } = require('../lib/crypto');

const nameField = z.string().trim().min(3).max(120);
const codeField = z.string().trim().transform(toAsciiDigits).pipe(z.string().regex(/^\d{7}$/));   // 7 digits (Arabic-Indic accepted), never validated by prefix
// A real hash so that unknown admin emails cost the same time as known ones (no user enumeration by timing).
const DUMMY_HASH = argon2.hash('dummy-' + Math.random(), { type: argon2.argon2id });

module.exports = function authRoutes({ cfg, repo, mw, googleVerifier }) {
  const router = express.Router();
  const limiter = (limit) => rateLimit({ windowMs: 15 * 60e3, limit, standardHeaders: true, legacyHeaders: false,
    handler: (_q, res) => res.status(429).json({ error: 'rate_limited' }) });
  const authLimit = limiter(cfg.RATE_LIMIT_AUTH), adminLimit = limiter(cfg.RATE_LIMIT_ADMIN);
  const CODE_LOCK = 5, IP_LOCK = 40;   // IP threshold is high on purpose: a whole campus can share one NAT address

  const locked = (keys) => keys.some(k => repo.lockedUntil(k));
  const fail = (req, res, keys, thresholds, meta) => {
    keys.forEach((k, i) => repo.registerFail(k, thresholds[i]));
    mw.logEvent(req, { event: 'login_fail', actor_type: 'anonymous', method: meta.method, student_code: meta.code, student_name: null, email: meta.email, meta: { reason: meta.reason } });
    res.status(401).json({ error: 'invalid_credentials' });         // same answer for wrong name, wrong code, inactive
  };

  // Shared by Path B and the Google link step: verifies the (name, code) pair against the roster.
  function checkRoster(req, res, { name, code, method, email }) {
    const keys = [`code:${code}`, `ip:${req.ip}`];
    if (locked(keys)) {
      mw.logEvent(req, { event: 'login_fail', actor_type: 'anonymous', method, student_code: code, email, meta: { reason: 'locked' } });
      res.status(429).json({ error: 'locked' }); return null;
    }
    const st = repo.studentByCode(code);
    if (!st || !st.is_active || !namesMatch(name, st.name_normalized)) {
      fail(req, res, keys, [CODE_LOCK, IP_LOCK], { method, code, email, reason: !st ? 'unknown_code' : !st.is_active ? 'inactive' : 'name_mismatch' });
      return null;
    }
    repo.clearFails(keys[0]);
    return st;
  }
  const publicUser = u => ({ type: u.type, name: u.name, code: u.code, email: u.email, hall: u.hall });
  function finish(req, res, st, method, event = 'login_success') {
    mw.startSession(req, res, 'student', st);
    req.user = { type: 'student', id: st.id, name: st.name, code: st.code, email: st.email, hall: st.hall };   // same shape as /api/me
    mw.logEvent(req, { event, method });
    res.json({ user: publicUser(req.user) });
  }

  // ── Path B: quadruple name + student code ──
  router.post('/login', authLimit, mw.validate(z.object({ name: nameField, code: codeField })), (req, res) => {
    const st = checkRoster(req, res, { ...req.body, method: 'name_code' });
    if (st) finish(req, res, st, 'name_code');
  });

  // ── Path A: Google (ID token verified server-side) ──
  router.post('/google', authLimit, mw.validate(z.object({ credential: z.string().min(20).max(4096) })), async (req, res) => {
    if (!cfg.GOOGLE_CLIENT_ID && !googleVerifier) return res.status(501).json({ error: 'google_disabled' });
    let email;
    try { email = (await googleVerifier(req.body.credential)).email; } catch {
      mw.logEvent(req, { event: 'login_fail', actor_type: 'anonymous', method: 'google', meta: { reason: 'bad_token' } });
      return res.status(401).json({ error: 'google_failed' });
    }
    const st = repo.studentByEmail(email);
    if (!st || !st.is_active) {
      if (st) { mw.logEvent(req, { event: 'login_fail', actor_type: 'anonymous', method: 'google', email, student_code: st.code, meta: { reason: 'inactive' } }); return res.status(401).json({ error: 'invalid_credentials' }); }
      // Unlinked Gmail: no session, nothing visible — only a 10-minute proof that this email was verified.
      return res.json({ needsLink: true, email, linkToken: signBlob(cfg.SESSION_SECRET, { email, purpose: 'link' }, 600) });
    }
    finish(req, res, st, 'google');
  });

  router.post('/google/link', authLimit, mw.validate(z.object({ linkToken: z.string().max(2000), name: nameField, code: codeField })), (req, res) => {
    const t = openBlob(cfg.SESSION_SECRET, req.body.linkToken);
    if (!t || t.purpose !== 'link') return res.status(401).json({ error: 'link_expired' });
    const st = checkRoster(req, res, { name: req.body.name, code: req.body.code, method: 'google', email: t.email });
    if (!st) return;
    if (st.email && st.email !== t.email) return res.status(409).json({ error: 'link_conflict' });
    if (repo.studentByEmail(t.email)) return res.status(409).json({ error: 'link_conflict' });
    repo.linkEmail(st.id, t.email); st.email = t.email;
    mw.logEvent(req, { event: 'google_linked', actor_type: 'student', actor_id: st.id, student_code: st.code, student_name: st.name, email: t.email, method: 'google' });
    finish(req, res, st, 'google');
  });

  // ── Admin (Mostafa only): separate route, stricter limits, optional TOTP ──
  router.post('/admin', adminLimit, mw.validate(z.object({ email: z.string().email().max(200), password: z.string().min(1).max(200), totp: z.string().regex(/^\d{6}$/).optional() })), async (req, res) => {
    const keys = [`admin:${req.body.email.toLowerCase()}`, `ip:${req.ip}`];
    if (locked(keys)) return res.status(429).json({ error: 'locked' });
    const a = repo.adminByEmail(req.body.email);
    const okPw = await argon2.verify(a?.password_hash || await DUMMY_HASH, req.body.password).catch(() => false) && !!a;
    const ok2fa = !a?.totp_secret || (req.body.totp && verifyTotp(a.totp_secret, req.body.totp));
    if (!okPw || !ok2fa) {
      repo.registerFail(keys[0], 3); repo.registerFail(keys[1], IP_LOCK);
      mw.logEvent(req, { event: 'login_fail', actor_type: 'anonymous', method: 'admin', email: req.body.email, meta: { reason: okPw ? 'bad_totp' : 'bad_password' } });
      return res.status(401).json({ error: okPw && a?.totp_secret ? 'totp_required' : 'invalid_credentials' });
    }
    repo.clearFails(keys[0]);
    mw.startSession(req, res, 'admin', a);
    req.user = { type: 'admin', id: a.id, name: a.display_name, email: a.email };
    mw.logEvent(req, { event: 'login_success', method: 'admin' });
    res.json({ user: publicUser(req.user) });
  });

  router.post('/logout', (req, res) => {
    if (req.sessionId) repo.revoke(req.sessionId);
    if (req.user) mw.logEvent(req, { event: 'logout' });
    res.clearCookie('sid', mw.cookieOpts()); res.json({ ok: true });
  });
  router.post('/logout-all', mw.requireAuth, (req, res) => {
    repo.revokeAll(req.user.type, req.user.id);
    mw.logEvent(req, { event: 'logout_all' }); res.clearCookie('sid', mw.cookieOpts()); res.json({ ok: true });
  });
  return router;
};
