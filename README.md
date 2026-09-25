# Pigeon Post for Gmail

A Chrome extension that shows unread counts and desktop notifications for the Gmail accounts you are already signed in to in Chrome. It needs no OAuth, no Google Cloud project and no server.

## Features

- **Works with your Chrome login**: detects every Gmail account signed in to in Chrome (`/mail/u/0`, `/u/1`, …).
- **Per-folder control**: each inbox, inbox tab, system folder or label is set to *Off*, *Count* (included in the badge number) or *Notify* (counted and shows a desktop notification).
- **Labels read from Gmail**: the settings page lists your real Gmail labels, so you never type label names by hand.
- **Live preview**: the settings page shows the badge and a sample notification built from your real mail as you change settings.
- **Tell accounts apart**: each mailbox gets its own name, color and sound, with an optional per-account badge (e.g. `26/2`).
- **Mark as read** from the popup or directly from a notification, or clear a whole mailbox at once.
- **Settings sync** across computers through Chrome Sync.
- Available in English, 繁體中文, 简体中文, 日本語, 한국어, Español, Français and Deutsch.

## Privacy

Everything runs locally in your browser. The extension talks only to `mail.google.com`, has no server, and sends nothing to the developer or any third party. Message subjects and snippets are kept in memory only. See [PRIVACY.md](PRIVACY.md).

## Install

- **Chrome Web Store**: coming soon.
- **From source**:
  1. Run `scripts/pack.sh` to copy the extension into `payload/`.
  2. Open `chrome://extensions`, turn on *Developer mode*, click *Load unpacked* and pick `payload/`.

## Development

Plain HTML/JS, Manifest V3, no build step and no dependencies.

| Task | Command |
|---|---|
| Sync files to `payload/` for *Load unpacked* | `scripts/pack.sh` |
| Build the Chrome Web Store zip (`dist/`) | `scripts/pack.sh --zip` |
| Check that all locales have every string | `node scripts/check_locales.js` |
| Regenerate icons | `node scripts/gen_icons.js` |

After editing, run `scripts/pack.sh` again and click *Reload* on the extension card in `chrome://extensions`.

### How it works

- Unread mail comes from Gmail's Atom feed (`https://mail.google.com/mail/u/N/feed/atom[/label]`), fetched with the browser's existing Gmail cookies.
- "Mark as read" calls the same internal endpoint that the Gmail web app uses, with the `GMAIL_AT` cookie as the action token. This interface is undocumented and may break if Gmail changes.

## Support

If you find it useful, I'd love it if you bought me a coffee: **[PayPal.Me/tasict](https://paypal.me/tasict)**

## License

[GPL-3.0](LICENSE). The name "Pigeon Post" and the icon are not covered by the license. Please use a different name and icon if you publish a fork.

Gmail is a trademark of Google LLC. This project is not affiliated with or endorsed by Google.
