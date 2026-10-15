'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const { app, BrowserWindow, Tray, Menu, Notification, ipcMain, shell, nativeImage, globalShortcut } = require('electron');
const { APPS, byId, appForUrl } = require('./apps');
const auth = require('./auth');
const api = require('./api');
const imapMod = require('./imap');

const CACHE = path.join(os.homedir(), '.cache', 'gone', 'icons');
const BROWSERS = ['google-chrome-stable', 'google-chrome', 'chromium', 'brave-browser', 'brave', 'microsoft-edge-stable', 'vivaldi', 'helium'];

app.setName('GOne');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// CLI maintenance flags (used by packaged installs): gone --install-launchers | --uninstall-launchers
if (process.argv.includes('--install-launchers') || process.argv.includes('--uninstall-launchers')) {
  const L = require('./launchers');
  if (process.argv.includes('--uninstall-launchers')) L.uninstall();
  else L.install(L.q(process.env.APPIMAGE || process.execPath));
  process.exit(0);
}

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

// ---------- persisted state ----------
const state = { settings: { dnd: false, autostart: false, closeToTray: true }, seen: [], bounds: { width: 1240, height: 800 } };
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
function loadState() {
  try {
    const s = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    Object.assign(state.settings, s.settings || {});
    state.seen = s.seen || []; state.bounds = s.bounds || state.bounds;
  } catch { /* first run */ }
}
let saveTimer;
function saveState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile(), JSON.stringify(state)); } catch { /* ignore */ }
  }, 200);
}

// ---------- runtime ----------
let win, tray, quitting = false, trayTotal = -1;
const unread = {};        // appId -> badge number
const feed = [];          // recent notifications {id, title, body, ts, target}
const icons = {};
const alive = new Set();
const remindedEvents = new Set();
let seenFirstPoll = false;

const img = (id, size) => {
  if (!icons[id]) return undefined;
  const i = nativeImage.createFromPath(icons[id]);
  return size ? i.resize({ width: size, height: size }) : i;
};
const snapshot = () => ({ unread, feed, settings: state.settings, auth: auth.status() });
const send = (ch, ...a) => { if (win && !win.isDestroyed()) win.webContents.send(ch, ...a); };

let refreshTimer;
function refresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => {
    const total = (unread.gmail || 0) + (unread.tasks || 0);
    send('state', snapshot());
    try { app.setBadgeCount(total); } catch { /* unsupported */ }
    if (tray) { tray.setToolTip(total ? `GOne — ${total} need attention` : 'GOne'); tray.setContextMenu(buildTrayMenu()); }
    if (total !== trayTotal) { trayTotal = total; send('render-tray', total); }
  }, 80);
}

function notify(id, title, body, target) {
  feed.unshift({ id, title, body, ts: Date.now(), target });
  feed.length = Math.min(feed.length, 60);
  refresh();
  if (state.settings.dnd || !Notification.isSupported()) return;
  const focused = win && win.isVisible() && win.isFocused();
  if (focused) return;
  const n = new Notification({ title, body, icon: img(id) });
  alive.add(n);
  n.on('click', () => navigate(target || { view: id }));
  n.on('close', () => alive.delete(n));
  n.show();
  if (win && !win.isDestroyed() && !win.isFocused()) win.flashFrame(true);
}

