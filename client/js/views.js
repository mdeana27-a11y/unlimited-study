import { t, lang } from './i18n.js';
import { $, $$, esc, api, state, icon, logo, themeIcon, enter, countUp, reveal, applyAccents, toast, RM, fmtDay, fmtSize, num, checkSvg, asciiDigits } from './core.js';

/* ───────── shared chrome ───────── */
export function shell(inner, { wide = false } = {}) {
  const u = state.user;
  return `<a href="#main" class="sr focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 btn">${t('skip')}</a>
  <header class="max-w-6xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-3">
    <a href="#/" class="flex items-center gap-2.5 font-bold text-lg" aria-label="${t('brand')}">${logo()}<span class="hidden min-[420px]:inline whitespace-nowrap">${t('brand')}</span></a>
    <nav class="flex items-center gap-2" aria-label="main">
      ${u ? `<span class="chip hidden sm:inline-flex" title="${esc(u.name)}">${esc(u.name.split(' ').slice(0, 2).join(' '))}</span>` : ''}
      ${u?.type === 'admin' ? `<a class="btn ghost sm" href="#/admin" aria-label="${t('admin_panel')}">${icon('grid', 'w-4 h-4')}<span class="hidden sm:inline">${t('admin_panel')}</span></a>` : ''}
      <button class="btn ghost sm nomag" id="langBtn">${t('lang_toggle')}</button>
      <button class="btn ghost sm nomag !px-2.5" id="themeBtn" aria-label="${t('theme')}">${themeIcon()}</button>
      ${u ? `<button class="btn ghost sm" id="outBtn" aria-label="${t('logout')}">${icon('logout', 'w-4 h-4 flip')}<span class="hidden sm:inline">${t('logout')}</span></button>` : ''}
    </nav></header>
  <main id="main" tabindex="-1" class="${wide ? 'max-w-6xl' : 'max-w-5xl'} mx-auto px-4 sm:px-6 pb-20">${inner}</main>`;
}
const skeletons = n => `<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">${'<div class="skel"></div>'.repeat(n)}</div>`;

