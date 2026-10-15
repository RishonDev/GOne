'use strict';
Views.contacts = {
  async mount(el) {
    let all = [], selId = null;
    const listBox = h('div', { class: 'scroll', style: 'flex:1' }), detail = h('div', { class: 'scroll' }, h('div', { class: 'empty' }, 'Select a contact'));
    const searchIn = h('input', { type: 'search', placeholder: 'Search contacts', 'aria-label': 'Search contacts', oninput: draw });

    function draw() {
      const s = searchIn.value.trim().toLowerCase();
      const rows = all.filter((c) => !s || c.name.toLowerCase().includes(s) || c.emails.some((e) => e.toLowerCase().includes(s)) || c.phones.some((p) => p.includes(s)));
      listBox.textContent = '';
      if (!rows.length) listBox.append(h('div', { class: 'empty' }, all.length ? 'No matches' : 'No contacts yet'));
      for (const c of rows.slice(0, 400)) listBox.append(h('div', { class: 'thread' + (c.id === selId ? ' sel' : ''), style: 'grid-template-columns:36px 1fr', tabindex: 0, role: 'button', onclick: () => show(c), onkeydown: (e) => e.key === 'Enter' && show(c) },
        avatar(c.name, c.photo), h('div', { style: 'min-width:0' }, h('div', { class: 'from' }, c.name), h('div', { class: 'snip muted', style: 'font-size:12.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' }, c.emails[0] || c.phones[0] || c.org))));
    }
    function show(c) {
      selId = c.id; draw(); detail.textContent = '';
      detail.append(h('div', { class: 'detail' }, avatar(c.name, c.photo), h('h2', { class: 'name' }, c.name), c.org && h('div', { class: 'muted' }, c.org),
        h('div', { style: 'margin-top:16px;width:100%;max-width:420px;text-align:left' },
          c.emails.map((m) => h('div', { class: 'li', onclick: () => go('gmail', { view: 'gmail', compose: { to: m } }) }, ic('mail'), h('div', {}, h('div', { class: 't' }, m), h('div', { class: 's' }, 'Send email')),
            h('button', { class: 'btn text', onclick: (e) => { e.stopPropagation(); go('gmail', { view: 'gmail', search: `from:${m} OR to:${m}` }); } }, 'Search mail'))),
          c.phones.map((p) => h('div', { class: 'li', onclick: () => navigator.clipboard.writeText(p).then(() => toast('Number copied', true)) }, ic('phone'), h('div', {}, h('div', { class: 't' }, p), h('div', { class: 's' }, 'Copy number'))))),
        h('button', { class: 'btn danger', style: 'margin-top:16px', onclick: () => dialog('Delete contact?', `${c.name} will be removed from Google Contacts.`, [{ label: 'Cancel' }, { label: 'Delete', cls: 'text danger', fn: async () => {
          try { await call('contacts', 'remove', { id: c.id }); all = all.filter((x) => x.id !== c.id); selId = null; detail.textContent = ''; draw(); } catch { return false; }
        } }]) }, ic('trash'), 'Delete')));
    }
    function create() {
      const n = h('input', { placeholder: 'Full name' }), m = h('input', { type: 'email', placeholder: 'name@example.com' }), p = h('input', { type: 'tel', placeholder: 'Phone' });
      dialog('New contact', h('div', {}, field('Name', n), field('Email', m), field('Phone', p)), [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', fn: async () => {
        if (!n.value.trim()) { toast('Add a name'); return false; }
        try { await call('contacts', 'create', { name: n.value.trim(), email: m.value.trim(), phone: p.value.trim() }); toast('Contact saved', true); load(); } catch { return false; }
      } }]);
    }
    async function load() {
      listBox.textContent = ''; listBox.append(spinner());
      try { all = await call('contacts', 'list'); } catch { all = []; }
      draw();
    }

    $('#topExtra').append(h('div', { class: 'search', style: 'width:min(420px,40vw)' }, ic('search'), searchIn));
    el.append(h('div', { class: 'split', style: 'grid-template-columns:minmax(300px,400px) 1fr' },
      h('div', { class: 'panel' }, h('div', { class: 'list-head' }, h('button', { class: 'btn primary', onclick: create }, ic('plus'), 'New contact')), listBox), h('div', { class: 'panel' }, detail)));
    await load();
  },
};
