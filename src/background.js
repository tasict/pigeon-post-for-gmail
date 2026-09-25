// Background service worker: polls Gmail, finds new mail, shows notifications and updates the toolbar badge.
importScripts('i18n.js', 'feed-parser.js', 'gmail.js', 'settings.js', 'gmail-actions.js');
const { t, tn, list } = I18n;

const ALARM = 'poll';
const MAX_SEEN = 3000;
const ICON = '/icons/icon128.png';
// The toolbar envelope moves up while a badge shows, so the badge does not cover it.
const toolbarIcon = badged => Object.fromEntries([16, 24, 32].map(n => [n, `/icons/toolbar${badged ? '-badge' : ''}${n}.png`]));
const RANK = { off: 0, count: 1, notify: 2 };
const PROBE_MS = 15 * 60 * 1000;

// Without a valid session Gmail answers 401 with "WWW-Authenticate: Basic", which makes Chrome show a password dialog.
// Account discovery always hits a /u/N that does not exist, so the extension's own Gmail requests never answer the challenge.
// The request ends as a 401, which is treated as "this account is not signed in". Requests from Gmail tabs are not affected.
chrome.webRequest.onAuthRequired.addListener(
  details => (details.initiator === self.location.origin || (details.tabId === -1 && !details.initiator) ? { cancel: true } : {}),
  { urls: ['https://mail.google.com/mail/u/*'] },
  ['blocking']
);

// The full account list is probed every 15 minutes (or on a manual check or settings change); otherwise only known accounts are verified.
async function getAccounts(fetcher, reason) {
  const { accountCache } = await chrome.storage.session.get('accountCache');
  const quick = reason === 'alarm' || reason === 'action';
  const full = !accountCache?.accounts.length || !quick || Date.now() - accountCache.at > PROBE_MS;
  const accounts = await Gmail.discoverAccounts(fetcher, full ? 6 : accountCache.accounts.length);
  if (full || JSON.stringify(accounts) !== JSON.stringify(accountCache.accounts)) {
    await chrome.storage.session.set({ accountCache: { at: full ? Date.now() : accountCache.at, accounts } });
  }
  return accounts;
}

async function scheduleAlarm() {
  const { pollSeconds } = await Settings.get();
  const minutes = pollSeconds / 60;
  const existing = await chrome.alarms.get(ALARM);
  if (existing && Math.abs(existing.periodInMinutes - minutes) < 0.01) return;
  await chrome.alarms.create(ALARM, { delayInMinutes: minutes, periodInMinutes: minutes });
}

function setBadge(state, settings) {
  const text = Gmail.badgeText(state, settings.badgeMode);
  let color = '#d6382d';
  if (!state.accounts.length) color = '#7b8294';
  else if (state.errors.length) color = '#c77800';
  const shown = state.accounts.length && state.errors.length && !state.folders.some(f => !f.error) ? '!' : text;
  chrome.action.setBadgeText({ text: shown });
  chrome.action.setIcon({ path: toolbarIcon(!!shown) });
  chrome.action.setBadgeBackgroundColor({ color });
  chrome.action.setBadgeTextColor?.({ color: '#ffffff' });
  // The icon tooltip lists the unread count of each mailbox.
  const ids = Settings.identities(settings, state.accounts.map(a => a.email));
  const title = !state.accounts.length ? t('tooltipSignedOut')
    : [t('extName'), ...state.accounts.map(a => tn('tooltipAccount', state.accountTotals[a.email] || 0, ids[a.email].label))].join('\n');
  chrome.action.setTitle({ title });
}

// Remembers which messages each notification refers to: clicking opens them, the button marks them as read.
// Each notification has its own key, so concurrent writes never overwrite one another.
const notifKey = id => `notif:${id}`;

async function rememberNotification(id, url, messages) {
  const entry = { url, messages: messages.map(m => ({ key: m.key, link: m.link, index: m.index, email: m.email })) };
  await chrome.storage.session.set({ [notifKey(id)]: entry });
}

