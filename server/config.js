// Single place that reads and validates the environment (zod). Fail fast on bad config.
require('dotenv').config({ quiet: true });
const { z } = require('zod');
const path = require('path');
const bool = z.enum(['true', 'false']).transform(v => v === 'true');

// `KEY=` lines copied from .env.example (or passed by docker env_file) mean "unset", not an empty string.
const withoutBlanks = env => Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ''));

function loadConfig(env = process.env) {
  const s = z.object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(3000),
    SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be >= 32 chars'),
    ADMIN_EMAIL: z.string().email().default('mostafa@example.com'),
    ADMIN_DISPLAY_NAME: z.string().default('مصطفى المشرف التنفيذي'),
    ADMIN_PASSWORD: z.string().min(10).optional(),          // only needed by `npm run seed`
    ADMIN_TOTP_SECRET: z.string().regex(/^[A-Z2-7]+=*$/).optional(),  // base32, enables 2FA
    GOOGLE_CLIENT_ID: z.string().optional().transform(v => v || null),
    COHORT_LABEL: z.string().default('الفرقة الأولى — برنامج علوم البيانات'),
    STORAGE_DIR: z.string().default(path.join(__dirname, '..', 'storage')),
    MAX_UPLOAD_MB: z.coerce.number().default(100),
    LOG_RETENTION_MONTHS: z.coerce.number().default(12),
    TRUST_PROXY: z.coerce.number().default(0),
    COOKIE_SECURE: bool.optional(),
    RATE_LIMIT_AUTH: z.coerce.number().default(30),
    RATE_LIMIT_ADMIN: z.coerce.number().default(8),
    LOG_LEVEL: z.string().default('info'),
  }).safeParse(withoutBlanks(env));
  if (!s.success) {
    throw new Error('Invalid environment:\n' + s.error.issues.map(i => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  const c = s.data;
  c.isProd = c.NODE_ENV === 'production';
  c.cookieSecure = c.COOKIE_SECURE ?? c.isProd;
  c.DB_FILE = path.join(c.STORAGE_DIR, 'study.db');
  c.UPLOAD_DIR = path.join(c.STORAGE_DIR, 'uploads');   // outside the web root on purpose
  return c;
}
module.exports = { loadConfig };
