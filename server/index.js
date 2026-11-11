const { loadConfig } = require('./config');
const { openDb } = require('./db');
const { createApp } = require('./app');

const cfg = loadConfig();
const db = openDb(cfg.DB_FILE);
if (!db.prepare('SELECT 1 FROM admins LIMIT 1').get()) console.warn('⚠ No admin yet — run: npm run seed');
const { app, repo, logger } = createApp({ cfg, db });

const purge = () => { const n = repo.purgeLogs(cfg.LOG_RETENTION_MONTHS); if (n) logger.info({ n }, 'purged old activity logs'); };
purge(); setInterval(purge, 24 * 3600e3).unref();

const server = app.listen(cfg.PORT, () => logger.info(`Unlimited Study → http://localhost:${cfg.PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => {
  server.close(() => { db.close(); process.exit(0); });
  server.closeAllConnections();                        // the admin panel's SSE stream would otherwise keep close() waiting forever
  setTimeout(() => process.exit(1), 5000).unref();     // last resort
});
