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

  // Marketing mail pads its preview text with characters that take up space but show nothing
  // (non-breaking and zero-width spaces, soft hyphens, combining grapheme joiners), which leaves a blank line ending in "…".
  // Collapse any run of them that contains a space into one space, and drop a summary made of nothing else.
  // Runs without a space are kept, so emoji sequences (ZWJ) and words that use ZWNJ stay intact. Bidi marks are left alone.
  const FILLER = '\\u00ad\\u034f\\u115f\\u1160\\u17b4\\u17b5\\u180e\\u200b-\\u200d\\u2060-\\u2064\\u3164\\uffa0';
  const PADDING = new RegExp(`[\\s${FILLER}]*\\s[\\s${FILLER}]*`, 'g');
  const BLANK = new RegExp(`^[\\s${FILLER}]*$`);
  function tidy(s) {
    return BLANK.test(s) ? '' : s.replace(PADDING, ' ').trim();
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
        summary: tidy(tag(e, 'summary')),
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
