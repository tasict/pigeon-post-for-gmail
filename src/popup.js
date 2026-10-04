const { h, accountMark, timeAgo } = UI;
const { t, tn, list } = I18n;
const $ = sel => document.querySelector(sel);

I18n.apply();
$('.bar').after(UI.pinHint());

// bulk: per-mailbox progress of "mark all as read" (written to session storage by the background); confirming: the mailbox being confirmed.
// reauth: mailboxes Gmail asked to verify again (email → verification URL, also written by the background).
// reconnecting: mailboxes whose Gmail session is being renewed in a background tab (email → start time, written by the background).
// pending: keys of messages being marked as read, kept hidden across re-renders until the result is in.
// dismiss: timers that fade out a finished bulk result (email → timer); fading: mailboxes whose result is fading out.
const P = {
  state: null, settings: null, avatars: {}, collapsed: {}, bulk: {}, reauth: {}, reconnecting: {}, pending: new Set(),
  confirming: null, entering: null, dismiss: {}, fading: new Set()
};

const SVG = 'http://www.w3.org/2000/svg';
function icon(paths, size = 16) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(SVG, 'path');
    p.setAttribute('d', d);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '1.7');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.append(p);
  }
  return svg;
}
const openIcon = () => icon(['M8 4H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3', 'M11 4h5v5', 'M16 4l-7 7'], 14);

// Icons whose parts are animated by CSS; the markup is fixed and holds no outside data.
function markupIcon(cls, markup, size, style = '') {
  const tpl = document.createElement('template');
  tpl.innerHTML = `<svg class="${cls}" viewBox="0 0 20 20" width="${size}" height="${size}" aria-hidden="true" style="${style}"
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${markup}</svg>`;
  return tpl.content.firstElementChild;
}

// Read icon: a closed envelope with an unread dot in the mailbox color; on hover or press the flap opens and the dot disappears.
// hinge is the axis the flap turns on (the top edge of the envelope).
const envelopeIcon = (markup, hinge, size) => markupIcon('env', markup, size, `--hinge: ${hinge}`);
const readIcon = () => envelopeIcon(
  '<rect x="2.75" y="7" width="14.5" height="9.5" rx="1.6"/>' +
  '<path class="env-flap" d="M3.3 7.6L10 12.1l6.7-4.5"/>' +
  '<circle class="env-dot" cx="16.6" cy="5.6" r="2.4"/>',
  '10px 7px', 20);
const readAllIcon = () => envelopeIcon(
  '<path d="M5.6 5h10.2a1.4 1.4 0 0 1 1.4 1.4v7.2"/>' +
  '<rect x="2.75" y="8" width="11.5" height="8.75" rx="1.5"/>' +
  '<path class="env-flap" d="M3.3 8.6l5.2 3.7 5.2-3.7"/>' +
  '<circle class="env-dot" cx="14" cy="7.4" r="2.2"/>',
  '8.5px 8px', 20);

// Reconnecting icon: a plug and a socket that keep coming together, with a spark where they meet.
// Drawn plugged in, which is also what shows when motion is reduced.
const plugIcon = () => markupIcon('plug',
  '<g class="plug-l"><path d="M3.6 10H1.4"/><path d="M8.6 6.5v7H7.1a3.5 3.5 0 0 1 0-7z"/><path d="M8.6 8.6h2.8M8.6 11.4h2.8"/></g>' +
  '<g class="plug-r"><path d="M11.4 6.5v7h1.5a3.5 3.5 0 0 0 0-7z"/><path d="M16.4 10h2.2"/></g>' +
  '<path class="plug-spark" d="M10 4.3V2.7M10 15.7v1.6M7.7 4.8l-.9-1.2M12.3 4.8l.9-1.2"/>',
  18);
const RECONNECT_LOOP_MS = 1400;

function openAndClose(url) {
  chrome.runtime.sendMessage({ type: 'openUrl', url }).then(() => window.close());
}