/* ───────── Login ───────── */
export async function loginView(app, { onDone, setMode }) {
  const cfg = state.config;
  app.innerHTML = shell(`
  <div class="grid lg:grid-cols-[1.1fr_1fr] gap-10 items-center min-h-[72vh] pt-4">
    <section aria-labelledby="h">
      <div class="lg-logo inline-block">${logo('w-14 h-14')}</div>
      <h1 id="h" class="lg-title ${lang === 'ar' ? 'text-right' : 'text-left'} mt-5 font-bold leading-[1.05] text-5xl sm:text-6xl lg:text-7xl" dir="ltr"><span class="block">Unlimited</span><span class="block grad-text">Study</span></h1>
      <p class="lg-sub mt-6 text-lg max-w-md text-mute leading-relaxed">${t('tagline')}</p>
      <p class="lg-sub mt-4 text-sm text-mute">${t('college')}</p>
      <p class="lg-sub mt-1 text-sm text-mute">${t('by')}</p>
    </section>
    <section class="lg-card glass p-6 sm:p-8 will-change-transform" id="card" aria-label="${t('login')}">
      <div class="seg" role="tablist" id="seg"><span class="thumb" aria-hidden="true"></span>
        <button role="tab" id="tab-name" aria-selected="true" data-m="name">${t('tab_name')}</button>
        <button role="tab" id="tab-google" aria-selected="false" data-m="google">${t('tab_google')}</button></div>
      <div id="pane" class="mt-6" role="tabpanel"></div>
      <p class="mt-6 text-xs text-mute leading-relaxed">${icon('lock', 'w-3.5 h-3.5 inline-block align-[-2px] me-1')}${t('privacy')}</p>
      <button class="mt-3 text-sm text-mute underline underline-offset-4 hover:text-ink min-h-[44px]" id="adminLink">${t('admin_entry')}</button>
    </section></div>`);
  const card = $('#card'), pane = $('#pane'), seg = $('#seg');

  const moveThumb = () => { const b = $('[aria-selected="true"]', seg), th = $('.thumb', seg); if (!b) { th.style.opacity = 0; return; }
    th.style.opacity = 1; th.style.width = b.offsetWidth + 'px'; th.style.transform = `translateX(${b.offsetLeft}px)`; };
  const fail = (m, form) => { toast(m, 'err'); card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); form?.querySelectorAll('input').forEach(i => i.setAttribute('aria-invalid', 'true')); };
  const field = (id, label, o = {}) => `<label class="grid gap-1.5 text-sm font-medium" for="${id}">${label}<input class="field" id="${id}" name="${o.name || id}" type="${o.type || 'text'}" ${o.ph ? `placeholder="${o.ph}"` : ''} ${o.ac ? `autocomplete="${o.ac}"` : ''} ${o.mode ? `inputmode="${o.mode}"` : ''} ${o.max ? `maxlength="${o.max}"` : ''} ${o.dir ? `dir="${o.dir}"` : ''} required><span class="text-xs text-rose-400 min-h-[1rem]" data-err="${o.name || id}" role="alert"></span></label>`;

  // success: card morphs into a drawn checkmark, then the dashboard
  const success = async () => {
    const done = () => { const c = $('#card'); c.innerHTML = `<div class="grid place-items-center py-14 text-emerald-400" role="status">${checkSvg}</div>`;
      if (RM.matches) return setTimeout(onDone, 300);
      gsap.fromTo(c, { scale: .98 }, { scale: 1, duration: .3 }); setTimeout(() => gsap.to(c, { scale: 1.06, opacity: 0, y: -20, duration: .5, ease: 'power2.in', onComplete: onDone }), 650); };
    done();
  };
  const validate = (form, rules) => { let ok = true;
    for (const [n, test, msg] of rules) { const i = form.elements[n], e = $(`[data-err="${n}"]`, form), bad = !test(i.value.trim());
      i.setAttribute('aria-invalid', bad); e.textContent = bad ? msg : ''; ok &&= !bad; } return ok; };
  const wireLive = (form, rules) => rules.forEach(([n]) => form.elements[n].addEventListener('input', () => validate(form, rules.filter(r => r[0] === n))));
  const bad = [['name', v => v.split(/\s+/).filter(Boolean).length >= 3, t('v_name')], ['code', v => /^\d{7}$/.test(asciiDigits(v)), t('v_code')]];

  const modes = {
    name() {
      pane.innerHTML = `<form class="grid gap-4" novalidate>${field('name', t('f_name'), { ph: t('f_name_ph'), ac: 'name' })}${field('code', t('f_code'), { ph: t('f_code_ph'), mode: 'numeric', max: 7, dir: 'ltr' })}<button class="btn mt-1">${t('login')}</button></form>`;
      const f = $('form', pane); wireLive(f, bad);
      f.onsubmit = async e => { e.preventDefault(); if (!validate(f, bad)) return fail(t('err_invalid_input'));
        const b = $('.btn', f); b.disabled = true;
        try { state.user = (await api('/api/auth/login', { method: 'POST', body: { name: f.name.value.trim(), code: asciiDigits(f.code.value.trim()) } })).user; success(); }
        catch (er) { b.disabled = false; fail(er.message, f); } };
    },
    google() {
      if (!cfg.googleEnabled || !cfg.googleClientId) { pane.innerHTML = `<p class="text-sm text-mute leading-relaxed">${t('google_off')}</p><button class="btn ghost mt-4 w-full" disabled aria-disabled="true">${icon('google')} ${t('google_btn')}</button>`; return; }
      pane.innerHTML = `<p class="text-sm text-mute mb-4 leading-relaxed">${t('google_hint')}</p><div id="gbtn" class="min-h-[44px] flex justify-center"></div><div id="linkbox"></div>`;
      const init = () => { google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: onCred }); google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', shape: 'pill', size: 'large', locale: lang, width: 280 }); };
      if (window.google?.accounts) init(); else { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = init; document.head.append(s); }
      async function onCred({ credential }) {
        try { const r = await api('/api/auth/google', { method: 'POST', body: { credential } });
          if (!r.needsLink) { state.user = r.user; return success(); }
          $('#gbtn').remove(); $('#linkbox').innerHTML = `<h2 class="font-bold mb-1">${t('link_title')}</h2><p class="text-xs text-mute mb-4 num" dir="ltr">${t('link_for')} ${esc(r.email)}</p><form class="grid gap-4" novalidate>${field('name', t('f_name'), { ac: 'name' })}${field('code', t('f_code'), { mode: 'numeric', max: 7, dir: 'ltr' })}<button class="btn">${t('link_go')}</button></form>`;
          const f = $('#linkbox form'); wireLive(f, bad);
          f.onsubmit = async e => { e.preventDefault(); if (!validate(f, bad)) return fail(t('err_invalid_input'));
            try { state.user = (await api('/api/auth/google/link', { method: 'POST', body: { linkToken: r.linkToken, name: f.name.value.trim(), code: asciiDigits(f.code.value.trim()) } })).user; success(); } catch (er) { fail(er.message, f); } };
        } catch (er) { fail(er.message); } }
    },
    admin() {
      pane.innerHTML = `<form class="grid gap-4" novalidate><h2 class="font-bold">${t('admin_entry')}</h2>${field('email', t('f_email'), { type: 'email', ac: 'username', dir: 'ltr' })}${field('password', t('f_password'), { type: 'password', ac: 'current-password', dir: 'ltr' })}
        <label class="grid gap-1.5 text-sm font-medium">${t('f_totp')}<input class="field" name="totp" inputmode="numeric" maxlength="6" dir="ltr" autocomplete="one-time-code"></label><div class="flex gap-2"><button class="btn flex-1">${t('login')}</button><button type="button" class="btn ghost" id="bk">${t('back')}</button></div></form>`;
      $('#bk').onclick = () => setSeg('name'); const f = $('form', pane);
      f.onsubmit = async e => { e.preventDefault(); const body = { email: f.email.value.trim(), password: f.password.value }; if (f.totp.value.trim()) body.totp = f.totp.value.trim();
        try { state.user = (await api('/api/auth/admin', { method: 'POST', body })).user; success(); } catch (er) { fail(er.message, f); } };
    },
  };
  function setSeg(m) { $$('[data-m]', seg).forEach(b => b.setAttribute('aria-selected', b.dataset.m === m)); modes[m](); moveThumb();
    if (!RM.matches) gsap.fromTo(pane, { opacity: 0, x: (lang === 'ar' ? -1 : 1) * 14 }, { opacity: 1, x: 0, duration: .35, ease: 'power2.out' }); }
  $$('[data-m]', seg).forEach(b => (b.onclick = () => setSeg(b.dataset.m)));
  $('#adminLink').onclick = () => { $$('[data-m]', seg).forEach(b => b.setAttribute('aria-selected', 'false')); moveThumb(); modes.admin(); };
  modes.name(); requestAnimationFrame(moveThumb); addEventListener('resize', moveThumb, { once: true }); document.fonts?.ready.then(moveThumb);

  // staged entrance: logo -> title -> copy -> card
  if (RM.matches) gsap.fromTo('.lg-logo,.lg-title,.lg-sub,.lg-card', { opacity: 0 }, { opacity: 1, duration: .3 });
  else {
    const tl = gsap.timeline({ defaults: { ease: 'power3.out' } });
    tl.from('.lg-logo', { scale: .4, rotate: -25, opacity: 0, duration: .7, ease: 'back.out(2)' }).from('.lg-title span', { yPercent: 110, opacity: 0, duration: .8, stagger: .12 }, '-=.35')
      .from('.lg-sub', { opacity: 0, y: 16, stagger: .08, duration: .5 }, '-=.4').from('.lg-card', { opacity: 0, y: 40, rotateX: -8, duration: .8 }, '-=.7');
    // floating card + 3D tilt on pointer move
    if (matchMedia('(pointer: fine)').matches) {
      gsap.to(card, { y: -6, duration: 3, ease: 'sine.inOut', yoyo: true, repeat: -1, delay: 1.2 });
      card.style.transformPerspective = 900;
      const rx = gsap.quickTo(card, 'rotationX', { duration: .5, ease: 'power3' }), ry = gsap.quickTo(card, 'rotationY', { duration: .5, ease: 'power3' });
      card.addEventListener('pointermove', e => { const r = card.getBoundingClientRect(); ry(((e.clientX - r.left) / r.width - .5) * 8); rx(-((e.clientY - r.top) / r.height - .5) * 8); });
      card.addEventListener('pointerleave', () => { rx(0); ry(0); });
    }
  }
}

