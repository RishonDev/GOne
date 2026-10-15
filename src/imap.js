'use strict';
// Gmail over IMAP/SMTP with an app password: same interface as api.gmail (REST), no Cloud project needed.
const { ImapFlow } = require('imapflow');
const nodemailer = require('nodemailer');
const { simpleParser } = require('mailparser');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let creds = null;      // { email, password, name }
let client = null, connecting = null, folders = null;

const SPECIAL = { INBOX: 'INBOX', STARRED: '\\Flagged', SENT: '\\Sent', DRAFT: '\\Drafts', SPAM: '\\Junk', TRASH: '\\Trash', ALL: '\\All' };

function setCreds(c) { creds = c; close(); }
function close() { const c = client; client = null; folders = null; if (c) c.logout().catch(() => {}); }

function newClient(c) {
  return new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: c.email, pass: c.password }, logger: false });
}

async function verify(email, password) {
  const c = newClient({ email, password });
  c.on('error', () => {});
  try { await c.connect(); } catch (e) {
    throw new Error(e.authenticationFailed ? 'Gmail rejected that app password. Check the address, and that IMAP is enabled in Gmail settings.' : e.message);
  }
  await c.logout();
}

async function conn() {
  if (!creds) throw new Error('Not signed in.');
  if (client && client.usable) return client;
  if (!connecting) {
    connecting = (async () => {
      const c = newClient(creds);
      c.on('error', () => { if (client === c) client = null; });
      c.on('close', () => { if (client === c) client = null; });
      await c.connect();
      client = c;
      folders = {};
      for (const b of await c.list()) if (b.specialUse) folders[b.specialUse] = b.path;
      folders.INBOX = 'INBOX';
      return c;
    })().finally(() => { connecting = null; });
  }
  return connecting;
}

const pathFor = (label) => { const k = SPECIAL[label] || SPECIAL.INBOX; return k === 'INBOX' ? 'INBOX' : (folders[k] || 'INBOX'); };
async function withBox(boxPath, fn) {
  const c = await conn();
  const lock = await c.getMailboxLock(boxPath);
  try { return await fn(c); } finally { lock.release(); }
}
const fmtAddr = (a) => (a ? (a.name ? `"${a.name.replace(/"/g, '')}" <${a.address}>` : a.address || '') : '');
const idStr = (v) => (v == null ? '' : String(v));

