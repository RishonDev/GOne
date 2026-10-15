'use strict';
const DRIVE_TYPES = {
  'application/vnd.google-apps.folder': ['folder', 'var(--yellow)'],
  'application/vnd.google-apps.document': ['file', '#4285F4'],
  'application/vnd.google-apps.spreadsheet': ['file', '#34A853'],
  'application/vnd.google-apps.presentation': ['file', '#FBBC04'],
};
const fmtSize = (n) => (n ? (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB') : '');

Views.drive = {
  async mount(el) {
    let path = [{ id: 'root', name: 'My Drive' }], q = '', files = [], next = null;
    const crumbs = h('div', { class: 'crumbs' }), box = h('div', { class: 'scroll files', style: 'flex:1' });
    const searchIn = h('input', { type: 'search', placeholder: 'Search Drive', 'aria-label': 'Search Drive', onkeydown: (e) => { if (e.key === 'Enter') { q = e.target.value.trim(); load(); } } });

    function drawCrumbs() {
      crumbs.textContent = '';
      if (q) return crumbs.append(h('span', {}, `Results for “${q}”`), h('a', { onclick: () => { q = ''; searchIn.value = ''; load(); } }, 'Clear'));
      path.forEach((p, i) => { if (i) crumbs.append(ic('right')); crumbs.append(h('a', { tabindex: 0, onclick: () => { path = path.slice(0, i + 1); load(); }, onkeydown: (e) => e.key === 'Enter' && e.currentTarget.click() }, p.name)); });
    }
    function row(f) {
      const [icon, color] = DRIVE_TYPES[f.mimeType] || ['file', 'var(--muted)'];
      const isFolder = f.mimeType === 'application/vnd.google-apps.folder', isGoogle = f.mimeType.startsWith('application/vnd.google-apps.');
      return h('div', { class: 'li', tabindex: 0, role: 'button', onclick: () => (isFolder ? (path.push({ id: f.id, name: f.name }), q = '', searchIn.value = '', load()) : isGoogle ? gone.openWeb(f.webViewLink) : call('drive', 'download', { id: f.id, name: f.name, mimeType: f.mimeType })), onkeydown: (e) => e.key === 'Enter' && e.currentTarget.click() },
        h('div', { class: 'fico', style: `background:${color}` }, ic(icon)),
        h('div', {}, h('div', { class: 't' }, f.name), h('div', { class: 's' }, new Date(f.modifiedTime).toLocaleDateString(), f.size ? ' · ' + fmtSize(Number(f.size)) : '')),
        !isFolder && h('button', { class: 'ib', title: isGoogle ? 'Export' : 'Download', 'aria-label': 'Download ' + f.name, onclick: (e) => { e.stopPropagation(); call('drive', 'download', { id: f.id, name: f.name, mimeType: f.mimeType }); } }, ic('down')),
        !isFolder && f.webViewLink && h('button', { class: 'ib', title: 'Open in browser', 'aria-label': 'Open ' + f.name + ' in browser', onclick: (e) => { e.stopPropagation(); gone.openWeb(f.webViewLink); } }, ic('ext')),
        h('button', { class: 'ib', title: 'Move to trash', 'aria-label': 'Trash ' + f.name, onclick: (e) => { e.stopPropagation(); dialog('Move to trash?', f.name, [{ label: 'Cancel' }, { label: 'Trash', cls: 'text danger', fn: async () => { try { await call('drive', 'trash', { id: f.id }); files = files.filter((x) => x.id !== f.id); draw(); } catch { return false; } } }]); } }, ic('trash')));
    }
    function draw() {
      box.textContent = '';
      if (!files.length) box.append(h('div', { class: 'empty' }, 'This folder is empty'));
      files.forEach((f) => box.append(row(f)));
      if (next) box.append(h('button', { class: 'btn text', style: 'margin:8px', onclick: () => load(true) }, 'Load more'));
    }
    async function load(more) {
      drawCrumbs();
      if (!more) { box.textContent = ''; box.append(spinner()); }
      try {
        const r = await call('drive', 'list', { folderId: path[path.length - 1].id, q, pageToken: more ? next : undefined });
        files = more ? files.concat(r.files) : r.files; next = r.next;
      } catch { files = []; next = null; }
      draw();
    }

    $('#topExtra').append(h('div', { class: 'search', style: 'width:min(420px,40vw)' }, ic('search'), searchIn));
    const mk = (label, url) => h('button', { class: 'btn', onclick: () => gone.openWeb(url) }, ic('plus'), label);
    el.append(h('div', { class: 'split', style: 'grid-template-columns:1fr' }, h('div', { class: 'panel' },
      h('div', { class: 'list-head' }, crumbs, h('span', { class: 'grow' }), mk('Doc', 'https://docs.google.com/document/create'), mk('Sheet', 'https://docs.google.com/spreadsheets/create'), mk('Slides', 'https://docs.google.com/presentation/create')), box)));
    await load();
  },
};
