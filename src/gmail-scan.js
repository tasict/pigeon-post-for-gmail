// Content script: while Gmail is open, reads label names from the left-hand menu so the settings page can list them,
// and, when the photo icon is chosen, the account's profile photo. Message content is never read. Requires label-scan.js to be loaded first.
(() => {
  let lastSig = '';
  let lastAvatar = '';
  let wantAvatar = false;
  let lastRun = 0;
  let timer = null;

  // After the extension reloads, this script in old tabs is orphaned and must stop.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  async function run() {
    timer = null;
    lastRun = Date.now();
    if (!alive()) return observer.disconnect();
    const result = scanGmailLabels();
    const avatar = `${result.email}|${result.avatar}`;
    if (wantAvatar && result.avatar && avatar !== lastAvatar) {
      lastAvatar = avatar;
      saveScannedAvatar(result).catch(() => { lastAvatar = ''; });
    }
    const sig = `${result.email}|${result.index}|${result.labels.join('\n')}`;
    if (!result.labels.length || sig === lastSig) return;
    lastSig = sig;
    try {
      await saveScannedLabels(result);
    } catch {
      lastSig = '';
    }
  }

  // Gmail's DOM changes almost constantly, so throttle rather than debounce: at most one scan every 5 seconds, and it always runs.
  function schedule() {
    if (timer) return;
    timer = setTimeout(run, Math.max(1500, 5000 - (Date.now() - lastRun)));
  }

  // The photo is read only while the photo icon is chosen in settings.
  chrome.storage.sync.get({ markStyle: 'initial' }).then(s => { wantAvatar = s.markStyle === 'photo'; }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync' || !changes.markStyle || !alive()) return;
    wantAvatar = changes.markStyle.newValue === 'photo';
    lastAvatar = '';
    schedule();
  });

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
