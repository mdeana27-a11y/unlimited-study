import { t, lang } from './i18n.js';
import { $, $$, esc, api, upload, icon, enter, countUp, applyWidths, toast, askForm, confirmBox, fmtDate, fmtDay, fmtSize, num, RM } from './core.js';
import { shell } from './views.js';

let es = null, charts = [];
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim().split(/\s+/).join(',');
const rgb = (n, a = 1) => `rgba(${css(n)},${a})`;
export function stopAdmin() { es?.close(); es = null; charts.forEach(c => c.destroy()); charts = []; }
const TABS = ['overview', 'activity', 'roster', 'content'];
const evLabel = e => (t('ev_' + e) === 'ev_' + e ? e : t('ev_' + e));
const mLabel = m => (m ? t('m_' + m) : '—');

export async function adminView(app, tab = 'overview') {
  stopAdmin(); if (!TABS.includes(tab)) tab = 'overview';
  app.innerHTML = shell(`
    <div class="flex items-center justify-between flex-wrap gap-3 mt-2"><h1 class="text-2xl sm:text-3xl font-bold">${t('admin_title')}</h1>
      <span class="chip"><span class="pulse"></span> ${t('live')}</span></div>
    <div class="tabs mt-4" role="tablist" id="atabs">${TABS.map(k => `<button role="tab" data-k="${k}" aria-selected="${k === tab}">${t('a_' + k)}</button>`).join('')}</div>
    <div id="apane" class="mt-6"><div class="skel"></div></div>`, { wide: true });
  $$('#atabs button').forEach(b => (b.onclick = () => (location.hash = '#/admin/' + b.dataset.k)));
  await ({ overview, activity, roster, content })[tab]($('#apane'));
}

