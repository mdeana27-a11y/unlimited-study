const os = require('os'); const fs = require('fs'); const path = require('path');
const request = require('supertest');
const { loadConfig } = require('../server/config');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');
const { seedAll } = require('../server/seed');

const ADMIN = { email: 'mostafa@test.dev', password: 'TestPassw0rd!2026' };
async function makeApp(over = {}, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'us-test-'));
  const cfg = loadConfig({ NODE_ENV: 'test', SESSION_SECRET: 'x'.repeat(40), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password,
    STORAGE_DIR: dir, RATE_LIMIT_AUTH: '1000', RATE_LIMIT_ADMIN: '1000', ...over });
  const db = openDb(':memory:');
  await seedAll(db, cfg, { log: () => {} });
  const built = createApp({ cfg, db, googleVerifier: opts.googleVerifier });
  return { ...built, cfg, db, dir };
}
// A cookie-keeping client that also handles CSRF like the browser would.
async function client(app) {
  const agent = request.agent(app);
  const { body } = await agent.get('/api/csrf');
  const send = (m, url) => agent[m](url).set('X-CSRF-Token', body.token);
  return { agent, csrf: body.token, get: u => agent.get(u), post: u => send('post', u), patch: u => send('patch', u), del: u => send('delete', u) };
}
module.exports = { makeApp, client, ADMIN };
