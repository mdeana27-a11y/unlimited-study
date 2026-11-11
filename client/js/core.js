import { t, errMsg, lang } from './i18n.js';

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const RM = matchMedia('(prefers-reduced-motion: reduce)');
export const state = { user: null, config: null };

/* ───────── API (CSRF double-submit handled here) ───────── */
let csrf = null;
const loadCsrf = async () => { csrf = (await (await fetch('/api/csrf', { credentials: 'same-origin' })).json()).token; };
export async function api(url, { method = 'GET', body } = {}) {
  const opt = { method, credentials: 'same-origin', headers: {} };
  if (method !== 'GET') { if (!csrf) await loadCsrf(); opt.headers['X-CSRF-Token'] = csrf; }
  if (body !== undefined) { opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  let r;
  try { r = await fetch(url, opt); } catch { throw Object.assign(new Error(errMsg('network')), { code: 'network' }); }
  if (r.status === 403 && method !== 'GET' && (await r.clone().json().catch(() => ({}))).error === 'csrf') {
    await loadCsrf(); opt.headers['X-CSRF-Token'] = csrf; r = await fetch(url, opt);
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(errMsg(j.error)), { code: j.error, status: r.status });
  return j;
}
// XHR because fetch cannot report upload progress.
export async function upload(url, fd, onProgress) {
  if (!csrf) await loadCsrf();
  return new Promise((ok, no) => {
    const x = new XMLHttpRequest(); x.open('POST', url); x.setRequestHeader('X-CSRF-Token', csrf); x.responseType = 'json';
    x.upload.onprogress = e => e.lengthComputable && onProgress(e.loaded / e.total);
    x.onload = () => x.status < 300 ? ok(x.response) : no(Object.assign(new Error(errMsg(x.response?.error)), { code: x.response?.error }));
    x.onerror = () => no(Object.assign(new Error(errMsg('network')), { code: 'network' })); x.send(fd);
  });
}

/* ───────── Icons: one consistent stroke set (no emoji) ───────── */
const P = {
  brain: 'M9 4a3 3 0 0 0-3 3v.5A3 3 0 0 0 4 10.5a3 3 0 0 0 1 2.2A3 3 0 0 0 6 17a3 3 0 0 0 3 3 3 3 0 0 0 3-3V7a3 3 0 0 0-3-3zm6 0a3 3 0 0 1 3 3v.5a3 3 0 0 1 2 3 3 3 0 0 1-1 2.2A3 3 0 0 1 18 17a3 3 0 0 1-3 3 3 3 0 0 1-3-3',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zm0 0v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
  cpu: 'M7 7h10v10H7zM9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4M10 10h4v4h-4z',
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9S9.500 5.500 12 3z',
  chart: 'M4 20V10M10 20V4M16 20v-8M22 20H2',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2',
  shield: 'M12 3l8 3v6c0 4.500-3.400 8-8 9-4.600-1-8-4.500-8-9V6l8-3zM9 12l2 2 4-4',
  sparkles: 'M12 3l1.800 5.200L19 10l-5.200 1.800L12 17l-1.800-5.200L5 10l5.200-1.800L12 3zM19 16l.8 2.200L22 19l-2.200.8L19 22l-.8-2.200L16 19l2.200-.8z',
  book: 'M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5zM4 19a2 2 0 0 0 2 2h13',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14', upload: 'M12 16V5M7 9l5-5 5 5M5 20h14', file: 'M7 3h7l5 5v13H7zM14 3v5h5',
  logout: 'M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 8l-4 4 4 4M6 12h10', users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.500 11a3.500 3.500 0 1 0 0-7 3.500 3.500 0 0 0 0 7zM21 20v-1a4 4 0 0 0-3-3.900M16 4.100a3.500 3.500 0 0 1 0 6.800',
  activity: 'M3 12h4l3-8 4 16 3-8h4', edit: 'M4 20h4L19 9l-4-4L4 16v4zM13 7l4 4', trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  plus: 'M12 5v14M5 12h14', check: 'M5 13l4 4L19 7', chev: 'M9 6l6 6-6 6', grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3', globe2: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', megaphone: 'M3 11v2a1 1 0 0 0 1 1h3l9 5V5L7 10H4a1 1 0 0 0-1 1zM19 9v6', pin: 'M12 17v5M8 3h8l-1 6 3 3H6l3-3z',
  google: 'M21 12.200c0-.700-.100-1.300-.200-1.900H12v3.600h5.100a4.400 4.400 0 0 1-1.900 2.900v2.400h3.100c1.800-1.700 2.700-4.100 2.700-7zM12 21.500c2.600 0 4.700-.900 6.300-2.300l-3.100-2.400c-.900.600-2 .900-3.200.900-2.500 0-4.600-1.700-5.300-3.900H3.500v2.500a9.500 9.500 0 0 0 8.500 5.200zM6.700 13.800a5.700 5.700 0 0 1 0-3.600V7.700H3.500a9.500 9.500 0 0 0 0 8.600l3.200-2.500zM12 6.300c1.400 0 2.700.500 3.700 1.400l2.800-2.800A9.500 9.500 0 0 0 3.500 7.700l3.200 2.500C7.400 8 9.500 6.300 12 6.300z',
};
export const icon = (n, cls = 'w-5 h-5') => `<svg class="${cls} shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n] || P.book}"/></svg>`;
export const themeIcon = () => `<svg class="theme-ic w-5 h-5" viewBox="0 0 24 24" aria-hidden="true"><mask id="mm"><rect width="24" height="24" fill="#fff"/><circle class="cut" cx="16" cy="8" r="6" fill="#000"/></mask><circle class="core" cx="12" cy="12" r="5" fill="currentColor" mask="url(#mm)"/><g class="rays" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 1.500v2.500M12 20v2.500M1.500 12H4M20 12h2.500M4.600 4.600l1.800 1.800M17.600 17.600l1.800 1.800M4.600 19.400l1.800-1.800M17.600 6.400l1.800-1.800"/></g></svg>`;
export const logo = (cls = 'w-8 h-8') => `<svg class="${cls}" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#22D3EE"/><stop offset="1" stop-color="#8B5CF6"/></linearGradient></defs><path d="M9 22L16 8l8 13z" fill="none" stroke="url(#lg)" stroke-width="1.8"/><circle cx="9" cy="22" r="3.600" fill="#22D3EE"/><circle cx="16" cy="8" r="3.600" fill="#8B5CF6"/><circle cx="24" cy="21" r="3.600" fill="#22D3EE"/></svg>`;

/* ───────── Dates (stored UTC, shown in Africa/Cairo) ───────── */
export const fmtDate = (iso, o = { dateStyle: 'medium', timeStyle: 'short' }) => iso ? new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { timeZone: 'Africa/Cairo', ...o }).format(new Date(iso)) : '—';
export const fmtDay = iso => fmtDate(/^\d{4}-\d\d-\d\d$/.test(iso) ? iso + 'T12:00:00Z' : iso, { dateStyle: 'medium' });
export const fmtSize = n => '\u2066' + (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') + '\u2069';   // LTR isolate: "1 KB", not "KB 1", inside RTL text
// ٢٥٧٠٠١٠ -> 2570010: a code typed on an Arabic keyboard must still pass validation (the server accepts it too).
export const asciiDigits = s => String(s).replace(/[\u0660-\u0669]/g, d => d.charCodeAt(0) - 0x0660).replace(/[\u06F0-\u06F9]/g, d => d.charCodeAt(0) - 0x06F0);
export const num = n => new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en-US').format(n);

/* ───────── Motion helpers (all honour prefers-reduced-motion by degrading to a fade) ───────── */
export function enter(els, { y = 24, stagger = .07, duration = .6, delay = 0 } = {}) {
  const list = typeof els === 'string' ? $$(els) : els; if (!list.length) return;
  if (RM.matches) return gsap.fromTo(list, { opacity: 0 }, { opacity: 1, duration: .25 });
  gsap.fromTo(list, { opacity: 0, y }, { opacity: 1, y: 0, duration, stagger, delay, ease: 'power3.out', clearProps: 'transform' });
}
export function countUp(el, to) {
  if (RM.matches || !to) { el.textContent = num(to); return; }
  const o = { v: 0 }; gsap.to(o, { v: to, duration: 1.1, ease: 'power2.out', onUpdate: () => (el.textContent = num(Math.round(o.v))) });
}
export function reveal(els) {
  if (RM.matches || !window.ScrollTrigger) return; gsap.registerPlugin(ScrollTrigger);
  ScrollTrigger.batch(els, { start: 'top 92%', once: true, onEnter: b => gsap.fromTo(b, { opacity: 0, y: 26 }, { opacity: 1, y: 0, stagger: .08, duration: .6, ease: 'power3.out' }) });
}
export const applyAccents = root => $$('[data-ac]', root).forEach(e => e.style.setProperty('--ac', e.dataset.ac));
export const applyWidths = root => $$('[data-w]', root).forEach(e => (e.style.width = e.dataset.w + '%'));

// global delegates: ripple, magnetic buttons, cursor-follow glow
export function initFx() {
  document.addEventListener('click', e => {
    const b = e.target.closest('.btn'); if (!b || RM.matches) return;
    const r = b.getBoundingClientRect(), s = Math.max(r.width, r.height), d = document.createElement('span');
    d.className = 'ripple'; Object.assign(d.style, { width: s + 'px', height: s + 'px', left: e.clientX - r.left - s / 2 + 'px', top: e.clientY - r.top - s / 2 + 'px' });
    b.append(d); setTimeout(() => d.remove(), 650);
  });
  const fine = matchMedia('(pointer: fine)');
  document.addEventListener('pointermove', e => {
    const c = e.target.closest?.('.card'); if (c) { const r = c.getBoundingClientRect(); c.style.setProperty('--mx', e.clientX - r.left + 'px'); c.style.setProperty('--my', e.clientY - r.top + 'px'); }
    const b = e.target.closest?.('.btn:not(.nomag)'); if (!b || RM.matches || !fine.matches || b.disabled) return;
    const r = b.getBoundingClientRect(); gsap.to(b, { x: (e.clientX - r.left - r.width / 2) * .18, y: (e.clientY - r.top - r.height / 2) * .25, duration: .3, overwrite: 'auto' });
  });
  document.addEventListener('pointerout', e => { const b = e.target.closest?.('.btn'); if (b && !RM.matches) gsap.to(b, { x: 0, y: 0, duration: .5, ease: 'elastic.out(1,.5)' }); });
}

/* ───────── Toasts (spring), route progress, dialogs ───────── */
export function toast(msg, type = 'ok') {
  const el = document.createElement('div'); el.className = `toast ${type}`; el.textContent = msg; $('#toasts').append(el);
  if (RM.matches) gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: .2 });
  else gsap.fromTo(el, { y: 40, scale: .85, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .7, ease: 'elastic.out(1,.6)' });
  setTimeout(() => gsap.to(el, { opacity: 0, y: 10, duration: .3, onComplete: () => el.remove() }), 3600);
}
export function routeBar() {
  const b = $('#routebar'); gsap.killTweensOf(b);
  gsap.set(b, { scaleX: 0, opacity: 1 }); gsap.to(b, { scaleX: .85, duration: RM.matches ? .01 : .5, ease: 'power2.out' });
  return () => gsap.to(b, { scaleX: 1, duration: .2, onComplete: () => gsap.to(b, { opacity: 0, duration: .3 }) });
}
// Reusable modal form: askForm(title, fields, values) -> values | null
export function askForm(title, fields, values = {}) {
  const dlg = $('#dlg');
  dlg.innerHTML = `<form method="dialog" class="grid gap-4"><h2 class="text-xl font-bold">${esc(title)}</h2>${fields.map(f => {
    const v = values[f.name] ?? '', id = 'f_' + f.name;
    if (f.type === 'checkbox') return `<label class="flex items-center gap-3"><input type="checkbox" id="${id}" name="${f.name}" ${v ? 'checked' : ''} class="w-5 h-5 accent-cyan-400"> ${esc(f.label)}</label>`;
    if (f.type === 'textarea') return `<label class="grid gap-1.5 text-sm">${esc(f.label)}<textarea class="field" rows="3" name="${f.name}" maxlength="5000">${esc(v)}</textarea></label>`;
    return `<label class="grid gap-1.5 text-sm">${esc(f.label)}<input class="field" id="${id}" name="${f.name}" type="${f.type || 'text'}" value="${esc(v)}" ${f.required ? 'required' : ''} ${f.max ? `max="${f.max}"` : ''} ${f.type === 'number' ? 'min="0"' : ''}></label>`;
  }).join('')}<div class="flex gap-2 justify-end"><button type="button" class="btn ghost" data-x>${t('cancel')}</button><button class="btn">${t('save')}</button></div></form>`;
  return new Promise(res => {
    const f = $('form', dlg); let done = false; const fin = v => { if (done) return; done = true; dlg.close(); res(v); };
    $('[data-x]', dlg).onclick = () => fin(null); dlg.oncancel = () => fin(null);
    f.onsubmit = e => { e.preventDefault(); const o = {};
      fields.forEach(x => { const el = f.elements[x.name]; o[x.name] = x.type === 'checkbox' ? el.checked : x.type === 'number' ? (el.value === '' ? null : +el.value) : el.value; }); fin(o); };
    dlg.showModal(); (f.querySelector('input,textarea') || f).focus();
    if (!RM.matches) gsap.fromTo(dlg, { y: 20, scale: .96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: .35, ease: 'power3.out' });
  });
}
export const confirmBox = msg => askForm(msg, [], {}).then(v => v !== null);

// the success checkmark that draws itself
export const checkSvg = '<svg class="check w-14 h-14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10" opacity=".25"/><path d="M7 12.500l3.200 3.200L17 9"/></svg>';
