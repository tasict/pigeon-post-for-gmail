// Gmail Atom feed parser.
// Service workers have no DOMParser; the feed is small and fixed in shape, so plain string matching is enough.
// The feed lists only unread mail, at most about 20 entries; <fullcount> holds the real unread total.
const FeedParser = (() => {
  const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

  function decode(s) {
    return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
      if (g[0] === '#') {
        const code = g[1].toLowerCase() === 'x' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10);
        return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
      }
      return NAMED[g.toLowerCase()] ?? m;
    });
  }

  function tag(xml, name) {
    const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i');
    const m = xml.match(re);
    return m ? decode(m[1].trim()) : '';
  }

  function parse(xml) {
    const head = xml.split(/<entry[\s>]/i)[0];
    const title = tag(head, 'title');
    const fullcount = parseInt(tag(head, 'fullcount'), 10) || 0;
    const accountMatch = title.match(/for\s+(\S+@\S+)\s*$/);
    const entries = [];
    const re = /<entry[\s>][\s\S]*?<\/entry>/gi;
    let m;
    while ((m = re.exec(xml))) {
      const e = m[0];
      const link = e.match(/<link\b[^>]*\bhref="([^"]*)"/i);
      entries.push({
        id: tag(e, 'id'),
        title: tag(e, 'title'),
        summary: tag(e, 'summary'),
        link: link ? decode(link[1]) : '',
        modified: tag(e, 'modified'),
        issued: tag(e, 'issued'),
        authorName: tag(e, 'name'),
        authorEmail: tag(e, 'email')
      });
    }
    return { title, email: accountMatch ? accountMatch[1].toLowerCase() : '', fullcount, entries };
  }

  return { parse };
})();
