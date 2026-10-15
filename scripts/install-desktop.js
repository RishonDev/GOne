#!/usr/bin/env node
'use strict';
// Dev-mode installer: launchers that run this checkout via `electron <project>`.
const path = require('path');
const { install, uninstall, q } = require('../src/launchers');

if (process.argv.includes('--uninstall')) { uninstall(); console.log('GOne launchers removed.'); process.exit(0); }

let electron;
try { electron = require('electron'); } catch { console.error('Run `npm install` first.'); process.exit(1); }
const files = install(`${q(electron)} ${q(path.resolve(__dirname, '..'))}`);
console.log(`Installed ${files.length} files. Gmail is now the default mailto: handler. Undo: npm run uninstall-desktop`);