// Opens the verification page for this mailbox; the background clears its notice.
function openReauth(email, url) {
  chrome.runtime.sendMessage({ type: 'openReauth', email, url }).then(() => window.close());
}

function stateBox(title, text, action) {
  return h('div', { class: 'state' },
    h('p', {}, h('strong', { text: title }), text),
    action && h('button', { class: 'btn solid', type: 'button', text: action.label, onclick: action.run })
  );
}

function setCollapsed(email, value) {
  P.collapsed = { ...P.collapsed, [email]: value };
  chrome.storage.local.set({ collapsed: P.collapsed });
  const box = document.querySelector(`.box[data-email="${CSS.escape(email)}"]`);
  box?.classList.toggle('collapsed', value);
  box?.querySelector('.box-toggle')?.setAttribute('aria-expanded', String(!value));
}

function showWarning(text, title = '') {
  const w = $('#warning');
  w.hidden = !text;
  w.textContent = text;
  w.title = title;
}

async function markRead(row, m) {
  // The row stays hidden even if the list is re-rendered meanwhile (for example when the reconnecting notice appears).
  // On success it stays pending until the new state drops the message (see render).
  P.pending.add(m.key);
  row.querySelector('.msg-read').setAttribute('aria-busy', 'true');
  row.classList.add('leaving');
  const r = await chrome.runtime.sendMessage({ type: 'markRead', keys: [m.key] }).catch(e => ({ ok: false, error: e.message }));
  if (!r?.ok) {
    P.pending.delete(m.key);
    const live = document.querySelector(`.msg[data-key="${CSS.escape(m.key)}"]`);
    live?.classList.remove('leaving');
    live?.querySelector('.msg-read').removeAttribute('aria-busy');
    if (r?.reauthUrl) {
      // The notice stays on this mailbox's box (a warning would be cleared by the next render); move focus to its button.
      P.reauth = { ...P.reauth, [m.email]: r.reauthUrl };
      render();
      document.querySelector(`[data-focus="reauth:${CSS.escape(m.email)}"]`)?.focus();
      return;
    }
    showWarning(t('markReadFailed', r?.error || t('unknownError')));
  }
}

function startConfirm(email) {
  P.confirming = email;
  P.entering = email;
  render();
  document.querySelector(`[data-focus="bulk-go:${CSS.escape(email)}"]`)?.focus();
}

function cancelConfirm(email) {
  P.confirming = null;
  render();
  document.querySelector(`[data-focus="bulk-open:${CSS.escape(email)}"]`)?.focus();
}

function markAllRead(email) {
  P.confirming = null;
  // Show progress right away, before the background writes it, so the view does not stall.
  P.bulk = { ...P.bulk, [email]: { phase: 'running', done: 0, total: P.state?.accountTotals?.[email] || 0 } };
  render();
  // If the background refuses right away (e.g. a job is already running) it writes no progress, so show the reason here.
  chrome.runtime.sendMessage({ type: 'markAllRead', email })
    .then(r => (r?.ok || r?.phase ? null : r?.error || t('unknownError')), e => e.message)
    .then(error => {
      if (!error) return;
      P.bulk = { ...P.bulk, [email]: { phase: 'error', done: 0, error } };
      render();
    });
}

function clearBulk(email) {
  clearTimeout(P.dismiss[email]);
  delete P.dismiss[email];
  P.fading.delete(email);
  const { [email]: _, ...rest } = P.bulk;
  P.bulk = rest;
  render();
  chrome.runtime.sendMessage({ type: 'clearBulk', email }).catch(() => {});
}