/* ───────── Overview: stats, charts, live pulse ───────── */
async function overview(pane) {
  const [o, c] = await Promise.all([api('/api/admin/overview'), api('/api/admin/charts')]);
  const spike = o.failedHour >= 10;
  const stat = (id, n, label, extra = '') => `<div class="glass p-4"><div class="text-3xl font-bold num flex items-center gap-2"><span data-count="${n}" id="${id}">0</span>${extra}</div><div class="text-xs text-mute mt-1">${label}</div></div>`;
  const total = o.methods.reduce((a, m) => a + m.c, 0) || 1;
  pane.innerHTML = `${spike ? `<div class="glass p-3 mb-4 text-sm border-rose-400/60" role="alert">${icon('shield', 'w-4 h-4 inline text-rose-400')} ${t('spike')}: ${num(o.failedHour)}</div>` : ''}
    <div class="grid grid-cols-2 lg:grid-cols-5 gap-3">
      ${stat('s-online', o.online, t('online_now'), '<span class="pulse" aria-hidden="true"></span>')}${stat('s-today', o.loginsToday, t('logins_today'))}${stat('s-week', o.loginsWeek, t('logins_week'))}
      <div class="glass p-4"><div class="text-3xl font-bold num"><span data-count="${o.everPct}">0</span>%</div><div class="text-xs text-mute mt-1">${t('ever_pct')} · ${num(o.everLoggedIn)}/${num(o.rosterTotal)}</div><div class="bar mt-3"><i data-w="${o.everPct}" class="grow-bar"></i></div></div>
      ${stat('s-fail', o.failedHour, t('failed_hr'))}</div>
    <div class="grid lg:grid-cols-2 gap-4 mt-4">
      <section class="glass p-4"><h2 class="font-semibold mb-3">${t('c_day')}</h2><div class="h-56"><canvas id="ch-day" aria-label="${t('c_day')}" role="img"></canvas></div></section>
      <section class="glass p-4"><h2 class="font-semibold mb-3">${t('c_hour')}</h2><div class="h-56"><canvas id="ch-hour" aria-label="${t('c_hour')}" role="img"></canvas></div></section>
      <section class="glass p-4"><h2 class="font-semibold mb-3">${t('c_hall')}</h2><div class="h-56"><canvas id="ch-hall" aria-label="${t('c_hall')}" role="img"></canvas></div></section>
      <section class="glass p-4"><h2 class="font-semibold mb-3">${t('c_subj')}</h2>${c.perSubject.length ? `<div class="h-56"><canvas id="ch-subj" aria-label="${t('c_subj')}" role="img"></canvas></div>` : `<p class="text-mute text-sm">${t('nothing')}</p>`}</section>
      <section class="glass p-4"><h2 class="font-semibold mb-3">${t('methods')}</h2>${o.methods.map(m => `<div class="mb-3"><div class="flex justify-between text-sm"><span>${mLabel(m.method)}</span><span class="num">${num(m.c)}</span></div><div class="bar mt-1"><i data-w="${Math.round(m.c / total * 100)}" class="grow-bar"></i></div></div>`).join('') || `<p class="text-mute text-sm">${t('nothing')}</p>`}</section>
      <section class="glass p-4"><h2 class="font-semibold mb-3">${t('c_files')}</h2><ol class="grid gap-2 text-sm">${c.topFiles.map((f, i) => `<li class="flex justify-between gap-3"><span class="truncate"><span class="text-mute num">${num(i + 1)}.</span> ${esc(f.name)}</span><span class="chip num">${num(f.n)} ${t('downloads')}</span></li>`).join('') || `<li class="text-mute">${t('nothing')}</li>`}</ol></section></div>`;
  $$('[data-count]', pane).forEach(e => countUp(e, +e.dataset.count));
  $$('.grow-bar', pane).forEach(b => { b.style.transformOrigin = lang === 'ar' ? 'right' : 'left'; gsap.fromTo(b, { scaleX: 0 }, { scaleX: +b.dataset.w / 100, duration: RM.matches ? .01 : 1, ease: 'power3.out' }); });
  // charts: Chart.js animates the draw-in; colours come from the active theme tokens
  const ink = rgb('--mute'), grid = rgb('--ink', .08), accent = rgb('--accent'), violet = rgb('--accent2');
  Chart.defaults.font.family = '"IBM Plex Sans Arabic", sans-serif'; Chart.defaults.color = ink; Chart.defaults.animation.duration = RM.matches ? 0 : 1100;
  const base = { responsive: true, maintainAspectRatio: false, layout: { padding: { left: 10, right: 10, top: 6 } }, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, reverse: lang === 'ar' }, y: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 }, position: lang === 'ar' ? 'right' : 'left' } } };
  const mk = (id, cfg) => { const el = $('#' + id); if (el) charts.push(new Chart(el, cfg)); };
  mk('ch-day', { type: 'line', data: { labels: c.perDay.map(d => d.day.slice(5)), datasets: [{ data: c.perDay.map(d => d.n), borderColor: accent, backgroundColor: rgb('--accent', .15), fill: true, tension: .35, pointRadius: 3 }] }, options: base });
  mk('ch-hour', { type: 'bar', data: { labels: c.perHour.map((_, h) => h), datasets: [{ data: c.perHour, backgroundColor: violet, borderRadius: 4 }] }, options: base });
  mk('ch-hall', { type: 'bar', data: { labels: c.perHall.map(h => h.hall), datasets: [{ data: c.perHall.map(h => h.n), backgroundColor: accent, borderRadius: 4 }] }, options: base });
  if (c.perSubject.length) mk('ch-subj', { type: 'bar', data: { labels: c.perSubject.map(s => lang === 'ar' ? s.title_ar : s.title_en), datasets: [{ data: c.perSubject.map(s => s.n), backgroundColor: violet, borderRadius: 4 }] }, options: { ...base, indexAxis: 'y', scales: { x: { beginAtZero: true, grid: { color: grid }, ticks: { precision: 0 }, reverse: lang === 'ar' }, y: { grid: { display: false }, position: lang === 'ar' ? 'right' : 'left' } } } });
  enter('#apane .glass', { y: 18, stagger: .04, duration: .45 });
  // live: online count over SSE; refresh numbers when a login/failure arrives
  let t0; es = new EventSource('/api/admin/stream');
  es.addEventListener('online', e => { const n = JSON.parse(e.data).online; const el = $('#s-online'); if (el) el.textContent = num(n); });
  es.addEventListener('log', e => { const r = JSON.parse(e.data); if (!/^login_/.test(r.event)) return; clearTimeout(t0);
    t0 = setTimeout(async () => { try { const n = await api('/api/admin/overview'); $('#s-today').textContent = num(n.loginsToday); $('#s-week').textContent = num(n.loginsWeek); $('#s-fail').textContent = num(n.failedHour); } catch { /* ignore */ } }, 400);
    if (r.event === 'login_fail') toast(`${t('ev_login_fail')} · ${r.student_code || '—'}`, 'err'); });
}

