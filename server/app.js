const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const pino = require('pino');
const pinoHttp = require('pino-http');
const path = require('path');
const { EventEmitter } = require('events');
const { OAuth2Client } = require('google-auth-library');
const { makeRepo } = require('./repo');
const { makeMiddleware } = require('./middleware');

// Verifies a Google ID token on the server: signature, audience, issuer, expiry (library) + email_verified (here).
function defaultGoogleVerifier(clientId) {
  const client = new OAuth2Client(clientId);
  return async (credential) => {
    const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
    const p = ticket.getPayload();
    if (!['accounts.google.com', 'https://accounts.google.com'].includes(p.iss) || !p.email_verified || !p.email) throw new Error('rejected');
    return { email: p.email.toLowerCase() };
  };
}

function createApp({ cfg, db, googleVerifier, bus = new EventEmitter() }) {
  const repo = makeRepo(db), mw = makeMiddleware({ cfg, repo, bus });
  const verifier = googleVerifier || (cfg.GOOGLE_CLIENT_ID ? defaultGoogleVerifier(cfg.GOOGLE_CLIENT_ID) : null);
  const app = express();
  app.disable('x-powered-by'); app.set('trust proxy', cfg.TRUST_PROXY);

  const logger = pino({ level: cfg.NODE_ENV === 'test' ? 'silent' : cfg.LOG_LEVEL,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-csrf-token"]', 'res.headers["set-cookie"]'] });
  app.use(pinoHttp({ logger, autoLogging: { ignore: r => r.url === '/healthz' } }));

  app.use(helmet({
    contentSecurityPolicy: { useDefaults: false, directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'", 'https://accounts.google.com/gsi/client'],     // no inline scripts, so no nonce needed
      styleSrc: ["'self'", 'https://accounts.google.com/gsi/style'], imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com'],
      fontSrc: ["'self'"], connectSrc: ["'self'", 'https://accounts.google.com/gsi/'], frameSrc: ['https://accounts.google.com/gsi/'],
      objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      ...(cfg.isProd ? { upgradeInsecureRequests: [] } : {}) } },
    hsts: cfg.isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false, crossOriginOpenerPolicy: { policy: 'same-origin-allow-popups' },   // GIS popup needs this
    referrerPolicy: { policy: 'same-origin' },
  }));
  app.use(express.json({ limit: '20kb' }));
  app.use(cookieParser());

  app.get('/healthz', (_q, res) => res.json({ ok: true }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use('/api', mw.attachUser, mw.csrfProtect);
  app.get('/api/csrf', mw.issueCsrf);
  app.get('/api/config', (_q, res) => res.json({ googleClientId: cfg.GOOGLE_CLIENT_ID, googleEnabled: !!verifier, cohortLabel: cfg.COHORT_LABEL }));
  app.use('/api/auth', require('./routes/auth')({ cfg, repo, mw, googleVerifier: verifier }));
  app.use('/api/admin', require('./routes/admin')({ cfg, repo, mw, bus }));
  app.use('/api', require('./routes/student')({ cfg, repo, mw }));
  app.use('/api', (_q, res) => res.status(404).json({ error: 'not_found' }));

  const client = path.join(__dirname, '..', 'client');
  app.use('/dist', express.static(path.join(client, 'dist'), { maxAge: cfg.isProd ? '7d' : 0 }));
  app.use(express.static(path.join(client, 'public'), { maxAge: 0 }));
  app.use('/js', express.static(path.join(client, 'js')));
  app.get('/{*splat}', (_q, res) => res.sendFile(path.join(client, 'public', 'index.html')));   // SPA fallback
  app.use(mw.errorHandler);
  return { app, repo, bus, logger };
}
module.exports = { createApp };
