// Idempotent seeding: re-running never duplicates rows or overwrites supervisor edits.
const fs = require('fs');
const path = require('path');
const argon2 = require('argon2');
const { parse } = require('csv-parse/sync');
const { normalizeArabic } = require('./lib/arabic');

const SUBJECTS = [
  ['expert-systems', 'النظم الخبيرة', 'Expert Systems', 'د. عبد السلام حلمي', 'م. زينب', 1, 1, '#8B5CF6', 'brain'],
  ['data-engineering', 'هندسة وتحليل البيانات', 'Data Engineering and Analysis', 'د. هند ذياده', 'م. محمد إبراهيم', 1, 1, '#22D3EE', 'database'],
  ['artificial-intelligence', 'الذكاء الاصطناعي', 'Artificial Intelligence', 'د. نجلاء سعيد', 'م. عمر جمعة', 1, 1, '#60A5FA', 'cpu'],
  ['web-applications', 'تطبيقات الويب', 'Web Applications', 'د. شريف', 'غير محدد', 1, 1, '#34D399', 'globe'],
  ['ds-fundamentals', 'أساسيات علم البيانات', 'Data Science Fundamentals', 'د. شريف', 'م. آية ندى و م. رضوى (معاً)', 1, 1, '#E879F9', 'chart'],
  ['history-of-technology', 'تاريخ التكنولوجيا', 'History of Technology', 'د. شريف', 'لا يوجد', 0, 0, '#FBBF24', 'clock'],
  ['health-safety', 'الصحة والسلامة', 'Health and Safety', 'غير محدد', 'لا يوجد', 0, 0, '#FB7185', 'shield'],
  ['subject-8', 'المادة الثامنة — قريباً', 'Eighth subject — coming soon', '—', '—', 1, 1, '#94A3B8', 'sparkles'],
];

async function seedAll(db, cfg, { csvPath = path.join(__dirname, '..', 'data', 'students.csv'), log = console.log } = {}) {
  const rows = parse(fs.readFileSync(csvPath, 'utf8'), { columns: true, bom: true, skip_empty_lines: true });
  const up = db.prepare(`INSERT INTO students (code,name,name_normalized,name_raw,hall,seq) VALUES (@code,@name,@n,@raw,@hall,@seq)
    ON CONFLICT(code) DO UPDATE SET name=excluded.name, name_normalized=excluded.name_normalized,
      name_raw=excluded.name_raw, hall=excluded.hall, seq=excluded.seq`);          // email / is_active untouched
  db.transaction(() => rows.forEach(r => up.run({ code: r.code, name: r.name, n: normalizeArabic(r.name),
    raw: r.name_raw, hall: r.hall === 'None' ? null : r.hall, seq: r.seq ? +r.seq : null })))();

  const ins = db.prepare(`INSERT OR IGNORE INTO subjects (slug,title_ar,title_en,doctor_name,ta_names,has_sections,has_tasks,color,icon,sort_order)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);                                                // OR IGNORE: keeps admin edits
  db.transaction(() => SUBJECTS.forEach((s, i) => ins.run(...s, i)))();

  let adminCreated = false;
  if (!db.prepare('SELECT 1 FROM admins WHERE email=?').get(cfg.ADMIN_EMAIL)) {
    if (!cfg.ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD (>=10 chars) must be set in .env for the first seed');
    db.prepare('INSERT INTO admins (display_name,email,password_hash,totp_secret) VALUES (?,?,?,?)')
      .run(cfg.ADMIN_DISPLAY_NAME, cfg.ADMIN_EMAIL, await argon2.hash(cfg.ADMIN_PASSWORD, { type: argon2.argon2id }), cfg.ADMIN_TOTP_SECRET || null);
    adminCreated = true;
  }
  const out = { students: db.prepare('SELECT COUNT(*) c FROM students').get().c,
    subjects: db.prepare('SELECT COUNT(*) c FROM subjects').get().c, adminCreated };
  log(`seed: ${out.students} students, ${out.subjects} subjects, admin ${adminCreated ? 'created' : 'already exists'}`);
  return out;
}
module.exports = { seedAll, SUBJECTS };