async function takeNotification(id) {
  const key = notifKey(id);
  const { [key]: entry } = await chrome.storage.session.get(key);
  await chrome.storage.session.remove(key);
  return entry;
}

async function notify(fresh, settings, accounts) {
  const ids = Settings.identities(settings, accounts.map(a => a.email));
  // Notifications are always silent; each mailbox plays its own sound instead.
  if (fresh.length > settings.groupAfter) {
    const id = `sum-${Date.now()}`;
    await rememberNotification(id, Gmail.gmailUrl(fresh[0].index), fresh);
    // macOS native notifications do not show list items, so use a basic notification with the summary in the body.
    await chrome.notifications.create(id, {
      type: 'basic',
      iconUrl: ICON,
      title: tn('newMessages', fresh.length),
      message: fresh.slice(0, 4).map(m => t('summaryLine', m.authorName || m.authorEmail, m.title || t('noSubject'))).join('\n'),
      contextMessage: list([...new Set(fresh.map(m => ids[m.email]?.label ?? m.email))]),
      buttons: [{ title: t('markAllRead') }],
      silent: true,
      priority: 1
    });
  } else {
    for (const m of fresh) {
      const id = `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await rememberNotification(id, Gmail.messageUrl(m.link, m.index), [m]);
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: ICON,
        title: m.authorName || m.authorEmail || t('unknownSender'),
        message: m.title || t('noSubject'),
        contextMessage: t('contextLine', ids[m.email]?.label ?? m.email, Gmail.folderName(m.folders.find(fid => Settings.levelOf(settings, m.email, fid) === 'notify') ?? m.folders[0])),
        buttons: [{ title: t('markRead') }],
        silent: true,
        priority: 1
      });
    }
  }
  playSounds(fresh, settings, accounts);
}

/* ---------- Sounds ---------- */

let creatingOffscreen = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen.createDocument({
    url: 'src/offscreen.html',
    reasons: ['AUDIO_PLAYBACK'],
    justification: 'Play each mailbox\'s notification sound when new mail arrives'
  }).finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

// Each mailbox with new mail plays its own sound, three at most.
async function playSounds(fresh, settings, accounts) {
  if (!settings.volume) return;
  const ids = Settings.identities(settings, accounts.map(a => a.email));
  const { customSounds = {} } = await chrome.storage.local.get('customSounds');
  const queue = [...new Set(fresh.map(m => m.email))].slice(0, 3)
    .map(email => ({ sound: ids[email]?.sound ?? Settings.DEFAULT_SOUND, data: customSounds[email]?.data ?? null }))
    .filter(item => item.sound !== 'none');
  if (!queue.length) return;
  try {
    await ensureOffscreen();
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'play', queue, volume: settings.volume }).catch(() => {});
  } catch { /* keep the notification even if the sound cannot play */ }
}

/* ---------- Mark as read ---------- */

// Remove from the view first, then check again to confirm Gmail's state. Bulk callers run the final check themselves.
async function markRead(messages, { recheck = true } = {}) {
  const results = await Promise.allSettled(messages.map(m => GmailActions.run(m, 'read')));
  const done = messages.filter((m, i) => results[i].status === 'fulfilled').map(m => m.key);
  const failed = results.find(r => r.status === 'rejected');
  const reauthUrl = results.find(r => r.reason?.reauthUrl)?.reason.reauthUrl ?? null;
  if (done.length) {
    const { state } = await chrome.storage.session.get('state');
    if (state) {
      const gone = state.messages.filter(m => done.includes(m.key));
      state.messages = state.messages.filter(m => !done.includes(m.key));
      for (const m of gone) state.accountTotals[m.email] = Math.max(0, (state.accountTotals[m.email] || 0) - 1);
      state.total = Object.values(state.accountTotals).reduce((a, b) => a + b, 0);
      await chrome.storage.session.set({ state });
      setBadge(state, await Settings.get());
    }
    if (recheck) setTimeout(() => poll('action'), 2500);
  }
  return failed ? { ok: false, done, error: failed.reason?.message || String(failed.reason), reauthUrl } : { ok: true, done };
}

/* ---------- Mark a whole mailbox as read ---------- */

// Only handles the batch each tracked folder lists in its feed (about 20 each); the popup sends larger ones to Gmail.
// Progress is kept in session storage under bulk (keyed by email), so it survives closing and reopening the popup.
const BULK_CHUNK = 10;
const bulkJobs = new Set();

// All writes are queued. The first entry cleans up: jobs left running by a terminated service worker are marked as interrupted.
let bulkWrite = chrome.storage.session.get('bulk').then(async ({ bulk = {} }) => {
  let changed = false;
  for (const job of Object.values(bulk)) {
    if (job.phase !== 'running') continue;
    Object.assign(job, { phase: 'error', error: t('bulkInterrupted'), left: null });
    changed = true;
  }
  if (changed) await chrome.storage.session.set({ bulk });
}).catch(() => {});
function setBulk(email, value) {
  bulkWrite = bulkWrite.catch(() => {}).then(async () => {
    const { bulk = {} } = await chrome.storage.session.get('bulk');
    if (value) bulk[email] = value;
    else delete bulk[email];
    await chrome.storage.session.set({ bulk });
  });
  return bulkWrite;
}

async function markAllRead(email) {
  if (bulkJobs.has(email)) return { ok: false, error: t('bulkBusy') };
  const [settings, { state }] = await Promise.all([Settings.get(), chrome.storage.session.get('state')]);
  const acc = state?.accounts.find(a => a.email === email);
  const folderIds = Object.keys(Settings.watchFor(settings, email));
  if (!acc || !folderIds.length) return { ok: false, error: t('bulkNoFolders') };

  bulkJobs.add(email);
  const job = { phase: 'running', done: 0, total: 0 };
  let error = null;
  let reauthUrl = null;
  try {
    await setBulk(email, job);
    // Read the feeds again so the current unread mail is marked, not the result of the last check.
    const fetcher = Gmail.createFetcher();
    const lists = await Promise.allSettled(folderIds.map(id => Gmail.fetchFolder(acc.index, id, fetcher)));
    const batch = new Map();
    for (const r of lists) {
      if (r.status !== 'fulfilled') continue;
      for (const e of r.value.entries) batch.set(`${email}|${e.id}`, { ...e, key: `${email}|${e.id}`, email, index: acc.index });
    }
    const items = [...batch.values()];
    job.total = items.length;
    await setBulk(email, job);
    for (let i = 0; i < items.length && !error; i += BULK_CHUNK) {
      const r = await markRead(items.slice(i, i + BULK_CHUNK), { recheck: false });
      job.done += r.done.length;
      // Skip individual failures; stop when re-verification is required or a whole batch fails.
      if (r.reauthUrl || (!r.ok && !r.done.length)) ({ error, reauthUrl } = r);
      await setBulk(email, job);
    }
  } finally {
    bulkJobs.delete(email);
  }

  const after = await poll('action').catch(() => null);
  const result = { phase: error ? 'error' : 'done', done: job.done, left: after?.accountTotals?.[email] ?? 0, error, reauthUrl };
  await setBulk(email, result);
  return { ok: !error, ...result };
}

let running = null;
function poll(reason) {
  if (!running) running = doPoll(reason).finally(() => { running = null; });
  return running;
}

async function doPoll(reason) {
  const settings = await Settings.get();
  const fetcher = Gmail.createFetcher();
  const accounts = await getAccounts(fetcher, reason);

  const jobs = [];
  for (const acc of accounts) {
    for (const [folderId, level] of Object.entries(Settings.watchFor(settings, acc.email))) {
      jobs.push(
        Gmail.fetchFolder(acc.index, folderId, fetcher).then(
          r => ({ ...acc, folderId, level, fullcount: r.fullcount, entries: r.entries }),
          e => ({ ...acc, folderId, level, fullcount: 0, entries: [], error: e.message })
        )
      );
    }
  }
  const folders = await Promise.all(jobs);

  // Merge duplicates: one message can be in the inbox, the Primary tab and a label at once. The highest level wins.
  const messages = new Map();
  for (const f of folders) {
    for (const e of f.entries) {
      const key = `${f.email}|${e.id}`;
      const m = messages.get(key);
      if (m) {
        m.folders.push(f.folderId);
        if (RANK[f.level] > RANK[m.level]) m.level = f.level;
      } else {
        messages.set(key, { ...e, key, email: f.email, index: f.index, level: f.level, folders: [f.folderId] });
      }
    }
  }

  // Unread totals: a feed lists about 20 messages and fullcount covers the rest; subsets (inbox tabs) are not counted again when the inbox is tracked too.
  const accountTotals = Object.fromEntries(accounts.map(a => [a.email, 0]));
  for (const m of messages.values()) accountTotals[m.email]++;
  for (const f of folders) {
    if (f.error) continue;
    const parent = Gmail.SYSTEM_BY_ID[f.folderId]?.parent;
    if (parent && folders.some(o => o.email === f.email && o.folderId === parent && !o.error)) continue;
    accountTotals[f.email] += Math.max(0, f.fullcount - f.entries.length);
  }
  const total = Object.values(accountTotals).reduce((a, b) => a + b, 0);

  const prev = await chrome.storage.local.get({ seen: [], readyFolders: [] });
  const seen = new Set(prev.seen);
  const wasReady = new Set(prev.readyFolders);
  const folderKey = f => `${f.email}|${f.folderId}`;

  // The first check of a folder (fresh install, newly tracked, newly signed in) only records existing unread mail without notifying, to avoid a flood of old mail.
  // Folders that fail temporarily keep their previous state, so they are not treated as new when they recover.
  const ready = new Set();
  for (const f of folders) {
    if (!f.error || wasReady.has(folderKey(f))) ready.add(folderKey(f));
  }
  const fresh = [...messages.values()]
    .filter(m => m.level === 'notify' && !seen.has(m.key))
    .filter(m => m.folders.some(id => wasReady.has(`${m.email}|${id}`)))
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));

  const state = {
    lastCheck: Date.now(),
    reason,
    accounts,
    // Keep only statistics per folder; deduplicated messages are stored separately for the popup and the settings preview.
    folders: folders.map(({ entries, ...f }) => ({ ...f, listed: entries.length })),
    messages: [...messages.values()]
      .sort((a, b) => new Date(b.modified) - new Date(a.modified))
      .slice(0, 80),
    accountTotals,
    total,
    errors: folders.filter(f => f.error).map(f => ({ email: f.email, folderId: f.folderId, message: f.error }))
  };

  // Subjects and snippets live only in in-memory session storage: never written to disk and unreadable by content scripts in Gmail tabs.
  await chrome.storage.session.set({ state });
  // Keep the old records when no account is detected (signed out or offline): existing unread mail is not treated as new afterwards, while mail that arrives meanwhile still notifies.
  if (accounts.length) {
    await chrome.storage.local.set({
      readyFolders: [...ready],
      seen: [...messages.keys(), ...prev.seen.filter(k => !messages.has(k))].slice(0, MAX_SEEN)
    });
  }
  setBadge(state, settings);
  if (settings.notify && fresh.length) await notify(fresh, settings, accounts);
  return state;
}

async function openUrl(url) {
  if (!Gmail.isGoogleUrl(url)) return;
  const { reuseTab } = await Settings.get();
  if (reuseTab) {
    const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/*' });
    if (tabs.length) {
      const tab = tabs.find(t => t.active) || tabs[0];
      await chrome.tabs.update(tab.id, { url, active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
      return;
    }
  }
  await chrome.tabs.create({ url });
}

async function sendTestNotification(sample) {
  const id = `test-${Date.now()}`;
  await chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: ICON,
    title: sample?.from || t('extName'),
    message: sample?.subject || t('testMessage'),
    contextMessage: sample?.context || t('testContext'),
    silent: true,
    priority: 1
  });
  if (sample?.url) await rememberNotification(id, sample.url, []);
  if (sample?.email) {
    const settings = await Settings.get();
    playSounds([{ email: sample.email }], settings, [{ email: sample.email }]);
  }
  return { ok: true };
}

chrome.runtime.onInstalled.addListener(details => {
  // Older versions kept the check result in storage.local; it now lives in session storage.
  chrome.storage.local.remove('state');
  scheduleAlarm();
  poll('installed');
  if (details.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(() => { scheduleAlarm(); poll('startup'); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === ALARM) poll('alarm'); });

let settingsTimer;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  if (changes.pollSeconds) scheduleAlarm();
  // A new mailbox name or badge mode only needs a badge redraw, not a new check.
  if ((changes.accounts || changes.badgeMode) && !changes.watch) {
    Promise.all([Settings.get(), chrome.storage.session.get('state')]).then(([settings, { state }]) => state && setBadge(state, settings));
  }
  if (changes.watch) {
    // The settings page makes changes in quick succession; wait a moment to batch them into one check.
    clearTimeout(settingsTimer);
    settingsTimer = setTimeout(() => poll('settings'), 1500);
  }
});

chrome.notifications.onClicked.addListener(async id => {
  const entry = await takeNotification(id);
  chrome.notifications.clear(id);
  if (entry?.url) openUrl(entry.url);
});

// Dismissed or expired notifications no longer need their entry.
chrome.notifications.onClosed.addListener(id => { takeNotification(id); });

chrome.notifications.onButtonClicked.addListener(async id => {
  const entry = await takeNotification(id);
  chrome.notifications.clear(id);
  if (!entry?.messages.length) return;
  const result = await markRead(entry.messages);
  if (result.ok) return;
  // If the action from a notification fails, explain it in another notification; when re-verification is needed, clicking it opens the verification page.
  const failId = `fail-${Date.now()}`;
  await rememberNotification(failId, result.reauthUrl || Gmail.gmailUrl(entry.messages[0].index), []);
  await chrome.notifications.create(failId, {
    type: 'basic',
    iconUrl: ICON,
    title: t('markReadFailedTitle'),
    message: result.reauthUrl ? t('notifReauth') : result.error,
    silent: true,
    priority: 1
  });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Messages for the offscreen document are not handled here.
  if (msg?.target === 'offscreen') return false;
  // Only the extension's own pages (popup, settings) may send requests; content scripts in Gmail tabs cannot trigger any action.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  (async () => {
    switch (msg?.type) {
      case 'markRead': {
        const { state } = await chrome.storage.session.get('state');
        const targets = (state?.messages ?? []).filter(m => msg.keys.includes(m.key));
        if (!targets.length) return { ok: false, error: t('messageGone') };
        return markRead(targets);
      }
      case 'markAllRead':
        return markAllRead(msg.email);
      case 'clearBulk':
        await setBulk(msg.email, null);
        return { ok: true };
      case 'poll':
        return poll('manual');
      case 'openUrl':
        await openUrl(msg.url);
        return { ok: true };
      case 'testNotification':
        return sendTestNotification(msg.sample);
      default:
        return { ok: false, error: 'unknown message' };
    }
  })().then(sendResponse, e => sendResponse({ ok: false, error: String(e) }));
  return true;
});

// Make sure the alarm exists whenever the service worker wakes up (it can be lost after an update).
scheduleAlarm();
