'use strict';
// Installs/removes icons + .desktop launchers (one per Google app, plus a main entry with a jump list).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { APPS, iconSvg, hubIconSvg } = require('./apps');

const home = os.homedir();
const dataHome = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
const iconDir = path.join(dataHome, 'icons', 'hicolor', 'scalable', 'apps');
const appDir = path.join(dataHome, 'applications');
const run = (cmd, args) => { try { execFileSync(cmd, args, { stdio: 'ignore' }); } catch { /* tool not installed */ } };
const q = (s) => `"${s.replace(/(["\\$`])/g, '\\$1')}"`;

function refreshCaches() {
  run('update-desktop-database', [appDir]);
  run('gtk-update-icon-cache', ['-f', '-t', path.join(dataHome, 'icons', 'hicolor')]);
  run('kbuildsycoca6', []);
}

// exec: command prefix that starts GOne, e.g. `"/opt/GOne/gone"` or `"electron" "/path/to/project"`.
function install(exec, { setMailto = true } = {}) {
  const files = [];
  const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); files.push(file); };

  for (const a of APPS) {
    write(path.join(iconDir, `gone-${a.id}.svg`), iconSvg(a, 256));
    write(path.join(appDir, `gone-${a.id}.desktop`), `[Desktop Entry]
Type=Application
Name=${a.name}
GenericName=Google ${a.name}
Comment=Google ${a.name} on your desktop (GOne)
Exec=${exec} --app=${a.id}${a.id === 'gmail' ? ' %u' : ''}
Icon=gone-${a.id}
Terminal=false
Categories=Network;Office;
StartupWMClass=GOne
${a.id === 'gmail' ? 'MimeType=x-scheme-handler/mailto;\n' : ''}`);
  }
  write(path.join(iconDir, 'gone.svg'), hubIconSvg(256));
  write(path.join(appDir, 'gone.desktop'), `[Desktop Entry]
Type=Application
Name=GOne
GenericName=Google Suite
Comment=All your Google apps with native notifications
Exec=${exec}
Icon=gone
Terminal=false
Categories=Network;Office;
StartupWMClass=GOne
StartupNotify=true
Actions=${APPS.map((a) => a.id).join(';')};

${APPS.map((a) => `[Desktop Action ${a.id}]\nName=${a.name}\nIcon=gone-${a.id}\nExec=${exec} --app=${a.id}\n`).join('\n')}`);

  refreshCaches();
  if (setMailto) run('xdg-mime', ['default', 'gone-gmail.desktop', 'x-scheme-handler/mailto']);
  return files;
}

function uninstall() {
  for (const a of APPS) for (const f of [path.join(appDir, `gone-${a.id}.desktop`), path.join(iconDir, `gone-${a.id}.svg`)]) fs.rmSync(f, { force: true });
  for (const f of [path.join(appDir, 'gone.desktop'), path.join(iconDir, 'gone.svg'), path.join(home, '.config', 'autostart', 'gone.desktop')]) fs.rmSync(f, { force: true });
  refreshCaches();
}

module.exports = { install, uninstall, q };
