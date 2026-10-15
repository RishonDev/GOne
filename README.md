# GOne

A native-feeling Google suite for the Linux desktop. Gmail, Calendar, Tasks, Contacts and Drive are drawn natively
using Google's official APIs; Docs, Sheets, Slides, Meet, Chat, Photos, Maps, Keep and Translate open as chromeless
app windows in your own Chrome/Chromium (already signed in).

```
npm install
npm start
npm run install-desktop    # app-menu launchers, KDE jump list, Gmail as mailto: handler
npm run uninstall-desktop
```

## First run: connect Google (one time, free)
Sign-in uses your normal browser (OAuth + PKCE on a loopback port), so Google never blocks it as an "insecure app".
Google requires each app to have its own OAuth client:
1. Create a project in Google Cloud Console and enable the Gmail, Calendar, Tasks, People and Drive APIs.
2. Configure the consent screen (External), add yourself as a test user, and set publishing to "In production"
   so refresh tokens don't expire after 7 days (you'll see an "unverified app" warning once — expected).
3. Create an OAuth client ID of type **Desktop app**, then import its JSON (or paste ID + secret) in GOne.

Tokens are stored encrypted via the system keyring (`safeStorage`) when available.

## Notifications
- Background polling (60 s): new unread mail, calendar reminders (event's own lead time, default 10 min), tasks due today.
- Native desktop notifications with the app's gradient icon; click to jump to the thread/event.
- Unread apps get a spinning ring in their own logo gradient, a pinging badge in the rail, and an Activity feed on Home.
- Tray icon shows the total count; launcher icon gets a badge; the window flashes for attention. Do-not-disturb mutes popups.

## Desktop integration
Tray, close-to-tray, single instance, `--app=<id>` and `--hidden` flags, `mailto:` → Gmail compose, per-app `.desktop`
launchers with a jump list, start at login, downloads to `~/Downloads` with a notification, `Ctrl+Alt+G` toggle (X11 only).

## Security notes
Email bodies render in a sandboxed iframe with scripts disabled and remote images blocked until you click "Load remote images".
