'use strict';
const MAIL_LABELS = [['INBOX', 'Inbox', 'mail'], ['STARRED', 'Starred', 'star'], ['SENT', 'Sent', 'reply'], ['DRAFT', 'Drafts', 'file'], ['SPAM', 'Spam', 'x'], ['TRASH', 'Trash', 'trash'], ['ALL', 'All mail', 'archive']];
let contactCache = null;
async function contactEmails() {
  if (contactCache) return contactCache;
  contactCache = [];
  if (S.auth.oauth) { try { contactCache = (await gone.api('contacts', 'list')).flatMap((c) => c.emails.map((e) => ({ e, n: c.name }))); } catch { /* optional */ } }
  return contactCache;
}
const MEET_RE = /https:\/\/meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function emailFrame(m, images) {
  const csp = `default-src 'none'; img-src ${images ? 'data: https: cid:' : 'data:'}; style-src 'unsafe-inline'; font-src data:`;
  const body = m.html || `<pre style="white-space:pre-wrap;font:inherit;margin:0">${esc(m.text)}</pre>`;
  const f = h('iframe', { sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', title: 'Message body' });
  f.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><base target="_blank"><style>html,body{margin:0}body{padding:14px;font:14px/1.5 system-ui,sans-serif;color:#202124;background:#fff;word-break:break-word;overflow-y:hidden}img{max-width:100%;height:auto}blockquote{margin:0 0 0 8px;padding-left:12px;border-left:3px solid #ddd;color:#555}</style>${body}`;
  f.addEventListener('load', () => { try { f.style.height = f.contentDocument.documentElement.scrollHeight + 4 + 'px'; } catch { /* ignore */ } });
  return f;
}
const hasRemoteImages = (m) => /<img[^>]+src=["']?https?:|url\(\s*["']?https?:/i.test(m.html || '');

Views.gmail = {
  async mount(el, arg) {
    let label = 'INBOX', q = '', next = null, selId = null, threads = [];
    const labelNav = h('div', { class: 'nav' });
    const listBox = h('div', { class: 'scroll', style: 'flex:1' });
    const reader = h('div', { class: 'reader scroll' }, h('div', { class: 'empty' }, 'Select a conversation'));
    const searchIn = h('input', { type: 'search', placeholder: 'Search mail', 'aria-label': 'Search mail', onkeydown: (e) => { if (e.key === 'Enter') { q = e.target.value.trim(); load(); } } });

    const compose = (pre = {}) => {
      document.querySelector('.compose')?.remove();
      const to = h('input', { value: pre.to || '', placeholder: 'To' }), cc = h('input', { value: pre.cc || '', placeholder: 'Cc' });
      const sub = h('input', { value: pre.subject || '', placeholder: 'Subject' }), body = h('textarea', { 'aria-label': 'Message' }, pre.body || '');
      const box = h('div', { class: 'compose', role: 'dialog', 'aria-label': 'New message' },
        h('div', { class: 'ch' }, pre.subject?.startsWith('Re:') ? 'Reply' : 'New message', h('span', { class: 'grow' }), h('button', { class: 'ib', 'aria-label': 'Close', onclick: () => box.remove() }, ic('x'))),
        h('div', { class: 'cb' }, field('To', to), field('Cc', cc), field('Subject', sub), field('', body),
          h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: async (ev) => {
            if (!to.value.trim()) return toast('Add a recipient');
            ev.currentTarget.disabled = true;
            try { await call('gmail', 'send', { to: to.value, cc: cc.value, subject: sub.value, body: body.value, threadId: pre.threadId, inReplyTo: pre.inReplyTo, references: pre.references }); toast('Message sent', true); box.remove(); if (label === 'SENT') load(); }
            catch { ev.currentTarget.disabled = false; }
          } }, 'Send'), h('button', { class: 'btn text', onclick: () => box.remove() }, 'Discard'))));
      const dl = h('datalist', { id: 'gone-contacts' });
      to.setAttribute('list', 'gone-contacts'); cc.setAttribute('list', 'gone-contacts'); box.append(dl);
      contactEmails().then((cs) => {
        const seen = new Set(cs.map((c) => c.e));
        const extra = threads.map((t) => parseFrom(t.from)).filter((f) => f.addr.includes('@') && !seen.has(f.addr)).map((f) => ({ e: f.addr, n: f.name }));
        [...cs, ...extra].slice(0, 800).forEach((c) => dl.append(h('option', { value: c.e }, c.n)));
      });
      document.body.append(box); (pre.to ? body : to).focus();
    };

    const drawNav = () => {
      labelNav.textContent = '';
      labelNav.append(h('button', { class: 'btn primary big', onclick: () => compose() }, ic('plus'), 'Compose'));
      for (const [id, name, icon] of MAIL_LABELS) labelNav.append(h('a', { class: label === id ? 'on' : '', tabindex: 0, role: 'button', onclick: () => { label = id; q = ''; searchIn.value = ''; selId = null; drawNav(); load(); reader.textContent = ''; reader.append(h('div', { class: 'empty' }, 'Select a conversation')); }, onkeydown: (e) => e.key === 'Enter' && e.currentTarget.click() },
        ic(icon), name, id === 'INBOX' && S.unread.gmail ? h('span', { class: 'n' }, S.unread.gmail) : null));
    };

    const row = (t) => {
      const f = parseFrom(t.from);
      return h('div', { class: 'thread' + (t.unread ? ' unread' : '') + (t.id === selId ? ' sel' : ''), tabindex: 0, role: 'button', 'data-id': t.id, onclick: () => open(t.id), onkeydown: (e) => e.key === 'Enter' && open(t.id) },
        avatar(f.name), h('div', { style: 'min-width:0' }, h('div', { class: 'from' }, f.name, t.count > 1 && h('span', { class: 'muted' }, ` (${t.count})`)),
          h('div', { class: 'subj' }, t.subject, h('span', { class: 'snip' }, ' — ' + t.snippet))), h('div', { class: 'when' }, shortDate(t.date)));
    };

    async function load(more) {
      if (!more) { listBox.textContent = ''; listBox.append(spinner()); }
      try {
        const r = await call('gmail', 'list', { label, q, pageToken: more ? next : undefined });
        next = r.next;
        if (!more) { threads = []; listBox.textContent = ''; }
        listBox.querySelector('.more-btn')?.remove();
        r.threads = r.threads.filter((t) => !threads.some((x) => x.id === t.id));
        threads.push(...r.threads);
        if (!threads.length) listBox.append(h('div', { class: 'empty' }, q ? 'No results' : 'Nothing here'));
        r.threads.forEach((t) => listBox.append(row(t)));
        if (next) listBox.append(h('button', { class: 'btn text more-btn', style: 'margin:8px', onclick: () => load(true) }, 'Load more'));
      } catch { listBox.textContent = ''; listBox.append(h('div', { class: 'empty' }, 'Couldn’t load mail')); }
    }

    async function open(id) {
      selId = id;
      listBox.querySelectorAll('.thread').forEach((r) => { r.classList.toggle('sel', r.dataset.id === id); if (r.dataset.id === id) r.classList.remove('unread'); });
      reader.textContent = ''; reader.append(spinner());
      let th;
      try { th = await call('gmail', 'thread', { id }); } catch { return; }
      if (selId !== id) return;
      const last = th.messages[th.messages.length - 1];
      const t = threads.find((x) => x.id === id) || {};
      reader.textContent = '';
      reader.append(
        h('div', { class: 'row', style: 'margin-bottom:6px' }, h('h2', { class: 'subject', style: 'flex:1' }, last.subject || '(no subject)'),
          h('button', { class: 'ib' + (t.starred ? ' on' : ''), title: 'Star', 'aria-label': 'Star', onclick: async (e) => { t.starred = !t.starred; e.currentTarget.classList.toggle('on', t.starred); await call('gmail', 'modify', t.starred ? { id, add: ['STARRED'] } : { id, remove: ['STARRED'] }); } }, ic('star')),
          S.auth.oauth && h('button', { class: 'ib', title: 'Create task from this email', 'aria-label': 'Create task from this email', onclick: () => taskDialog({ title: last.subject, notes: `From: ${last.from}\n\n${(last.text || '').trim().slice(0, 300)}` }) }, ic('check')),
          S.auth.oauth && h('button', { class: 'ib', title: 'Add to calendar', 'aria-label': 'Add to calendar', onclick: () => eventDialog({ title: last.subject, description: `Email from ${last.from}\n\n${(last.text || '').trim().slice(0, 300)}`, date: ymd(new Date()) }) }, ic('plus')),
          h('button', { class: 'ib', title: 'Archive', 'aria-label': 'Archive', onclick: async () => { await call('gmail', 'modify', { id, remove: ['INBOX'] }); gone_removed(id); } }, ic('archive')),
          h('button', { class: 'ib', title: 'Mark unread', 'aria-label': 'Mark unread', onclick: async () => { await call('gmail', 'modify', { id, add: ['UNREAD'] }); toast('Marked unread', true); load(); } }, ic('unread')),
          h('button', { class: 'ib', title: 'Move to trash', 'aria-label': 'Move to trash', onclick: async () => { await call('gmail', 'trash', { id }); gone_removed(id); } }, ic('trash'))));
      th.messages.forEach((m, i) => {
        const f = parseFrom(m.from);
        const frame = h('div', {});
        const render = (img) => { frame.textContent = ''; frame.append(emailFrame(m, img)); };
        render(false);
        reader.append(h('div', { class: 'msg' },
          h('div', { class: 'msg-head' }, avatar(f.name), h('div', { style: 'flex:1;min-width:0' }, h('div', { style: 'font-weight:500' }, f.name, h('span', { class: 'muted', style: 'font-weight:400' }, `  <${f.addr}>`)), h('div', { class: 'muted', style: 'font-size:12px' }, `to ${m.to}  ·  ${new Date(m.date).toLocaleString()}`))),
          hasRemoteImages(m) && h('button', { class: 'btn text', onclick: (e) => { render(true); e.currentTarget.remove(); } }, 'Load remote images'),
          frame,
          MEET_RE.test(m.text + m.html) && h('button', { class: 'chip', onclick: () => gone.openWeb((m.text + m.html).match(MEET_RE)[0]) }, ic('video'), 'Join Google Meet'),
          m.atts.map((a) => h('span', { style: 'display:inline-flex' },
            h('button', { class: 'chip', onclick: () => call('gmail', 'attachment', { messageId: m.id, attId: a.attId, name: a.name }) }, ic('down'), `${a.name} (${Math.max(1, Math.round(a.size / 1024))} KB)`),
            S.auth.oauth && h('button', { class: 'chip', title: 'Save to Google Drive', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const r = await call('drive', 'fromGmail', { messageId: m.id, attId: a.attId, name: a.name }); toast(`Saved “${a.name}” to Drive`, true); b.textContent = 'Saved ✓'; b.onclick = () => gone.openWeb(r.webViewLink); b.disabled = false; } catch { b.disabled = false; } } }, 'Save to Drive'))),
          i === th.messages.length - 1 && h('div', { class: 'row', style: 'margin-top:10px' },
            h('button', { class: 'btn', onclick: () => compose({ to: f.addr, subject: /^re:/i.test(m.subject) ? m.subject : 'Re: ' + m.subject, threadId: id, inReplyTo: m.messageId, references: m.references, body: `\n\nOn ${new Date(m.date).toLocaleString()}, ${f.name} wrote:\n` + (m.text || '').split('\n').map((l) => '> ' + l).join('\n') }) }, ic('reply'), 'Reply'),
            h('button', { class: 'btn', onclick: () => compose({ subject: 'Fwd: ' + m.subject, body: `\n\n---------- Forwarded message ----------\nFrom: ${m.from}\n\n${m.text || ''}` }) }, 'Forward'))));
      });
      reader.scrollTop = 0;
    }
    function gone_removed(id) {
      threads = threads.filter((t) => t.id !== id); listBox.querySelector(`[data-id="${id}"]`)?.remove(); selId = null;
      reader.textContent = ''; reader.append(h('div', { class: 'empty' }, 'Done'));
    }

    $('#topExtra').append(h('div', { class: 'search', style: 'width:min(420px,40vw)' }, ic('search'), searchIn));
    el.append(h('div', { class: 'split', style: 'grid-template-columns:200px minmax(300px,420px) 1fr' }, labelNav,
      h('div', { class: 'panel' }, h('div', { class: 'list-head' }, h('button', { class: 'ib', title: 'Refresh', 'aria-label': 'Refresh', onclick: () => load() }, ic('refresh')), h('span', { class: 'muted' }, 'Conversations')), listBox),
      h('div', { class: 'panel' }, reader)));
    drawNav();
    Views.gmail.onState = drawNav;
    if (arg && arg.search) { q = arg.search; searchIn.value = q; label = 'ALL'; drawNav(); }
    await load();
    if (arg && arg.compose) compose(arg.compose);
    if (arg && arg.thread) open(arg.thread);
    return () => { document.querySelector('.compose')?.remove(); };
  },
};
