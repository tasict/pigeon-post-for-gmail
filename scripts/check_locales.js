// Checks every locale's messages.json for missing keys and matching placeholders. Usage: node scripts/check_locales.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const src = path.join(ROOT, 'src');
const used = new Set(), plural = new Set();
for (const f of fs.readdirSync(src)) {
  const s = fs.readFileSync(path.join(src, f), 'utf8');
  for (const m of s.matchAll(/(?:\bt|I18n\.t|I18n\.parts)\(\s*'([\w]+)'/g)) used.add(m[1]);
  for (const m of s.matchAll(/\btn\(\s*'([\w]+)'/g)) plural.add(m[1]);
  for (const m of s.matchAll(/data-i18n="([\w]+)"/g)) used.add(m[1]);
  for (const m of s.matchAll(/data-i18n-attr="([^"]+)"/g)) for (const p of m[1].split(';')) used.add(p.split(':')[1].trim());
}
['inbox','primary','social','promo','updates','forums','starred','important','unread'].forEach(id => used.add(`folder_${id}`));
['inbox','starred','important','unread'].forEach(id => used.add(`folderHint_${id}`));
['teal','violet','magenta','olive','cocoa','slate'].forEach(id => used.add(`color_${id}`));
['chime','ding','drop','marimba','bell','tick','none','custom'].forEach(id => used.add(`sound_${id}`));
['off','count','notify'].forEach(id => used.add(`level_${id}`));
['langTag','listSeparator','quoted','justNow','extName','extDescription'].forEach(k => used.add(k));
used.delete('key');
const need = [...used, ...[...plural].map(k => `${k}_other`)];
const en = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales/en/messages.json')));
let bad = 0;
for (const loc of fs.readdirSync(path.join(ROOT, '_locales'))) {
  const msgs = JSON.parse(fs.readFileSync(path.join(ROOT, '_locales', loc, 'messages.json')));
  const missing = need.filter(k => !msgs[k]);
  const extra = Object.keys(msgs).filter(k => !need.includes(k) && !/_(one|two|few|many|zero)$/.test(k));
  // Placeholders: every locale must use the $N that en uses.
  const params = Object.keys(msgs).filter(k => {
    const base = en[k] || en[k.replace(/_(one|two|few|many|zero)$/, '_other')];
    if (!base) return false;
    const want = new Set(base.message.match(/\$\d/g) || []);
    const have = new Set(msgs[k].message.match(/\$\d/g) || []);
    return [...want].some(p => !have.has(p) && !(k.match(/_(one|zero|two)$/) && p === '$1'));
  });
  // Chrome parses $name$ as a named placeholder, and adjacent $1$2 makes the extension fail to load.
  const named = Object.keys(msgs).filter(k => /\$[a-z0-9_@]+\$/i.test(msgs[k].message));
  if (named.length) console.log('  NAMED-PLACEHOLDER', named);
  if (missing.length || extra.length || params.length || named.length) bad++;
  console.log(loc, Object.keys(msgs).length, 'keys', missing.length ? `MISSING ${missing}` : '', extra.length ? `EXTRA ${extra}` : '', params.length ? `PARAMS ${params}` : '');
}
process.exit(bad ? 1 : 0);
