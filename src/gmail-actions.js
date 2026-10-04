// Actions on messages (currently: mark as read).
// The Gmail feed is read-only. Changing state goes through the Gmail web app's internal endpoint, which needs two values:
// - at: the per-account action token from the GMAIL_AT cookie (path /mail/u/N), read right before every action.
// - ik: the account key, found as ID_KEY on the /mail/u/N/s/ page and cached for 5 minutes.
// This interface is undocumented, and Gmail gates it: the token goes stale when the Gmail page has not been opened for a while,
// and Gmail sometimes asks for re-verification instead of acting. So each action gets up to two rounds:
// 1. Sent from an open Gmail tab of that account (a same-origin request, like Gmail's own), or from here when none is open.
// 2. Whatever failed is sent again from a Gmail tab opened in the background, which renews the Gmail session
//    (it loads the verification page instead when Gmail asked for one). The tab closes a few seconds after its last use.
// If both rounds fail, actions report an error and nothing else is affected.
const GmailActions = (() => {
  const ORIGIN = 'https://mail.google.com';
  const CODES = { read: 3 };
  const IK_TTL = 5 * 60 * 1000;
  const TAB_WAIT = 20 * 1000;
  const TAB_LINGER = 5 * 1000;
  const ikCache = new Map(); // index → { value, at }
  const leases = new Map(); // index → { tab: promise of the tab id (null if Gmail did not load), id, users, timer }
  const ownTabs = new Set();

  // Sometimes Gmail skips the action and returns a short body holding only a spreauth URL, asking the user to re-verify.
  const REAUTH_RE = /https?:\/\/[\w.-]+\/[\w\/.-]*spreauth[\w\/.-]*/;

  class ActionError extends Error {
    constructor(message, reauthUrl = null) {
      super(message);
      this.reauthUrl = reauthUrl;
    }
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const tabIndex = url => Number((url.match(/\/mail\/u\/(\d+)/) || [])[1] ?? 0);

  function threadOf(link) {
    try {
      return new URL(link).searchParams.get('message_id');
    } catch {
      return null;
    }
  }

  /* ---------- Requests ---------- */
  // These two run either here or inside a Gmail tab (injected with chrome.scripting), so they use nothing outside their own body.

  // Reads ID_KEY from the /mail/u/N/s/ page. Gmail sometimes answers with a meta refresh redirect page first.
  async function fetchKey(origin, index) {
    try {
      let url = `${origin}/mail/u/${index}/s/`;
      for (let hop = 0; hop < 3; hop++) {
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) break;
        const html = await res.text();
        const m = html.match(/ID_KEY\s*=\s*['"]([^'"]+)['"]/);
        if (m) return m[1];
        const refresh = html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
        if (!refresh) break;
        url = new URL(refresh[1].replace(/&amp;/g, '&'), url).href;
        // Requests that carry the sign-in cookies only go to Gmail.
        if (!url.startsWith(`${origin}/`)) break;
      }
    } catch { /* offline */ }
    return null;
  }

  // The action is only complete once the response is read. Only a short body is passed back, enough to spot a re-verification request.
  async function postAction(url, sjr) {
    try {
      const body = new FormData();
      body.append('s_jr', sjr);
      const res = await fetch(url, { method: 'POST', credentials: 'include', body });
      const text = await res.text();
      return { ok: res.ok, status: res.status, short: text.length < 200 ? text : '' };
    } catch {
      return { ok: false, status: 0, short: '', network: true };
    }
  }

  // Runs one of the functions above in the given tab, or here when there is no tab. Resolves to undefined if the tab cannot run it.
  async function exec(tabId, func, ...args) {
    if (tabId == null) return func(...args);
    try {
      const [frame] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
      return frame?.result;
    } catch {
      return undefined;
    }
  }

  async function getAt(index) {
    const cookie = await chrome.cookies.get({ url: `${ORIGIN}/mail/u/${index}`, name: 'GMAIL_AT' });
    return cookie?.value || null;
  }

  async function getIk(index, tabId, fresh) {
    const cached = ikCache.get(index);
    if (!fresh && cached && Date.now() - cached.at < IK_TTL) return { value: cached.value, cached: true };
    const value = await exec(tabId, fetchKey, ORIGIN, index);
    if (!value) return null;
    ikCache.set(index, { value, at: Date.now() });
    return { value, cached: false };
  }

  async function send(index, thread, code, tabId, at, ik) {
    const sjr = JSON.stringify([
      null,
      [
        [null, null, null, [null, code, thread, thread, 'l:all', [], [], []]],
        [null, null, null, null, null, null, [null, true, false]],
        [null, null, null, null, null, null, [null, true, false]]
      ],
      2, null, null, null, ik
    ]);
    const url = `${ORIGIN}/mail/u/${index}/s/?v=or&ik=${encodeURIComponent(ik)}&at=${encodeURIComponent(at)}&subui=chrome&hl=en&ts=${Date.now()}`;
    const res = await exec(tabId, postAction, url, sjr);
    if (!res) return { error: I18n.t('unknownError') };
    if (res.network) return { error: I18n.t('errNetwork'), network: true };
    const reauth = res.short.match(REAUTH_RE);
    if (reauth) return { error: I18n.t('errReauth'), reauthUrl: Gmail.isGoogleUrl(reauth[0]) ? reauth[0] : null };
    if (!res.ok) return { error: I18n.t('errRejected', res.status), rejected: true };
    return { ok: true };
  }

  // One round for one account: every message is sent from the same place (the tab, or here). Returns a result per message.
  async function round(index, messages, code, tabId, freshKey) {
    const at = await getAt(index);
    if (!at) return messages.map(() => ({ error: I18n.t('errNoToken') }));
    let ik = await getIk(index, tabId, freshKey);
    if (!ik) return messages.map(() => ({ error: I18n.t('errNoKey') }));
    const sendAll = list => Promise.all(list.map(m => send(index, threadOf(m.link), code, tabId, at, ik.value)));
    const out = await sendAll(messages);
    // A cached account key may have expired, so retry once with a fresh one; retrying does not help when re-verification is required.
    if (ik.cached && out.some(r => r.rejected)) {
      ik = await getIk(index, tabId, true);
      if (ik) {
        const redo = await sendAll(messages.filter((m, i) => out[i].rejected));
        return out.map(r => (r.rejected ? redo.shift() : r));
      }
    }
    return out;
  }

  /* ---------- Gmail tabs ---------- */

  // One of the user's Gmail tabs for this account, if open. Only complete, loaded tabs can run the request.
  async function userTab(index) {
    const tabs = await chrome.tabs.query({ url: `${ORIGIN}/mail/*`, status: 'complete', discarded: false });
    return tabs.find(t => !ownTabs.has(t.id) && tabIndex(t.url) === index)?.id ?? null;
  }

  function closeTab(id) {
    ownTabs.delete(id);
    chrome.tabs.remove(id).catch(() => {});
  }

  // Opens Gmail (or the verification page Gmail asked for) in a background tab and waits until Gmail has loaded and set its action token.
  // Resolves to the tab id, or null when Gmail does not come up in time (the page wants the user to sign in or confirm something).
  // With no browser window open it does nothing, so a click on a notification never pops up a window.
  async function openTab(index, url) {
    const windows = await chrome.windows.getAll({ windowTypes: ['normal'] });
    if (!windows.length) return null;
    // Register the tab before it loads Gmail, so the auth-dialog guard in the background covers its very first request.
    const tab = await chrome.tabs.create({ url: 'about:blank', active: false });
    ownTabs.add(tab.id);
    await chrome.tabs.update(tab.id, { url: url || Gmail.gmailUrl(index) });
    // Ready once the tab has left the verification page for this account's Gmail; tab.url stays empty on sites outside the host permission.
    const ready = t => t.status === 'complete' && t.url?.startsWith(`${ORIGIN}/mail/`) && !t.url.includes('spreauth') && tabIndex(t.url) === index;
    for (const until = Date.now() + TAB_WAIT; Date.now() < until;) {
      await sleep(500);
      const now = await chrome.tabs.get(tab.id).catch(() => null);
      if (!now) return null;
      if (ready(now) && await getAt(index)) return tab.id;
    }
    closeTab(tab.id);
    return null;
  }

  // Actions on the same account that overlap share one background tab. It closes a few seconds after the last one is done,
  // so the batches of "mark all as read" reuse it too.
  function borrowTab(index, url = null) {
    let lease = leases.get(index);
    if (!lease) {
      lease = { id: null, users: 0, timer: 0 };
      lease.tab = openTab(index, url).then(id => (lease.id = id));
      leases.set(index, lease);
    }
    clearTimeout(lease.timer);
    lease.users++;
    return lease;
  }

  function returnTab(index, lease) {
    if (--lease.users > 0) return;
    lease.timer = setTimeout(() => {
      if (leases.get(index) === lease) leases.delete(index);
      lease.tab.then(id => id != null && closeTab(id));
    }, TAB_LINGER);
  }

  // The user may close the background tab; later actions should not try to use it.
  chrome.tabs.onRemoved.addListener(id => {
    if (!ownTabs.delete(id)) return;
    for (const [index, lease] of leases) if (lease.id === id) leases.delete(index);
  });

  /* ---------- Running actions ---------- */

  // onReconnect(index, busy) is told when round 2 starts and ends, so the popup can show that Gmail is being reconnected.
  async function runAccount(index, messages, code, onReconnect) {
    // A failing listener must not keep the background tab open or change the result.
    const reconnect = busy => {
      try {
        onReconnect?.(index, busy);
      } catch { /* ignore */ }
    };
    // A background tab from an action moments ago is still fresh: use it, and if it fails, do not open another.
    const recent = leases.has(index) ? borrowTab(index) : null;
    try {
      const tabId = (recent && await recent.tab) ?? await userTab(index);
      const out = await round(index, messages, code, tabId, false);
      if (recent || !out.some(r => !r.ok && !r.network)) return out;
      const fresh = borrowTab(index, out.find(r => r.reauthUrl)?.reauthUrl);
      reconnect(true);
      try {
        const tab = await fresh.tab;
        if (tab == null) return out;
        const redo = await round(index, messages.filter((m, i) => !out[i].ok), code, tab, true);
        return out.map(r => (r.ok ? r : redo.shift()));
      } finally {
        returnTab(index, fresh);
        reconnect(false);
      }
    } finally {
      if (recent) returnTab(index, recent);
    }
  }

  // messages need link (the message link from the feed) and index (the account index).
  // Results come back in the same order and shape as Promise.allSettled; a rejection's reason may carry reauthUrl.
  async function runAll(messages, action, { onReconnect } = {}) {
    const code = CODES[action];
    const results = messages.map(m => (threadOf(m.link) ? null : { status: 'rejected', reason: new ActionError(I18n.t('errNoThread')) }));
    const byIndex = new Map();
    messages.forEach((m, i) => {
      if (!results[i]) byIndex.set(m.index, [...(byIndex.get(m.index) || []), i]);
    });
    await Promise.all([...byIndex].map(async ([index, ids]) => {
      const out = await runAccount(index, ids.map(i => messages[i]), code, onReconnect).catch(e => ids.map(() => ({ error: e.message || String(e) })));
      if (out.some(r => r.reauthUrl)) ikCache.delete(index);
      ids.forEach((i, k) => {
        const r = out[k];
        results[i] = r.ok ? { status: 'fulfilled', value: true } : { status: 'rejected', reason: new ActionError(r.error, r.reauthUrl) };
      });
    }));
    return results;
  }

  return { runAll, threadOf, ownsTab: id => ownTabs.has(id) };
})();