// A finished result fades out on its own; a longer one (with a note) stays longer.
// The timer waits while the pointer or focus is on the panel, so it never disappears mid-read or under a click.
const DISMISS_MS = 4000;
const DISMISS_NOTE_MS = 8000;
const FADE_MS = 500;
function scheduleDismiss(email, delay) {
  if (P.dismiss[email]) return;
  P.dismiss[email] = setTimeout(() => {
    delete P.dismiss[email];
    if (P.bulk[email]?.phase !== 'done') return;
    const panel = document.querySelector(`.bulk[data-done="${CSS.escape(email)}"]`);
    if (panel?.matches(':hover, :focus-within')) return scheduleDismiss(email, 1500);
    P.fading.add(email);
    if (panel) {
      // Pin the current height so it can shrink to zero after the fade.
      panel.style.height = `${panel.offsetHeight}px`;
      panel.offsetHeight;
      panel.classList.add('fading');
    }
    P.dismiss[email] = setTimeout(() => clearBulk(email), FADE_MS);
  }, delay);
}

// The confirmation, progress and result panel below a mailbox header.
// folders are the folders tracked for this mailbox (entries of state.folders).
function bulkPanel(acc, id, total, folders) {
  const email = acc.email;
  const job = P.bulk[email];
  const enter = P.entering === email;
  if (enter) P.entering = null;

  if (!job && P.confirming === email) {
    // Each feed lists only the newest ~20 messages; if any folder has more, send the user to Gmail instead.
    const over = folders.filter(f => !f.error && f.fullcount > f.listed);
    if (over.length) {
      return h('div', { class: `bulk${enter ? ' enter' : ''}`, role: 'group', 'aria-label': t('markAllRead') },
        h('p', { class: 'bulk-q', text: tn('bulkTooMany', total) }),
        h('p', { class: 'bulk-note', text: t('bulkTooManyNote', list(over.map(f => Gmail.folderName(f.folderId)))) }),
        h('div', { class: 'bulk-acts' },
          h('button', {
            class: 'btn acct', type: 'button', dataset: { focus: `bulk-go:${email}` }, text: t('openInGmail'),
            onclick: () => openAndClose(Gmail.unreadSearchUrl(acc.index, folders.map(f => f.folderId)))
          }),
          h('button', { class: 'btn', type: 'button', dataset: { focus: `bulk-cancel:${email}` }, text: t('cancel'), onclick: () => cancelConfirm(email) })
        )
      );
    }
    const folderNames = folders.map(f => Gmail.folderName(f.folderId));
    return h('div', { class: `bulk${enter ? ' enter' : ''}`, role: 'group', 'aria-label': t('markAllRead') },
      h('p', { class: 'bulk-q', text: tn('bulkConfirm', total) }),
      h('p', { class: 'bulk-note', text: t('bulkScope', list(folderNames)) }),
      h('div', { class: 'bulk-acts' },
        h('button', { class: 'btn acct', type: 'button', dataset: { focus: `bulk-go:${email}` }, text: t('markAllRead'), onclick: () => markAllRead(email) }),
        h('button', { class: 'btn', type: 'button', dataset: { focus: `bulk-cancel:${email}` }, text: t('cancel'), onclick: () => cancelConfirm(email) })
      )
    );
  }
  if (!job) return null;

  if (job.phase === 'running') {
    const pct = job.total ? Math.min(100, Math.round(job.done / job.total * 100)) : 0;
    return h('div', { class: 'bulk', 'aria-live': 'polite' },
      h('p', { class: 'bulk-q', text: t('bulkProgress', job.done, job.total) }),
      h('p', { class: 'bulk-note', text: t('bulkKeepsRunning') }),
      h('div', {
        class: 'bulk-bar', role: 'progressbar', 'aria-label': t('bulkProgressLabel'),
        'aria-valuemin': '0', 'aria-valuemax': String(job.total), 'aria-valuenow': String(job.done), style: `--p: ${pct}%`
      })
    );
  }

  const close = h('button', { class: 'btn', type: 'button', dataset: { focus: `bulk-close:${email}` }, text: t('close'), onclick: () => clearBulk(email) });
  if (job.phase === 'error') {
    return h('div', { class: 'bulk is-error', role: 'alert' },
      h('p', { class: 'bulk-q', text: t('bulkFailed') }),
      h('p', { class: 'bulk-note', text: job.done ? tn('bulkFailedPartial', job.done, job.error || t('unknownError')) : job.error || t('unknownError') }),
      h('div', { class: 'bulk-acts' },
        job.reauthUrl && h('button', { class: 'btn acct', type: 'button', text: t('reauthOpen'), onclick: () => openReauth(email, job.reauthUrl) }),
        close
      )
    );
  }

  let note = '';
  if (job.left) note = tn('bulkLeft', job.left);
  scheduleDismiss(email, note ? DISMISS_NOTE_MS : DISMISS_MS);
  return h('div', { class: `bulk is-done${P.fading.has(email) ? ' fading' : ''}`, role: 'status', dataset: { done: email } },
    h('p', { class: 'bulk-q', text: job.done ? tn('bulkDone', job.done) : t('bulkNothing') }),
    note && h('p', { class: 'bulk-note', text: note }),
    h('div', { class: 'bulk-acts' }, close)
  );
}

