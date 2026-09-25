// Privacy page: loads PRIVACY.md and renders it in the browser.
// A small renderer for the Markdown the policy uses (headings, paragraphs, lists, tables, rules, bold, italics, code, links).
// Everything is built with DOM nodes and textContent, so the file's text is never parsed as HTML.
(() => {
  const root = document.getElementById('policy');
  if (!root) return;

  const el = (tag, ...children) => {
    const node = document.createElement(tag);
    node.append(...children);
    return node;
  };

  // Only web and mail links; anything else is shown as plain text.
  function safeHref(url) {
    try {
      const u = new URL(url, location.href);
      return ['https:', 'http:', 'mailto:'].includes(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  }

  const INLINE = /`([^`]+)`|\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])/g;

  function inline(text) {
    const out = [];
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] != null) out.push(el('code', m[1]));
      else if (m[2] != null) out.push(el('strong', ...inline(m[2])));
      else if (m[3] != null) {
        const href = safeHref(m[4]);
        if (href) {
          const a = el('a', ...inline(m[3]));
          a.href = href;
          out.push(a);
        } else out.push(...inline(m[3]));
      } else out.push(el('em', ...inline(m[5])));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const isBlockStart = line => /^(#{1,6}\s|[-*]\s|\d+\.\s|>|\||-{3,}\s*$)/.test(line);

  function render(md) {
    const lines = md.replace(/\r\n?/g, '\n').split('\n');
    const frag = document.createDocumentFragment();
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }

      let m;
      if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
        frag.append(el(`h${m[1].length}`, ...inline(m[2].trim())));
        i++;
      } else if (/^-{3,}\s*$/.test(line)) {
        frag.append(el('hr'));
        i++;
      } else if (line.startsWith('|')) {
        const rows = [];
        while (i < lines.length && lines[i].startsWith('|')) rows.push(lines[i++]);
        const table = el('table');
        const [head, sep, ...body] = rows;
        if (sep && /^[\s|:-]+$/.test(sep)) {
          table.append(el('thead', el('tr', ...cells(head).map(c => el('th', ...inline(c))))));
        } else body.unshift(...[head, sep].filter(Boolean));
        table.append(el('tbody', ...body.map(r => el('tr', ...cells(r).map(c => el('td', ...inline(c)))))));
        frag.append(el('div', table));
        frag.lastChild.className = 'table';
      } else if (/^([-*]|\d+\.)\s/.test(line)) {
        const ordered = /^\d/.test(line);
        const list = el(ordered ? 'ol' : 'ul');
        const item = ordered ? /^\d+\.\s+(.*)$/ : /^[-*]\s+(.*)$/;
        while (i < lines.length && item.test(lines[i])) {
          let text = lines[i++].match(item)[1];
          // Indented lines continue the same item.
          while (i < lines.length && /^\s{2,}\S/.test(lines[i])) text += ' ' + lines[i++].trim();
          list.append(el('li', ...inline(text)));
        }
        frag.append(list);
      } else if (line.startsWith('>')) {
        const quote = [];
        while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
        frag.append(el('blockquote', ...render(quote.join('\n')).childNodes));
      } else {
        const para = [];
        while (i < lines.length && lines[i].trim() && !isBlockStart(lines[i])) para.push(lines[i++].trim());
        frag.append(el('p', ...inline(para.join(' '))));
      }
    }
    return frag;
  }

  // PRIVACY.md holds one top-level section per language, separated by "# " headings.
  function sections(md) {
    const parts = md.split(/\n(?=# )/).map(s => s.replace(/\n-{3,}\s*$/, '').trim()).filter(Boolean);
    return parts.length ? parts : [md];
  }

  async function load(url) {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  (async () => {
    let md;
    try {
      md = await load(root.dataset.md);
    } catch {
      try {
        md = await load(root.dataset.fallback);
      } catch {
        const a = el('a', root.dataset.error);
        a.href = root.dataset.source;
        root.replaceChildren(el('p', a));
        return;
      }
    }
    const all = sections(md);
    const asked = new URLSearchParams(location.search).get('section');
    const index = Math.min(Number(asked ?? root.dataset.section) || 0, all.length - 1);
    root.replaceChildren(render(all[index]));
    // The link to the other language version is pointless when it leads back here.
    for (const a of document.querySelectorAll('a[href^="?section="]')) {
      if (Number(new URL(a.href).searchParams.get('section')) === index) a.closest('p').hidden = true;
    }
    const h1 = root.querySelector('h1');
    if (h1) document.title = h1.textContent.includes('Pigeon Post') ? h1.textContent : `${h1.textContent} | Pigeon Post for Gmail`;
  })();
})();
