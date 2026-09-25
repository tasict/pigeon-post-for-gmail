const { h, accountMark, timeAgo } = UI;
const { t, tn, list, quote } = I18n;
const $ = sel => document.querySelector(sel);

I18n.apply();

const LEVEL_TEXT = Object.fromEntries(Settings.LEVELS.map(lv => [lv, t(`level_${lv}`)]));
const RANK = { off: 0, count: 1, notify: 2 };
const TAB_IDS = Gmail.SYSTEM_FOLDERS.filter(f => f.group === 'tabs').map(f => f.id);

const S = {
  settings: null,
  accounts: null,     // null while detecting
  gmailLabels: {},    // labels read from Gmail's left-hand menu by the content script
  state: null,        // result of the background's latest check
  manual: {},         // labels added by hand in this session that are not in Gmail's menu { email: Set }
  counts: new Map(),  // `${email}|${folderId}` → { fullcount } | { error } | 'pending'
  filter: {},         // label filter text { email: string }
  labelStatus: {},    // result message of reading labels { email: { text, tone } }
  changedAt: 0
};

function identities() {
  return Settings.identities(S.settings, (S.accounts ?? S.state?.accounts ?? []).map(a => a.email));
}

const keyOf = (email, folderId) => `${email}|${folderId}`;
const splitKey = key => { const i = key.indexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };
const byKey = key => `[data-key="${CSS.escape(key)}"]`;

function displayName(folderId) {
  const f = Gmail.SYSTEM_BY_ID[folderId];
  if (f?.group === 'tabs') return t('tabName', f.name);
  return Gmail.folderName(folderId);
}

/* ---------- Saving ---------- */

let pendingPatch = {};
let saveTimer = null;
let savedTimer = null;

function save(patch) {
  Object.assign(pendingPatch, patch);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 350);
}

async function flushSave() {
  const patch = pendingPatch;
  pendingPatch = {};
  saveTimer = null;
  const saved = $('#saved');
  try {
    S.settings = await Settings.set(patch);
    // When folders change, ask the background to check right away so the preview counts catch up.
    if (patch.watch) chrome.runtime.sendMessage({ type: 'poll' }).catch(() => {});
    saved.textContent = t('saved');
    saved.style.color = '';
  } catch (e) {
    saved.textContent = t('saveFailed', e.message);
    saved.style.color = 'var(--red)';
  }
  saved.classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => saved.classList.remove('show'), 1800);
}

/* ---------- Folder rows ---------- */

let radioSeq = 0;

function segmented(label, value, onChange) {
  const name = `lv-${++radioSeq}`;
  return h('fieldset', { class: 'seg' },
    h('legend', { class: 'visually-hidden', text: label }),
    Settings.LEVELS.map(level =>
      h('label', {},
        h('input', { type: 'radio', name, value: level, checked: level === value, onchange: () => onChange(level) }),
        h('span', { text: LEVEL_TEXT[level] })
      )
    )
  );
}

function folderRow(acc, folderId, opts = {}) {
  const key = keyOf(acc.email, folderId);
  const level = Settings.levelOf(S.settings, acc.email, folderId);
  const label = opts.label ?? Gmail.folderName(folderId);
  const nameNode = opts.parent
    ? h('span', { class: 'name' }, h('span', { class: 'parent', text: `${opts.parent} / ` }), opts.leaf)
    : h('span', { class: 'name', text: label });
  return h('div', { class: 'row', dataset: { key, level, search: label.toLowerCase() } },
    h('div', { class: 'row-name' },
      nameNode,
      opts.hint && h('span', { class: 'hint', text: opts.hint }),
      opts.onRemove && h('button', { class: 'remove', type: 'button', text: t('remove'), title: t('removeNamed', label), onclick: opts.onRemove })
    ),
    h('span', { class: 'count pending', dataset: { key }, title: t('currentUnread'), text: '…' }),
    segmented(t('levelLegend', label), level, lv => setLevel(acc.email, folderId, lv))
  );
}