// Shown below a mailbox header when Gmail asked this mailbox to verify again; visible even when the box is collapsed.
function reauthPanel(acc) {
  const email = acc.email;
  // A failed bulk job already offers the same button.
  if (!P.reauth[email] || P.bulk[email]?.reauthUrl) return null;
  return h('div', { class: 'bulk is-error', role: 'alert' },
    h('p', { class: 'bulk-q', text: t('reauthNeeded') }),
    h('p', { class: 'bulk-note', text: t('reauthNeededNote', email) }),
    h('div', { class: 'bulk-acts' },
      h('button', { class: 'btn acct', type: 'button', dataset: { focus: `reauth:${email}` }, text: t('reauthOpen'), onclick: () => openReauth(email) })
    )
  );
}

// Shown in a mailbox header while a background Gmail tab renews the mailbox's session.
// The animation is offset by the time already spent, so re-rendering the list does not restart it.
function reconnectBadge(acc) {
  const since = P.reconnecting[acc.email];
  if (!since) return null;
  const phase = (Date.now() - since) % RECONNECT_LOOP_MS;
  return h('span', { class: 'reconnect', role: 'status', title: t('reconnectingNote'), style: `--loop: ${RECONNECT_LOOP_MS}ms; --phase: -${phase}ms` },
    plugIcon(), h('span', { text: t('reconnecting') }));
}

function messageRow(m) {
  const pending = P.pending.has(m.key);
  const row = h('div', { class: `msg${pending ? ' leaving' : ''}`, dataset: { key: m.key } });
  row.append(
    h('button', {
      class: 'msg-open', type: 'button', title: m.authorEmail ? t('openMessageFrom', m.authorEmail) : t('openMessage'),
      onclick: () => openAndClose(Gmail.messageUrl(m.link, m.index))
    },
      h('span', { class: 'top' },
        h('span', { class: 'from', text: m.authorName || m.authorEmail || t('unknownSender') }),
        h('span', { class: 'time', text: timeAgo(m.modified) })
      ),
      h('span', { class: 'subject', text: m.title || t('noSubject') }),
      m.summary && h('span', { class: 'snippet', text: m.summary }),
      h('span', { class: 'where', text: list(m.folders.map(Gmail.folderName)) })
    ),
    h('button', {
      class: 'msg-read', type: 'button', title: t('markRead'), 'aria-label': t('markReadNamed', m.title || t('noSubject')),
      'aria-busy': pending ? 'true' : null, onclick: () => markRead(row, m)
    }, readIcon())
  );
  return row;
}

// Fade the strip's edges only where more chips are hidden past them.
function updateStripFade() {
  const strip = $('#strip');
  const max = strip.scrollWidth - strip.clientWidth;
  strip.classList.toggle('more-before', strip.scrollLeft > 1);
  strip.classList.toggle('more-after', strip.scrollLeft < max - 1);
}

