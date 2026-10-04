# Changelog

## Unreleased

### Added

- A "Mailbox icon" setting: show each mailbox with its first letter on the mailbox color, as before, or with its Google Account photo. The photo is read from the account button in Gmail and kept only on this computer. Until a mailbox's photo has been read, it keeps its first letter, and the settings page offers to read the missing photos from Gmail.

## 0.6.1 — 2026-10-04

### Added

- While Gmail is being reconnected in a background tab, the mailbox header in the popup shows "Reconnecting" with a small plug that keeps plugging in. Hover over it to see why a Gmail tab opened.

### Changed

- "Mark as read" and "Mark all as read" fail less often. If a Gmail tab for that account is open, the action is sent from it, the same way Gmail sends its own. If the action still fails, for example because Gmail asks you to verify again or you have not opened Gmail for a while, Pigeon Post opens Gmail in a background tab to renew your session, tries once more and closes the tab a few seconds later.

## 0.6.0 — 2026-10-01

### Added

- A tip on the settings page and in the popup that shows how to pin Pigeon Post to the Chrome toolbar. It goes away once the icon is pinned, or when you choose "Hide".

### Changed

- When Gmail asks you to verify again before marking mail as read, the popup now shows a notice on that mailbox, naming the account, with a button that opens the verification page. Before, a short warning at the top did not say which mailbox needed it and disappeared on the next refresh. The notification sent after a failed "Mark as read" names the account too.
- The result shown after marking a whole mailbox as read now fades out on its own after a few seconds. It waits while the pointer or keyboard focus is on it.

## 0.5.0 — 2026-09-26

### Added

- Six new notification sounds: Pop, Harp, Glass, Knock, Pigeon coo and Sparkle.
- The website's "Add to Chrome" button now links to the [Chrome Web Store listing](https://chromewebstore.google.com/detail/pigeon-post-for-gmail/adflaplgialinhjpiiggopbhebjjiddd).

### Removed

- Uploading your own sound file. Mailboxes that used one now play the default Two-tone sound, and uploaded files are deleted from this computer when the extension updates.

### Notes

- Every sound is synthesized in the browser with Web Audio. The extension bundles no audio files, samples or recordings.
- Privacy policy updated: the extension no longer stores sound files.

## 0.4.1 — 2026-09-25

- First public release.
