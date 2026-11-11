// SQLite (better-sqlite3, WAL) + versioned migrations. All SQL that the app runs lives in repo.js,
// so moving to PostgreSQL means re-implementing repo.js and these migrations — nothing else.
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const MIGRATIONS = [
`CREATE TABLE students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE CHECK (length(code) = 7 AND code NOT GLOB '*[^0-9]*'),
  name TEXT NOT NULL, name_normalized TEXT NOT NULL, name_raw TEXT,
  hall TEXT, seq INTEGER,
  email TEXT UNIQUE, email_verified_at TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_students_name ON students(name_normalized);
CREATE INDEX idx_students_hall ON students(hall);
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT, display_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, totp_secret TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,                                   -- sha256 of the cookie token (never the token itself)
  user_type TEXT NOT NULL CHECK (user_type IN ('student','admin')), user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, expires_at TEXT NOT NULL,
  ip TEXT, user_agent TEXT, revoked_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_type, user_id);
CREATE TABLE activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  actor_type TEXT NOT NULL CHECK (actor_type IN ('student','admin','anonymous')),
  actor_id INTEGER, student_code TEXT, student_name TEXT, email TEXT,
  event TEXT NOT NULL, method TEXT CHECK (method IN ('google','name_code','admin') OR method IS NULL),
  ip TEXT, user_agent TEXT, path TEXT, meta_json TEXT
);
CREATE INDEX idx_logs_ts ON activity_logs(ts DESC);
CREATE INDEX idx_logs_code ON activity_logs(student_code, ts DESC);
CREATE INDEX idx_logs_event ON activity_logs(event, ts DESC);
CREATE TABLE subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL UNIQUE,
  title_ar TEXT NOT NULL, title_en TEXT NOT NULL, doctor_name TEXT, ta_names TEXT,
  has_sections INTEGER NOT NULL DEFAULT 1, has_tasks INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '#22D3EE', icon TEXT NOT NULL DEFAULT 'book'
);
CREATE TABLE lectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, week_no INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, week_no INTEGER,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title TEXT NOT NULL, description TEXT, due_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_lectures_subject ON lectures(subject_id);
CREATE INDEX idx_sections_subject ON sections(subject_id);
CREATE INDEX idx_tasks_subject ON tasks(subject_id);
CREATE TABLE files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_kind TEXT NOT NULL CHECK (owner_kind IN ('lecture','section','task','subject')), owner_id INTEGER NOT NULL,
  original_name TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE, mime TEXT, size INTEGER, sha256 TEXT,
  uploaded_by INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  uploaded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_files_owner ON files(owner_kind, owner_id);
CREATE TABLE announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, body TEXT, pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- "new" badges: when did this student last open this subject?
CREATE TABLE subject_visits (
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  last_visit TEXT NOT NULL, PRIMARY KEY (student_id, subject_id)
);
-- progressive lockout (per code, per IP, per admin email); persisted so a restart doesn't reset it
CREATE TABLE lockouts (key TEXT PRIMARY KEY, fails INTEGER NOT NULL DEFAULT 0, locked_until TEXT, updated_at TEXT NOT NULL);`,
];

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY)');
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  MIGRATIONS.forEach((sql, i) => {
    if (done.has(i + 1)) return;
    db.transaction(() => { db.exec(sql); db.prepare('INSERT INTO schema_migrations VALUES (?)').run(i + 1); })();
  });
  return db;
}
module.exports = { openDb };
