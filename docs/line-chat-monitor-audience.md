# LINE 聊天室監控與受眾分析

## Webhook 權責

LINE Official Account 只設定一個 Webhook：

```text
https://travelkeeper-worker.fangwl591021.workers.dev/line-webhook
```

Worker 是唯一入口，負責：

- 驗證 `x-line-signature`。
- 將 LINE events 寫入 D1 的 `line_threads`、`line_messages`。
- 將同一批 events 轉給母站 webhook：`https://aiwe.cc/index.php/line_login/4572/`。
- 如果母站回傳 `replyPayload`，由 Worker 呼叫 LINE Reply API。
- 如果有設定 `FORWARD_WEBHOOK_URL`，背景轉發給第二套監控或日誌系統。第二套系統只做觀察，不處理 reply token。

## 必要環境變數

```text
GAS_URL=https://aiwe.cc/index.php/line_login/4572/
LINE_CHANNEL_SECRET=LINE Developers 的 Channel Secret
LINE_CHANNEL_ACCESS_TOKEN=LINE Developers 的 Channel Access Token
```

選填：

```text
FORWARD_WEBHOOK_URL=https://example.com/monitor-webhook
```

## 後台入口

管理員從 `line-oa-monitor.html` 進入，可以查看：

- 聊天室列表、未讀、狀態、風險等級。
- 單一聊天室訊息紀錄。
- AI 參考回覆草稿與行程推薦。
- 訪客重要需求紀錄。
- 受眾分析：30 天活躍受眾、高風險聊天室、重要需求數、7 天訊息量、需求熱度、常見標籤。

## API

聊天室列表：

```text
GET /api/line-oa/threads?uid={adminLineUid}
```

聊天室詳情：

```text
GET /api/line-oa/thread?uid={adminLineUid}&id={threadId}
```

受眾分析：

```text
GET /api/line-oa/audience?uid={adminLineUid}
```

診斷：

```text
GET /hub-test
GET /api/hub-test
```

## 驗收順序

1. 部署 Worker 並設定環境變數。
2. 打開 `/hub-test`，確認 GAS、LINE Bot Token、環境變數狀態。
3. LINE Developers 的 Webhook URL 設為 Worker 的 `/line-webhook`。
4. 從 LINE 傳送真實訊息，確認 LINE 官方帳號能收到回覆。
5. 進入 `line-oa-monitor.html`，確認聊天室和受眾分析有更新。
