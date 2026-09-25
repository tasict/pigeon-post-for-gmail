// Offscreen document: an MV3 service worker cannot play audio, so this hidden page plays the notification sounds.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.type !== 'play') return false;
  Sounds.playQueue(msg.queue || [], msg.volume).then(() => sendResponse({ ok: true }), e => sendResponse({ ok: false, error: String(e) }));
  return true;
});
