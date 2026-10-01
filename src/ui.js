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

  // Chrome's puzzle-piece and pin icons (Material Icons), so the steps match what the user sees on the toolbar.
  const PUZZLE = 'M20.5 11H19V7c0-1.1-.9-2-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4c-1.1 0-2 .9-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20c0 1.1.9 2 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17c1.1 0 2-.9 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z';
  const PIN = 'M16 9V4h1a1 1 0 0 0 0-2H7a1 1 0 0 0 0 2h1v5a3 3 0 0 1-3 3v2h5.97v7l1 1 1-1v-7H19v-2a3 3 0 0 1-3-3z';
  function glyph(d, cls) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    svg.append(path);
    return svg;
  }

  // Chrome puts a newly installed extension in the puzzle-piece menu and offers no way for it to pin itself,
  // so both pages show how to pin it until the icon is on the toolbar or the user hides the tip.
  const PIN_HINT_HIDDEN = 'pinHintHidden';
  function pinHint() {
    const node = h('div', { class: 'pin-hint', role: 'note', hidden: true },
      glyph(PIN, 'pin-hint-icon'),
      h('div', { class: 'pin-hint-text' },
        h('strong', { text: I18n.t('pinHintTitle') }),
        h('span', {}, I18n.parts('pinHintSteps', glyph(PUZZLE, 'key-glyph'), glyph(PIN, 'key-glyph')))),
      h('button', {
        class: 'link-btn pin-hint-hide', type: 'button', text: I18n.t('pinHintHide'),
        onclick: () => { node.hidden = true; chrome.storage.local.set({ [PIN_HINT_HIDDEN]: true }); }
      }));
    const update = async () => {
      const [{ isOnToolbar }, { [PIN_HINT_HIDDEN]: hidden }] = await Promise.all([
        chrome.action.getUserSettings(),
        chrome.storage.local.get(PIN_HINT_HIDDEN)
      ]);
      node.hidden = isOnToolbar || !!hidden;
    };
    // onUserSettingsChanged needs Chrome 130; older versions check again when the page comes back into view.
    chrome.action.onUserSettingsChanged?.addListener(() => update().catch(() => {}));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') update().catch(() => {});
    });
    update().catch(() => {});
    return node;
  }

  return { h, accountMark, pinHint, timeAgo: I18n.timeAgo };
})();
