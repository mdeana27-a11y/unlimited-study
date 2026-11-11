import { t, setLang, lang } from './i18n.js';
import { $, api, state, initFx, routeBar, RM, toast } from './core.js';
import { loginView, dashView, subjectView } from './views.js';
import { adminView, stopAdmin } from './admin.js';

const app = $('#app');
const savedTheme = localStorage.getItem('us-theme');
const setTheme = m => { document.documentElement.dataset.theme = m; localStorage.setItem('us-theme', m); };
setTheme(savedTheme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
initFx();

// header buttons are re-rendered with every view, so delegate once
document.addEventListener('click', async e => {
  const b = e.target.closest('#langBtn,#themeBtn,#outBtn'); if (!b) return;
  if (b.id === 'langBtn') { setLang(lang === 'ar' ? 'en' : 'ar'); route(); }
  if (b.id === 'themeBtn') { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); if (location.hash.startsWith('#/admin')) route(); }
  if (b.id === 'outBtn') { try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* */ } state.user = null; location.hash = '#/login'; route(); }
});

let seq = 0;
async function route() {
  const my = ++seq, done = routeBar(), h = location.hash || '#/'; stopAdmin();
  try {
    state.config ??= await api('/api/config');
    try { state.user = (await api('/api/me')).user; } catch { state.user = null; }
    if (my !== seq) return;
    document.title = `${t('brand')} — Unlimited Study`;
    if (!state.user) { if (h !== '#/login') history.replaceState(null, '', '#/login'); await loginView(app, { onDone: () => { location.hash = '#/'; route(); }, setMode: () => {} }); }
    else if (h === '#/login') { location.hash = '#/'; return; }
    else {
      if (!RM.matches) gsap.set(app, { opacity: 0 });
      if (h.startsWith('#/s/')) await subjectView(app, h.slice(4));
      else if (h.startsWith('#/admin')) { if (state.user.type !== 'admin') { location.hash = '#/'; return; } await adminView(app, h.split('/')[2]); }
      else await dashView(app);
      gsap.to(app, { opacity: 1, duration: RM.matches ? .2 : .35 });
    }
    if (my === seq) { gsap.set(app, { opacity: 1 }); $('#main')?.focus({ preventScroll: true }); window.scrollTo(0, 0); }
  } catch (e) { toast(e.message || t('err_server_error'), 'err'); gsap.set(app, { opacity: 1 }); }
  finally { done(); }
}
addEventListener('hashchange', route); route();
