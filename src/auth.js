'use strict';
// OAuth 2.0 for installed apps: system browser + loopback redirect + PKCE.
// Sign-in happens in the user's real browser, so Google never sees an embedded webview.
const http = require('http');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, shell, safeStorage } = require('electron');

const SCOPES = [
  'openid', 'email', 'profile',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/drive',
];
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

const file = () => path.join(app.getPath('userData'), 'auth.bin');
let data = { creds: null, tokens: null, profile: null, mail: null };

function load() {
  try {
    const raw = fs.readFileSync(file());
    const text = raw[0] === 0x7b ? raw.toString('utf8') : safeStorage.decryptString(raw);
    data = { ...data, ...JSON.parse(text) };
  } catch { /* nothing saved yet */ }
}
function save() {
  const text = JSON.stringify(data);
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  const buf = safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : Buffer.from(text);
  fs.writeFileSync(file(), buf, { mode: 0o600 });
}

const b64u = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function setCreds(clientId, clientSecret) {
  clientId = String(clientId || '').trim(); clientSecret = String(clientSecret || '').trim();
  if (!clientId || !clientSecret) throw new Error('Client ID and client secret are both required.');
  data.creds = { clientId, clientSecret }; save();
}
function importJson(text) {
  const j = JSON.parse(text);
  const c = j.installed || j.web;
  if (!c || !c.client_id) throw new Error('That file is not an OAuth client JSON from Google Cloud Console.');
  setCreds(c.client_id, c.client_secret);
}

async function tokenRequest(params) {
  const body = new URLSearchParams({ client_id: data.creds.clientId, client_secret: data.creds.clientSecret, ...params });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error || `Token request failed (${r.status})`);
  return j;
}

const page = (title, msg) => `<!doctype html><meta charset=utf-8><title>GOne</title><style>
body{margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui,sans-serif;background:#f8fafd;color:#1f1f1f}
@media(prefers-color-scheme:dark){body{background:#131314;color:#e3e3e3}}
.c{text-align:center;padding:40px 56px;border-radius:28px;background:Canvas;box-shadow:0 8px 40px -12px rgba(66,133,244,.5)}
h1{margin:0 0 8px;font-size:28px;font-weight:500;background:linear-gradient(90deg,#4285F4,#EA4335,#FBBC04,#34A853);-webkit-background-clip:text;color:transparent}
p{margin:0;color:#5f6368}</style><div class=c><h1>${title}</h1><p>${msg}</p></div>`;

function signIn() {
  if (!data.creds) return Promise.reject(new Error('Add your OAuth client first.'));
  const verifier = b64u(crypto.randomBytes(48));
  const challenge = b64u(crypto.createHash('sha256').update(verifier).digest());
  const state = b64u(crypto.randomBytes(16));

  return new Promise((resolve, reject) => {
    const srv = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      if (u.pathname !== '/') { res.writeHead(404).end(); return; }
      const done = (fn) => { clearTimeout(timer); srv.close(); fn(); };
      const fail = (msg) => { res.writeHead(400, { 'Content-Type': 'text/html' }).end(page('Sign-in failed', msg)); done(() => reject(new Error(msg))); };
      if (u.searchParams.get('error')) return fail(u.searchParams.get('error'));
      if (u.searchParams.get('state') !== state) return fail('State mismatch.');
      try {
        const t = await tokenRequest({ code: u.searchParams.get('code'), code_verifier: verifier, grant_type: 'authorization_code', redirect_uri: `http://127.0.0.1:${srv.address().port}` });
        data.tokens = { refresh: t.refresh_token || (data.tokens && data.tokens.refresh), access: t.access_token, expiry: Date.now() + t.expires_in * 1000 };
        if (!data.tokens.refresh) throw new Error('Google did not return a refresh token. Remove GOne at myaccount.google.com/permissions and retry.');
        data.profile = await (await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } })).json();
        save();
        res.writeHead(200, { 'Content-Type': 'text/html' }).end(page('You’re signed in', 'You can close this tab and return to GOne.'));
        done(() => resolve(data.profile));
      } catch (e) { fail(e.message); }
    });
    const timer = setTimeout(() => { srv.close(); reject(new Error('Sign-in timed out.')); }, 5 * 60 * 1000);
    srv.listen(0, '127.0.0.1', () => {
      const q = new URLSearchParams({
        client_id: data.creds.clientId, redirect_uri: `http://127.0.0.1:${srv.address().port}`, response_type: 'code',
        scope: SCOPES.join(' '), code_challenge: challenge, code_challenge_method: 'S256',
        access_type: 'offline', prompt: 'consent', state,
      });
      shell.openExternal(`${AUTH_URL}?${q}`);
    });
  });
}

async function accessToken() {
  const t = data.tokens;
  if (!t) throw new Error('Not signed in.');
  if (t.access && t.expiry - Date.now() > 60000) return t.access;
  const r = await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh });
  t.access = r.access_token; t.expiry = Date.now() + r.expires_in * 1000;
  save();
  return t.access;
}

function setMail(email, password) {
  email = String(email || '').trim(); password = String(password || '').replace(/\s+/g, '');
  if (!/^[^@\s]+@[^@\s]+$/.test(email) || !password) throw new Error('Enter your Gmail address and the app password.');
  const local = email.split('@')[0];
  data.mail = { email, password, name: local.charAt(0).toUpperCase() + local.slice(1) };
  save();
}
const mailCreds = () => data.mail;

async function signOut() {
  const t = data.tokens;
  data.tokens = null; data.profile = null; data.mail = null; save();
  if (t && t.refresh) fetch(`https://oauth2.googleapis.com/revoke?token=${t.refresh}`, { method: 'POST' }).catch(() => {});
}

const status = () => ({
  configured: !!data.creds, oauth: !!data.tokens, mail: !!(data.tokens || data.mail), signedIn: !!(data.tokens || data.mail),
  profile: data.profile || (data.mail ? { email: data.mail.email, name: data.mail.name, given_name: data.mail.name } : null),
});

module.exports = { load, setMail, mailCreds, setCreds, importJson, signIn, signOut, accessToken, status };
