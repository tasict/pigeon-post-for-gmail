// Builds the project site pages (site/<lang>/index.html and privacy.html) from scripts/site_text.json and _locales.
// Usage: node scripts/build_site.js
// Page copy lives in site_text.json; UI terms (levels, folder names, "Mark as read"…) come from the extension's own _locales,
// so the site always uses the same words as the extension. Shared CSS/JS and images are in site/assets/ and are edited directly.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const { text: T, samples: SAMPLES } = JSON.parse(fs.readFileSync(path.join(__dirname, 'site_text.json'), 'utf8'));

const BASE = 'https://tasict.github.io/pigeon-post-for-gmail/';
const REPO = 'https://github.com/tasict/pigeon-post-for-gmail';
const PRIVACY = `${REPO}/blob/master/PRIVACY.md`;
const RAW_PRIVACY = 'https://raw.githubusercontent.com/tasict/pigeon-post-for-gmail/master/PRIVACY.md';
const PAYPAL = 'https://paypal.me/tasict';
// Which top-level section of PRIVACY.md each page shows (0 = English, 1 = 繁體中文), and the link to the other one.
const POLICY_SECTION = { 'zh-TW': '1', 'zh-CN': '1' };
const POLICY_OTHER = { en: ['繁體中文', '1'], 'zh-TW': ['English', '0'], 'zh-CN': ['English', '0'] };

// [hreflang, directory, html lang, native name, og locale, _locales folder]
const LANGS = [
  ['en', '', 'en', 'English', 'en_US', 'en'],
  ['zh-TW', 'zh-TW/', 'zh-Hant-TW', '繁體中文', 'zh_TW', 'zh_TW'],
  ['zh-CN', 'zh-CN/', 'zh-Hans-CN', '简体中文', 'zh_CN', 'zh_CN'],
  ['ja', 'ja/', 'ja', '日本語', 'ja_JP', 'ja'],
  ['ko', 'ko/', 'ko', '한국어', 'ko_KR', 'ko'],
  ['es', 'es/', 'es', 'Español', 'es_ES', 'es'],
  ['fr', 'fr/', 'fr', 'Français', 'fr_FR', 'fr'],
  ['de', 'de/', 'de', 'Deutsch', 'de_DE', 'de']
];

const GLOBE = '<svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="10" cy="10" r="7.5"/><path d="M2.5 10h15M10 2.5c2.2 2.3 3.2 4.8 3.2 7.5s-1 5.2-3.2 7.5c-2.2-2.3-3.2-4.8-3.2-7.5s1-5.2 3.2-7.5z"/></svg>';

// Root pages only: send first-time visitors to their browser language; an explicit choice (saved by site.js) wins.
const REDIRECT = `<script>
try {
  if (!localStorage.getItem('lang')) {
    const pick = tag => {
      const t = tag.toLowerCase();
      if (/^zh-(tw|hk|mo)|^zh-hant/.test(t)) return 'zh-TW';
      if (t.startsWith('zh')) return 'zh-CN';
      return ['ja', 'ko', 'es', 'fr', 'de', 'en'].find(l => t.startsWith(l));
    };
    const lang = (navigator.languages || [navigator.language]).map(pick).find(Boolean);
    if (lang && lang !== 'en') location.replace(lang + '/FILE' + location.search + location.hash);
  }
} catch { /* storage blocked: stay on English */ }
</script>`;

