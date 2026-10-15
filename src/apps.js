'use strict';
// App registry + gradient icon generator. Works in Node (main/installer) and in the hub renderer.
(function (root) {
  const APPS = [
    { id: 'gmail', native: true, name: 'Gmail', url: 'https://mail.google.com/mail/', match: /^mail\.google\.com\//,
      colors: ['#FF8A80', '#EA4335', '#B31412'],
      glyph: '<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.5 7l8.5 6.5L20.5 7"/>' },
    { id: 'calendar', native: true, name: 'Calendar', url: 'https://calendar.google.com/', match: /^calendar\.google\.com\//,
      colors: ['#8AB4F8', '#4285F4', '#1967D2'],
      glyph: '<rect x="4" y="5" width="16" height="15" rx="2.5"/><path d="M4 10h16M8 3v4M16 3v4M9 14.5h2v2.5H9z"/>' },
    { id: 'drive', native: true, name: 'Drive', url: 'https://drive.google.com/drive/', match: /^drive\.google\.com\//,
      colors: ['#FBBC04', '#34A853', '#4285F4'],
      glyph: '<path d="M9 4h6l6 10.5-3 5.5H6l-3-5.5z"/><path d="M9 4l6 10.5h6M15 4L9 14.5H3M6 20l3-5.5h9"/>' },
    { id: 'docs', name: 'Docs', url: 'https://docs.google.com/document/u/0/', match: /^docs\.google\.com\/document/,
      colors: ['#8AB4F8', '#4285F4', '#174EA6'],
      glyph: '<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4M9.5 12h5M9.5 15.5h5"/>' },
    { id: 'sheets', name: 'Sheets', url: 'https://docs.google.com/spreadsheets/u/0/', match: /^docs\.google\.com\/spreadsheets/,
      colors: ['#81C995', '#34A853', '#0D652D'],
      glyph: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M4 9.5h16M4 14.5h16M10 4v16"/>' },
    { id: 'slides', name: 'Slides', url: 'https://docs.google.com/presentation/u/0/', match: /^docs\.google\.com\/presentation/,
      colors: ['#FDE293', '#FBBC04', '#E37400'],
      glyph: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><rect x="7.5" y="9" width="9" height="6" rx="1"/>' },
    { id: 'meet', name: 'Meet', url: 'https://meet.google.com/', match: /^meet\.google\.com/,
      colors: ['#34A853', '#00897B', '#4285F4'],
      glyph: '<rect x="3" y="6.5" width="12.5" height="11" rx="2.5"/><path d="M15.5 10.5L21 7.5v9l-5.5-3"/>' },
    { id: 'chat', name: 'Chat', url: 'https://mail.google.com/chat/', match: /^(chat\.google\.com|mail\.google\.com\/chat)/, prio: 1,
      colors: ['#5BB974', '#00AC47', '#00692B'],
      glyph: '<path d="M4 5.5h16v11H9.5L5 20.5v-4H4z"/>' },
    { id: 'photos', name: 'Photos', url: 'https://photos.google.com/', match: /^photos\.google\.com/,
      colors: ['#EA4335', '#FBBC04', '#34A853', '#4285F4'],
      glyph: '<circle cx="12" cy="7.2" r="3.4"/><circle cx="16.8" cy="12" r="3.4"/><circle cx="12" cy="16.8" r="3.4"/><circle cx="7.2" cy="12" r="3.4"/>' },
    { id: 'keep', name: 'Keep', url: 'https://keep.google.com/', match: /^keep\.google\.com/,
      colors: ['#FDD663', '#FBBC04', '#E37400'],
      glyph: '<path d="M9.5 18h5M10.5 21h3M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>' },
    { id: 'tasks', native: true, name: 'Tasks', url: 'https://tasks.google.com/embed/?origin=https://calendar.google.com', match: /^tasks\.google\.com/,
      colors: ['#669DF6', '#1A73E8', '#174EA6'],
      glyph: '<circle cx="12" cy="12" r="8"/><path d="M8.3 12.4l2.6 2.6 4.8-5.2"/>' },
    { id: 'maps', name: 'Maps', url: 'https://www.google.com/maps', match: /^(maps\.google\.com|www\.google\.com\/maps)/,
      colors: ['#34A853', '#4285F4', '#EA4335'],
      glyph: '<path d="M12 21s6-5.4 6-11a6 6 0 0 0-12 0c0 5.6 6 11 6 11z"/><circle cx="12" cy="10" r="2.2"/>' },
    { id: 'contacts', native: true, name: 'Contacts', url: 'https://contacts.google.com/', match: /^contacts\.google\.com/,
      colors: ['#669DF6', '#4285F4', '#174EA6'],
      glyph: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.9-4 3.9-5.6 7-5.6s6.1 1.6 7 5.6"/>' },
    { id: 'translate', name: 'Translate', url: 'https://translate.google.com/', match: /^translate\.google\.com/,
      colors: ['#8AB4F8', '#4285F4', '#1967D2'],
      glyph: '<path d="M4 5.5h9M8.5 3.5v2M6 5.5c.6 3.8 3 6.8 6.2 7.8M11 5.5c-.7 3.8-3.4 6.8-6.8 7.8M13 20.5l4-9 4 9M14.6 17.2h4.8"/>' },
  ];

  const byId = (id) => APPS.find((a) => a.id === id);

  function appForUrl(url) {
    let u;
    try { u = new URL(url); } catch { return null; }
    const key = u.host + u.pathname;
    return [...APPS].sort((a, b) => (b.prio || 0) - (a.prio || 0)).find((a) => a.match.test(key)) || null;
  }

  function stops(colors) {
    return colors.map((c, i) => `<stop offset="${Math.round((i / (colors.length - 1)) * 100)}%" stop-color="${c}"/>`).join('');
  }

  // Squircle tile: diagonal gradient of the app's logo colors, glass highlight, white line glyph.
  function iconSvg(app, size = 96) {
    const g = `g-${app.id}`, s = `s-${app.id}`;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
<defs><linearGradient id="${g}" x1="0" y1="0" x2="1" y2="1">${stops(app.colors)}</linearGradient>
<linearGradient id="${s}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect x="4" y="4" width="88" height="88" rx="24" fill="url(#${g})"/>
<rect x="4" y="4" width="88" height="88" rx="24" fill="url(#${s})"/>
<g transform="translate(24 24) scale(2)" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${app.glyph}</g></svg>`;
  }

  // Hub icon: Google's four brand colors with a 3x3 "apps" dot grid.
  function hubIconSvg(size = 96) {
    const dots = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) dots.push(`<circle cx="${30 + c * 18}" cy="${30 + r * 18}" r="5.2"/>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 96 96">
<defs><linearGradient id="g-hub" x1="0" y1="0" x2="1" y2="1">${stops(['#4285F4', '#EA4335', '#FBBC04', '#34A853'])}</linearGradient>
<linearGradient id="s-hub" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".32"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect x="4" y="4" width="88" height="88" rx="24" fill="url(#g-hub)"/><rect x="4" y="4" width="88" height="88" rx="24" fill="url(#s-hub)"/>
<g fill="#fff">${dots.join('')}</g></svg>`;
  }

  const api = { APPS, byId, appForUrl, iconSvg, hubIconSvg };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.GOneApps = api;
})(typeof window !== 'undefined' ? window : this);
