// Project site: store link, language choice and the Off/Count/Notify demo.

// Chrome Web Store listing. Leave empty until the item is public; the pages then show "coming soon" instead of the button.
const STORE_URL = '';

if (STORE_URL) {
  for (const a of document.querySelectorAll('[data-store]')) { a.href = STORE_URL; a.hidden = false; }
  for (const el of document.querySelectorAll('[data-store-soon]')) el.hidden = true;
}

// Remember an explicit language choice so the English root page stops redirecting to the browser language.
for (const a of document.querySelectorAll('a[hreflang]')) {
  a.addEventListener('click', () => {
    try { localStorage.setItem('lang', a.hreflang); } catch { /* storage blocked: the choice just isn't remembered */ }
  });
}

// Close the language menu when clicking elsewhere.
const langMenu = document.querySelector('.lang');
document.addEventListener('click', e => {
  if (langMenu?.open && !langMenu.contains(e.target)) langMenu.open = false;
});

// Levels demo: each folder row has a level; the badge adds up counted folders, and the first notifying folder fills the notification.
const demo = document.querySelector('[data-demo]');
if (demo) {
  const rows = [...demo.querySelectorAll('[data-folder]')];
  const badges = [...document.querySelectorAll('[data-badge]')];
  const note = demo.querySelector('.note');
  const t = (key, vars = {}) => demo.dataset[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  let last = null;

  function update() {
    let total = 0;
    const notifying = [];
    for (const row of rows) {
      const level = row.querySelector('input:checked').value;
      row.dataset.level = level;
      if (level !== 'off') total += Number(row.dataset.n);
      if (level === 'notify') notifying.push(row);
    }
    for (const b of badges) {
      b.querySelector('b').textContent = total || '';
      if (last !== null && total !== last && total) {
        b.classList.remove('pop');
        void b.offsetWidth;
        b.classList.add('pop');
      }
    }
    last = total;
    demo.querySelector('[data-badge-caption]').textContent = total ? t('tBadge', { n: total }) : t('tBadgeNone');

    const first = notifying[0];
    note.classList.toggle('silent', !first);
    if (first) {
      note.querySelector('strong').textContent = first.dataset.from;
      note.querySelector('.subject').textContent = first.dataset.subject;
      note.querySelector('small').textContent = t('tContext', { folder: first.dataset.name });
    }
    demo.querySelector('[data-note-caption]').textContent = first
      ? t('tNote', { folders: notifying.map(r => r.dataset.name).join(demo.dataset.sep) })
      : t('tNoteNone');
  }

  demo.addEventListener('change', update);
  update();
}