function setLevel(email, folderId, level) {
  S.settings = { ...S.settings, watch: Settings.withLevel(S.settings, email, folderId, level) };
  S.changedAt = Date.now();
  syncRow(keyOf(email, folderId));
  updateConflict(email);
  renderPreview();
  save({ watch: S.settings.watch });
}

// Keeps the rows on screen in line with the current settings (which may also arrive via sync from another computer).
function syncRow(key) {
  const [email, folderId] = splitKey(key);
  const level = Settings.levelOf(S.settings, email, folderId);
  for (const row of document.querySelectorAll(`.row${byKey(key)}`)) {
    row.dataset.level = level;
    const radio = row.querySelector(`input[value="${level}"]`);
    if (radio && !radio.checked) radio.checked = true;
  }
}

/* ---------- Account sections ---------- */

function renderAccounts() {
  const box = $('#accounts');
  box.replaceChildren();
  renderConnection();
  // With one mailbox, total and split look the same, so the option is hidden.
  $('#badge-section').hidden = !(S.accounts?.length > 1);
  if (S.accounts === null) {
    box.append(h('p', { class: 'note', text: t('loadingAccounts') }));
    return;
  }
  if (!S.accounts.length) {
    box.append(h('div', { class: 'signin' },
      h('p', {}, h('strong', { text: t('signedOutTitle') }), t('signedOutOptions')),
      h('button', { class: 'btn solid', type: 'button', text: t('signIn'), onclick: () => chrome.tabs.create({ url: 'https://mail.google.com/' }) })
    ));
  }
  for (const acc of S.accounts) box.append(accountSection(acc));
  const away = Object.keys(S.settings.watch).filter(e => !S.accounts.some(a => a.email === e));
  if (away.length) {
    box.append(h('div', { class: 'away' },
      h('p', { text: t('awayAccounts', list(away)) })));
  }
  observeCounts();
}

function renderConnection() {
  const p = $('#connection');
  p.classList.toggle('problem', Array.isArray(S.accounts) && !S.accounts.length);
  if (S.accounts === null) { p.textContent = t('checkingSignIn'); return; }
  if (!S.accounts.length) { p.textContent = t('notSignedIn'); return; }
  const emails = h('span', {}, S.accounts.flatMap((a, i) => [i ? t('listSeparator') : '', h('strong', { text: a.email })]));
  p.replaceChildren(...I18n.parts('connected', emails));
}

function accountSection(acc) {
  const tabsOpen = TAB_IDS.some(id => Settings.levelOf(S.settings, acc.email, id) !== 'off');
  const more = Gmail.SYSTEM_FOLDERS.filter(f => f.group === 'more');
  const id = identities()[acc.email];
  const headMark = accountMark(id, 'lg');
  const colorName = `color-${++radioSeq}`;
  return h('section', { class: 'account', dataset: { email: acc.email, acct: id.color } },
    h('div', { class: 'account-head' },
      headMark,
      h('h3', { text: acc.email }),
      h('button', { class: 'link-btn', type: 'button', text: t('openThisGmail'), onclick: () => chrome.tabs.create({ url: Gmail.gmailUrl(acc.index) }) }),
      h('div', { class: 'mark' },
        h('label', { class: 'nick' }, t('nameLabel'),
          h('input', {
            type: 'text', maxlength: '12', placeholder: t('namePlaceholder'), value: id.name,
            oninput: e => setIdentity(acc.email, { name: e.target.value.trim() })
          })),
        h('fieldset', { class: 'swatches' },
          h('legend', { text: t('colorLegend') }),
          Settings.ACCOUNT_COLORS.map(c => h('label', { title: c.name },
            h('input', { type: 'radio', name: colorName, value: c.id, checked: c.id === id.color, 'aria-label': c.name, onchange: () => setIdentity(acc.email, { color: c.id }) }),
            h('span', { dataset: { acct: c.id } })
          ))
        ),
        soundPicker(acc)
      )
    ),
    h('div', { class: 'sheet' },
      h('div', { class: 'group' },
        h('h4', { class: 'group-title', text: t('groupInbox') }),
        folderRow(acc, 'inbox', { hint: Gmail.SYSTEM_BY_ID.inbox.hint }),
        h('details', { class: 'tabs', open: tabsOpen },
          h('summary', { text: t('tabsSummary') }),
          TAB_IDS.map(fid => folderRow(acc, fid, { hint: fid === 'primary' ? t('primaryHint') : null })),
          h('div', { class: 'conflict', dataset: { conflict: acc.email }, hidden: true })
        )
      ),
      h('div', { class: 'group' },
        h('h4', { class: 'group-title', text: t('groupOther') }),
        more.map(f => folderRow(acc, f.id, { hint: f.hint }))
      ),
      labelsGroup(acc)
    )
  );
}

