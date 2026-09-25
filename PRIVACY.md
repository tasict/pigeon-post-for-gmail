# Privacy Policy — Pigeon Post for Gmail

Last updated: 2026-09-24

Pigeon Post for Gmail ("the extension") shows unread counts and desktop notifications for the Gmail accounts you are already signed in to in Chrome. This policy explains what data the extension handles and what it does with it.

## Summary

- The extension has **no server**. It does not send any data to the developer or to any third party.
- It talks only to `https://mail.google.com`, using the Gmail session you already have in Chrome.
- There are no analytics, no ads, no tracking and no remote code.

## Data the extension handles

| Data | Why | Where it is kept |
|---|---|---|
| Email addresses of your signed-in Gmail accounts | To tell your accounts apart and store per-account settings | `chrome.storage.sync` (your Chrome profile) |
| Sender, subject and snippet of **unread** messages (from Gmail's Atom feed) | To show them in the popup and in notifications | `chrome.storage.session`: kept in memory only, never written to disk, cleared when the browser closes |
| Message IDs of messages already notified | So you are not notified twice for the same message | `chrome.storage.local` (your computer) |
| Gmail label names (read from Gmail's left-hand menu) | To let you pick labels in the settings page | `chrome.storage.local` (your computer) |
| Gmail's `GMAIL_AT` cookie | Used as the action token when you click "Mark as read". It is read at the moment of the action and sent only to `mail.google.com` | Not stored |
| Your settings (which folders to watch, colors, sounds, volume) | To remember your preferences | `chrome.storage.sync` |
| Custom notification sounds you upload | To play them | `chrome.storage.local` (your computer only; not synced) |

The extension never reads the full body of your messages, and it never sends, deletes or modifies messages. The one exception is marking them as read when you ask it to.

`chrome.storage.sync` is synced by Chrome to your Google account if you have Chrome Sync turned on. Google handles that sync, not the developer.

## Sharing

The extension does not sell, transfer or share any user data. The developer cannot see your data.

## Permissions

| Permission | Use |
|---|---|
| `https://mail.google.com/*` | Read Gmail's unread-mail Atom feed; mark messages as read on request |
| `alarms` | Check for new mail periodically |
| `notifications` | Show desktop notifications |
| `storage` | Store settings and state described above |
| `cookies` | Read Gmail's action token (`GMAIL_AT`) for "Mark as read" |
| `scripting` | Read label names from an open Gmail tab for the settings page |
| `offscreen` | Play notification sounds (a background service worker cannot play audio) |
| `webRequest`, `webRequestAuthProvider` | Stop Chrome from showing a username/password prompt when the extension checks an account that is not signed in |

## Removing your data

Uninstalling the extension removes all data it stored on your computer.

## Contact

Questions about this policy: tasict@gmail.com

---

# 隱私權政策（繁體中文）

最後更新：2026-09-24

Pigeon Post for Gmail（下稱「本擴充功能」）使用你在 Chrome 中已登入的 Gmail 帳號，顯示未讀數與桌面通知。

- 本擴充功能**沒有伺服器**，不會把任何資料傳給開發者或任何第三方。
- 只與 `https://mail.google.com` 連線，使用你在 Chrome 中已有的 Gmail 登入狀態。
- 沒有分析、沒有廣告、沒有追蹤，也不載入遠端程式碼。

處理的資料：

- **已登入帳號的 email 地址**：用來區分信箱並儲存各信箱的設定。
- **未讀郵件的寄件者、主旨與摘要**：用來顯示清單與通知，只存在記憶體（`chrome.storage.session`），關閉瀏覽器即清除。
- **已通知過的郵件 ID**：避免重複通知。
- **Gmail 標籤名稱**：供設定頁選擇。
- **Gmail 的 `GMAIL_AT` cookie**：在你按「標為已讀」時當作操作權杖，只送往 `mail.google.com`，不另外儲存。
- **你的設定與自訂音效**：存在你的 Chrome 設定檔。

本擴充功能不讀取郵件全文。除了在你要求時把郵件標為已讀，不會寄出、刪除或修改任何郵件。
不出售、不轉移、不分享任何使用者資料。移除本擴充功能即刪除它在本機儲存的所有資料。

聯絡：tasict@gmail.com
