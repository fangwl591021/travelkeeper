# TravelKeeper Phase 12：租戶 LINE OA Channel 與 Webhook

## 目標

每個租戶可設定自己的 LINE Messaging API Channel。Channel Secret 與 Channel Access Token 以 AES-256-GCM 加密保存，Webhook 由 URL 中的租戶 slug 選擇設定並驗證 `X-Line-Signature`，通過後寫入該租戶 CRM。

## API

- `GET /api/v2/line/channel`
- `POST /api/v2/line/channel`
- `POST /api/v2/line/webhook/{tenant_slug}`

Channel 設定 API 需要 `platform_admin` 或 `tenant_admin`。Webhook 不使用 LIFF Bearer Token，但必須通過該租戶 Channel Secret 的 HMAC-SHA256 簽章。

## 資料表

- `tenant_line_channels`：Channel metadata、密文、末四碼、啟用狀態、最近 Webhook 狀態。
- `tenant_crm_messages`：入站 LINE 訊息與事件 metadata。
- `tenant_line_webhook_logs`：每次 Webhook request 的處理、重送與錯誤紀錄。

## 安全界線

1. 租戶只取自 `/api/v2/line/webhook/{tenant_slug}`。
2. Query、Header、Body 不可改寫 Webhook 租戶。
3. Secret 與 Access Token 不回傳、不寫 log，只回末四碼遮罩。
4. AES-GCM AAD 使用 `tenant_slug:line:key_version`，密文不可跨租戶解密。
5. 簽章對原始 request body 驗證，不可先 parse 或重新 stringify。
6. Message、Thread、Profile、Webhook Log 的儲存 ID 都包含租戶來源。
7. `webhookEventId` 與事件 fingerprint 共同提供冪等保護。
8. D1 Trigger 阻止 Message 指向其他租戶 Profile 或 Thread。

## 事件處理

支援 message、follow、unfollow、postback、join、leave 等事件。具有 `source.userId` 的事件會：

1. 以租戶 Access Token嘗試取得 LINE Profile。
2. 建立或更新 `tenant_crm_profiles`。
3. 建立或更新 `tenant_crm_threads`。
4. 寫入 `tenant_crm_messages`。

沒有 userId 的群組級事件目前標記為 skipped，不會建立假客戶。

## 錯誤

- `LINE_WEBHOOK_SIGNATURE_INVALID` → 401
- `TENANT_LINE_CHANNEL_NOT_CONFIGURED` → 404
- `TENANT_LINE_CHANNEL_DISABLED` → 409
- `TENANT_LINE_CHANNEL_ID_REQUIRED` → 400
- `TENANT_LINE_CHANNEL_SECRET_REQUIRED` → 400
- 主密鑰缺失或版本錯誤 → 503

## 尚未包含

- LINE OA 設定 UI。
- `line-oa-monitor.html` 改讀 `tenant_crm_messages`。
- 圖片／影片檔案內容下載與私有 R2 保存。
- 自動回覆與 AI 回覆。
- 正式 Webhook endpoint 設定及正式 Channel 驗證。
