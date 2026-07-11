# TravelKeeper Phase 13：租戶 LINE 聊天室監控與 Channel 設定頁

## 目標

將原本 demo 專用、混合 Legacy API 的 `line-oa-monitor.html` 改為租戶化監控頁，資料來源統一為：

- `tenant_crm_threads`
- `tenant_crm_messages`
- `tenant_crm_profiles`
- `tenant_line_channels`

## 新增 API

- `GET /api/v2/line/threads`
- `GET /api/v2/line/threads/:thread_id/messages`
- `POST /api/v2/line/threads/:thread_id`

## 新增頁面與 Client

- `js/tenant-line-client.js`
- `js/tenant-line-monitor-page.js`
- `line-channel-settings.html`
- 重建 `line-oa-monitor.html`

## 權限

- `platform_admin`：可查看與管理租戶全部 Thread。
- `tenant_admin`：可查看與管理租戶全部 Thread。
- `sales` / `editor`：只可查看與管理 `owner_uid` 為自己的 Thread。
- `finance` / `member`：不可讀取聊天室與訊息。

## 監控功能

- Thread 列表與搜尋。
- 依 open / pending / closed 篩選。
- 訊息時間軸。
- 顯示文字與非文字事件摘要。
- 修改 Thread 狀態、風險、摘要、內部備註與標籤。
- 保留 tenant、localhost Worker 與 dev_uid 導航參數。

## Channel 設定功能

`line-channel-settings.html` 使用 Phase 12 的：

- `GET /api/v2/line/channel`
- `POST /api/v2/line/channel`

頁面只顯示：

- 是否已設定。
- Secret / Token 末四碼遮罩。
- Channel ID、Bot Basic ID、顯示名稱。
- Webhook 啟用狀態。
- 該租戶 Webhook URL。

頁面不回讀：

- Channel Secret 完整值。
- Channel Access Token 完整值。
- AES ciphertext / IV。

## 安全界線

- 所有 Thread / Message SQL 必須包含 `tenant_slug`。
- sales / editor 以 `profile.owner_uid` 限制資料範圍。
- `line-oa-monitor.html` 不再呼叫 `/api/line-oa/*` Legacy API。
- 外部 `worker` 參數不會覆寫預設 Worker；只有 localhost 可覆寫。
- `dev_uid` 只在 localhost Worker 生效。
- Phase 13 不開放直接 LINE Push Reply，避免未完成 Push API 權限與稽核前誤發訊息。

## 尚未完成

- 直接 LINE Push / Reply API。
- Outbound message 寫入與送達狀態。
- 圖片、影片與檔案下載到私有 R2。
- 即時更新（SSE / WebSocket / Durable Object）。
- 正式 CORS allowlist。
- Tailwind CDN 生產化。