function render() {
  const { state, settings } = P;
  // Remember which button had focus and restore it after re-rendering.
  const focusKey = document.activeElement?.dataset?.focus;
  const content = $('#content');
  const strip = $('#strip');
  // Keep the strip's scroll position across re-renders so a refresh does not jump back to the first chip.
  const stripScroll = strip.scrollLeft;
  content.replaceChildren();
  strip.replaceChildren();
  strip.hidden = true;
  $('#checked').textContent = state?.lastCheck ? t('checkedAgo', timeAgo(state.lastCheck)) : '';

  const errors = state?.errors ?? [];
  showWarning(errors.length && state.accounts.length
    ? tn('foldersFailed', errors.length, list([...new Set(errors.map(e => Gmail.folderName(e.folderId)))])) : '',
  errors.map(e => t('folderError', `${e.email} ${Gmail.folderName(e.folderId)}`, e.message)).join('\n'));

  if (!state || !settings) {
    $('#summary').textContent = t('checking');
    return;
  }
  if (!state.accounts.length) {
    $('#summary').textContent = t('notSignedIn');
    content.append(stateBox(t('signedOutTitle'), t('signedOutPopup'),
      { label: t('signIn'), run: () => openAndClose('https://mail.google.com/') }));
    return;
  }
  if (!state.folders.length) {
    $('#summary').textContent = t('noFoldersSummary');
    content.append(stateBox(t('noFoldersTitle'), t('noFoldersText'),
      { label: t('chooseFolders'), run: () => chrome.runtime.openOptionsPage() }));
    return;
  }

  // A message that has left the list is done; if a later check brings it back, it shows again.
  for (const key of P.pending) if (!state.messages.some(m => m.key === key)) P.pending.delete(key);
  $('#summary').textContent = state.total ? tn('unreadCount', state.total) : t('noUnread');
  const ids = Settings.identities(settings, state.accounts.map(a => a.email), P.avatars);
  const multi = state.accounts.length > 1;

  // With several mailboxes, show a chip for each one with its unread count; clicking opens that mailbox.
  // Chips keep the mailbox order so each one stays in the same place between checks.
  if (multi) {
    strip.hidden = false;
    for (const acc of state.accounts) {
      const id = ids[acc.email];
      const n = state.accountTotals?.[acc.email] ?? 0;
      strip.append(h('button', {
        class: 'strip-item', type: 'button', dataset: { acct: id.color }, title: t('openGmailOf', acc.email),
        onclick: () => openAndClose(Gmail.gmailUrl(acc.index))
      },
        accountMark(id, 'sm'),
        h('span', { class: 'who', text: id.name || acc.email.split('@')[0] }),
        h('span', { class: `n${n ? '' : ' zero'}`, text: n, 'aria-label': tn('unreadCount', n) })
      ));
    }
    strip.scrollTo({ left: stripScroll, behavior: 'instant' });
    updateStripFade();
  }

  for (const acc of state.accounts) {
    const id = ids[acc.email];
    const msgs = state.messages.filter(m => m.email === acc.email);
    const total = state.accountTotals?.[acc.email] ?? msgs.length;
    const tracked = state.folders.some(f => f.email === acc.email);
    const collapsed = multi && !!P.collapsed[acc.email];
    const count = h('span', { class: `n${total ? '' : ' zero'}`, text: tracked ? (total ? total : t('noUnreadShort')) : t('notTracked') });
    const accFolders = state.folders.filter(f => f.email === acc.email);
    const canReadAll = tracked && total > 0 && !P.bulk[acc.email];

    const head = h('div', { class: 'box-head' },
      h('button', {
        class: 'box-open', type: 'button', title: t('openGmailOf', acc.email),
        onclick: () => openAndClose(Gmail.gmailUrl(acc.index))
      },
        accountMark(id),
        h('span', { class: 'who' }, h('strong', { text: id.label }), id.name && h('small', { text: acc.email })),
        h('span', { class: 'go' }, openIcon())
      ),
      reconnectBadge(acc),
      canReadAll && h('button', {
        class: 'box-read', type: 'button', dataset: { focus: `bulk-open:${acc.email}` },
        title: t('markAllRead'), 'aria-label': tn('markAllReadNamed', total, id.label),
        'aria-expanded': String(P.confirming === acc.email),
        onclick: () => (P.confirming === acc.email ? cancelConfirm(acc.email) : startConfirm(acc.email))
      }, readAllIcon()),
      multi
        ? h('button', {
          class: 'box-toggle', type: 'button', 'aria-expanded': String(!collapsed), 'aria-label': t('toggleBox', id.label),
          onclick: () => setCollapsed(acc.email, !P.collapsed[acc.email])
        }, count, h('span', { class: 'chev', 'aria-hidden': 'true' }))
        : h('span', { class: 'box-count' }, count)
    );

    const body = h('div', { class: 'box-body' });
    if (!tracked) body.append(h('p', { class: 'box-empty', text: t('boxNotTracked') }));
    else if (!msgs.length) body.append(h('p', { class: 'box-empty', text: t('boxNoUnread') }));
    for (const m of msgs) body.append(messageRow(m));
    const hidden = total - msgs.length;
    if (hidden > 0) {
      body.append(h('button', { class: 'more', type: 'button', text: tn('moreInGmail', hidden), onclick: () => openAndClose(Gmail.gmailUrl(acc.index)) }));
    }
    content.append(h('section', { class: `box${collapsed ? ' collapsed' : ''}`, dataset: { email: acc.email, acct: id.color }, 'aria-label': id.label },
      head, reauthPanel(acc), bulkPanel(acc, id, total, accFolders), body));
  }
  if (focusKey) document.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus();
}

