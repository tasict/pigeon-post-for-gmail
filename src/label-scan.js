// Reads label names from Gmail's left-hand menu.
// The settings page injects scanGmailLabels into Gmail tabs with chrome.scripting, so it must be self-contained.
function scanGmailLabels() {
  const names = new Set();
  // Label links look like #label/<name>, with spaces as + and slashes as %2F; a further / is followed by a message id.
  for (const a of document.querySelectorAll('a[href*="#label/"]')) {
    const href = a.getAttribute('href') || '';
    const raw = href.slice(href.indexOf('#label/') + 7).split('/')[0];
    if (!raw) continue;
    try {
      names.add(decodeURIComponent(raw.replace(/\+/g, ' ')));
    } catch { /* ignore links that cannot be decoded */ }
  }
  const emailRe = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
  let email = (document.title.match(emailRe) || [])[0] || '';
  if (!email) {
    // Before the title loads, look for the email in the label of the Google Account button in the top right.
    for (const el of document.querySelectorAll('[aria-label*="@"]')) {
      const m = (el.getAttribute('aria-label') || '').match(emailRe);
      if (m) { email = m[0]; break; }
    }
  }
  const m = location.pathname.match(/\/mail\/u\/(\d+)/);
  return {
    index: m ? Number(m[1]) : 0,
    email: email.toLowerCase(),
    labels: [...names].sort(),
    // Whether Gmail's left-hand menu has rendered yet; if not, the page is still loading.
    navReady: !!document.querySelector('[role="navigation"] a[href*="#"]')
  };
}

// Merges scanned labels into chrome.storage.local. Without an email they are kept under #index, which the settings page maps back to a mailbox.
// Labels not seen for 30 days are treated as deleted.
async function saveScannedLabels(result) {
  if (!result || !result.labels.length) return false;
  const key = result.email || `#${result.index}`;
  const now = Date.now();
  const { gmailLabels = {} } = await chrome.storage.local.get('gmailLabels');
  const entry = gmailLabels[key] ?? { labels: {} };
  for (const n of result.labels) entry.labels[n] = now;
  for (const [n, t] of Object.entries(entry.labels)) if (now - t > 30 * 24 * 3600 * 1000) delete entry.labels[n];
  entry.updated = now;
  entry.index = result.index;
  gmailLabels[key] = entry;
  await chrome.storage.local.set({ gmailLabels });
  return true;
}
