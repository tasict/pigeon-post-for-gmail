// Small helpers shared by the popup and the settings page.
const UI = (() => {
  // h('div', { class: 'row', dataset: { key } , onclick }, child, 'text', [more])
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (k in node && typeof v !== 'string') node[k] = v;
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children.flat(Infinity)) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  }

  // Mailbox mark. id comes from Settings.identities().
  function accountMark(id, size = '') {
    return h('span', { class: `acct-mark ${size}`.trim(), dataset: { acct: id.color }, 'aria-hidden': 'true', text: id.initial });
  }

  return { h, accountMark, timeAgo: I18n.timeAgo };
})();
