'use strict';
// Shared by Tasks and by Gmail ("Create task").
async function taskDialog(pre, done) {
  let lists;
  try { lists = await call('tasks', 'lists'); } catch { return; }
  if (!lists.length) return toast('No task list found');
  const title = h('input', { value: pre.title || '' }), notes = h('textarea', { style: 'min-height:80px' }, pre.notes || ''), due = h('input', { type: 'date' });
  const list = h('select', {}, lists.map((l) => h('option', { value: l.id }, l.title)));
  dialog('New task', h('div', {}, field('Title', title), field('Details', notes), field('Due date (optional)', due), field('List', list)),
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', fn: async () => {
      if (!title.value.trim()) { toast('Add a title'); return false; }
      try { await call('tasks', 'add', { listId: list.value, title: title.value.trim(), notes: notes.value, due: due.value ? `${due.value}T00:00:00.000Z` : undefined }); toast('Task created', true); if (done) done(); } catch { return false; }
    } }]);
}
Views.tasks = {
  async mount(el) {
    let lists = [], cur = null, items = [];
    const nav = h('div', { class: 'nav' }), box = h('div', { class: 'scroll', style: 'flex:1' });
    const addIn = h('input', { placeholder: 'Add a task', 'aria-label': 'New task', onkeydown: async (e) => {
      if (e.key !== 'Enter' || !e.target.value.trim()) return;
      const title = e.target.value.trim(); e.target.value = '';
      try { await call('tasks', 'add', { listId: cur.id, title }); await loadItems(); } catch { e.target.value = title; }
    } });

    const drawNav = () => {
      nav.textContent = '';
      for (const l of lists) nav.append(h('a', { class: cur && cur.id === l.id ? 'on' : '', tabindex: 0, role: 'button', onclick: () => { cur = l; drawNav(); loadItems(); }, onkeydown: (e) => e.key === 'Enter' && e.currentTarget.click() }, ic('check'), l.title));
    };

    function draw() {
      box.textContent = '';
      const open = items.filter((t) => t.status !== 'completed'), done = items.filter((t) => t.status === 'completed');
      if (!items.length) box.append(h('div', { class: 'empty' }, 'No tasks yet — add one above'));
      const row = (t) => {
        const due = t.due ? new Date(t.due) : null;
        const late = due && t.status !== 'completed' && due < new Date(new Date().setHours(0, 0, 0, 0));
        return h('div', { class: 'task' + (t.status === 'completed' ? ' done' : '') },
          h('button', { class: 'check', role: 'checkbox', 'aria-checked': t.status === 'completed', 'aria-label': `Mark ${t.title} ${t.status === 'completed' ? 'incomplete' : 'complete'}`, onclick: async () => {
            const c = t.status !== 'completed';
            try { await call('tasks', 'update', { listId: cur.id, id: t.id, patch: c ? { status: 'completed' } : { status: 'needsAction', completed: null } }); await loadItems(); } catch { /* toast shown */ }
          } }, ic('check')),
          h('div', { class: 't' }, h('div', {}, t.title || '(untitled)'), t.notes && h('div', { class: 'muted', style: 'font-size:12.5px' }, t.notes)),
          due && h('span', { class: 'due' + (late ? ' late' : '') }, due.toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' })),
          h('button', { class: 'ib', 'aria-label': 'Delete task', onclick: async () => { try { await call('tasks', 'remove', { listId: cur.id, id: t.id }); await loadItems(); } catch { /* toast */ } } }, ic('trash')));
      };
      open.forEach((t) => box.append(row(t)));
      if (done.length) { box.append(h('div', { class: 'muted', style: 'padding:14px 14px 6px' }, `Completed (${done.length})`)); done.forEach((t) => box.append(row(t))); }
    }
    async function loadItems() {
      try { items = await call('tasks', 'list', { listId: cur.id }); } catch { items = []; }
      draw();
    }

    el.append(h('div', { class: 'split', style: 'grid-template-columns:220px 1fr' }, nav,
      h('div', { class: 'panel' }, h('div', { class: 'list-head' }, h('div', { class: 'search', style: 'flex:1' }, ic('plus'), addIn)), box)));
    box.append(spinner());
    try { lists = await call('tasks', 'lists'); } catch { box.textContent = ''; box.append(h('div', { class: 'empty' }, 'Couldn’t load tasks')); return; }
    cur = lists[0]; drawNav(); if (cur) await loadItems();
  },
};