// ---------- window ----------
function createWindow(show) {
  win = new BrowserWindow({
    ...state.bounds, minWidth: 820, minHeight: 560, title: 'GOne', icon: icons.gone,
    autoHideMenuBar: true, show: false, backgroundColor: '#131314',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  win.once('ready-to-show', () => { if (show) win.show(); });
  const keep = () => { if (!win.isMaximized() && !win.isMinimized()) { state.bounds = win.getBounds(); saveState(); } };
  win.on('resized', keep); win.on('moved', keep);
  win.on('focus', () => win.flashFrame(false));
  win.on('close', (e) => { if (!quitting && state.settings.closeToTray && tray) { e.preventDefault(); win.hide(); } });
  // Email bodies and links: never navigate this window; hand everything off to the browser.
  win.webContents.setWindowOpenHandler(({ url }) => { openLink(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('file://')) { e.preventDefault(); openLink(url); } });
}

function showWin() {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show(); win.focus();
}
function navigate(target) { showWin(); send('navigate', target); }

// ---------- opening Google web apps / links ----------
let browserBin;
function findBrowser() {
  if (browserBin !== undefined) return browserBin;
  const dirs = (process.env.PATH || '').split(':');
  browserBin = BROWSERS.find((b) => dirs.some((d) => { try { fs.accessSync(path.join(d, b), fs.constants.X_OK); return true; } catch { return false; } })) || null;
  return browserBin;
}
// Chromeless "app mode" window in the user's real browser: native-looking, already signed in.
function openWeb(url) {
  if (!/^https:\/\//i.test(url)) return;
  const bin = findBrowser();
  if (bin && appForUrl(url)) {
    const p = spawn(bin, [`--app=${url}`], { detached: true, stdio: 'ignore' });
    p.on('error', () => shell.openExternal(url));
    p.unref();
  } else shell.openExternal(url);
}
function openLink(url) {
  if (/^mailto:/i.test(url)) return navigate({ view: 'gmail', compose: { to: url.slice(7).split('?')[0] } });
  if (/^https?:\/\//i.test(url)) shell.openExternal(url);
}

// ---------- tray ----------
function buildTrayMenu() {
  const items = [{ label: 'Open GOne', click: showWin }, { type: 'separator' }];
  for (const a of APPS) {
    const n = unread[a.id] || 0;
    items.push({ label: n ? `${a.name}  •  ${n}` : a.name, icon: img(a.id, 16), click: () => (a.native ? navigate({ view: a.id }) : openWeb(a.url)) });
  }
  items.push({ type: 'separator' },
    { label: 'Do not disturb', type: 'checkbox', checked: state.settings.dnd, click: (i) => setSetting('dnd', i.checked) },
    { label: 'Quit GOne', click: () => app.quit() });
  return Menu.buildFromTemplate(items);
}
function setTrayIcon(dataUrl) {
  const image = nativeImage.createFromDataURL(dataUrl);
  if (!tray) {
    tray = new Tray(image);
    tray.on('click', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin()));
    tray.setContextMenu(buildTrayMenu()); tray.setToolTip('GOne');
  } else tray.setImage(image);
}

function applyAutostart() {
  const f = path.join(os.homedir(), '.config', 'autostart', 'gone.desktop');
  if (!state.settings.autostart) { try { fs.unlinkSync(f); } catch { /* none */ } return; }
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, `[Desktop Entry]\nType=Application\nName=GOne\nExec="${process.execPath}" "${app.getAppPath()}" --hidden\nIcon=gone\nX-GNOME-Autostart-enabled=true\n`);
}
function setSetting(k, v) {
  if (!(k in state.settings)) return;
  state.settings[k] = !!v;
  if (k === 'autostart') applyAutostart();
  saveState(); refresh();
}

// ---------- background polling (mail, calendar reminders, tasks) ----------
const senderName = (f) => (f.match(/^"?([^"<]+?)"?\s*</) || [, f])[1].trim();
async function poll() {
  if (!auth.status().signedIn) return;
  try {
    unread.gmail = await api.gmail.unreadCount();
    const fresh = await api.gmail.newUnread();
    const known = new Set(state.seen);
    for (const m of fresh.reverse()) {
      if (known.has(m.id)) continue;
      known.add(m.id);
      if (seenFirstPoll) notify('gmail', senderName(m.from), `${m.subject}${m.snippet ? ' — ' + m.snippet : ''}`, { view: 'gmail', thread: m.threadId });
    }
    state.seen = [...known].slice(-200); saveState();
  } catch (e) { console.error('gmail poll', e.message); }

  if (!auth.status().oauth) { seenFirstPoll = true; refresh(); return; }
  try {
    const now = Date.now();
    const evs = await api.calendar.events({ timeMin: new Date(now - 3600e3).toISOString(), timeMax: new Date(now + 24 * 3600e3).toISOString() });
    let soon = 0;
    for (const e of evs) {
      if (e.allDay) continue;
      const mins = (new Date(e.start) - now) / 60000;
      if (mins > -5 && mins <= 60) soon++;
      const lead = e.reminder ?? 10;
      const key = `${e.id}@${e.start}`;
      if (mins <= lead && mins > -5 && !remindedEvents.has(key)) {
        remindedEvents.add(key);
        if (seenFirstPoll || mins > 0) notify('calendar', e.title, mins > 0 ? `Starts in ${Math.max(1, Math.round(mins))} min${e.location ? ' · ' + e.location : ''}` : 'Starting now', { view: 'calendar' });
      }
    }
    unread.calendar = soon;
  } catch (e) { console.error('calendar poll', e.message); }

  try { unread.tasks = await api.tasks.dueCount(); } catch (e) { console.error('tasks poll', e.message); }
  seenFirstPoll = true;
  refresh();
}
let pollTimer;
function startPolling() { clearInterval(pollTimer); seenFirstPoll = false; poll(); pollTimer = setInterval(poll, 60000); }

// ---------- IPC ----------
ipcMain.handle('state', () => snapshot());
ipcMain.handle('auth:setCreds', (_e, id, secret) => { auth.setCreds(id, secret); refresh(); return auth.status(); });
ipcMain.handle('auth:import', (_e, text) => { auth.importJson(text); refresh(); return auth.status(); });
ipcMain.handle('auth:mail', async (_e, email, pass) => {
  auth.setMail(email, pass);
  const m = auth.mailCreds();
  try { await imapMod.verify(m.email, m.password); } catch (e) { await auth.signOut(); throw e; }
  imapMod.setCreds(m); startPolling(); refresh();
  return auth.status();
});
ipcMain.handle('auth:signin', async () => {
  const p = await auth.signIn();
  showWin(); startPolling(); refresh();
  return p;
});
ipcMain.handle('auth:signout', async () => {
  await auth.signOut(); clearInterval(pollTimer); imapMod.setCreds(null);
  for (const k of Object.keys(unread)) delete unread[k];
  feed.length = 0; refresh();
});
const MUTATING = new Set(['modify', 'trash', 'send', 'add', 'update', 'remove']);
ipcMain.handle('api', async (_e, ns, fn, args) => {
  const group = api[ns];
  if (!group || typeof group[fn] !== 'function' || fn === 'constructor') throw new Error('Unknown API call');
  const r = await group[fn](args || {});
  if (MUTATING.has(fn)) poll();
  if (fn === 'attachment' || fn === 'download') {
    new Notification({ title: 'Download complete', body: path.basename(r), icon: img('drive') }).show();
    shell.showItemInFolder(r);
  }
  return r;
});
ipcMain.on('open-web', (_e, url) => openWeb(String(url)));
ipcMain.on('open-link', (_e, url) => openLink(String(url)));
ipcMain.on('setting', (_e, k, v) => setSetting(k, v));
ipcMain.on('clear-feed', () => { feed.length = 0; refresh(); });
ipcMain.on('icons', (_e, map) => {
  fs.mkdirSync(CACHE, { recursive: true });
  for (const [id, dataUrl] of Object.entries(map)) {
    const p = path.join(CACHE, `${id}.png`);
    fs.writeFileSync(p, Buffer.from(dataUrl.split(',')[1], 'base64'));
    icons[id] = p;
  }
  if (win && !win.isDestroyed() && icons.gone) win.setIcon(icons.gone);
  refresh();
});
ipcMain.on('tray-icon', (_e, dataUrl) => setTrayIcon(dataUrl));

// Packaged builds register their app-menu launchers once (not the mailto default; that is opt-in).
function ensureLaunchers() {
  if (!app.isPackaged) return;
  const marker = path.join(app.getPath('userData'), '.launchers');
  const exec = process.env.APPIMAGE || process.execPath;
  try {
    if (fs.existsSync(marker) && fs.readFileSync(marker, 'utf8') === exec) return;
    const L = require('./launchers');
    L.install(L.q(exec), { setMailto: false });
    fs.mkdirSync(path.dirname(marker), { recursive: true }); fs.writeFileSync(marker, exec);
  } catch (e) { console.error('launchers', e.message); }
}

// ---------- launch args ----------
function handleArgs(argv, first) {
  const hidden = argv.includes('--hidden');
  let handled = false;
  for (const a of argv.slice(1)) {
    if (a.startsWith('--app=')) {
      const t = byId(a.slice(6));
      if (t) { t.native ? navigate({ view: t.id }) : openWeb(t.url); handled = true; }
    } else if (/^mailto:/i.test(a)) { openLink(a); handled = true; }
    else if (/^https:\/\//i.test(a)) { const t = appForUrl(a); if (t) { openWeb(a); handled = true; } }
  }
  if (!handled && !(first && hidden)) showWin();
}

app.on('second-instance', (_e, argv) => handleArgs(argv, false));
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* tray keeps GOne alive */ });
app.on('will-quit', () => globalShortcut.unregisterAll());

app.whenReady().then(() => {
  loadState(); auth.load();
  if (auth.mailCreds()) imapMod.setCreds(auth.mailCreds());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'GOne', submenu: [{ label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'zoomIn', accelerator: 'CmdOrCtrl+=' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
  ]));
  const hidden = process.argv.includes('--hidden');
  const launches = process.argv.some((a) => a.startsWith('--app=') || /^(mailto:|https:)/i.test(a));
  createWindow(!hidden && !launches);
  try { globalShortcut.register('Control+Alt+G', () => (win.isVisible() && win.isFocused() ? win.hide() : showWin())); } catch { /* Wayland */ }
  handleArgs(process.argv, true);
  applyAutostart();
  ensureLaunchers();
  if (auth.status().signedIn) startPolling();
});
