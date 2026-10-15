'use strict';
let seenTs = 0, firstFeed = true;

function feedList(limit) {
  const list = h('div', { class: 'feed' });
  if (!S.feed.length) return h('div', { class: 'empty' }, 'You’re all caught up.');
  for (const f of S.feed.slice(0, limit || 60)) {
    const a = byId(f.id); if (!a) continue;
    const el = h('div', { class: 'item' + (!firstFeed && f.ts > seenTs ? ' new' : ''), style: `--c1:${a.colors[0]};--c3:${a.colors[a.colors.length - 1]}`, onclick: () => navigate(f.target || { view: f.id }) },
      appIcon(a, 34), h('div', {}, h('div', { class: 't' }, f.title), f.body && h('div', { class: 'b' }, f.body), h('div', { class: 'w' }, `${a.name} · ${ago(f.ts)}`)));
    list.append(el);
  }
  seenTs = Math.max(seenTs, S.feed.length ? S.feed[0].ts : 0); firstFeed = false;
  return list;
}

function greeting() {
  const hr = new Date().getHours();
  const g = hr < 5 ? 'Good night' : hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
  const n = ((S.auth.profile && (S.auth.profile.given_name || S.auth.profile.name)) || '').split(' ')[0];
  return h('div', {}, h('div', { class: 'muted' }, new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })),
    h('p', { class: 'hello' }, g, n ? ', ' : '', n && h('b', {}, n)));
}

function card(appId, title, body, onMore) {
  const a = byId(appId);
  return h('section', { class: 'card', style: accentOf(a) }, h('h3', {}, svgEl(iconSvg(a, 26), 'ico'), title, h('span', { class: 'grow' }), onMore && h('button', { class: 'btn text', onclick: onMore }, 'Open')), body);
}

Views.home = {
  async mount(el) {
    const feedHolder = h('div', {});
    const mail = h('div', {}, spinner()), agenda = h('div', {}, spinner()), todo = h('div', {}, spinner());
    const launch = h('div', { class: 'launch' }, APPS.map((a) => h('button', { class: 'tile' + (S.unread[a.id] ? ' has' : ''), style: accentOf(a), onclick: () => (a.native ? go(a.id) : gone.openWeb(a.url)) },
      svgEl(iconSvg(a, 52), 'ico'), h('span', { class: 'name' }, a.name), !a.native && h('span', { class: 'tag', html: `<svg class="i" viewBox="0 0 24 24">${PATHS.ext}</svg>` }))));

    const settings = h('div', { class: 'settings' }, [['dnd', 'Do not disturb'], ['closeToTray', 'Close to tray'], ['autostart', 'Start at login']].map(([k, l]) =>
      h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: !!S.settings[k], onchange: (e) => gone.setSetting(k, e.target.checked) }), h('span'), l)));

    el.append(h('div', { class: 'home' },
      h('div', { class: 'col' }, greeting(),
        h('div', { class: 'cards' }, card('gmail', 'Unread mail', mail, () => go('gmail')), card('calendar', 'Today', agenda, () => go('calendar')), card('tasks', 'Due today', todo, () => go('tasks'))),
        h('section', { class: 'card' }, h('h2', {}, 'All apps'), launch)),
      h('div', { class: 'col' },
        h('section', { class: 'card' }, h('div', { class: 'row' }, h('h2', { style: 'margin:0;flex:1' }, 'Activity'), h('button', { class: 'btn text', onclick: () => gone.clearFeed() }, 'Clear')), feedHolder),
        h('section', { class: 'card' }, h('h2', {}, 'Settings'), settings))));

    Views.home.onState = () => { feedHolder.textContent = ''; feedHolder.append(feedList()); for (const t of launch.children) t.classList.toggle('has', !!S.unread[APPS[[...launch.children].indexOf(t)].id]); };
    Views.home.onState();

    // data cards load independently so one failing API doesn't blank the page
    call('gmail', 'list', { label: 'INBOX', q: 'is:unread', max: 5 }).then((r) => {
      mail.textContent = '';
      if (!r.threads.length) return mail.append(h('div', { class: 'empty' }, 'Inbox zero 🎉'));
      for (const t of r.threads) { const f = parseFrom(t.from); mail.append(h('div', { class: 'li', onclick: () => go('gmail', { view: 'gmail', thread: t.id }) }, avatar(f.name), h('div', {}, h('div', { class: 't' }, f.name), h('div', { class: 's' }, t.subject)))); }
    }).catch(() => { mail.textContent = ''; mail.append(h('div', { class: 'empty' }, 'Couldn’t load mail')); });

    const needFull = (box) => { box.textContent = ''; box.append(h('div', { class: 'empty' }, 'Needs full Google sign-in', h('div', {}, h('button', { class: 'btn text', onclick: () => go('account') }, 'Set up')))); };
    if (!S.auth.oauth) { needFull(agenda); needFull(todo); return; }
    const d0 = new Date(); d0.setHours(0, 0, 0, 0); const d1 = new Date(d0); d1.setDate(d1.getDate() + 1);
    call('calendar', 'events', { timeMin: d0.toISOString(), timeMax: d1.toISOString() }).then((evs) => {
      agenda.textContent = '';
      if (!evs.length) return agenda.append(h('div', { class: 'empty' }, 'Nothing scheduled'));
      for (const e of evs.slice(0, 6)) agenda.append(h('div', { class: 'li', onclick: () => go('calendar') }, h('span', { class: 'dot', style: `background:${e.color}` }), h('div', {}, h('div', { class: 't' }, e.title), h('div', { class: 's' }, e.allDay ? 'All day' : `${timeStr(e.start)} – ${timeStr(e.end)}`))));
    }).catch(() => { agenda.textContent = ''; agenda.append(h('div', { class: 'empty' }, 'Couldn’t load calendar')); });

    call('tasks', 'lists').then(async (lists) => {
      const end = new Date(); end.setHours(23, 59, 59, 999);
      const all = (await Promise.all(lists.map((l) => call('tasks', 'list', { listId: l.id }).then((ts) => ts.map((t) => ({ ...t, listId: l.id })))))).flat()
        .filter((t) => t.status !== 'completed' && t.due && new Date(t.due) <= end);
      todo.textContent = '';
      if (!all.length) return todo.append(h('div', { class: 'empty' }, 'Nothing due'));
      for (const t of all.slice(0, 6)) todo.append(h('div', { class: 'li', onclick: () => go('tasks') }, h('span', { class: 'dot', style: 'background:var(--c2)' }), h('div', {}, h('div', { class: 't' }, t.title))));
    }).catch(() => { todo.textContent = ''; todo.append(h('div', { class: 'empty' }, 'Couldn’t load tasks')); });
  },
};