/* ───────── Activity: filter, paginate, live rows, CSV ───────── */
async function activity(pane) {
  const S = { q: '', from: '', to: '', method: '', event: '', page: 1, pageSize: 25 };
  pane.innerHTML = `<div class="glass p-4"><form id="flt" class="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 items-end">
    <input class="field lg:col-span-2" name="q" placeholder="${t('search')}" aria-label="${t('search')}">
    <label class="text-xs text-mute grid gap-1">${t('from')}<input class="field" type="date" name="from"></label><label class="text-xs text-mute grid gap-1">${t('to')}<input class="field" type="date" name="to"></label>
    <select class="field" name="method" aria-label="${t('col_method')}"><option value="">${t('col_method')}: ${t('all')}</option>${['google', 'name_code', 'admin'].map(m => `<option value="${m}">${mLabel(m)}</option>`).join('')}</select>
    <select class="field" name="event" aria-label="${t('col_event')}"><option value="">${t('col_event')}: ${t('all')}</option>${['login_success', 'login_fail', 'logout', 'logout_all', 'view_subject', 'download_file', 'admin_action', 'admin_denied', 'google_linked'].map(m => `<option value="${m}">${evLabel(m)}</option>`).join('')}</select></form>
    <div class="flex items-center justify-between mt-4 flex-wrap gap-2"><span class="text-sm text-mute num" id="tot"></span><a class="btn sm ghost" id="csv" href="#">${icon('download', 'w-4 h-4')} ${t('export_csv')}</a></div>
    <div class="tscroll mt-2"><table><thead><tr><th>${t('col_time')}</th><th>${t('col_name')}</th><th>${t('col_code')}</th><th>${t('col_email')}</th><th>${t('col_event')}</th><th>${t('col_method')}</th><th>${t('col_browser')}</th><th>${t('col_ip')}</th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="flex items-center justify-between mt-4"><button class="btn sm ghost" id="pv">${t('prev')}</button><span class="text-sm text-mute num" id="pg"></span><button class="btn sm ghost" id="nx">${t('next')}</button></div></div>`;
  const qs = () => new URLSearchParams(Object.entries(S).filter(([, v]) => v !== '')).toString();   // from/to stay plain YYYY-MM-DD: the server maps them to Cairo days
  const row = r => { let m = {}; try { m = JSON.parse(r.meta_json || '{}'); } catch { /* */ }
    return `<tr data-id="${r.id}"><td class="num">${fmtDate(r.ts)}</td><td>${esc(r.student_name || (r.actor_type === 'admin' ? t('admin_title') : '—'))}</td><td class="num" dir="ltr">${esc(r.student_code || '—')}</td><td dir="ltr">${esc(r.email || '—')}</td>
      <td><span class="chip ${r.event === 'login_fail' || r.event === 'admin_denied' ? 'late' : ''}">${esc(evLabel(r.event))}</span> <span class="text-mute text-xs">${esc(m.subject || m.action || m.name || '')}</span></td><td>${mLabel(r.method)}</td><td>${esc(m.browser || '')} / ${esc(m.os || '')}</td><td dir="ltr" class="num">${esc(r.ip || '')}</td></tr>`; };
  let total = 0;
  const load = async () => { const d = await api('/api/admin/logs?' + qs()); total = d.total; $('#rows').innerHTML = d.rows.map(row).join('') || `<tr><td colspan="8" class="text-mute">${t('nothing')}</td></tr>`;
    const pages = Math.max(1, Math.ceil(d.total / S.pageSize)); $('#tot').textContent = `${t('total')}: ${num(d.total)}`; $('#pg').textContent = `${t('page')} ${num(S.page)} ${t('of')} ${num(pages)}`;
    $('#pv').disabled = S.page <= 1; $('#nx').disabled = S.page >= pages; $('#csv').href = '/api/admin/logs.csv?' + qs().replace(/&?page=\d+/, '').replace(/&?pageSize=\d+/, ''); };
  let tm; $('#flt').oninput = e => { S[e.target.name] = e.target.value; S.page = 1; clearTimeout(tm); tm = setTimeout(load, 250); };
  $('#pv').onclick = () => { S.page--; load(); }; $('#nx').onclick = () => { S.page++; load(); };
  await load();
  // live insert: new rows slide in at the top (only when looking at page 1 with no filters)
  es = new EventSource('/api/admin/stream');
  es.addEventListener('log', e => { const r = JSON.parse(e.data); if (S.page !== 1 || S.q || S.from || S.to || S.method || S.event) return;
    const tb = $('#rows'); if (!tb) return; tb.insertAdjacentHTML('afterbegin', row(r)); const tr = tb.firstElementChild; tr.classList.add('flash-row');
    if (!RM.matches) gsap.from(tr, { opacity: 0, y: -14, duration: .5, ease: 'power3.out' }); if (tb.children.length > S.pageSize) tb.lastElementChild.remove(); $('#tot').textContent = `${t('total')}: ${num(++total)}`; });
}

