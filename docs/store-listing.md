# Chrome Web Store 上架資料

送審時各欄位要填的內容。英文為主要語系，其他語系的名稱與簡述會自動取自 `_locales/*/messages.json`。

## Store listing

**Name**：Pigeon Post for Gmail（取自 `extName`）

**Summary**：取自 `extDescription`，上限 132 字元。

**Category**：Productivity → Communication

**Language**：English（其他語系的商店說明可在後台另外加）

### Description（English）

```
See new Gmail at a glance: unread counts on the toolbar and desktop notifications for the Gmail accounts you're already signed in to in Chrome. No extra login, no OAuth, no server.

YOU DECIDE WHAT MATTERS
Set each inbox, inbox tab (Primary, Social, Promotions…), Starred, Important or any of your labels to:
• Off – not checked
• Count – included in the toolbar number
• Notify – counted, with a desktop notification

Your labels are read from Gmail itself, so you pick them from a list instead of typing names. A live preview shows exactly what the badge and notifications will look like.

MULTIPLE ACCOUNTS, CLEARLY APART
Every mailbox gets its own name, color and notification sound. Show one total or a per-account badge like 26/2.

ACT WITHOUT OPENING GMAIL
Mark a message as read from the popup or straight from the notification, or clear a whole mailbox in one click.

PRIVATE BY DESIGN
• Runs entirely in your browser and talks only to mail.google.com
• No server, no analytics, no ads, no tracking
• Message subjects are kept in memory only
• Open source: https://github.com/tasict/pigeon-post-for-gmail

Available in English, 繁體中文, 简体中文, 日本語, 한국어, Español, Français, Deutsch.

SUPPORT
If you find it useful, I'd love it if you bought me a coffee: https://paypal.me/tasict

Gmail is a trademark of Google LLC. This extension is not affiliated with or endorsed by Google.
```

### Description（繁體中文）

```
一眼看到 Gmail 新信：工具列顯示未讀數，並為你在 Chrome 中已登入的 Gmail 帳號跳出桌面通知。不需另外登入、不需 OAuth、沒有伺服器。

由你決定哪些信重要
每個收件匣、分頁（主要、社交網路、促銷內容…）、已加星號、重要或任何標籤，都能設為：
• 關：不檢查
• 計數：算進工具列的數字
• 通知：計數並跳出桌面通知

標籤直接從 Gmail 讀取，用選的就好，不必手動輸入名稱。即時預覽讓你看到徽章與通知實際的樣子。

多個信箱，一眼分清
每個信箱都有自己的名稱、顏色與通知音效。工具列可顯示加總，或分開顯示如 26/2。

不開 Gmail 也能處理
在清單或通知上直接標為已讀，也能一鍵清空整個信箱的未讀。

重視隱私
• 完全在瀏覽器內執行，只與 mail.google.com 連線
• 沒有伺服器、沒有分析、沒有廣告、沒有追蹤
• 郵件主旨只存在記憶體
• 開放原始碼：https://github.com/tasict/pigeon-post-for-gmail

贊助
如果你覺得好用，希望你能贊助我喝杯咖啡：https://paypal.me/tasict

Gmail 是 Google LLC 的商標。本擴充功能與 Google 無關，也未經 Google 背書。
```

### 圖片素材

| 項目 | 規格 | 狀態 |
|---|---|---|
| Store icon | 128×128 PNG | `icons/icon128.png` |
| Screenshots | 1280×800 或 640×400，1–5 張 | 4 張：popup 清單、設定頁與即時預覽、桌面通知與一鍵已讀、隱私與多語系 |
| Small promo tile | 440×280 | 已製作 |
| Marquee promo tile | 1400×560 | 已製作（選用） |

截圖與宣傳圖都是示意圖：用擴充功能本身的頁面搭配假資料（`example.com` 信箱、虛構寄件者）渲染，不使用真實帳號畫面，避免露出個人 email 與郵件內容。

## Privacy practices

**Single purpose**

```
Shows unread counts and desktop notifications for the Gmail accounts the user is signed in to in Chrome, and lets the user mark those messages as read.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `alarms` | Checks Gmail for new unread mail at the interval the user chooses (30 seconds to 15 minutes). |
| `notifications` | Shows a desktop notification when a new unread message arrives in a folder the user set to "Notify". |
| `storage` | Stores the user's settings (synced), IDs of already-notified messages, and the latest check result (session storage, in memory only). |
| `scripting` | When the user opens the settings page, reads label names from the left-hand menu of an open Gmail tab so the user can choose labels from a list. Only label names are read. |
| `cookies` | Reads Gmail's GMAIL_AT cookie at the moment the user clicks "Mark as read". Gmail's web interface requires this value as the action token. It is sent only to mail.google.com and never stored or transmitted elsewhere. |
| `offscreen` | Plays the per-account notification sound. A Manifest V3 service worker cannot play audio. |
| `webRequest` | Required together with webRequestAuthProvider (below). |
| `webRequestAuthProvider` | When an account is not signed in, Gmail's Atom feed answers with HTTP 401 and a Basic auth challenge, which makes Chrome show a username/password dialog. The extension cancels that challenge only for its own feed requests so no dialog appears. It does not read or modify any other request. |
| Host `https://mail.google.com/*` | Reads the Gmail Atom feed (unread messages) using the user's existing Gmail session, and sends the "mark as read" action the user requested. |

**Remote code**：No, I am not using remote code.

**Data usage**：勾選以下兩項，其餘不勾

- [x] Personally identifiable information：the email addresses of the user's signed-in Gmail accounts
- [x] Personal communications：sender, subject and snippet of unread messages, shown in the popup and notifications

三項聲明全部勾選：

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL**：https://tasict.github.io/pigeon-post-for-gmail/privacy.html

**Homepage URL**：https://tasict.github.io/pigeon-post-for-gmail/

**Support URL**：https://github.com/tasict/pigeon-post-for-gmail/issues

## Test instructions（給審查員）

```
1. Sign in to any Gmail account in Chrome (https://mail.google.com).
2. Install the extension. The settings page opens automatically and lists the signed-in account.
3. Set "Inbox" to "Notify". Send an email to that account from another address.
4. Within about a minute the toolbar badge shows the unread count and a desktop notification appears.
5. Click the toolbar icon to see the message list. The envelope button marks a message as read.
No account or credentials for the extension itself are needed. It uses the existing Gmail login.
```

## Distribution

- 測試期：Visibility 選 **Private**，在 Trusted testers 加入測試者的 email 或 Google Group。
- 正式上線：改為 **Public**。Item ID 與已安裝的使用者都不受影響。
