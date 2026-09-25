// User settings, stored in chrome.storage.sync so they follow the Chrome profile to other computers.
// Folder settings are keyed by email rather than the /u/N index, because sign-in order can differ between computers.
const Settings = (() => {
  const LEVELS = ['off', 'count', 'notify'];

  // Used for an account that appears for the first time and has no settings yet.
  const DEFAULT_WATCH = { inbox: 'notify' };

  const DEFAULTS = {
    // { [email]: { [folderId]: 'count' | 'notify' } }; anything not listed is off.
    watch: {},
    pollSeconds: 60,
    notify: true,
    // Combine new mail into one notification when a check finds more than this many messages.
    groupAfter: 3,
    reuseTab: true,
    // Per-mailbox identity { [email]: { name, color } }, used to tell mailboxes apart in the list, notifications and tooltip.
    accounts: {},
    // Toolbar badge number: total adds up all mailboxes, split shows each one (e.g. 3/12).
    badgeMode: 'total',
    // Notification volume 0–100; each mailbox's sound is stored in accounts[email].sound.
    volume: 70
  };

  // Sound ids. The sounds themselves are in sounds.js; custom is a file the user uploaded, kept on this computer only.
  const SOUND_IDS = ['none', 'chime', 'ding', 'drop', 'marimba', 'bell', 'tick', 'custom'];
  const DEFAULT_SOUND = 'chime';

  // Mailbox colors avoid red and blue, which stand for "notify" and "count".
  const ACCOUNT_COLORS = ['teal', 'violet', 'magenta', 'olive', 'cocoa', 'slate']
    .map(id => ({ id, name: I18n.t(`color_${id}`) }));
  const COLOR_IDS = ACCOUNT_COLORS.map(c => c.id);

  const POLL_CHOICES = [30, 60, 120, 300, 900];

  function normalize(s) {
    const watch = {};
    for (const [email, folders] of Object.entries(s.watch || {})) {
      watch[email] = {};
      for (const [id, level] of Object.entries(folders || {})) {
        if (level === 'count' || level === 'notify') watch[email][id] = level;
      }
    }
    const accounts = {};
    for (const [email, a] of Object.entries(s.accounts || {})) {
      const name = String(a?.name ?? '').trim().slice(0, 12);
      const color = COLOR_IDS.includes(a?.color) ? a.color : undefined;
      const sound = SOUND_IDS.includes(a?.sound) ? a.sound : undefined;
      if (name || color || sound) accounts[email] = { ...(name && { name }), ...(color && { color }), ...(sound && { sound }) };
    }
    return {
      ...DEFAULTS,
      ...s,
      watch,
      accounts,
      badgeMode: s.badgeMode === 'split' ? 'split' : 'total',
      volume: Math.max(0, Math.min(100, Number.isFinite(Number(s.volume)) ? Number(s.volume) : DEFAULTS.volume)),
      pollSeconds: POLL_CHOICES.includes(Number(s.pollSeconds)) ? Number(s.pollSeconds) : DEFAULTS.pollSeconds,
      groupAfter: Math.max(1, parseInt(s.groupAfter, 10) || DEFAULTS.groupAfter),
      notify: s.notify !== false,
      reuseTab: s.reuseTab !== false
    };
  }

  async function get() {
    return normalize(await chrome.storage.sync.get(DEFAULTS));
  }

  async function set(patch) {
    const next = normalize({ ...(await get()), ...patch });
    await chrome.storage.sync.set(next);
    return next;
  }

  function watchFor(settings, email) {
    return settings.watch[email] ?? DEFAULT_WATCH;
  }

  function levelOf(settings, email, folderId) {
    return watchFor(settings, email)[folderId] ?? 'off';
  }

  function withLevel(settings, email, folderId, level) {
    const folders = { ...watchFor(settings, email) };
    if (level === 'off') delete folders[folderId];
    else folders[folderId] = level;
    return { ...settings.watch, [email]: folders };
  }

  // Without a chosen color, the color is derived from the email alone, so a mailbox has the same color on every computer and next to any other mailbox.
  // Collisions are not resolved, because that would depend on which mailboxes this computer has; the user can pick a color once (it syncs).
  // FNV-1a plus the murmur3 finalizer spreads similar emails (e.g. a1@, a2@) across different colors.
  function hashColor(email) {
    let h = 0x811c9dc5;
    for (const ch of email.trim().toLowerCase()) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193);
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return ((h ^ (h >>> 16)) >>> 0) % COLOR_IDS.length;
  }

  // Builds each mailbox's identity { email, name, label, color, initial }.
  function identities(settings, emails) {
    const out = {};
    for (const email of emails) {
      const own = settings.accounts[email] || {};
      const color = own.color || COLOR_IDS[hashColor(email)];
      const name = own.name || '';
      const label = name || email;
      out[email] = { email, name, label, color, sound: own.sound || DEFAULT_SOUND, initial: [...label][0].toUpperCase() };
    }
    return out;
  }

  function withAccount(settings, email, patch) {
    return { ...settings.accounts, [email]: { ...(settings.accounts[email] || {}), ...patch } };
  }

  return {
    LEVELS, DEFAULTS, DEFAULT_WATCH, POLL_CHOICES, ACCOUNT_COLORS, SOUND_IDS, DEFAULT_SOUND,
    get, set, normalize, watchFor, levelOf, withLevel, identities, withAccount
  };
})();