/* ---------- Sounds ---------- */

function soundOptions(current) {
  return [
    h('option', { value: 'none', text: Sounds.NAMES.none, selected: current === 'none' }),
    Sounds.LIST.map(snd => h('option', { value: snd.id, text: snd.name, selected: current === snd.id }))
  ];
}

function soundPicker(acc) {
  const id = identities()[acc.email];
  const select = h('select', {
    'aria-label': t('soundLabel'),
    onchange: e => {
      setIdentity(acc.email, { sound: e.target.value });
      previewSound(acc.email);
    }
  }, soundOptions(id.sound));
  return h('div', { class: 'sound', dataset: { sound: acc.email } },
    h('label', {}, t('soundLabel'), select),
    h('button', { class: 'btn', type: 'button', text: t('soundPreview'), 'aria-label': t('soundPreviewNamed', id.label), onclick: () => previewSound(acc.email) })
  );
}

function previewSound(email) {
  Sounds.play(identities()[email].sound, S.settings.volume || 60);
}

// Name, color or sound changed: update this mailbox's mark on the settings page and in the preview.
function setIdentity(email, patch) {
  S.settings = { ...S.settings, accounts: Settings.withAccount(S.settings, email, patch) };
  paintIdentities();
  renderPreview();
  save({ accounts: S.settings.accounts });
}

function paintIdentities() {
  const all = identities();
  for (const [email, id] of Object.entries(all)) {
    const section = document.querySelector(`.account[data-email="${CSS.escape(email)}"]`);
    if (!section) continue;
    section.dataset.acct = id.color;
    const mark = section.querySelector('.account-head .acct-mark');
    mark.dataset.acct = id.color;
    mark.textContent = id.initial;
    const select = section.querySelector('.sound select');
    if (select && select.value !== id.sound) select.value = id.sound;
    const radio = section.querySelector(`.swatches input[value="${id.color}"]`);
    if (radio && !radio.checked) radio.checked = true;
    const nick = section.querySelector('.mark input[type="text"]');
    if (nick && document.activeElement !== nick && nick.value !== id.name) nick.value = id.name;
  }
}

// The inbox already contains every tab; a tab set lower than the inbox has no effect, so warn about it.
function updateConflict(email) {
  const box = document.querySelector(`.conflict[data-conflict="${CSS.escape(email)}"]`);
  if (!box) return;
  const inbox = Settings.levelOf(S.settings, email, 'inbox');
  const shadowed = TAB_IDS.filter(id => {
    const lv = Settings.levelOf(S.settings, email, id);
    return lv !== 'off' && RANK[lv] <= RANK[inbox];
  });
  box.hidden = inbox === 'off' || !shadowed.length;
  if (box.hidden) return;
  const lower = inbox === 'notify' ? 'count' : 'off';
  box.replaceChildren(
    h('p', { text: t('conflictText', quote(Gmail.folderName('inbox')), quote(LEVEL_TEXT[inbox]), list(shadowed.map(id => quote(Gmail.folderName(id))))) }),
    h('p', { text: t('conflictHelp') }),
    h('button', { class: 'btn', type: 'button', text: t('conflictFix', quote(LEVEL_TEXT[lower])), onclick: () => setLevel(email, 'inbox', lower) })
  );
}

/* ---------- Labels ---------- */

