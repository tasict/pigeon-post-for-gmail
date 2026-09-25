// Content script: while Gmail is open, reads label names from the left-hand menu so the settings page can list them.
// Only label names are read, never message content. Requires label-scan.js to be loaded first.
(() => {
  let lastSig = '';
  let lastRun = 0;
  let timer = null;

  // After the extension reloads, this script in old tabs is orphaned and must stop.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  async function run() {
    timer = null;
    lastRun = Date.now();
    if (!alive()) return observer.disconnect();
    const result = scanGmailLabels();
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

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  schedule();
})();