async function snippetOf(source) {
  try {
    const p = await simpleParser(source);
    return (p.text || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  } catch { return ''; }
}

const imap = {
  async list({ label = 'INBOX', q = '', pageToken, max } = {}) {
    await conn();
    return withBox(pathFor(label), async (c) => {
      const query = q ? { gmraw: q } : { all: true };
      const uids = (await c.search(query, { uid: true })) || [];
      uids.sort((a, b) => b - a);
      const offset = Number(pageToken) || 0, size = max ? max * 2 : 40;
      const slice = uids.slice(offset, offset + size);
      const groups = new Map();
      if (slice.length) {
        for await (const m of c.fetch(slice.join(','), { uid: true, envelope: true, flags: true, threadId: true, internalDate: true, source: { maxLength: 6000 } }, { uid: true })) {
          const tid = idStr(m.threadId) || `u${m.uid}`;
          const g = groups.get(tid) || { msgs: [] };
          g.msgs.push(m); groups.set(tid, g);
        }
      }
      const threads = [];
      for (const [tid, g] of groups) {
        g.msgs.sort((a, b) => b.uid - a.uid);
        const last = g.msgs[0], first = g.msgs[g.msgs.length - 1];
        threads.push({
          id: tid, from: fmtAddr(last.envelope.from && last.envelope.from[0]), subject: first.envelope.subject || '(no subject)',
          snippet: await snippetOf(last.source), date: new Date(last.internalDate).getTime(), count: g.msgs.length,
          unread: g.msgs.some((m) => !m.flags.has('\\Seen')), starred: g.msgs.some((m) => m.flags.has('\\Flagged')),
        });
      }
      threads.sort((a, b) => b.date - a.date);
      const nextOff = offset + size;
      return { threads: max ? threads.slice(0, max) : threads, next: nextOff < uids.length ? String(nextOff) : null };
    });
  },

  async thread({ id }) {
    await conn();
    return withBox(pathFor('ALL'), async (c) => {
      const uids = (await c.search({ threadId: id }, { uid: true })) || [];
      uids.sort((a, b) => a - b);
      const messages = [];
      for await (const m of c.fetch(uids.join(','), { uid: true, source: true }, { uid: true })) {
        const p = await simpleParser(m.source);
        let html = p.html || '';
        for (const a of p.attachments || []) {
          if (a.cid && /^image\//.test(a.contentType) && a.size < 3e6) html = html.split(`cid:${a.cid}`).join(`data:${a.contentType};base64,${a.content.toString('base64')}`);
        }
        messages.push({
          id: String(m.uid), from: p.from ? p.from.text : '', to: p.to ? p.to.text : '', cc: p.cc ? p.cc.text : '', subject: p.subject || '',
          date: (p.date || new Date()).getTime(), html, text: p.text || '',
          atts: (p.attachments || []).map((a, i) => ({ name: a.filename || `attachment-${i + 1}`, size: a.size, attId: String(i), inline: !!a.related })).filter((a) => !a.inline),
          messageId: p.messageId || '', references: Array.isArray(p.references) ? p.references.join(' ') : p.references || '',
        });
      }
      if (uids.length) await c.messageFlagsAdd(uids.join(','), ['\\Seen'], { uid: true });
      return { id, messages };
    });
  },

  async modify({ id, add = [], remove = [] }) {
    await conn();
    const flags = (uids, c, addF, delF) => Promise.all([
      addF.length && c.messageFlagsAdd(uids.join(','), addF, { uid: true }),
      delF.length && c.messageFlagsRemove(uids.join(','), delF, { uid: true }),
    ]);
    await withBox(pathFor('ALL'), async (c) => {
      const uids = (await c.search({ threadId: id }, { uid: true })) || [];
      if (!uids.length) return;
      const addF = [], delF = [];
      if (add.includes('STARRED')) addF.push('\\Flagged');
      if (remove.includes('STARRED')) delF.push('\\Flagged');
      if (add.includes('UNREAD')) delF.push('\\Seen');
      if (remove.includes('UNREAD')) addF.push('\\Seen');
      await flags(uids, c, addF, delF);
    });
    if (remove.includes('INBOX')) {
      await withBox('INBOX', async (c) => {
        const uids = (await c.search({ threadId: id }, { uid: true })) || [];
        if (uids.length) await c.messageMove(uids.join(','), pathFor('ALL'), { uid: true });
      });
    }
    return true;
  },

  async trash({ id }) {
    await conn();
    await withBox(pathFor('ALL'), async (c) => {
      const uids = (await c.search({ threadId: id }, { uid: true })) || [];
      if (uids.length) await c.messageMove(uids.join(','), pathFor('TRASH'), { uid: true });
    });
    return true;
  },

  async send({ to, cc, subject, body, inReplyTo, references }) {
    const t = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: creds.email, pass: creds.password } });
    await t.sendMail({ from: creds.name ? `"${creds.name}" <${creds.email}>` : creds.email, to, cc: cc || undefined, subject, text: body, inReplyTo: inReplyTo || undefined, references: references ? references + ' ' + inReplyTo : inReplyTo || undefined });
    return true;
  },

  async attachment({ messageId, attId, name }) {
    await conn();
    return withBox(pathFor('ALL'), async (c) => {
      const m = await c.fetchOne(messageId, { source: true }, { uid: true });
      const p = await simpleParser(m.source);
      const files = (p.attachments || []).filter((a) => !a.related);
      const a = files[Number(attId)] || (p.attachments || [])[Number(attId)];
      if (!a) throw new Error('Attachment not found.');
      const dir = app.getPath('downloads');
      const safe = path.basename(name || a.filename || 'attachment').replace(/[\0/]/g, '_');
      const ext = path.extname(safe), base = path.basename(safe, ext);
      let dest = path.join(dir, safe), n = 1;
      while (fs.existsSync(dest)) dest = path.join(dir, `${base} (${n++})${ext}`);
      fs.writeFileSync(dest, a.content);
      return dest;
    });
  },

  async unreadCount() {
    const c = await conn();
    const st = await c.status('INBOX', { unseen: true });
    return st.unseen || 0;
  },

  async newUnread() {
    await conn();
    return withBox('INBOX', async (c) => {
      const since = new Date(Date.now() - 2 * 86400e3);
      const uids = ((await c.search({ seen: false, since }, { uid: true })) || []).sort((a, b) => b - a).slice(0, 15);
      const out = [];
      if (uids.length) {
        for await (const m of c.fetch(uids.join(','), { uid: true, envelope: true, threadId: true, source: { maxLength: 6000 } }, { uid: true })) {
          out.push({ id: m.envelope.messageId || `uid${m.uid}`, threadId: idStr(m.threadId), subject: m.envelope.subject || '', from: fmtAddr(m.envelope.from && m.envelope.from[0]), snippet: await snippetOf(m.source) });
        }
      }
      return out;
    });
  },
};

module.exports = { imap, setCreds, verify, close };
