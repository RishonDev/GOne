'use strict';
// Thin wrappers over the Google REST APIs. Everything returns plain JSON-able data for the renderer.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const auth = require('./auth');

async function g(url, { method = 'GET', body, query, raw } = {}) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(query || {})) {
    if (Array.isArray(v)) v.forEach((x) => u.searchParams.append(k, x));
    else if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v);
  }
  const go = async (retry) => {
    const r = await fetch(u, {
      method,
      headers: { Authorization: `Bearer ${await auth.accessToken()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 401 && retry) return go(false);
    if (!r.ok) {
      let msg = `${r.status} ${r.statusText}`;
      try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || msg; } catch { /* not json */ }
      throw new Error(msg);
    }
    if (raw) return r;
    return r.status === 204 ? null : r.json();
  };
  return go(true);
}

const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3';
const TASKS = 'https://tasks.googleapis.com/tasks/v1';
const PEOPLE = 'https://people.googleapis.com/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';

const hdr = (m, n) => ((m.payload.headers || []).find((h) => h.name.toLowerCase() === n.toLowerCase()) || {}).value || '';
const dec = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

// ---------------- Gmail ----------------
const gmailRest = {
  async list({ label = 'INBOX', q = '', pageToken, max } = {}) {
    const l = await g(`${GM}/threads`, { query: { labelIds: label === 'ALL' ? undefined : label, q, maxResults: max || 30, pageToken } });
    const threads = await Promise.all((l.threads || []).map(async (t) => {
      const th = await g(`${GM}/threads/${t.id}`, { query: { format: 'metadata', metadataHeaders: ['From', 'Subject'] } });
      const first = th.messages[0], last = th.messages[th.messages.length - 1];
      const labels = new Set(th.messages.flatMap((m) => m.labelIds || []));
      return {
        id: t.id, from: hdr(last, 'From') || hdr(first, 'From'), subject: hdr(first, 'Subject') || '(no subject)',
        snippet: last.snippet, date: Number(last.internalDate), count: th.messages.length,
        unread: labels.has('UNREAD'), starred: labels.has('STARRED'),
      };
    }));
    return { threads, next: l.nextPageToken || null };
  },

  async thread({ id }) {
    const th = await g(`${GM}/threads/${id}`, { query: { format: 'full' } });
    const messages = th.messages.map((m) => {
      let html = '', text = '';
      const atts = [];
      const walk = (p) => {
        if (p.filename && p.body && p.body.attachmentId) atts.push({ name: p.filename, size: p.body.size, attId: p.body.attachmentId });
        else if (p.mimeType === 'text/html' && p.body.data) html += dec(p.body.data);
        else if (p.mimeType === 'text/plain' && p.body.data) text += dec(p.body.data);
        (p.parts || []).forEach(walk);
      };
      walk(m.payload);
      return {
        id: m.id, from: hdr(m, 'From'), to: hdr(m, 'To'), cc: hdr(m, 'Cc'), subject: hdr(m, 'Subject'),
        date: Number(m.internalDate), html, text, atts, messageId: hdr(m, 'Message-ID'), references: hdr(m, 'References'),
      };
    });
    if (th.messages.some((m) => (m.labelIds || []).includes('UNREAD'))) {
      g(`${GM}/threads/${id}/modify`, { method: 'POST', body: { removeLabelIds: ['UNREAD'] } }).catch(() => {});
    }
    return { id, messages };
  },

  modify: ({ id, add = [], remove = [] }) => g(`${GM}/threads/${id}/modify`, { method: 'POST', body: { addLabelIds: add, removeLabelIds: remove } }).then(() => true),
  trash: ({ id }) => g(`${GM}/threads/${id}/trash`, { method: 'POST' }).then(() => true),

  async send({ to, cc, subject, body, threadId, inReplyTo, references }) {
    const lines = [`To: ${to}`, ...(cc ? [`Cc: ${cc}`] : []),
      `Subject: =?UTF-8?B?${Buffer.from(subject || '').toString('base64')}?=`,
      ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`, `References: ${(references ? references + ' ' : '') + inReplyTo}`] : []),
      'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '',
      Buffer.from(body || '').toString('base64')];
    const raw = Buffer.from(lines.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await g(`${GM}/messages/send`, { method: 'POST', body: { raw, threadId } });
    return true;
  },

  async attachment({ messageId, attId, name }) {
    const a = await g(`${GM}/messages/${messageId}/attachments/${attId}`);
    return saveDownload(name, Buffer.from(a.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
  },

  async unreadCount() {
    const l = await g(`${GM}/labels/INBOX`);
    return l.threadsUnread || 0;
  },

  async newUnread() {
    const l = await g(`${GM}/messages`, { query: { q: 'is:unread in:inbox newer_than:2d', maxResults: 15 } });
    return Promise.all((l.messages || []).map(async (m) => {
      const x = await g(`${GM}/messages/${m.id}`, { query: { format: 'metadata', metadataHeaders: ['Subject', 'From'] } });
      return { id: m.id, threadId: m.threadId, subject: hdr(x, 'Subject'), from: hdr(x, 'From'), snippet: x.snippet };
    }));
  },
};

// ---------------- Calendar ----------------
const calendar = {
  async events({ timeMin, timeMax }) {
    const cals = (await g(`${CAL}/users/me/calendarList`)).items.filter((c) => c.selected !== false);
    const all = await Promise.all(cals.map(async (c) => {
      const r = await g(`${CAL}/calendars/${encodeURIComponent(c.id)}/events`, { query: { timeMin, timeMax, singleEvents: true, orderBy: 'startTime', maxResults: 250 } });
      return (r.items || []).filter((e) => e.status !== 'cancelled').map((e) => ({
        id: e.id, calId: c.id, title: e.summary || '(no title)', location: e.location || '', description: e.description || '',
        allDay: !!e.start.date, start: e.start.dateTime || e.start.date, end: e.end.dateTime || e.end.date,
        color: c.backgroundColor || '#4285F4', link: e.htmlLink, attendees: (e.attendees || []).filter((a) => !a.self && !a.resource).map((a) => a.email), meet: e.hangoutLink || '',
        reminder: ((e.reminders && e.reminders.overrides && e.reminders.overrides[0]) || {}).minutes,
      }));
    }));
    return all.flat().sort((a, b) => new Date(a.start) - new Date(b.start));
  },
  create: ({ title, start, end, allDay, location, description }) => g(`${CAL}/calendars/primary/events`, {
    method: 'POST',
    body: {
      summary: title, location, description,
      start: allDay ? { date: start } : { dateTime: start },
      end: allDay ? { date: end } : { dateTime: end },
    },
  }).then(() => true),
  remove: ({ calId, id }) => g(`${CAL}/calendars/${encodeURIComponent(calId)}/events/${id}`, { method: 'DELETE' }).then(() => true),
};

// ---------------- Tasks ----------------
const tasks = {
  lists: () => g(`${TASKS}/users/@me/lists`).then((r) => r.items || []),
  list: ({ listId }) => g(`${TASKS}/lists/${listId}/tasks`, { query: { showCompleted: true, showHidden: true, maxResults: 100 } }).then((r) => r.items || []),
  add: ({ listId, title, notes, due }) => g(`${TASKS}/lists/${listId}/tasks`, { method: 'POST', body: { title, notes, due } }),
  update: ({ listId, id, patch }) => g(`${TASKS}/lists/${listId}/tasks/${id}`, { method: 'PATCH', body: patch }),
  remove: ({ listId, id }) => g(`${TASKS}/lists/${listId}/tasks/${id}`, { method: 'DELETE' }).then(() => true),
  async dueCount() {
    const lists = await tasks.lists();
    const end = new Date(); end.setHours(23, 59, 59, 999);
    const out = await Promise.all(lists.map((l) => g(`${TASKS}/lists/${l.id}/tasks`, { query: { showCompleted: false, dueMax: end.toISOString(), maxResults: 100 } })));
    return out.reduce((n, r) => n + (r.items || []).filter((t) => t.due).length, 0);
  },
};

// ---------------- Contacts ----------------
const contacts = {
  async list() {
    const out = [];
    let pageToken;
    do {
      const r = await g(`${PEOPLE}/people/me/connections`, { query: { personFields: 'names,emailAddresses,phoneNumbers,photos,organizations', pageSize: 1000, sortOrder: 'LAST_NAME_ASCENDING', pageToken } });
      for (const p of r.connections || []) {
        out.push({
          id: p.resourceName,
          name: (p.names && p.names[0] && p.names[0].displayName) || (p.emailAddresses && p.emailAddresses[0].value) || '(unnamed)',
          emails: (p.emailAddresses || []).map((e) => e.value), phones: (p.phoneNumbers || []).map((x) => x.value),
          org: (p.organizations && p.organizations[0] && p.organizations[0].name) || '',
          photo: p.photos && p.photos[0] && !p.photos[0].default ? p.photos[0].url : '',
        });
      }
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  },
  create: ({ name, email, phone }) => g(`${PEOPLE}/people:createContact`, {
    method: 'POST',
    body: { names: [{ givenName: name }], ...(email ? { emailAddresses: [{ value: email }] } : {}), ...(phone ? { phoneNumbers: [{ value: phone }] } : {}) },
  }).then(() => true),
  remove: ({ id }) => g(`${PEOPLE}/${id}:deleteContact`, { method: 'DELETE' }).then(() => true),
};

// ---------------- Drive ----------------
const drive = {
  async list({ folderId = 'root', q = '', pageToken } = {}) {
    const query = q ? `name contains '${q.replace(/'/g, "\\'")}' and trashed = false` : `'${folderId}' in parents and trashed = false`;
    const r = await g(`${DRIVE}/files`, { query: { q: query, pageSize: 60, pageToken, orderBy: 'folder,name', fields: 'nextPageToken,files(id,name,mimeType,modifiedTime,size,webViewLink,iconLink,starred)' } });
    return { files: r.files || [], next: r.nextPageToken || null };
  },
  async download({ id, name, mimeType }) {
    const exp = { 'application/vnd.google-apps.document': ['application/pdf', '.pdf'], 'application/vnd.google-apps.spreadsheet': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.xlsx'], 'application/vnd.google-apps.presentation': ['application/pdf', '.pdf'] }[mimeType];
    const r = exp
      ? await g(`${DRIVE}/files/${id}/export`, { query: { mimeType: exp[0] }, raw: true })
      : await g(`${DRIVE}/files/${id}`, { query: { alt: 'media' }, raw: true });
    return saveDownload(exp ? name + exp[1] : name, Buffer.from(await r.arrayBuffer()));
  },
  trash: ({ id }) => g(`${DRIVE}/files/${id}`, { method: 'PATCH', body: { trashed: true } }).then(() => true),
  // Cross-app: copy a Gmail attachment straight into My Drive.
  async fromGmail({ messageId, attId, name }) {
    const a = await g(`${GM}/messages/${messageId}/attachments/${attId}`);
    const buf = Buffer.from(a.data.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const b = `gone${Date.now()}`;
    const body = Buffer.concat([
      Buffer.from(`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name })}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      buf, Buffer.from(`\r\n--${b}--`)]);
    const r = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST', headers: { Authorization: `Bearer ${await auth.accessToken()}`, 'Content-Type': `multipart/related; boundary=${b}` }, body });
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))).error || {}).message || `Drive upload failed (${r.status})`);
    return r.json();
  },
};

function saveDownload(name, buf) {
  const dir = app.getPath('downloads');
  const safe = path.basename(name).replace(/[\0/]/g, '_') || 'download';
  const ext = path.extname(safe), base = path.basename(safe, ext);
  let dest = path.join(dir, safe), n = 1;
  while (fs.existsSync(dest)) dest = path.join(dir, `${base} (${n++})${ext}`);
  fs.writeFileSync(dest, buf);
  return dest;
}

// Gmail: REST when OAuth is connected, otherwise IMAP/SMTP with the app password.
const { imap } = require('./imap');
const gmail = {};
for (const fn of Object.keys(gmailRest)) gmail[fn] = (args) => (auth.status().oauth ? gmailRest : imap)[fn](args);

module.exports = { gmail, calendar, tasks, contacts, drive };
