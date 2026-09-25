// Localized UI text. Strings live in _locales/<lang>/messages.json; this module handles lookup, plurals, lists and time formats.
// Shared by the background (importScripts), popup and settings page; it must load first.
const I18n = (() => {
  // Use the language of the strings actually in use (English when the browser language has no translation), so dates and numbers match.
  const lang = chrome.i18n.getMessage('langTag') || 'en';
  const plural = new Intl.PluralRules(lang);

  // t('key', a, b) substitutes $1, $2. A missing string returns the key, which makes missing translations easy to spot.
  function t(key, ...subs) {
    return chrome.i18n.getMessage(key, subs.map(String)) || key;
  }

  // Picks the string for a count: key_one, key_few… falling back to key_other. The count is always $1.
  function tn(key, n, ...subs) {
    const args = [String(n), ...subs.map(String)];
    return chrome.i18n.getMessage(`${key}_${plural.select(n)}`, args) || chrome.i18n.getMessage(`${key}_other`, args) || key;
  }

  const list = items => items.join(t('listSeparator'));
  const quote = text => t('quoted', text);

  // For strings that embed DOM nodes (e.g. a bold email): returns an array of strings and nodes.
  function parts(key, ...nodes) {
    const marks = nodes.map((_, i) => `\uE000${i}\uE001`);
    return t(key, ...marks).split(/(\uE000\d+\uE001)/).filter(Boolean)
      .map(s => (/^\uE000\d+\uE001$/.test(s) ? nodes[Number(s.slice(1, -1))] : s));
  }

  const relative = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  function timeAgo(when) {
    const ms = typeof when === 'number' ? when : new Date(when).getTime();
    if (!ms) return '';
    const m = Math.floor(Math.max(0, Date.now() - ms) / 60000);
    if (m < 1) return t('justNow');
    if (m < 60) return relative.format(-m, 'minute');
    const hr = Math.floor(m / 60);
    if (hr < 24) return relative.format(-hr, 'hour');
    const d = Math.floor(hr / 24);
    if (d < 7) return relative.format(-d, 'day');
    return new Date(ms).toLocaleDateString(lang);
  }

  // Poll interval, e.g. 30 seconds, 1 minute, 15 minutes.
  function duration(seconds) {
    const [value, unit] = seconds < 60 ? [seconds, 'second'] : [seconds / 60, 'minute'];
    return new Intl.NumberFormat(lang, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
  }

  // Applies to HTML: data-i18n sets the text, data-i18n-args supplies "|"-separated arguments,
  // data-i18n-attr="title:key;aria-label:key" sets attributes.
  function apply(root = document) {
    if (root === document) document.documentElement.lang = lang;
    for (const el of root.querySelectorAll('[data-i18n]')) {
      el.textContent = t(el.dataset.i18n, ...(el.dataset.i18nArgs?.split('|') ?? []));
    }
    for (const el of root.querySelectorAll('[data-i18n-attr]')) {
      for (const pair of el.dataset.i18nAttr.split(';')) {
        const [attr, key] = pair.split(':').map(s => s.trim());
        if (attr && key) el.setAttribute(attr, t(key));
      }
    }
  }

  return { lang, t, tn, list, quote, parts, timeAgo, duration, apply };
})();
