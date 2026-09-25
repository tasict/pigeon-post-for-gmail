// Actions on messages (currently: mark as read).
// The Gmail feed is read-only. Changing state goes through the Gmail web app's internal endpoint, which needs two values:
// - at: the per-account action token from the GMAIL_AT cookie (path /mail/u/N), read right before every action.
// - ik: the account key, found as ID_KEY on the /mail/u/N/s/ page and cached for 5 minutes.
// This interface is undocumented. If it breaks, actions report an error and nothing else is affected.
const GmailActions = (() => {
  const ORIGIN = 'https://mail.google.com';
  const CODES = { read: 3 };
  const IK_TTL = 5 * 60 * 1000;
  const ikCache = new Map(); // index → { value, at }

  // Sometimes Gmail skips the action and returns a short body holding only a spreauth URL, asking the user to re-verify.
  const REAUTH_RE = /https?:\/\/[\w.-]+\/[\w\/.-]*spreauth[\w\/.-]*/;

  class ActionError extends Error {
    constructor(message, reauthUrl = null) {
      super(message);
      this.reauthUrl = reauthUrl;
    }
  }

  function threadOf(link) {
    try {
      return new URL(link).searchParams.get('message_id');
    } catch {
      return null;
    }
  }

  async function getAt(index) {
    const cookie = await chrome.cookies.get({ url: `${ORIGIN}/mail/u/${index}`, name: 'GMAIL_AT' });
    if (!cookie?.value) throw new Error(I18n.t('errNoToken'));
    return cookie.value;
  }

  async function getIk(index, fresh = false) {
    const cached = ikCache.get(index);
    if (!fresh && cached && Date.now() - cached.at < IK_TTL) return cached.value;
    let url = `${ORIGIN}/mail/u/${index}/s/`;
    for (let hop = 0; hop < 3; hop++) {
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) break;
      const html = await res.text();
      const m = html.match(/ID_KEY\s*=\s*['"]([^'"]+)['"]/);
      if (m) {
        ikCache.set(index, { value: m[1], at: Date.now() });
        return m[1];
      }
      // Gmail sometimes answers with a meta refresh redirect page first.
      const refresh = html.match(/http-equiv=["']?refresh["']?[^>]*content=["'][^"']*url=([^"'>\s]+)/i);
      if (!refresh) break;
      url = new URL(refresh[1].replace(/&amp;/g, '&'), url).href;
      // Requests that carry the sign-in cookies only go to Gmail.
      if (!url.startsWith(`${ORIGIN}/`)) break;
    }
    throw new Error(I18n.t('errNoKey'));
  }

  async function send(index, thread, code, fresh = false) {
    const [at, ik] = await Promise.all([getAt(index), getIk(index, fresh)]);
    const body = new FormData();
    body.append('s_jr', JSON.stringify([
      null,
      [
        [null, null, null, [null, code, thread, thread, 'l:all', [], [], []]],
        [null, null, null, null, null, null, [null, true, false]],
        [null, null, null, null, null, null, [null, true, false]]
      ],
      2, null, null, null, ik
    ]));
    const url = `${ORIGIN}/mail/u/${index}/s/?v=or&ik=${encodeURIComponent(ik)}&at=${encodeURIComponent(at)}&subui=chrome&hl=en&ts=${Date.now()}`;
    const res = await fetch(url, { method: 'POST', credentials: 'include', body });
    // The action is only complete once the response is read; also check whether it asks for re-verification.
    const text = await res.text();
    const reauth = text.length < 200 ? text.match(REAUTH_RE) : null;
    const reauthUrl = reauth && Gmail.isGoogleUrl(reauth[0]) ? reauth[0] : null;
    return { ok: res.ok && !reauth, status: res.status, reauthUrl };
  }

  // message needs link (the message link from the feed) and index (the account index).
  async function run(message, action) {
    const thread = threadOf(message.link);
    if (!thread) throw new ActionError(I18n.t('errNoThread'));
    let res = await send(message.index, thread, CODES[action]);
    // The account key may have expired, so retry once with a fresh one; retrying does not help when re-verification is required.
    if (!res.ok && !res.reauthUrl) res = await send(message.index, thread, CODES[action], true);
    if (res.reauthUrl) {
      ikCache.delete(message.index);
      throw new ActionError(I18n.t('errReauth'), res.reauthUrl);
    }
    if (!res.ok) throw new ActionError(I18n.t('errRejected', res.status));
    return true;
  }

  return { run, threadOf };
})();
