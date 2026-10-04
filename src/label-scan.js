// Reads label names from Gmail's left-hand menu, and the account's profile photo from the Google Account button.
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
  email = email.toLowerCase();
  // The Google Account button in the top right is labelled with the email and holds the profile photo.
  // Look in the top bar first; class names there change too often to rely on.
  let avatar = '';
  for (const root of [document.querySelector('[role="banner"]'), document]) {
    if (!email || avatar || !root) continue;
    for (const el of root.querySelectorAll('[aria-label*="@"]')) {
      if (!(el.getAttribute('aria-label') || '').toLowerCase().includes(email)) continue;
      for (const img of el.matches('img') ? [el] : el.querySelectorAll('img')) {
        // srcset lists the same photo at 1x and 2x; the last candidate is the largest.
        const src = (img.getAttribute('srcset') || '').split(',').map(c => c.trim().split(/\s+/)[0]).filter(Boolean).pop() || img.src;
        try {
          const u = new URL(src, location.href);
          if (u.protocol === 'https:' && u.hostname.endsWith('.googleusercontent.com')) { avatar = u.href; break; }
        } catch { /* not a URL */ }
      }
      if (avatar) break;
    }
  }
  const m = location.pathname.match(/\/mail\/u\/(\d+)/);
  return {
    index: m ? Number(m[1]) : 0,
    email,
    avatar,
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

// Keeps the account's profile photo in chrome.storage.local as a data URL, so the extension's pages show it without loading it from Google.
// The photo is fetched again only when Gmail shows a different URL. Only Google's image servers are fetched, without cookies.
async function saveScannedAvatar(result) {
  const url = result?.avatar;
  if (!url || !result.email) return false;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || !u.hostname.endsWith('.googleusercontent.com')) return false;
  } catch {
    return false;
  }
  const { avatars = {} } = await chrome.storage.local.get('avatars');
  if (avatars[result.email]?.url === url) return false;
  // Gmail shows the photo at 32 or 64 pixels; ask for 96 so it stays sharp on the settings page, and fall back to the URL as shown.
  let blob = null;
  for (const candidate of new Set([url.replace(/=s\d+(?=-|$)/, '=s96'), url])) {
    try {
      const res = await fetch(candidate, { credentials: 'omit', referrerPolicy: 'no-referrer' });
      const b = res.ok ? await res.blob() : null;
      if (b && b.type.startsWith('image/') && b.size <= 200 * 1024) { blob = b; break; }
    } catch { /* try the next candidate */ }
  }
  if (!blob) return false;
  const src = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
  // Read again: a Gmail tab for another mailbox may have saved its photo in the meantime.
  const { avatars: latest = {} } = await chrome.storage.local.get('avatars');
  await chrome.storage.local.set({ avatars: { ...latest, [result.email]: { url, src, updated: Date.now() } } });
  return true;
}
