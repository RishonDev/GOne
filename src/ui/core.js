'use strict';
const { APPS, byId, iconSvg, hubIconSvg } = window.GOneApps;
const $ = (s, r = document) => r.querySelector(s);
const Views = {};
const S = { unread: {}, feed: [], settings: {}, auth: {}, view: null };

// ---------- DOM helper (text only; "html" is for trusted SVG strings we generate) ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') el.style.cssText = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat(Infinity)) { if (c == null || c === false) continue; el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  return el;
}

const PATHS = {
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1.5"/><path d="M5 9v10h14V9M10 13h4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  reply: '<path d="M10 8L4 13l6 5v-3.5c5 0 8 1 10 5-.5-6-3.5-9-10-9.5z"/>',
  star: '<path d="M12 3.5l2.6 5.4 5.9.8-4.3 4.1 1 5.9L12 17l-5.2 2.7 1-5.9-4.3-4.1 5.9-.8z"/>',
  unread: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>',
  down: '<path d="M12 4v12M7 11.5l5 5 5-5M5 20h14"/>', ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5H5V6h5"/>',
  left: '<path d="M15 5l-7 7 7 7"/>', right: '<path d="M9 5l7 7-7 7"/>', folder: '<path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H10l2 2.5h7.5A1.5 1.5 0 0 1 21 9v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z"/>',
  file: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/>', logout: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>', phone: '<path d="M6 3h4l1.5 4.5-2 1.5a11 11 0 0 0 6 6l1.5-2L21 14.5V18a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  video: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5L21 7.5v9l-5.5-3"/>',
};
const ic = (n, extra = '') => h('span', { html: `<svg class="i ${extra}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[n] || ''}</svg>`, style: 'display:contents' });
const svgEl = (str, cls) => { const w = h('span', { html: str, style: 'display:contents' }); const s = w.firstElementChild; if (cls) s.classList.add(cls); return w; };

// ---------- formatting ----------
function parseFrom(s) {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s || '');
  return m ? { name: m[1].trim() || m[2], addr: m[2] } : { name: (s || '').trim(), addr: (s || '').trim() };
}
function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 45) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; return `${Math.round(s / 86400)} d ago`;
}
function shortDate(ms) {
  const d = new Date(ms), n = new Date();
  if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  return d.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}
const timeStr = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function avatar(name, photo) {
  const hue = [...(name || '?')].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  const el = h('div', { class: 'av', style: `--h:${hue}` }, (name || '?').replace(/[^\p{L}\p{N}]/gu, '').charAt(0).toUpperCase() || '?');
  if (photo) { const i = h('img', { src: photo, alt: '', referrerpolicy: 'no-referrer' }); i.onerror = () => i.remove(); el.append(i); }
  return el;
}
const appIcon = (a, size) => svgEl(iconSvg(a, size));
const accentOf = (a) => `--c1:${a.colors[0]};--c2:${a.colors[Math.floor(a.colors.length / 2)]};--c3:${a.colors[a.colors.length - 1]}`;

// ---------- toast / dialog / API ----------
function toast(msg, ok) {
  const t = h('div', { class: 'toast' + (ok ? ' ok' : ''), role: 'status' }, msg);
  $('#toasts').append(t); setTimeout(() => t.remove(), ok ? 3000 : 7000);
}
function cleanErr(e) {
  let m = String((e && e.message) || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  if (/has not been used|is disabled|accessNotConfigured|API has not/i.test(m)) m += ' — enable that API in Google Cloud Console (see the setup steps in Account).';
  return m;
}
async function call(ns, fn, args) {
  try { return await gone.api(ns, fn, args); } catch (e) { toast(cleanErr(e)); throw e; }
}
function dialog(title, body, actions) {
  const d = h('dialog', {}, h('div', { class: 'dh' }, title), h('div', { class: 'db' }, body),
    h('div', { class: 'df' }, actions.map((a) => h('button', { class: 'btn ' + (a.cls || 'text'), onclick: async () => { if (a.fn && (await a.fn()) === false) return; d.close(); } }, a.label))));
  d.addEventListener('close', () => d.remove());
  document.body.append(d); d.showModal();
  const f = d.querySelector('input,textarea'); if (f) f.focus();
  return d;
}
const field = (label, input) => h('div', { class: 'field' }, h('label', {}, label), input);
const spinner = () => h('div', { class: 'spinner', role: 'progressbar', 'aria-label': 'Loading' });

// ---------- shell: rail, header, routing ----------
function buildRail() {
  const rail = $('#rail'); rail.textContent = '';
  const items = [{ id: 'home', name: 'Home', hub: true }, ...APPS];
  for (const a of items) {
    const b = h('button', { class: 'rb', 'data-id': a.id, title: a.hub ? 'Home' : a.native ? a.name : `${a.name} (opens in a browser app window)`, style: a.hub ? '--c1:#4285F4;--c2:#EA4335;--c3:#34A853' : accentOf(a),
      onclick: () => (a.hub || a.native ? go(a.id) : gone.openWeb(a.url)) },
      h('span', { class: 'ico' }, a.hub ? svgEl(hubIconSvg(40)) : appIcon(a, 40), h('span', { class: 'badge' })),
      h('span', { class: 'lbl' }, a.name));
    if (!a.hub && !a.native) b.querySelector('.ico').append(h('span', { class: 'web', html: `<svg class="i" viewBox="0 0 24 24">${PATHS.ext}</svg>` }));
    rail.append(b);
  }
}
const prevCounts = {};
function paintBadges(first) {
  for (const b of document.querySelectorAll('.rb')) {
    const id = b.dataset.id, n = S.unread[id] || 0;
    b.classList.toggle('has', n > 0);
    const bd = b.querySelector('.badge'); bd.textContent = n > 99 ? '99+' : n;
    if (!first && n > (prevCounts[id] || 0)) { bd.classList.remove('fresh'); void bd.offsetWidth; bd.classList.add('fresh'); }
    prevCounts[id] = n;
  }
  const total = (S.unread.gmail || 0) + (S.unread.tasks || 0);
  const t = $('#total'); t.hidden = !total; t.textContent = `${total} need attention`;
  document.title = total ? `(${total}) GOne` : 'GOne';
}
function paintAccount() {
  const p = S.auth.profile, btn = $('#acct'); btn.textContent = '';
  btn.append(avatar(p ? p.name || p.email : 'G', p && p.picture));
  btn.onclick = () => go('account');
}

let cleanup = null;
async function go(id, arg) {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const authed = S.auth.signedIn;
  if (!authed && id !== 'account') id = 'account';
  S.view = id;
  const a = byId(id);
  const locked = !!(a && a.native && id !== 'gmail' && !S.auth.oauth);
  for (const b of document.querySelectorAll('.rb')) b.classList.toggle('on', b.dataset.id === id);
  const root = document.documentElement.style;
  const col = a ? a.colors : ['#4285F4', '#EA4335', '#34A853'];
  root.setProperty('--c1', col[0]); root.setProperty('--c2', col[Math.floor(col.length / 2)]); root.setProperty('--c3', col[col.length - 1]);
  $('#title').textContent = a ? a.name : id === 'account' ? (authed ? 'Account' : 'Connect to Google') : 'Home';
  $('#topExtra').textContent = '';
  const view = $('#view'); view.textContent = '';
  cleanup = (await (locked ? Views.locked : Views[id]).mount(view, locked ? a : arg)) || null;
}
function navigate(t) { if (t && Views[t.view]) go(t.view, t); }
function repaintView() { if (S.view && Views[S.view] && Views[S.view].onState) Views[S.view].onState(); }
