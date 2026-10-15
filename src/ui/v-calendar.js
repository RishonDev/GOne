'use strict';
// Shared by Calendar and by Gmail ("Add to calendar").
function eventDialog(pre, done) {
  const title = h('input', { placeholder: 'Add title', value: pre.title || '' }), date = h('input', { type: 'date', value: pre.date || ymd(new Date()) });
  const st = h('input', { type: 'time', value: pre.start || '09:00' }), en = h('input', { type: 'time', value: pre.end || '10:00' });
  const all = h('input', { type: 'checkbox', onchange: () => { st.disabled = en.disabled = all.checked; } });
  const loc = h('input', { placeholder: 'Location', value: pre.location || '' }), desc = h('textarea', { style: 'min-height:70px' }, pre.description || '');
  dialog('New event', h('div', {}, field('Title', title), field('Date', date), h('div', { class: 'row' }, field('Start', st), field('End', en)),
    h('label', { class: 'toggle', style: 'margin-bottom:12px' }, all, h('span'), 'All day'), field('Location', loc), field('Description', desc)),
    [{ label: 'Cancel' }, { label: 'Save', cls: 'primary', fn: async () => {
      if (!title.value.trim()) { toast('Add a title'); return false; }
      let start, end;
      if (all.checked) { const n = new Date(date.value + 'T00:00'); n.setDate(n.getDate() + 1); start = date.value; end = ymd(n); }
      else { start = new Date(`${date.value}T${st.value}`).toISOString(); end = new Date(`${date.value}T${en.value}`).toISOString(); if (end <= start) { toast('End must be after start'); return false; } }
      try { await call('calendar', 'create', { title: title.value, start, end, allDay: all.checked, location: loc.value, description: desc.value }); toast('Event created', true); if (done) done(); } catch { return false; }
    } }]);
}
Views.calendar = {
  async mount(el) {
    const today = new Date();
    let cursor = new Date(today.getFullYear(), today.getMonth(), 1), sel = new Date(today.getFullYear(), today.getMonth(), today.getDate()), events = [];
    const monthEl = h('div', { class: 'month' }), agenda = h('div', { class: 'agenda scroll', style: 'padding:6px 12px;flex:1' });
    const label = h('span', { style: 'font-size:18px;font-weight:500;min-width:170px' });

    const gridStart = () => { const d = new Date(cursor); d.setDate(1 - d.getDay()); return d; };
    const sameDay = (a, b) => a.toDateString() === b.toDateString();
    const eventsOn = (d) => events.filter((e) => {
      const s = new Date(e.allDay ? e.start + 'T00:00' : e.start), en = new Date(e.allDay ? e.end + 'T00:00' : e.end);
      const ds = new Date(d.getFullYear(), d.getMonth(), d.getDate()), de = new Date(ds); de.setDate(de.getDate() + 1);
      return s < de && en > ds || (s >= ds && s < de);
    });

    function drawMonth() {
      label.textContent = cursor.toLocaleDateString([], { month: 'long', year: 'numeric' });
      monthEl.textContent = '';
      ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach((d) => monthEl.append(h('div', { class: 'dow' }, d)));
      const d = gridStart();
      for (let i = 0; i < 42; i++, d.setDate(d.getDate() + 1)) {
        const day = new Date(d), evs = eventsOn(day);
        monthEl.append(h('button', { class: 'day' + (day.getMonth() !== cursor.getMonth() ? ' other' : '') + (sameDay(day, today) ? ' today' : '') + (sameDay(day, sel) ? ' sel' : ''), 'aria-label': day.toDateString(), onclick: () => { sel = day; drawMonth(); drawAgenda(); }, ondblclick: () => newEvent(day) },
          h('span', { class: 'num' }, day.getDate()),
          evs.slice(0, 3).map((e) => h('span', { class: 'ev', style: `background:${e.color}` }, e.title)),
          evs.length > 3 && h('span', { class: 'more' }, `+${evs.length - 3} more`)));
      }
    }

    function drawAgenda() {
      agenda.textContent = '';
      agenda.append(h('h2', {}, sel.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })));
      const evs = eventsOn(sel);
      if (!evs.length) agenda.append(h('div', { class: 'empty' }, 'No events'));
      for (const e of evs) {
        const mins = (new Date(e.start) - Date.now()) / 60000;
        agenda.append(h('div', { class: 'ag', tabindex: 0, role: 'button', onclick: () => detail(e), onkeydown: (ev) => ev.key === 'Enter' && detail(e) },
          h('div', { class: 'bar', style: `background:${e.color}` }),
          h('div', { style: 'min-width:0;flex:1' }, h('div', { style: 'font-weight:500' }, e.title),
            h('div', { class: 'muted', style: 'font-size:12.5px' }, e.allDay ? 'All day' : `${timeStr(e.start)} – ${timeStr(e.end)}`, !e.allDay && mins > 0 && mins <= 60 && h('span', { class: 'soon' }, `  · in ${Math.round(mins)} min`)),
            e.location && h('div', { class: 'muted', style: 'font-size:12.5px' }, e.location))));
      }
    }

    function detail(e) {
      const body = h('div', {}, h('div', { class: 'muted' }, e.allDay ? 'All day' : `${new Date(e.start).toLocaleString()} – ${timeStr(e.end)}`),
        e.location && h('p', {}, e.location), e.description && h('p', { style: 'white-space:pre-wrap' }, e.description.replace(/<[^>]+>/g, '')));
      const acts = [{ label: 'Close' }, { label: 'Open in browser', fn: () => { gone.openWeb(e.link); } }];
      if (e.meet) acts.push({ label: 'Join Meet', cls: 'primary', fn: () => { gone.openWeb(e.meet); } });
      if (e.attendees && e.attendees.length) acts.splice(1, 0, { label: 'Email guests', fn: () => go('gmail', { view: 'gmail', compose: { to: e.attendees.join(', '), subject: e.title } }) });
      acts.unshift({ label: 'Delete', cls: 'text danger', fn: async () => { try { await call('calendar', 'remove', { calId: e.calId, id: e.id }); load(); } catch { return false; } } });
      dialog(e.title, body, acts);
    }

    const newEvent = (day = sel) => eventDialog({ date: ymd(day) }, load);

    async function load() {
      const s = gridStart(), e = new Date(s); e.setDate(e.getDate() + 42);
      try { events = await call('calendar', 'events', { timeMin: s.toISOString(), timeMax: e.toISOString() }); } catch { events = []; }
      drawMonth(); drawAgenda();
    }
    const shift = (n) => { cursor = new Date(cursor.getFullYear(), cursor.getMonth() + n, 1); load(); };

    $('#topExtra').append(h('div', { class: 'row' },
      h('button', { class: 'btn', onclick: () => { cursor = new Date(today.getFullYear(), today.getMonth(), 1); sel = new Date(today.getFullYear(), today.getMonth(), today.getDate()); load(); } }, 'Today'),
      h('button', { class: 'ib', 'aria-label': 'Previous month', onclick: () => shift(-1) }, ic('left')), h('button', { class: 'ib', 'aria-label': 'Next month', onclick: () => shift(1) }, ic('right')), label));
    el.append(h('div', { class: 'cal' }, h('div', { class: 'panel' }, monthEl),
      h('div', { class: 'panel' }, h('div', { class: 'list-head' }, h('button', { class: 'btn primary', onclick: () => newEvent() }, ic('plus'), 'New event')), agenda)));
    drawMonth(); drawAgenda();
    await load();
    Views.calendar.onState = () => {};
  },
};