function labelsGroup(acc) {
  const filter = h('input', {
    type: 'search', placeholder: t('filterLabels'), 'aria-label': t('filterLabels'),
    value: S.filter[acc.email] || '',
    oninput: e => { S.filter[acc.email] = e.target.value; applyFilter(acc.email); }
  });
  const group = h('div', { class: 'group labels', dataset: { labels: acc.email } },
    h('h4', { class: 'group-title', text: t('groupLabels') }),
    h('div', { class: 'label-tools', hidden: true }, filter),
    h('div', { class: 'label-list' }),
    h('div', { class: 'label-foot' })
  );
  fillLabels(acc, group);
  return group;
}

function labelNames(email) {
  // Labels read with an email are stored under it; those without one are kept under #index.
  const index = S.accounts?.find(a => a.email === email)?.index;
  const discovered = [...new Set([
    ...Object.keys(S.gmailLabels[email]?.labels ?? {}),
    ...Object.keys((index != null && S.gmailLabels[`#${index}`]?.labels) || {})
  ])];
  const watched = Object.keys(Settings.watchFor(S.settings, email)).filter(Gmail.isLabel).map(Gmail.labelOf);
  const manual = [...(S.manual[email] ?? [])];
  const all = [...new Set([...discovered, ...watched, ...manual])].sort((a, b) => a.localeCompare(b, I18n.lang));
  return { all, discovered: new Set(discovered) };
}

function fillLabels(acc, group = document.querySelector(`.labels[data-labels="${CSS.escape(acc.email)}"]`)) {
  if (!group) return;
  const { all, discovered } = labelNames(acc.email);
  const list = group.querySelector('.label-list');
  const foot = group.querySelector('.label-foot');
  group.querySelector('.label-tools').hidden = all.length <= 8;

  list.replaceChildren();
  const status = S.labelStatus[acc.email];
  const statusNode = () => status && h('p', { class: `label-status ${status.tone || ''}`, role: 'status', text: status.text });
  const readBtn = (text, cls) => h('button', {
    class: cls, type: 'button', text, disabled: !!status?.busy,
    onclick: () => readLabels(acc)
  });
  if (!all.length) {
    list.append(h('div', { class: 'empty' },
      h('p', { text: t('labelsEmpty') }),
      readBtn(status?.busy ? t('reading') : t('readLabels'), 'btn'),
      statusNode()
    ));
  }
  for (const name of all) {
    const parts = name.split('/');
    const leaf = parts.pop();
    list.append(folderRow(acc, Gmail.labelId(name), {
      label: name,
      parent: parts.length ? parts.join(' / ') : null,
      leaf,
      onRemove: discovered.has(name) ? null : () => removeLabel(acc, name)
    }));
  }

  const info = S.gmailLabels[acc.email] ?? S.gmailLabels[`#${acc.index}`];
  const addForm = h('form', { class: 'add-label', hidden: true, onsubmit: e => { e.preventDefault(); addLabel(acc, e.target.elements.name.value); e.target.reset(); } },
    h('input', { name: 'name', type: 'text', placeholder: t('addLabelPlaceholder'), 'aria-label': t('labelName'), required: true }),
    h('button', { class: 'btn', type: 'submit', text: t('add') })
  );
  foot.replaceChildren(...[
    info?.updated && h('p', { text: t('labelsSource', timeAgo(info.updated)) }),
    h('div', { class: 'label-actions' },
      all.length > 0 && readBtn(status?.busy ? t('reading') : t('rereadLabels'), 'link-btn'),
      h('button', {
        class: 'link-btn', type: 'button', text: t('addLabelManually'),
        onclick: e => { e.target.hidden = true; addForm.hidden = false; addForm.elements.name.focus(); }
      })
    ),
    all.length > 0 && statusNode(),
    addForm
  ].filter(Boolean));
  applyFilter(acc.email);
  observeCounts();
}

/* ---------- Reading labels from Gmail tabs ---------- */

const tabIndex = url => Number((url.match(/\/mail\/u\/(\d+)/) || [])[1] ?? 0);

async function scanTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({ target: { tabId }, func: scanGmailLabels });
  return result;
}

