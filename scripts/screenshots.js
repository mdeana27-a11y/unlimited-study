// Real-browser verification: boots the app on a temp DB, drives it with headless Chromium, saves screenshots to
// docs/screenshots and writes docs/ui-verification.json (console/CSP errors, axe-core a11y, overflow, reduced-motion, SSE).
// NOTE: the content shown (lectures, logins) is DEMO data created in a throw-away database for the screenshots only.
const fs = require('fs'), os = require('os'), path = require('path');
const { chromium } = require('playwright-core'); const spm = require('@sparticuz/chromium'); const sp = spm.default || spm;
const { loadConfig } = require('../server/config'); const { openDb } = require('../server/db'); const { createApp } = require('../server/app'); const { seedAll } = require('../server/seed');
const OUT = path.join(__dirname, '..', 'docs', 'screenshots'); fs.mkdirSync(OUT, { recursive: true });
const PORT = 3123, BASE = `http://localhost:${PORT}`, ADMIN = { email: 'mostafa@demo.dev', password: 'DemoPassw0rd!2026' };
const students = require('csv-parse/sync').parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'students.csv'), 'utf8'), { columns: true, bom: true });
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
const PHASE = process.argv[2] || 'dark';   // dark | light | misc | merge  (each phase fits in one tool call)
if (PHASE === 'merge') {
  const parts = ['dark', 'light', 'misc'].map(n => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', `.ui-${n}.json`), 'utf8')));
  const all = { pages: parts.flatMap(p => p.pages), notes: parts.flatMap(p => p.notes), reducedMotion: parts[2].reducedMotion, motionControl: parts[2].motionControl };
  fs.writeFileSync(path.join(__dirname, '..', 'docs', 'ui-verification.json'), JSON.stringify(all, null, 1));
  console.log('merged', all.pages.length, 'audited pages;', all.pages.reduce((a, p) => a + p.axeViolations.length, 0), 'axe violations;', all.pages.filter(p => p.horizontalOverflowPx > 0).length, 'overflow pages'); process.exit(0);
}
const report = { pages: [], notes: [] };

async function jar() {
  const c = {}; const store = r => r.headers.getSetCookie().forEach(s => { const kv = s.split(';')[0], i = kv.indexOf('='); c[kv.slice(0, i)] = kv.slice(i + 1); });
  const call = async (m, u, body, raw) => { const h = { cookie: Object.entries(c).map(([k, v]) => `${k}=${v}`).join('; ') }; if (m !== 'GET') h['x-csrf-token'] = c.csrf;
    if (body && !raw) { h['content-type'] = 'application/json'; body = JSON.stringify(body); } const r = await fetch(BASE + u, { method: m, headers: h, body }); store(r); return r; };
  await call('GET', '/api/csrf'); return call.bind(null) && Object.assign(call, { c });
}
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'us-shots-'));
  const cfg = loadConfig({ NODE_ENV: 'development', SESSION_SECRET: 'x'.repeat(40), ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password, STORAGE_DIR: dir, LOG_LEVEL: 'silent', RATE_LIMIT_AUTH: '500', RATE_LIMIT_ADMIN: '500' });
  const db = openDb(cfg.DB_FILE); await seedAll(db, cfg, { log: () => {} });
  const { app, repo } = createApp({ cfg, db }); const server = app.listen(PORT);

  // ── demo content + demo activity through the real API ──
  const adm = await jar(); await adm('POST', '/api/auth/admin', ADMIN);
  const subj = s => repo.subjectBySlug(s).id;
  const mk = async (kind, slug, d) => (await (await adm('POST', '/api/admin/' + kind, { subject_id: subj(slug), ...d })).json()).id;
  const pdf = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
  const up = async (kind, id, name) => { const fd = new FormData(); fd.append('owner_kind', kind); fd.append('owner_id', String(id)); fd.append('files', new Blob([pdf], { type: 'application/pdf' }), name); await adm('POST', '/api/admin/files', fd, true); };
  const l1 = await mk('lectures', 'artificial-intelligence', { title: 'المحاضرة 1 — مقدمة في الذكاء الاصطناعي', description: 'تعريف الذكاء الاصطناعي وتاريخه وتطبيقاته.', week_no: 1 }); await up('lecture', l1, 'AI-Lecture-1.pdf');
  await mk('lectures', 'artificial-intelligence', { title: 'المحاضرة 2 — البحث وحل المشكلات', week_no: 2 });
  const s1 = await mk('sections', 'artificial-intelligence', { title: 'سكشن 1 — Python للذكاء الاصطناعي', week_no: 1 }); await up('section', s1, 'Section-1.pdf');
  const t1 = await mk('tasks', 'artificial-intelligence', { title: 'التاسك الأول: خوارزمية BFS', description: 'نفّذ BFS على خريطة المدن.', due_at: '2026-12-20' }); await up('task', t1, 'Task-1.pdf');
  await mk('lectures', 'data-engineering', { title: 'المحاضرة 1 — خطوات هندسة البيانات', week_no: 1 });
  await mk('lectures', 'history-of-technology', { title: 'المحاضرة 1 — الثورات الصناعية', week_no: 1 });
  await up('subject', subj('history-of-technology'), 'Reading-List.pdf');
  await adm('POST', '/api/admin/announcements', { title: 'بداية الميدتيرم الأسبوع القادم', body: 'راجعوا المحاضرات من 1 إلى 5.', pinned: true });
  for (const s of students.slice(0, 14)) { const j = await jar(); const r = await j('POST', '/api/auth/login', { name: s.name, code: s.code }); if (r.ok) { await j('GET', '/api/subjects/artificial-intelligence'); await j('GET', '/api/subjects/data-engineering'); } }
  const bad = await jar(); for (const code of ['2570010', '2570011', '2570012']) await bad('POST', '/api/auth/login', { name: 'اسم غلط تماما هنا', code });

  const exe = await sp.executablePath(); const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--hide-scrollbars'], headless: true });
  const VP = { mobile: { width: 360, height: 780 }, tablet: { width: 768, height: 1024 }, desktop: { width: 1280, height: 800 }, wide: { width: 1920, height: 1080 } };
  const S = students[9];   // احمد بلال اسماعيل عبدالرحمن (a lam-alef name)
  async function newPage(vp, theme, lang, extra = {}) {
    const ctx = await browser.newContext({ viewport: VP[vp], deviceScaleFactor: 1, isMobile: vp === 'mobile', hasTouch: vp === 'mobile', ...extra });
    await ctx.addInitScript(([th, lg]) => { localStorage.setItem('us-theme', th); localStorage.setItem('us-lang', lg); }, [theme, lang]);
    const page = await ctx.newPage(); const errs = [];
    page.on('console', m => { if (['error', 'warning'].includes(m.type())) errs.push(m.text().slice(0, 240)); }); page.on('pageerror', e => errs.push('pageerror: ' + e.message)); page.on('requestfailed', r => { if (!r.url().includes('/api/admin/stream')) errs.push('requestfailed: ' + r.url()); });   // the SSE stream is aborted on navigation on purpose
    return { ctx, page, errs };
  }
  const settle = p => p.waitForTimeout(1900);   // let entrance animations finish
  async function audit(name, page, errs) {
    console.log('audit', name); const T = setTimeout(() => console.log('  ...audit slow', name), 15000);
    await page.evaluate(axeSrc);   // string expression => CDP Runtime.evaluate, which the page CSP does not block
    const axe = await page.evaluate(async () => { const r = await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] }); return { violations: r.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help })), incompleteContrast: r.incomplete.filter(i => i.id === 'color-contrast').reduce((a, i) => a + i.nodes.length, 0), passes: r.passes.length }; });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    clearTimeout(T); console.log('  audited', name, axe.violations.length);
    report.pages.push({ name, axeViolations: axe.violations, axePasses: axe.passes, contrastNeedsManualReview: axe.incompleteContrast, horizontalOverflowPx: overflow, consoleErrors: [...errs] });
  }
  const shot = (page, n, full) => (console.log('shot', n), page.screenshot({ path: path.join(OUT, n + '.png'), fullPage: !!full }));
  const loginUI = async page => { await page.goto(BASE + '/#/login'); await page.waitForSelector('#card'); await settle(page); };
  const doLogin = async (page, s) => { await page.fill('#name', s.name); await page.fill('#code', s.code); await page.click('#card .btn', { force: true }); await page.waitForSelector('.subj', { timeout: 8000 }); await settle(page); };

  for (const theme of PHASE === 'misc' ? [] : [PHASE]) {
    // login page: all breakpoints
    for (const vp of ['mobile', 'tablet', 'desktop', 'wide']) { const { ctx, page, errs } = await newPage(vp, theme, 'ar'); await loginUI(page); await shot(page, `login-${theme}-${vp}-ar`); if (vp === 'desktop' || vp === 'mobile') await audit(`login ${theme} ${vp} ar`, page, errs); await ctx.close(); }
    // validation + shake
    { const { ctx, page } = await newPage('desktop', theme, 'ar'); await loginUI(page); await page.fill('#name', 'احمد'); await page.fill('#code', '12'); await page.click('#card .btn', { force: true }); await page.waitForTimeout(500); if (theme === 'dark') await shot(page, 'login-dark-desktop-validation-ar'); await ctx.close(); }
    // student journey
    for (const vp of ['mobile', 'tablet', 'desktop', 'wide']) {
      const { ctx, page, errs } = await newPage(vp, theme, 'ar'); await loginUI(page); await doLogin(page, S);
      await shot(page, `dashboard-${theme}-${vp}-ar`, vp === 'mobile'); if (vp === 'desktop' || vp === 'mobile') await audit(`dashboard ${theme} ${vp} ar`, page, errs);
      await page.goto(BASE + '/#/s/artificial-intelligence'); await page.waitForSelector('#hub'); await settle(page); await shot(page, `subject-${theme}-${vp}-ar`, vp === 'mobile'); if (vp === 'desktop' || vp === 'mobile') await audit(`subject ${theme} ${vp} ar`, page, errs);
      if (vp === 'desktop') { await page.click('#tabs [data-k="tasks"]', { force: true }); await page.waitForTimeout(700); await shot(page, `subject-tasks-${theme}-desktop-ar`); }
      await ctx.close();
    }
    // admin
    for (const vp of ['mobile', 'desktop', 'wide']) {
      const { ctx, page, errs } = await newPage(vp, theme, 'ar'); await loginUI(page); await page.click('#adminLink', { force: true }); await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password); await page.click('#card .btn', { force: true });
      await page.waitForSelector('.subj'); await page.goto(BASE + '/#/admin/overview'); await page.waitForSelector('#ch-day'); await page.waitForTimeout(2600);
      await shot(page, `admin-overview-${theme}-${vp}-ar`, vp === 'mobile'); if (vp !== 'wide') await audit(`admin overview ${theme} ${vp} ar`, page, errs);
      if (vp === 'desktop') { await page.goto(BASE + '/#/admin/activity'); await page.waitForSelector('#rows tr'); await page.waitForTimeout(600); await shot(page, `admin-activity-${theme}-desktop-ar`); await audit(`admin activity ${theme} desktop ar`, page, errs);
        await page.goto(BASE + '/#/admin/roster'); await page.waitForSelector('#rr tr'); await page.waitForTimeout(500); await shot(page, `admin-roster-${theme}-desktop-ar`);
        await page.goto(BASE + '/#/admin/content'); await page.waitForSelector('#subjSel'); await page.waitForTimeout(600); await shot(page, `admin-content-${theme}-desktop-ar`); await audit(`admin content ${theme} desktop ar`, page, errs); }
      await ctx.close();
    }
  }
  if (PHASE === 'misc') {
  // English / LTR
  { const { ctx, page, errs } = await newPage('desktop', 'dark', 'en'); await loginUI(page); await shot(page, 'login-dark-desktop-en'); await audit('login dark desktop en', page, errs); await doLogin(page, S); await shot(page, 'dashboard-dark-desktop-en');
    await page.goto(BASE + '/#/s/artificial-intelligence'); await page.waitForSelector('#hub'); await settle(page); await shot(page, 'subject-dark-desktop-en'); await ctx.close(); }
  // live SSE: open activity tab as admin, trigger a failed login elsewhere, expect a new top row without reload
  { const { ctx, page } = await newPage('desktop', 'dark', 'ar'); await loginUI(page); await page.click('#adminLink', { force: true }); await page.fill('input[name=email]', ADMIN.email); await page.fill('input[name=password]', ADMIN.password); await page.click('#card .btn', { force: true });
    await page.waitForSelector('.subj'); await page.goto(BASE + '/#/admin/activity'); await page.waitForSelector('#rows tr'); await page.waitForTimeout(800);
    const before = await page.locator('#rows tr').first().getAttribute('data-id'); const j = await jar(); await j('POST', '/api/auth/login', { name: 'مين انا هنا فعلا', code: '2570300' });
    await page.waitForFunction(b => document.querySelector('#rows tr')?.dataset.id !== b, before, { timeout: 6000 }).then(() => report.notes.push('SSE: new activity row appeared live without reload: PASS'), () => report.notes.push('SSE: live row did NOT appear: FAIL'));
    await ctx.close(); }
  // reduced motion
  { const { ctx, page } = await newPage('desktop', 'dark', 'ar', { reducedMotion: 'reduce' }); await loginUI(page);
    const r = await page.evaluate(() => { const i = document.querySelector('.aurora i'); const cs = getComputedStyle(i); const running = document.getAnimations().filter(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length;
      return { auroraAnimationDuration: cs.animationDuration, infiniteAnimationsRunning: running, cardTransform: getComputedStyle(document.querySelector('#card')).transform }; });
    report.reducedMotion = r; await shot(page, 'login-dark-desktop-reduced-motion-ar'); await ctx.close(); }
  // control: with motion allowed the aurora does animate
  { const { ctx, page } = await newPage('desktop', 'dark', 'ar'); await loginUI(page); report.motionControl = await page.evaluate(() => ({ auroraAnimationDuration: getComputedStyle(document.querySelector('.aurora i')).animationDuration })); await ctx.close(); }
  }
  await browser.close(); server.close(); db.close();
  fs.writeFileSync(path.join(__dirname, '..', 'docs', `.ui-${PHASE}.json`), JSON.stringify(report, null, 1));
  const v = report.pages.flatMap(p => p.axeViolations.map(x => `${p.name}: ${x.id}(${x.impact}) x${x.nodes}`)); const e = report.pages.flatMap(p => p.consoleErrors.map(x => `${p.name}: ${x}`));
  console.log('pages audited:', report.pages.length, '| axe violations:', v.length, '| console msgs:', e.length, '| overflow:', report.pages.filter(p => p.horizontalOverflowPx > 0).map(p => `${p.name}=${p.horizontalOverflowPx}`));
  console.log(v.slice(0, 12).join('\n')); console.log([...new Set(e)].slice(0, 8).join('\n')); console.log(JSON.stringify({ rm: report.reducedMotion, ctl: report.motionControl, notes: report.notes }));
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