// ---------- Account / first-run setup ----------
const CONSOLE = 'https://console.cloud.google.com/';
const API_LINKS = [['Gmail', 'gmail.googleapis.com'], ['Calendar', 'calendar-json.googleapis.com'], ['Tasks', 'tasks.googleapis.com'], ['People', 'people.googleapis.com'], ['Drive', 'drive.googleapis.com']];
const link = (text, url) => h('a', { onclick: () => gone.openLink(url), role: 'link', tabindex: 0, onkeydown: (e) => e.key === 'Enter' && gone.openLink(url) }, text);

Views.locked = {
  mount(el, a) {
    el.append(h('div', { class: 'connect card', style: accentOf(a) }, h('div', { class: 'logo' }, svgEl(iconSvg(a, 64))),
      h('h2', { class: 'big' }, `${a.name} needs full Google sign-in`),
      h('p', { class: 'muted' }, `Google only exposes ${a.name} through its OAuth API, so an app password isn’t enough. Add full sign-in once to unlock Calendar, Tasks, Contacts and Drive — your Gmail keeps working either way.`),
      h('button', { class: 'btn primary big', onclick: () => go('account') }, 'Set up full sign-in'),
      h('p', { class: 'muted' }, `Prefer not to? ${a.name} is still available on the web: `, link('open in browser', a.url.startsWith('http') ? a.url : 'https://google.com'))));
  },
};