// Gmail tabs opened before the extension was installed or reloaded have no content script, so inject the scan directly.
async function scanOpenGmailTabs(index) {
  const tabs = await chrome.tabs.query({ url: 'https://mail.google.com/mail/*' });
  let best = null;
  for (const tab of tabs) {
    if (index != null && tabIndex(tab.url) !== index) continue;
    try {
      const r = await scanTab(tab.id);
      await saveScannedLabels(r);
      if (!best || r.labels.length > best.labels.length) best = r;
    } catch { /* the tab is still loading or cannot be accessed */ }
  }
  return best;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// With no Gmail tab open, open one in the background and close it after reading.
async function scanNewTab(index) {
  const tab = await chrome.tabs.create({ url: Gmail.gmailUrl(index), active: false });
  let last = null;
  let readySince = 0;
  try {
    for (let i = 0; i < 25; i++) {
      await sleep(1000);
      try {
        last = await scanTab(tab.id);
      } catch {
        continue;
      }
      if (last.labels.length) break;
      if (last.navReady && !readySince) readySince = i;
      if (readySince && i - readySince >= 3) break;
    }
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
  if (last) await saveScannedLabels(last);
  return last;
}

async function readLabels(acc) {
  const setStatus = st => { S.labelStatus[acc.email] = st; fillLabels(acc); };
  setStatus({ busy: true, text: t('readingLabels') });
  try {
    let r = await scanOpenGmailTabs(acc.index);
    if (!r?.labels.length) r = await scanNewTab(acc.index);
    const gotLabels = !!r?.labels.length;
    const wrongAccount = r?.email && r.email !== acc.email;
    setStatus(
      !r ? { tone: 'warn', text: t('labelsTimeout') }
      : wrongAccount ? { tone: 'warn', text: t('labelsWrongAccount', r.email) }
      : gotLabels ? { tone: 'ok', text: tn('labelsFound', r.labels.length) }
      : { tone: 'warn', text: t('labelsNone') }
    );
  } catch (e) {
    setStatus({ tone: 'warn', text: t('labelsTabError', e.message) });
  }
}

function applyFilter(email) {
  const q = (S.filter[email] || '').trim().toLowerCase();
  const group = document.querySelector(`.labels[data-labels="${CSS.escape(email)}"]`);
  group?.querySelectorAll('.label-list .row').forEach(row => { row.hidden = q && !row.dataset.search.includes(q); });
}

function addLabel(acc, raw) {
  const name = raw.trim().replace(/^label:/i, '').trim();
  if (!name) return;
  const key = keyOf(acc.email, Gmail.labelId(name));
  if (!document.querySelector(`.row${byKey(key)}`)) {
    (S.manual[acc.email] ??= new Set()).add(name);
    S.filter[acc.email] = '';
    const input = document.querySelector(`.labels[data-labels="${CSS.escape(acc.email)}"] .label-tools input`);
    if (input) input.value = '';
    setLevel(acc.email, Gmail.labelId(name), 'notify');
    fillLabels(acc);
  }
  const row = document.querySelector(`.row${byKey(key)}`);
  if (row) {
    row.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    row.classList.remove('flash');
    void row.offsetWidth;
    row.classList.add('flash');
  }
}

function removeLabel(acc, name) {
  S.manual[acc.email]?.delete(name);
  setLevel(acc.email, Gmail.labelId(name), 'off');
  fillLabels(acc);
}

/* ---------- Unread counts ---------- */

const queue = [];
let active = 0;

function pump() {
  while (active < 4 && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}

function requestCount(key) {
  if (S.counts.has(key)) return paintCount(key);
  const [email, folderId] = splitKey(key);
  const acc = S.accounts?.find(a => a.email === email);
  if (!acc) return;
  S.counts.set(key, 'pending');
  queue.push(async () => {
    try {
      const r = await Gmail.fetchFolder(acc.index, folderId);
      S.counts.set(key, { fullcount: r.fullcount });
    } catch (e) {
      S.counts.set(key, { error: e.message });
    }
    paintCount(key);
  });
  pump();
}

function paintCount(key) {
  const v = S.counts.get(key);
  for (const node of document.querySelectorAll(`.count${byKey(key)}`)) {
    node.classList.remove('pending', 'zero', 'error');
    node.removeAttribute('title');
    if (!v || v === 'pending') { node.textContent = '…'; node.classList.add('pending'); }
    else if (v.error) { node.textContent = t('countError'); node.classList.add('error'); node.title = v.error; }
    else { node.textContent = v.fullcount; node.title = tn('unreadCount', v.fullcount); if (!v.fullcount) node.classList.add('zero'); }
  }
}

// Only fetch a count when its row scrolls into view, so many labels do not fire many requests at once.
const counter = new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    counter.unobserve(e.target);
    requestCount(e.target.dataset.key);
  }
}, { rootMargin: '200px' });