async function refresh() {
  const btn = $('#refresh');
  btn.classList.add('spin');
  try {
    const state = await chrome.runtime.sendMessage({ type: 'poll' });
    // A failed poll answers { ok: false, error }; keep showing the last good state.
    if (state?.accounts) {
      P.state = state;
      render();
    }
  } catch { /* the service worker was restarting; the next poll updates the view */ } finally {
    btn.classList.remove('spin');
  }
}

$('#refresh').addEventListener('click', refresh);
$('#strip').addEventListener('scroll', updateStripFade, { passive: true });
// A plain mouse wheel scrolls vertically; turn it sideways over the strip when it overflows.
$('#strip').addEventListener('wheel', e => {
  const strip = e.currentTarget;
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY) || strip.scrollWidth <= strip.clientWidth) return;
  e.preventDefault();
  strip.scrollBy({ left: e.deltaY * (e.deltaMode === 1 ? 16 : 1) });
}, { passive: false });
$('#settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.state) { P.state = changes.state.newValue; render(); }
  if (area === 'sync') Settings.get().then(s => { P.settings = s; render(); });
  if (area === 'local' && changes.avatars) { P.avatars = changes.avatars.newValue || {}; render(); }
  if (area === 'session' && changes.bulk) { P.bulk = changes.bulk.newValue || {}; render(); }
  if (area === 'session' && changes.reauth) { P.reauth = changes.reauth.newValue || {}; render(); }
  if (area === 'session' && changes.reconnecting) { P.reconnecting = changes.reconnecting.newValue || {}; render(); }
});

(async () => {
  const [{ collapsed = {}, avatars = {} }, { state, bulk = {}, reauth = {}, reconnecting = {} }, settings] = await Promise.all([
    chrome.storage.local.get(['collapsed', 'avatars']),
    chrome.storage.session.get(['state', 'bulk', 'reauth', 'reconnecting']),
    Settings.get()
  ]);
  Object.assign(P, { state, settings, avatars, collapsed, bulk, reauth, reconnecting });
  render();
  // Check now if the last result is older than one poll interval.
  if (!state || Date.now() - state.lastCheck > settings.pollSeconds * 1000) refresh();
})();