Views.account = {
  mount(el) {
    const box = h('div', { class: 'connect' });
    el.append(h('div', { class: 'scroll', style: 'flex:1;display:flex' }, box));

    const quickCard = () => {
      const email = h('input', { type: 'email', placeholder: 'you@gmail.com', autocomplete: 'username' });
      const pw = h('input', { type: 'password', placeholder: 'abcd efgh ijkl mnop', autocomplete: 'off', spellcheck: 'false' });
      const btn = h('button', { class: 'btn primary', onclick: async () => {
        btn.disabled = true; btn.textContent = 'Checking…';
        try { S.auth = await gone.auth.setMail(email.value, pw.value); paintAccount(); toast('Gmail connected', true); go('home'); }
        catch (e) { toast(cleanErr(e)); btn.disabled = false; btn.textContent = 'Connect Gmail'; }
      } }, 'Connect Gmail');
      return h('section', { class: 'card', style: 'margin-bottom:16px' }, h('h2', {}, 'Quick start · app password'),
        h('p', { class: 'muted', style: 'margin-top:0' }, 'Gmail only, no Google Cloud setup. Works over IMAP/SMTP — read, send, archive, star, trash and notifications.'),
        h('ol', {}, h('li', {}, 'Turn on 2-Step Verification for your Google account.'),
          h('li', {}, 'Create an app password at ', link('myaccount.google.com/apppasswords', 'https://myaccount.google.com/apppasswords'), '.'),
          h('li', {}, 'Make sure IMAP is enabled in Gmail → Settings → Forwarding and POP/IMAP.')),
        h('p', { class: 'muted', style: 'font-size:12.5px' }, 'Page says “setting not available for your account”? 2-Step Verification is off, you only use passkeys/security keys, Advanced Protection is on, or it’s a work/school account. Use full Google OAuth below instead.'),
        field('Gmail address', email), field('App password', pw), btn);
    };

    const fullCard = (title) => {
      const a = S.auth;
      const body = [h('h2', {}, title), h('p', { class: 'muted', style: 'margin-top:0' }, 'Unlocks Calendar, Tasks, Contacts and Drive. Sign-in happens in your browser. Google needs a free OAuth client for this — one-time setup:')];
      if (!a.configured) {
        const id = h('input', { placeholder: '123456-abc.apps.googleusercontent.com', spellcheck: 'false' });
        const sec = h('input', { placeholder: 'GOCSPX-…', type: 'password', spellcheck: 'false' });
        const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: async (e) => {
          const f = e.target.files[0]; if (!f) return;
          try { S.auth = await gone.auth.importJson(await f.text()); render(); } catch (err) { toast(cleanErr(err)); }
        } });
        body.push(h('ol', {},
          h('li', {}, 'Open ', link('Google Cloud Console', CONSOLE), ' and create a project.'),
          h('li', {}, 'Enable these APIs: ', API_LINKS.map(([n, s], i) => [i ? ', ' : '', link(n, `${CONSOLE}apis/library/${s}`)])),
          h('li', {}, 'Under ', link('Google Auth Platform', `${CONSOLE}auth/overview`), ', set up consent (External), add yourself as a test user and publish to “In production” so tokens don’t expire after 7 days.'),
          h('li', {}, 'Create credentials → OAuth client ID → ', h('b', {}, 'Desktop app'), '. Import the JSON or paste the ID and secret.')),
          h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => file.click() }, ic('down'), 'Import client JSON'), file),
          h('p', { class: 'muted', style: 'margin:12px 0 4px' }, '…or enter them manually:'), field('Client ID', id), field('Client secret', sec),
          h('button', { class: 'btn primary', onclick: async () => { try { S.auth = await gone.auth.setCreds(id.value, sec.value); render(); } catch (e) { toast(cleanErr(e)); } } }, 'Save'));
      } else {
        const btn = h('button', { class: 'btn primary', onclick: async () => {
          btn.disabled = true; btn.textContent = 'Waiting for your browser…';
          try { await gone.auth.signIn(); S.auth = (await gone.state()).auth; paintAccount(); toast('Signed in', true); go('home'); }
          catch (e) { toast(cleanErr(e)); btn.disabled = false; btn.textContent = 'Sign in with Google'; }
        } }, 'Sign in with Google');
        body.push(btn, h('p', { class: 'muted' }, 'Your browser opens to approve access. An “unverified app” warning is expected for your own client — choose Advanced → continue.'));
      }
      return h('section', { class: 'card' }, body);
    };

    const render = () => {
      box.textContent = '';
      const a = S.auth;
      if (a.signedIn) {
        const p = a.profile || {};
        box.append(h('section', { class: 'card', style: 'margin-bottom:16px' }, h('div', { class: 'row' }, avatar(p.name || p.email, p.picture), h('div', { style: 'flex:1' }, h('div', { style: 'font-size:18px;font-weight:500' }, p.name || 'Signed in'), h('div', { class: 'muted' }, p.email || ''), h('div', { class: 'muted', style: 'font-size:12.5px' }, a.oauth ? 'Full Google sign-in (OAuth)' : 'Gmail via app password')),
          h('button', { class: 'btn danger', onclick: async () => { await gone.auth.signOut(); S.auth = (await gone.state()).auth; paintAccount(); go('account'); } }, ic('logout'), 'Sign out'))));
        if (!a.oauth) box.append(fullCard('Unlock the full suite · Google OAuth'));
        return;
      }
      box.append(h('div', { class: 'logo' }, svgEl(hubIconSvg(64))), h('h2', { class: 'big' }, 'Connect your Google account'),
        h('p', { class: 'muted' }, 'Pick whichever fits. Both sign in without an embedded browser, so Google won’t block them.'),
        quickCard(), fullCard('Full suite · Google OAuth'));
    };
    let sig = '';
    const key = () => `${S.auth.signedIn}|${S.auth.oauth}|${S.auth.configured}`;
    render(); sig = key();
    Views.account.onState = () => { if (key() !== sig) { sig = key(); render(); } };
  },
};