function observeCounts() {
  document.querySelectorAll('.count[data-key]').forEach(node => {
    if (S.counts.has(node.dataset.key)) paintCount(node.dataset.key);
    else counter.observe(node);
  });
}

// The background's result is newer, so use it to update the counts on screen.
function absorbState() {
  for (const f of S.state?.folders ?? []) {
    if (f.error) continue;
    const key = keyOf(f.email, f.folderId);
    S.counts.set(key, { fullcount: f.fullcount });
    paintCount(key);
  }
}

/* ---------- Preview ---------- */

function foldersAt(email, level) {
  const watch = Settings.watchFor(S.settings, email);
  const order = id => {
    const i = Gmail.SYSTEM_FOLDERS.findIndex(f => f.id === id);
    return i < 0 ? 100 : i;
  };
  return Object.keys(watch).filter(id => watch[id] === level)
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b, I18n.lang));
}

function quoteList(ids, max = 3) {
  const names = ids.map(id => quote(displayName(id)));
  return names.length > max ? tn('quoteMore', names.length, list(names.slice(0, max))) : list(names);
}

function renderPreview() {
  const s = S.settings;
  const state = S.state;
  // Until account detection finishes, use the accounts the background found last.
  const accounts = S.accounts ?? state?.accounts ?? [];
  const ids = identities();
  const badge = $('#pv-badge');
  const badgeText = $('#pv-badge-text');
  const stale = !state || S.changedAt > state.lastCheck;
  const totals = state?.accountTotals ?? {};

  badge.classList.remove('muted');
  if (S.accounts !== null && !accounts.length) {
    badge.textContent = '?';
    badge.classList.add('muted');
    badgeText.textContent = t('pvBadgeSignedOut');
  } else {
    const info = state ? Gmail.badgeInfo({ ...state, accounts }, s.badgeMode) : { text: '', order: [] };
    badge.textContent = info.text;
    if (stale) badgeText.textContent = t('pvBadgeStale');
    else if (!info.text) badgeText.textContent = t('pvBadgeEmpty');
    else if (info.order.length) badgeText.textContent = t('pvBadgeSplit', info.text, list(info.order.map(e => quote(ids[e]?.label ?? e))));
    else if (info.fallback === 'long') badgeText.textContent = t('pvBadgeLong', info.text);
    else if (info.fallback === 'single') badgeText.textContent = t('pvBadgeSingle', info.text);
    else badgeText.textContent = t('pvBadgeTotal', info.text, quote(LEVEL_TEXT.count), quote(LEVEL_TEXT.notify));
  }
  $('#pv-icon').src = `../icons/toolbar${badge.textContent ? '-badge' : ''}32.png`;

  // Notification preview: use the newest message that would actually notify you as the sample.
  const notifyIds = Object.fromEntries(accounts.map(a => [a.email, foldersAt(a.email, 'notify')]));
  const anyNotify = Object.values(notifyIds).some(v => v.length);
  const sample = (state?.messages ?? []).find(m =>
    m.folders.some(fid => Settings.levelOf(s, m.email, fid) === 'notify'));
  const firstEmail = accounts[0]?.email ?? 'you@gmail.com';
  const sampleEmail = sample?.email ?? firstEmail;
  const sampleFolder = sample ? sample.folders.find(fid => Settings.levelOf(s, sample.email, fid) === 'notify') : (notifyIds[firstEmail]?.[0] ?? 'inbox');
  $('#pv-from').textContent = sample ? (sample.authorName || sample.authorEmail) : t('pvFrom');
  $('#pv-subject').textContent = sample ? (sample.title || t('noSubject')) : t('pvSubject');
  $('#pv-context').textContent = t('contextLine', ids[sampleEmail]?.label ?? sampleEmail, Gmail.folderName(sampleFolder));

  $('#pv-envelope').classList.toggle('silent', !s.notify || !anyNotify);
  const envText = $('#pv-envelope-text');
  if (!accounts.length) envText.textContent = S.accounts === null ? '' : t('pvEnvSignedOut');
  else if (!s.notify) envText.textContent = t('pvEnvOff');
  else if (!anyNotify) envText.textContent = t('pvEnvNone', quote(LEVEL_TEXT.notify));
  else {
    const all = accounts.flatMap(a => notifyIds[a.email]);
    envText.textContent = t('pvEnvText', quoteList([...new Set(all)]));
  }

  // Per-mailbox preview, matching the mailbox headers in the popup.
  const box = $('#pv-accounts');
  box.replaceChildren();
  $('#pv-accounts-text').textContent = !accounts.length ? ''
    : accounts.length > 1 ? t('pvAccountsMulti') : t('pvAccountsSingle');
  for (const acc of accounts) {
    const id = ids[acc.email];
    const notify = foldersAt(acc.email, 'notify');
    const count = foldersAt(acc.email, 'count');
    const n = totals[acc.email];
    const tracked = notify.length || count.length;
    box.append(h('div', { class: 'pv-acct', dataset: { acct: id.color } },
      h('div', { class: 'pv-acct-head' },
        accountMark(id),
        h('span', { class: 'who' }, h('strong', { text: id.label }), id.name && h('small', { text: acc.email })),
        h('span', { class: `n${n ? '' : ' zero'}`, text: !tracked ? t('notTracked') : n ? n : n === 0 ? t('noUnreadShort') : '' })
      ),
      h('ul', {},
        notify.length > 0 && h('li', {}, h('span', { class: 'chip notify', text: LEVEL_TEXT.notify }), h('span', { text: list(notify.map(displayName)) })),
        count.length > 0 && h('li', {}, h('span', { class: 'chip count', text: LEVEL_TEXT.count }), h('span', { text: list(count.map(displayName)) })),
        !tracked && h('li', { class: 'none', text: t('pvNotTracked') }),
        notify.length > 0 && h('li', {}, h('span', { class: 'chip sound', text: t('soundLabel') }),
          h('span', { text: !s.volume || id.sound === 'none' ? Sounds.NAMES.none : Sounds.NAMES[id.sound] }))
      )
    ));
  }

  const plain = $('#pv-plain');
  plain.replaceChildren(h('p', { class: 'plain', text: t('pvPollEvery', I18n.duration(s.pollSeconds)) }));
  if (s.notify && anyNotify) {
    const g = s.groupAfter;
    plain.append(h('p', { class: 'plain', text: g >= 99 ? t('pvGroupEach') : g <= 1 ? t('pvGroupAll') : tn('pvGroupOver', g) }));
  }
}