const CURRENT = ' aria-current="page"';
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' };
const e = s => String(s).replace(/[&<>"']/g, c => ESC[c]);

function msgs(folder) {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', folder, 'messages.json'), 'utf8'));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, v.message]));
}

function page([code, d, htmlLang, native, og, folder], kind) {
  const t = T[code];
  const f = kind === 'home' ? '' : 'privacy.html';
  const title = kind === 'home' ? t.title : `${t.privacy} | Pigeon Post for Gmail`;
  const m = msgs(folder);
  const up = d ? '../' : '';
  const a = `${up}assets/`;
  const ctx = m.contextLine.replace('$1', t.acct).replace('$2', '{folder}');
  const inboxCtx = ctx.replace('{folder}', m.folder_inbox);
  const workCtx = m.contextLine.replace('$1', t.work).replace('$2', m.folder_primary);
  const s = SAMPLES[code];
  const levels = [['off', m.level_off], ['count', m.level_count], ['notify', m.level_notify]];
  // [id, name, hint, unread count, sample message, starting level]
  const folders = [
    ['inbox', m.folder_inbox, m.folderHint_inbox, 3, s[0], 'notify'],
    ['starred', m.folder_starred, m.folderHint_starred, 1, s[1], 'count'],
    ['label', t.label_name, t.label_hint, 2, s[2], 'off']
  ];

  const row = ([fid, name, hint, n, sample, level]) => {
    const radios = levels.map(([v, txt]) =>
      `<label><input type="radio" name="lv-${fid}" value="${v}"${v === level ? ' checked' : ''}><span>${e(txt)}</span></label>`).join('');
    return `<div class="folder" data-folder="${fid}" data-level="${level}" data-n="${n}" data-name="${e(name)}" ` +
      `data-from="${e(sample[0])}" data-subject="${e(sample[1])}">` +
      `<div class="folder-name"><strong>${e(name)}</strong><small>${e(hint)}</small></div>` +
      `<span class="n">${n}</span>` +
      `<fieldset class="seg"><legend>${e(name)}</legend>${radios}</fieldset></div>`;
  };

  const alts = LANGS.map(([c, dd]) => `<link rel="alternate" hreflang="${c}" href="${BASE}${dd}${f}">`).join('\n');
  const menu = LANGS.map(([c, dd, hl, nm]) =>
    `<li><a href="${up}${dd}${f}" hreflang="${c}" lang="${hl}"${c === code ? CURRENT : ''}>${e(nm)}</a></li>`).join('');
  const points = items => items.map(([h, p]) => `<li><h3>${e(h)}</h3><p>${e(p)}</p></li>`).join('');
  const facts = t.facts.map(([h, p]) => `<div><h3>${e(h)}</h3><p>${e(p)}</p></div>`).join('');
  const steps = t.steps.map(([h, p]) => `<li><h3>${e(h)}</h3><p>${e(p)}</p></li>`).join('');
  const note = (from, subject, context) =>
    `<div class="note"><img src="${a}icon128.png" alt=""><strong>${e(from)}</strong><span class="subject">${e(subject)}</span><small>${e(context)}</small><span class="act">${e(m.markRead)}</span></div>`;
  const storeButton = `<a class="btn" data-store hidden><img src="${a}icon128.png" alt="" width="22" height="22">${e(t.cta)}</a>
      <span class="soon" data-store-soon>${e(t.soon)}</span>`;
  const desc = m.extDescription;

  let main;
  if (kind === 'home') {
    main = `<main>
<div class="wrap">
  <section class="envelope" aria-labelledby="hero-title">
    <div class="letter">
      <div class="hero-copy">
        <h1 id="hero-title">${e(t.h1)}</h1>
        <p class="lede">${e(t.lede)}</p>
        <div class="actions">
          ${storeButton.replace('\n      ', '\n          ')}
          <a href="${REPO}">${e(t.github)}</a>
        </div>
        <p class="fine">${e(t.fine)}</p>
      </div>
      <figure class="hero-shot"><img src="${a}popup-${folder}.png" width="390" height="560" alt="${e(t.popup_alt)}"></figure>
      <div class="stamp" data-badge aria-hidden="true"><div><img src="${a}icon128.png" alt=""><b>4</b></div></div>
    </div>
  </section>

  <section class="band" aria-labelledby="h-demo">
    <div class="intro">
      <h2 id="h-demo">${e(t.demo_h2)}</h2>
      <p>${e(t.demo_p)}</p>
    </div>
    <div class="demo" data-demo data-t-badge="${e(t.t_badge)}" data-t-badge-none="${e(t.t_badge_none)}"
      data-t-note="${e(t.t_note)}" data-t-note-none="${e(t.t_note_none)}" data-t-context="${e(ctx)}" data-sep="${e(t.sep)}">
      <div>
        <div class="folders">
          ${folders.map(row).join('')}
        </div>
        <ul class="legend">
          ${levels.map(([v]) => `<li><b>${e(m[`level_${v}`])}</b>${e(m[`levelDesc_${v}`])}</li>`).join('')}
        </ul>
      </div>
      <div class="preview" aria-live="polite">
        <h3>${e(m.previewHeading)}</h3>
        <div class="toolbar" aria-hidden="true"><i></i><i></i><i></i><span></span><span class="tb" data-badge><img src="${a}toolbar-badge32.png" alt=""><b>4</b></span></div>
        <p class="caption" data-badge-caption></p>
        <div class="note" aria-hidden="true">
          <img src="${a}icon128.png" alt="">
          <strong>${e(s[0][0])}</strong>
          <span class="subject">${e(s[0][1])}</span>
          <small>${e(inboxCtx)}</small>
          <span class="act">${e(m.markRead)}</span>
        </div>
        <p class="caption" data-note-caption></p>
      </div>
    </div>
  </section>

  <section class="band" aria-labelledby="h-acct">
    <div class="split">
      <div class="shot"><img src="${a}popup-${folder}.png" width="390" height="560" alt="${e(t.popup_alt)}" loading="lazy"></div>
      <div>
        <div class="intro"><h2 id="h-acct">${e(t.acct_h2)}</h2><p>${e(t.acct_p)}</p></div>
        <ul class="points" style="margin-top:32px">${points(t.acct_pts)}</ul>
      </div>
    </div>
  </section>

  <section class="band" aria-labelledby="h-act">
    <div class="split">
      <div>
        <div class="intro"><h2 id="h-act">${e(t.act_h2)}</h2><p>${e(t.act_p)}</p></div>
        <ul class="points" style="margin-top:32px">${points(t.act_pts)}</ul>
      </div>
      <div class="notes" aria-hidden="true">
        ${note(t.work_from, t.work_subject, workCtx)}
        ${note(s[0][0], s[0][1], inboxCtx)}
      </div>
    </div>
  </section>

  <section class="band" aria-labelledby="h-priv">
    <div class="intro"><h2 id="h-priv">${e(t.priv_h2)}</h2><p>${e(t.priv_p)}</p></div>
    <div class="facts">${facts}</div>
    <p><a href="privacy.html">${e(t.priv_link)}</a></p>
  </section>

  <section class="band" aria-labelledby="h-start">
    <h2 id="h-start">${e(t.start_h2)}</h2>
    <ol class="steps">${steps}</ol>
    <div class="actions">
      ${storeButton}
    </div>
  </section>
</div>
</main>`;
  } else {
    const other = POLICY_OTHER[code];
    const noteText = t.policy_note ? `<p class="doc-note">${e(t.policy_note)}</p>` : '';
    const sw = other
      ? `<div class="wrap doc-foot"><p><a href="?section=${other[1]}">${e(t.policy_other.replace('{lang}', other[0]))}</a></p></div>`
      : '';
    main = `<main class="wrap doc">
  ${noteText}
  <article id="policy" data-md="${up}PRIVACY.md" data-fallback="${RAW_PRIVACY}" data-section="${POLICY_SECTION[code] ?? '0'}"
    data-error="${e(t.load_error)}" data-source="${PRIVACY}">
    <p class="doc-status">${e(t.loading)}</p>
  </article>
  <noscript><p><a href="${PRIVACY}">${e(t.priv_link)}</a></p></noscript>
</main>
${sw}`;
  }

  return `<!doctype html>
<html lang="${htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${e(title)}</title>
<meta name="description" content="${e(desc)}">
<link rel="canonical" href="${BASE}${d}${f}">
${alts}
<link rel="alternate" hreflang="x-default" href="${BASE}${f}">
<meta property="og:type" content="website">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(desc)}">
<meta property="og:url" content="${BASE}${d}${f}">
<meta property="og:image" content="${BASE}assets/og.png">
<meta property="og:locale" content="${og}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#f3f5f9">
<link rel="icon" href="${a}icon32.png" type="image/png">
<link rel="apple-touch-icon" href="${a}icon128.png">
<link rel="stylesheet" href="${a}site.css">
${d ? '' : REDIRECT.replace('FILE', f)}</head>
<body>
<header class="wrap masthead">
  <a class="wordmark" href="./"><img src="${a}icon128.png" alt="" width="30" height="30">Pigeon Post</a>
  <a href="${REPO}">${e(t.source)}</a>
  <details class="lang">
    <summary aria-label="${e(t.lang_menu)}">${GLOBE}${e(native)}</summary>
    <ul>${menu}</ul>
  </details>
</header>

${main}

<footer>
  <div class="wrap">
    <div class="foot">
      <div>
        <p>${e(t.made)} ${e(t.coffee)}</p>
        <ul>
          <li><a href="${PAYPAL}">${e(t.paypal)}</a></li>
          <li><a href="privacy.html">${e(t.privacy)}</a></li>
          <li><a href="${REPO}">${e(t.source)}</a></li>
          <li><a href="${REPO}/issues">${e(t.issues)}</a></li>
        </ul>
      </div>
      <ul class="langs">${menu}</ul>
    </div>
    <p class="tm">${e(t.tm)}</p>
  </div>
</footer>
<script src="${a}site.js"></script>${kind === 'home' ? '' : `<script src="${a}markdown.js"></script>`}
</body>
</html>
`;
}

for (const lang of LANGS) {
  for (const [kind, name] of [['home', 'index.html'], ['privacy', 'privacy.html']]) {
    const file = path.join(ROOT, 'site', lang[1], name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, page(lang, kind));
    console.log('wrote', path.relative(ROOT, file));
  }
}