/* ───────── Roster ───────── */
async function roster(pane) {
  const S = { q: '', never: false, page: 1, pageSize: 25 };
  pane.innerHTML = `<div class="glass p-4"><div class="flex gap-3 flex-wrap items-center"><input class="field max-w-sm" id="rq" placeholder="${t('search')}" aria-label="${t('search')}">
    <label class="flex items-center gap-2 text-sm"><input type="checkbox" id="rn" class="w-5 h-5 accent-cyan-400"> ${t('never')}</label><span class="text-sm text-mute num ms-auto" id="rt"></span></div>
    <div class="tscroll mt-3"><table><thead><tr><th>#</th><th>${t('col_name')}</th><th>${t('col_code')}</th><th>${t('col_hall')}</th><th>${t('col_email')}</th><th>${t('col_last')}</th><th>${t('col_logins')}</th><th>${t('col_status')}</th><th></th></tr></thead><tbody id="rr"></tbody></table></div>
    <div class="flex items-center justify-between mt-4"><button class="btn sm ghost" id="rp">${t('prev')}</button><span class="text-sm text-mute num" id="rg"></span><button class="btn sm ghost" id="rx">${t('next')}</button></div></div>`;
  const load = async () => { const d = await api(`/api/admin/roster?q=${encodeURIComponent(S.q)}&never=${S.never ? 1 : 0}&page=${S.page}&pageSize=${S.pageSize}`);
    $('#rr').innerHTML = d.rows.map(r => `<tr><td class="num">${num(r.seq || 0)}</td><td>${esc(r.name)}</td><td class="num" dir="ltr">${esc(r.code)}</td><td>${esc(r.hall || '—')}</td><td dir="ltr">${r.email ? `${esc(r.email)}` : '—'}</td><td class="num">${r.last_login ? fmtDate(r.last_login) : '—'}</td><td class="num">${num(r.logins)}</td>
      <td><span class="chip ${r.is_active ? '' : 'late'}">${r.is_active ? t('active') : t('inactive')}</span></td><td class="flex gap-2"><button class="btn sm ghost" data-act="${r.is_active ? 'off' : 'on'}" data-id="${r.id}">${r.is_active ? t('deactivate') : t('reactivate')}</button>${r.email ? `<button class="btn sm ghost" data-act="unlink" data-id="${r.id}">${t('unlink')}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="9" class="text-mute">${t('nothing')}</td></tr>`;
    const pages = Math.max(1, Math.ceil(d.total / S.pageSize)); $('#rt').textContent = `${t('total')}: ${num(d.total)}`; $('#rg').textContent = `${t('page')} ${num(S.page)} ${t('of')} ${num(pages)}`; $('#rp').disabled = S.page <= 1; $('#rx').disabled = S.page >= pages; };
  let tm; $('#rq').oninput = e => { S.q = e.target.value.trim(); S.page = 1; clearTimeout(tm); tm = setTimeout(load, 250); };
  $('#rn').onchange = e => { S.never = e.target.checked; S.page = 1; load(); }; $('#rp').onclick = () => { S.page--; load(); }; $('#rx').onclick = () => { S.page++; load(); };
  $('#rr').onclick = async e => { const b = e.target.closest('[data-act]'); if (!b) return; const { act, id } = b.dataset;
    try { if (act === 'unlink') await api(`/api/admin/roster/${id}/unlink`, { method: 'POST' }); else await api(`/api/admin/roster/${id}`, { method: 'PATCH', body: { is_active: act === 'on' } }); toast(t('saved')); load(); } catch (er) { toast(er.message, 'err'); } };
  await load();
}

/* ───────── Content management ───────── */
async function content(pane) {
  const { subjects } = await api('/api/subjects'); let sel = subjects.find(s => s.slug === sessionStorage.getItem('us-subj')) || subjects[0];
  async function paint() {
    const d = await api('/api/subjects/' + sel.slug), s = d.subject; const { announcements } = await api('/api/announcements');
    const dz = (kind, id) => `<div class="drop mt-3 text-sm text-mute" data-kind="${kind}" data-id="${id}" tabindex="0" role="button">${icon('upload', 'w-4 h-4 inline')} ${t('drop')}<input type="file" multiple hidden><div class="bar mt-2 hidden"><i></i></div></div>`;
    const list = (key, label, rows, kind, fields) => `<section class="glass p-4"><div class="flex items-center justify-between"><h2 class="font-bold">${label}</h2><button class="btn sm" data-add="${key}">${icon('plus', 'w-4 h-4')} ${t('add')}</button></div>
      <div class="grid gap-3 mt-3">${rows.map(r => `<div class="glass p-3" data-row="${key}:${r.id}"><div class="flex items-center justify-between gap-2"><strong>${esc(r.title)}</strong><span class="flex gap-1"><button class="btn sm ghost !px-2" data-edit="${key}:${r.id}" aria-label="${t('edit')}">${icon('edit', 'w-4 h-4')}</button><button class="btn sm danger !px-2" data-del="${key}:${r.id}" aria-label="${t('delete')}">${icon('trash', 'w-4 h-4')}</button></span></div>
        ${(r.files || []).map(f => `<div class="flex items-center justify-between text-sm mt-2"><span class="truncate">${icon('file', 'w-4 h-4 inline')} ${esc(f.original_name)} <span class="text-mute num">${fmtSize(f.size)}</span></span><button class="btn sm ghost !px-2" data-delfile="${f.id}" aria-label="${t('delete')}">${icon('trash', 'w-4 h-4')}</button></div>`).join('')}${dz(kind, r.id)}</div>`).join('')}</div></section>`;
    pane.innerHTML = `<div class="flex gap-3 flex-wrap items-end"><label class="grid gap-1.5 text-sm">${t('choose_subject')}<select class="field min-w-[16rem]" id="subjSel">${subjects.map(x => `<option value="${x.slug}" ${x.slug === sel.slug ? 'selected' : ''}>${esc(x.title_ar)}</option>`).join('')}</select></label><button class="btn ghost" id="editSubj">${icon('edit', 'w-4 h-4')} ${t('edit_subject')}</button></div>
      <div class="grid lg:grid-cols-2 gap-4 mt-5">${list('lectures', t('t_lectures'), d.lectures, 'lecture')}${s.has_sections ? list('sections', t('t_sections'), d.sections, 'section') : ''}${s.has_tasks ? list('tasks', t('t_tasks'), d.tasks, 'task') : ''}
        <section class="glass p-4"><h2 class="font-bold">${t('materials_general')}</h2>${d.materials.map(f => `<div class="flex items-center justify-between text-sm mt-2"><span class="truncate">${icon('file', 'w-4 h-4 inline')} ${esc(f.original_name)} <span class="text-mute num">${fmtSize(f.size)}</span></span><button class="btn sm ghost !px-2" data-delfile="${f.id}" aria-label="${t('delete')}">${icon('trash', 'w-4 h-4')}</button></div>`).join('')}${dz('subject', s.id)}</section>
        <section class="glass p-4"><div class="flex items-center justify-between"><h2 class="font-bold">${t('ann_title')}</h2><button class="btn sm" data-add="ann">${icon('plus', 'w-4 h-4')} ${t('add')}</button></div><div class="grid gap-2 mt-3">${announcements.map(a => `<div class="glass p-3 flex items-center justify-between gap-2"><span>${a.pinned ? icon('pin', 'w-4 h-4 inline text-amber-400') : ''} ${esc(a.title)}</span><span class="flex gap-1"><button class="btn sm ghost !px-2" data-edit="ann:${a.id}" aria-label="${t('edit')}">${icon('edit', 'w-4 h-4')}</button><button class="btn sm danger !px-2" data-del="ann:${a.id}" aria-label="${t('delete')}">${icon('trash', 'w-4 h-4')}</button></span></div>`).join('')}</div></section></div>`;
    const data = { lectures: d.lectures, sections: d.sections, tasks: d.tasks, ann: announcements };
    const F = { lectures: [['title', t('f_title'), 'text', 1], ['description', t('f_desc'), 'textarea'], ['week_no', t('f_week'), 'number']], sections: [['title', t('f_title'), 'text', 1], ['description', t('f_desc'), 'textarea'], ['week_no', t('f_week'), 'number']],
      tasks: [['title', t('f_title'), 'text', 1], ['description', t('f_desc'), 'textarea'], ['due_at', t('f_due'), 'date']], ann: [['title', t('f_title'), 'text', 1], ['body', t('f_desc'), 'textarea'], ['pinned', t('f_pinned'), 'checkbox']] };
    const flds = k => F[k].map(([name, label, type, required]) => ({ name, label, type, required }));
    const done = msg => { toast(msg); paint(); };
    $('#subjSel').onchange = e => { sel = subjects.find(x => x.slug === e.target.value); sessionStorage.setItem('us-subj', sel.slug); paint(); };
    $('#editSubj').onclick = async () => { const v = await askForm(t('edit_subject'), [{ name: 'title_ar', label: t('f_title_ar'), required: 1 }, { name: 'title_en', label: t('f_title_en'), required: 1 }, { name: 'doctor_name', label: t('f_doctor') }, { name: 'ta_names', label: t('f_ta') }, { name: 'has_sections', label: t('f_sections'), type: 'checkbox' }, { name: 'has_tasks', label: t('f_tasks'), type: 'checkbox' }, { name: 'color', label: t('f_color'), type: 'color' }], { ...s });
      if (v) try { await api('/api/admin/subjects/' + s.id, { method: 'PATCH', body: v }); Object.assign(sel, v); done(t('saved')); } catch (er) { toast(er.message, 'err'); } };
    pane.onclick = async e => { const b = e.target.closest('[data-add],[data-edit],[data-del],[data-delfile]'); if (!b) return;
      try {
        if (b.dataset.add) { const k = b.dataset.add, v = await askForm(t(k === 'ann' ? 'new_ann' : { lectures: 'new_lecture', sections: 'new_section', tasks: 'new_task' }[k]), flds(k)); if (!v) return;
          await api(k === 'ann' ? '/api/admin/announcements' : '/api/admin/' + k, { method: 'POST', body: k === 'ann' ? v : { ...v, subject_id: s.id } }); done(t('saved')); }
        else if (b.dataset.edit) { const [k, id] = b.dataset.edit.split(':'), cur = data[k].find(x => x.id == id), v = await askForm(t('edit'), flds(k), cur); if (!v) return;
          await api((k === 'ann' ? '/api/admin/announcements/' : `/api/admin/${k}/`) + id, { method: 'PATCH', body: v }); done(t('saved')); }
        else if (b.dataset.del) { const [k, id] = b.dataset.del.split(':'); if (!(await confirmBox(t('confirm_delete')))) return; await api((k === 'ann' ? '/api/admin/announcements/' : `/api/admin/${k}/`) + id, { method: 'DELETE' }); done(t('deleted')); }
        else if (b.dataset.delfile) { if (!(await confirmBox(t('confirm_delete')))) return; await api('/api/admin/files/' + b.dataset.delfile, { method: 'DELETE' }); done(t('deleted')); }
      } catch (er) { toast(er.message, 'err'); } };
    // drag & drop (or click) multi-file upload with a real progress bar
    $$('.drop', pane).forEach(z => { const input = $('input', z), bar = $('.bar', z), fill = $('i', bar);
      const send = async files => { if (!files.length) return; const fd = new FormData(); fd.append('owner_kind', z.dataset.kind); fd.append('owner_id', z.dataset.id); [...files].forEach(f => fd.append('files', f));
        bar.classList.remove('hidden'); fill.style.transformOrigin = lang === 'ar' ? 'right' : 'left';
        try { await upload('/api/admin/files', fd, p => (fill.style.transform = `scaleX(${p})`)); done(t('uploaded')); } catch (er) { bar.classList.add('hidden'); toast(er.message, 'err'); } };
      z.onclick = () => input.click(); z.onkeydown = e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), input.click()); input.onchange = () => send(input.files);
      ['dragenter', 'dragover'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.add('over'); })); ['dragleave', 'drop'].forEach(ev => z.addEventListener(ev, e => { e.preventDefault(); z.classList.remove('over'); }));
      z.addEventListener('drop', e => send(e.dataTransfer.files)); });
  }
  await paint();
}