async function sendTest() {
  const help = $('#test-help');
  const level = await new Promise(r => chrome.notifications.getPermissionLevel(r));
  const s = S.settings;
  const sample = (S.state?.messages ?? []).find(m => m.folders.some(id => Settings.levelOf(s, m.email, id) === 'notify'));
  await chrome.runtime.sendMessage({
    type: 'testNotification',
    sample: sample && {
      from: sample.authorName || sample.authorEmail,
      subject: sample.title || t('noSubject'),
      context: t('testContextLine', identities()[sample.email]?.label ?? sample.email, Gmail.folderName(sample.folders[0])),
      url: Gmail.messageUrl(sample.link, sample.index),
      email: sample.email
    }
  });
  // Without a sample message, at least play the first mailbox's sound.
  if (!sample && S.accounts?.[0]) previewSound(S.accounts[0].email);
  const platform = navigator.userAgentData?.platform || navigator.platform || '';
  const where = /mac/i.test(platform) ? t('testWhereMac') : /win/i.test(platform) ? t('testWhereWin') : t('testWhereOther');
  help.hidden = false;
  help.textContent = level === 'denied'
    ? t('testDenied')
    : t('testSent', where);
}

/* ---------- Other settings ---------- */

function renderGeneral() {
  const s = S.settings;
  $('#notify').checked = s.notify;
  $('#groupAfter').value = String([1, 3, 5, 99].reduce((best, v) => Math.abs(v - s.groupAfter) < Math.abs(best - s.groupAfter) ? v : best, 3));
  document.querySelectorAll('input[name="reuseTab"]').forEach(r => { r.checked = r.value === String(s.reuseTab); });
  document.querySelectorAll('input[name="badgeMode"]').forEach(r => { r.checked = r.value === s.badgeMode; });
  $('#volume').value = s.volume;
  $('#volume-out').textContent = s.volume;
  const poll = $('#poll');
  poll.querySelectorAll('label').forEach(n => n.remove());
  for (const sec of Settings.POLL_CHOICES) {
    poll.append(h('label', {},
      h('input', { type: 'radio', name: 'poll', value: String(sec), checked: sec === s.pollSeconds, onchange: () => { S.settings = { ...S.settings, pollSeconds: sec }; renderPreview(); save({ pollSeconds: sec }); } }),
      h('span', { text: I18n.duration(sec) })
    ));
  }
}