/* ───────── Dashboard ───────── */
export async function dashView(app) {
  const u = state.user;
  app.innerHTML = shell(`<h1 class="text-3xl sm:text-4xl font-bold mt-4">${t('hello')} ${esc(u.name.split(' ')[0])}</h1>
    <p class="mt-2 text-mute">${t('pick')} <span class="chip ms-1">${esc(state.config.cohortLabel)}</span></p>
    <div id="stats" class="grid grid-cols-3 gap-3 mt-6 max-w-xl"></div><div id="ann" class="mt-8"></div><div class="mt-8" id="grid">${skeletons(8)}</div>`, { wide: true });
  const [{ subjects }, { announcements }] = await Promise.all([api('/api/subjects'), api('/api/announcements')]);
  const newTotal = subjects.reduce((a, s) => a + s.new_count, 0);
  $('#stats').innerHTML = [[subjects.length, 'subjects'], [newTotal, 'new_items'], [announcements.length, 'announcements']].map(([n, k]) =>
    `<div class="glass p-4"><div class="text-3xl font-bold num" data-count="${n}">0</div><div class="text-xs text-mute mt-1">${t(k)}</div></div>`).join('');
  $$('[data-count]').forEach(e => countUp(e, +e.dataset.count));
  if (announcements.length) $('#ann').innerHTML = `<h2 class="font-bold mb-3 flex items-center gap-2">${icon('megaphone')} ${t('ann_title')}</h2><div class="grid gap-3 md:grid-cols-2">${announcements.slice(0, 4).map(a =>
    `<article class="glass p-4 reveal"><div class="flex items-center gap-2 font-semibold">${a.pinned ? `<span class="text-amber-400">${icon('pin', 'w-4 h-4')}</span>` : ''}${esc(a.title)}</div>${a.body ? `<p class="text-sm text-mute mt-1 whitespace-pre-line">${esc(a.body)}</p>` : ''}</article>`).join('')}</div>`;
  $('#grid').innerHTML = `<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">${subjects.map(s => `
    <a class="glass card subj" href="#/s/${s.slug}" data-ac="${esc(s.color)}">
      <div class="flex items-start justify-between"><span class="grid place-items-center w-11 h-11 rounded-xl ic-tile" data-ac="${esc(s.color)}">${icon(s.icon, 'w-6 h-6')}</span>
        ${s.new_count ? `<span class="chip new">${num(s.new_count)} ${t('new')}</span>` : ''}</div>
      <h3 class="font-bold text-lg mt-4 leading-snug">${esc(lang === 'ar' ? s.title_ar : s.title_en)}</h3>
      <p class="text-xs text-mute mt-0.5 text-start" dir="${lang === 'ar' ? 'ltr' : 'rtl'}">${esc(lang === 'ar' ? s.title_en : s.title_ar)}</p>
      <p class="text-sm mt-4">${esc(s.doctor_name || '—')}</p><p class="text-xs text-mute mt-0.5">${esc(s.ta_names || t('no_ta'))}</p>
      <div class="flex items-center justify-between mt-4"><span class="chip num">${num(s.items_count)} ${t('items')}</span><span class="text-mute flip">${icon('chev', 'w-4 h-4')}</span></div></a>`).join('')}</div>`;
  applyAccents(app); $$('.subj').forEach(c => { c.style.setProperty('--ac', c.dataset.ac); });
  enter('#grid .card', { y: 30, stagger: .06 }); reveal($$('.reveal'));
}

