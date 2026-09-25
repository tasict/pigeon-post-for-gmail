// Shared Gmail module: folder definitions, feed fetching and account discovery.
// Used by the background (importScripts) and the settings page (<script>); load feed-parser.js first.
const Gmail = (() => {
  const ORIGIN = 'https://mail.google.com';

  // System folders. paths are the feed paths to try; results are merged when there are several (Gmail supports some aliases inconsistently).
  // parent marks a folder as a subset of another, so unread counts are not added twice.
  // q is the Gmail search that lists this folder's unread mail in the web app; an empty string means any folder.
  const SYSTEM_FOLDERS = [
    { id: 'inbox', paths: [''], q: 'in:inbox', group: 'inbox', hint: true },
    { id: 'primary', paths: ['^sq_ig_i_personal'], q: 'in:inbox category:primary', group: 'tabs', parent: 'inbox' },
    { id: 'social', paths: ['^sq_ig_i_social'], q: 'in:inbox category:social', group: 'tabs', parent: 'inbox' },
    { id: 'promo', paths: ['^sq_ig_i_promo'], q: 'in:inbox category:promotions', group: 'tabs', parent: 'inbox' },
    { id: 'updates', paths: ['^sq_ig_i_notification'], q: 'in:inbox category:updates', group: 'tabs', parent: 'inbox' },
    { id: 'forums', paths: ['^sq_ig_i_group'], q: 'in:inbox category:forums', group: 'tabs', parent: 'inbox' },
    { id: 'starred', paths: ['starred', '^t'], q: 'is:starred', group: 'more', hint: true },
    { id: 'important', paths: ['important', '^io_im'], q: 'is:important', group: 'more', hint: true },
    { id: 'unread', paths: ['unread'], q: '', group: 'more', hint: true }
  ].map(f => ({ ...f, name: I18n.t(`folder_${f.id}`), hint: f.hint ? I18n.t(`folderHint_${f.id}`) : undefined }));
  const SYSTEM_BY_ID = Object.fromEntries(SYSTEM_FOLDERS.map(f => [f.id, f]));

  const labelId = name => `label:${name}`;
  const isLabel = id => id.startsWith('label:');
  const labelOf = id => id.slice(6);

  function folderName(id) {
    return isLabel(id) ? labelOf(id) : (SYSTEM_BY_ID[id]?.name ?? id);
  }

  // Gmail replaces spaces and slashes in label names with hyphens in search and feeds; the original name is tried as well.
  function feedPaths(id) {
    if (!isLabel(id)) return SYSTEM_BY_ID[id]?.paths ?? [];
    const name = labelOf(id);
    const hyphen = name.replace(/[\s/]+/g, '-');
    return [...new Set([hyphen, name])];
  }

  function feedUrl(index, path) {
    const base = `${ORIGIN}/mail/u/${index}/feed/atom`;
    return path ? `${base}/${encodeURIComponent(path)}` : base;
  }

  function gmailUrl(index = 0) {
    return `${ORIGIN}/mail/u/${index}/`;
  }

  // Searches Gmail for unread mail in these folders so the user can select all and act on them. Several folders are OR-ed with { }.
  function unreadSearchUrl(index, folderIds) {
    const parts = folderIds.map(id => (isLabel(id) ? `label:${labelOf(id).replace(/[\s/]+/g, '-')}` : SYSTEM_BY_ID[id]?.q ?? ''));
    const scope = parts.includes('') ? '' : parts.length > 1 ? ` {${parts.map(q => (q.includes(' ') ? `(${q})` : q)).join(' ')}}` : ` ${parts[0]}`;
    return `${gmailUrl(index)}#search/${encodeURIComponent(`is:unread${scope}`)}`;
  }

  // Feed links carry no account index; rewrite them to /mail/u/N/ for multiple accounts. Anything that is not a Gmail link opens the inbox instead.
  function messageUrl(link, index) {
    const url = (link || '').replace(/^https:\/\/mail\.google\.com\/mail(\/u\/\d+)?\/?\?/, `${ORIGIN}/mail/u/${index}/?`);
    return url.startsWith(`${ORIGIN}/mail/`) ? url : gmailUrl(index);
  }

  // The extension only ever opens Google URLs (Gmail and the account re-verification page).
  function isGoogleUrl(url) {
    try {
      const u = new URL(url);
      return u.protocol === 'https:' && (u.hostname === 'google.com' || u.hostname.endsWith('.google.com'));
    } catch {
      return false;
    }
  }

  class FeedError extends Error {
    constructor(kind, message) {
      super(message);
      this.kind = kind; // auth | http | network
    }
  }

  async function fetchFeed(index, path) {
    let res;
    try {
      res = await fetch(feedUrl(index, path), { credentials: 'include', cache: 'no-store' });
    } catch {
      throw new FeedError('network', I18n.t('errNetwork'));
    }
    if (res.status === 401 || res.status === 403) throw new FeedError('auth', I18n.t('errSignedOut'));
    if (!res.ok) throw new FeedError('http', I18n.t('errHttp', res.status));
    const text = await res.text();
    // When signed out, Gmail often redirects to an HTML sign-in page instead of returning an error status.
    if (!/<feed[\s>]/i.test(text)) throw new FeedError('auth', I18n.t('errSignedOut'));
    return FeedParser.parse(text);
  }

  // Fetch each feed only once per check.
  function createFetcher() {
    const cache = new Map();
    return (index, path) => {
      const key = `${index}|${path}`;
      if (!cache.has(key)) cache.set(key, fetchFeed(index, path));
      return cache.get(key);
    };
  }

  // Reads one folder of an account, merging the results of every candidate path.
  async function fetchFolder(index, id, fetcher = fetchFeed) {
    const paths = feedPaths(id);
    const results = await Promise.allSettled(paths.map(p => fetcher(index, p)));
    const ok = results.filter(r => r.status === 'fulfilled').map(r => r.value);
    if (!ok.length) throw results[0]?.reason ?? new FeedError('http', I18n.t('errUnreadable'));
    const byId = new Map();
    for (const feed of ok) for (const e of feed.entries) if (!byId.has(e.id)) byId.set(e.id, e);
    return {
      email: ok[0].email,
      fullcount: Math.max(...ok.map(f => f.fullcount)),
      entries: [...byId.values()].sort((a, b) => new Date(b.modified) - new Date(a.modified))
    };
  }

  // Probes /mail/u/0, /u/1, … in order and identifies each account by the email in the feed title.
  // Signed-in account indexes are contiguous, so the first index that fails (401) or repeats an email is the end.
  // max limits probing to the known accounts, so indexes that do not exist are not requested every time.
  async function discoverAccounts(fetcher = createFetcher(), max = 6) {
    const accounts = [];
    const seen = new Set();
    for (let index = 0; index < max; index++) {
      let feed;
      try {
        feed = await fetcher(index, '');
      } catch {
        break;
      }
      if (!feed.email || seen.has(feed.email)) break;
      seen.add(feed.email);
      accounts.push({ index, email: feed.email });
    }
    return accounts;
  }

  // Text on the toolbar badge. Split mode joins mailboxes with tracked folders using "/", e.g. 3/12;
  // it falls back to the total when that does not fit or only one mailbox is tracked.
  // Returns { text, order, fallback }: order is the mailbox order in split mode, fallback says why the total is shown instead.
  function badgeInfo(state, mode) {
    if (!state?.accounts?.length) return { text: '?', order: [], fallback: null };
    const totals = state.accountTotals || {};
    const total = state.total > 999 ? '999+' : state.total ? String(state.total) : '';
    if (mode !== 'split') return { text: total, order: [], fallback: null };
    const tracked = state.accounts.filter(a => (state.folders || []).some(f => f.email === a.email));
    if (tracked.length < 2) return { text: total, order: [], fallback: 'single' };
    if (!tracked.some(a => totals[a.email])) return { text: '', order: [], fallback: null };
    const text = tracked.map(a => (totals[a.email] > 99 ? '99+' : String(totals[a.email] || 0))).join('/');
    // The Chrome badge is only about 23px wide: digits and + take about 5px, a slash about 3px.
    const width = [...text].reduce((w, ch) => w + (ch === '/' ? 3 : 5), 0);
    if (width > 23) return { text: total, order: [], fallback: 'long' };
    return { text, order: tracked.map(a => a.email), fallback: null };
  }

  const badgeText = (state, mode) => badgeInfo(state, mode).text;

  return {
    badgeText, badgeInfo,
    SYSTEM_FOLDERS, SYSTEM_BY_ID, labelId, isLabel, labelOf, folderName, feedPaths,
    gmailUrl, messageUrl, isGoogleUrl, unreadSearchUrl, fetchFeed, createFetcher, fetchFolder, discoverAccounts, FeedError
  };
})();