$('#notify').addEventListener('change', e => { S.settings = { ...S.settings, notify: e.target.checked }; renderPreview(); save({ notify: e.target.checked }); });
$('#groupAfter').addEventListener('change', e => { const v = Number(e.target.value); S.settings = { ...S.settings, groupAfter: v }; renderPreview(); save({ groupAfter: v }); });
document.querySelectorAll('input[name="reuseTab"]').forEach(r => r.addEventListener('change', () => save({ reuseTab: r.value === 'true' })));
document.querySelectorAll('input[name="badgeMode"]').forEach(r => r.addEventListener('change', () => {
  S.settings = { ...S.settings, badgeMode: r.value };
  renderPreview();
  save({ badgeMode: r.value });
}));
$('#test').addEventListener('click', sendTest);
$('#volume').addEventListener('input', e => { $('#volume-out').textContent = e.target.value; });
$('#volume').addEventListener('change', e => {
  const v = Number(e.target.value);
  S.settings = { ...S.settings, volume: v };
  renderPreview();
  save({ volume: v });
  if (v && S.accounts?.[0]) previewSound(S.accounts[0].email);
});

/* ---------- Startup and sync ---------- */

async function detectAccounts() {
  const found = await Gmail.discoverAccounts();
  if (JSON.stringify(found) === JSON.stringify(S.accounts)) return;
  S.accounts = found;
  renderAccounts();
  paintIdentities();
  S.accounts.forEach(a => updateConflict(a.email));
  renderPreview();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.gmailLabels) {
    S.gmailLabels = changes.gmailLabels.newValue || {};
    (S.accounts ?? []).forEach(a => fillLabels(a));
  }
  if (area === 'session' && changes.state) {
    S.state = changes.state.newValue;
    absorbState();
    renderPreview();
  }
  if (area === 'sync' && !saveTimer) {
    // Settings changed on another computer: apply them without interrupting an edit in progress.
    Settings.get().then(next => {
      if (saveTimer || JSON.stringify(next) === JSON.stringify(S.settings)) return;
      S.settings = next;
      document.querySelectorAll('.row[data-key]').forEach(row => syncRow(row.dataset.key));
      paintIdentities();
      (S.accounts ?? []).forEach(a => { updateConflict(a.email); fillLabels(a); });
      renderGeneral();
      renderPreview();
    });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') detectAccounts();
});

(async () => {
  S.settings = await Settings.get();
  const [local, { state = null }] = await Promise.all([
    chrome.storage.local.get({ gmailLabels: {} }),
    chrome.storage.session.get('state')
  ]);
  S.gmailLabels = local.gmailLabels;
  S.state = state;
  renderGeneral();
  renderAccounts();
  renderPreview();
  absorbState();
  await detectAccounts();
  chrome.runtime.sendMessage({ type: 'poll' }).catch(() => {});
  scanOpenGmailTabs().catch(() => {});
})();