/* ───────── Subject hub ───────── */
export async function subjectView(app, slug) {
  app.innerHTML = shell(`<div class="skel mt-4 min-h-[9rem]"></div>`);
  const d = await api('/api/subjects/' + encodeURIComponent(slug)), s = d.subject;
  const matKey = 'mat_' + s.slug.replace(/-/g, '_'); const matLabel = t(matKey) === matKey ? t('mat_default') : t(matKey);
  const tabs = [['lectures', t('t_lectures'), d.lectures]]; if (s.has_sections) tabs.push(['sections', t('t_sections'), d.sections]); if (s.has_tasks) tabs.push(['tasks', t('t_tasks'), d.tasks]); tabs.push(['materials', matLabel, d.materials]);
  let cur = tabs[0][0];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());   // YYYY-MM-DD in Cairo, not UTC
  const files = fs => fs?.length ? `<div class="flex flex-wrap gap-2 mt-3">${fs.map(f => `<a class="btn sm ghost" href="/api/files/${f.id}" download>${icon('download', 'w-4 h-4')} ${esc(f.original_name)} <span class="text-mute num text-xs">${fmtSize(f.size)}</span></a>`).join('')}</div>` : '';
  const item = (x, kind) => kind === 'materials'
    ? `<article class="glass p-4 reveal flex items-center justify-between gap-3 flex-wrap"><div class="flex items-center gap-3">${icon('file', 'w-5 h-5 text-mute')}<span class="font-semibold break-all">${esc(x.original_name)}</span>${x.is_new ? `<span class="chip new">${t('new')}</span>` : ''}</div><a class="btn sm" href="/api/files/${x.id}" download>${icon('download', 'w-4 h-4')} ${t('download')} <span class="text-xs opacity-80 num">${fmtSize(x.size)}</span></a></article>`
    : `<article class="glass p-5 reveal"><div class="flex items-start justify-between gap-3 flex-wrap"><h2 class="font-bold text-lg">${esc(x.title)}</h2><div class="flex gap-2 flex-wrap">${x.is_new ? `<span class="chip new">${t('new')}</span>` : ''}${x.week_no != null ? `<span class="chip num">${t('week')} ${num(x.week_no)}</span>` : ''}
      ${x.due_at ? `<span class="chip num ${x.due_at < today ? 'late' : ''}">${x.due_at < today ? t('overdue') + ' · ' : ''}${t('due')}: ${fmtDay(x.due_at)}</span>` : ''}</div></div>
      ${x.description ? `<p class="text-sm text-mute mt-2 whitespace-pre-line leading-relaxed">${esc(x.description)}</p>` : ''}${files(x.files)}</article>`;
  const paint = () => { const rows = tabs.find(x => x[0] === cur)[2];
    $('#list').innerHTML = rows.length ? rows.map(r => item(r, cur)).join('') : `<div class="glass p-10 text-center text-mute">${icon(s.icon, 'w-10 h-10 mx-auto mb-3 opacity-60')}${t('empty')}</div>`;
    enter('#list > *', { y: 16, stagger: .05, duration: .45 }); reveal($$('#list .reveal')); };
  app.innerHTML = shell(`
    <a href="#/" class="inline-flex items-center gap-1.5 text-sm text-mute hover:text-ink min-h-[44px]"><span class="flip rotate-180">${icon('chev', 'w-4 h-4')}</span> ${t('all_subjects')}</a>
    <section class="glass p-6 sm:p-8 mt-2 relative overflow-hidden" id="hub" data-ac="${esc(s.color)}">
      <span class="absolute -top-24 -end-24 w-72 h-72 rounded-full blur-3xl opacity-30 blob" data-ac="${esc(s.color)}"></span>
      <div class="relative flex items-center gap-4"><span class="grid place-items-center w-14 h-14 rounded-2xl ic-tile" data-ac="${esc(s.color)}">${icon(s.icon, 'w-8 h-8')}</span>
        <div><h1 class="text-2xl sm:text-3xl font-bold">${esc(lang === 'ar' ? s.title_ar : s.title_en)}</h1><p class="text-sm text-mute text-start" dir="${lang === 'ar' ? 'ltr' : 'rtl'}">${esc(lang === 'ar' ? s.title_en : s.title_ar)}</p></div></div>
      <div class="relative flex flex-wrap gap-2 mt-5"><span class="chip">${t('doctor')}: ${esc(s.doctor_name || '—')}</span><span class="chip">${t('ta')}: ${esc(s.ta_names || t('no_ta'))}</span></div></section>
    <div class="tabs mt-6" role="tablist" data-ac="${esc(s.color)}" id="tabs">${tabs.map(([k, l, r]) => `<button role="tab" data-k="${k}" aria-selected="${k === cur}">${l} <span class="chip num ms-1">${num(r.length)}</span></button>`).join('')}</div>
    <div id="list" class="grid gap-3 mt-5" role="tabpanel"></div>`);
  applyAccents(app); $('#hub').style.setProperty('--ac', s.color); $('#tabs').style.setProperty('--ac', s.color);
  $$('#hub [data-ac]').forEach(e => e.style.setProperty('--ac', s.color));
  $$('#tabs button').forEach(b => (b.onclick = () => { cur = b.dataset.k; $$('#tabs button').forEach(x => x.setAttribute('aria-selected', x === b)); paint(); }));
  enter('#hub', { y: 20 }); paint();
}
