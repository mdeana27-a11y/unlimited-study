const { loadConfig } = require('../server/config');
const { openDb } = require('../server/db');
const { seedAll } = require('../server/seed');
const cfg = loadConfig();
seedAll(openDb(cfg.DB_FILE), cfg).catch(e => { console.error(e.message); process.exit(1); });
