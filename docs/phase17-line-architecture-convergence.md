# Phase 17：Production／Staging LINE 架構收斂盤點與遷移決策

## 執行邊界

本 Phase 僅允許靜態盤點、文件、測試與唯讀安全彙總；不得部署 Worker、修改 secrets、修改 LINE Developers webhook、啟用 Shadow／Queue／SLA／Outbound、寫入 D1、修改 canonical migrations、刪除 legacy 程式或資料表，亦不得在未另行核准前啟動 dual-write 或 migration。

## Current production architecture

目前已知 Production legacy inbound 入口為 `POST /line-webhook`，核心資料表為 `line_threads` 與 `line_messages`，正式聊天室可正常收件與顯示。正式 UI 的 repository 候選為 `line-oa-monitor.html`，但部署平台、部署 commit、cache 與實際 API host 必須由 production deployment metadata 再確認，不得只以 checkout 推定。

## Current tenant-v2 architecture

Tenant-v2 webhook 為 `POST /api/v2/line/webhook/{tenant_slug}`，核心資料表為 `tenant_crm_profiles`、`tenant_crm_threads`、`tenant_crm_messages`。其設計已包含租戶隔離、Channel 設定、客服回覆、指派、未讀、SLA 與 priority；本 Phase 不開啟 Queue、SLA 或 Outbound。

Tenant-v2 inbound call path：

`LINE Platform → /api/v2/line/webhook/{tenant_slug} → tenant channel secret loading → X-Line-Signature HMAC-SHA256 verification → profile/thread upsert → message idempotency check → tenant_crm_messages insert → unread/thread timestamps update`

程式僅保存 `reply_token_present` 指標，不應保存或輸出完整 replyToken。

## UI／API／Webhook／Table mapping

| Layer | Production legacy | Tenant-v2 |
|---|---|---|
| UI candidate | `line-oa-monitor.html`，實際 deployment 待確認 | `line-oa-monitor.html` + `js/tenant-line-client.js` + `js/tenant-line-monitor-page.js` |
| Thread list | `/api/line-oa/*` 具體 endpoint 待完整 route inventory | `GET /api/v2/line/threads` |
| Message list | `/api/line-oa/*` 具體 endpoint 待完整 route inventory | `GET /api/v2/line/threads/:thread_id/messages` |
| Update/status | legacy endpoint 待完整 route inventory | `POST /api/v2/line/threads/:thread_id` |
| Webhook | `POST /line-webhook` | `POST /api/v2/line/webhook/{tenant_slug}` |
| Tables | `line_threads`, `line_messages` | `tenant_crm_profiles`, `tenant_crm_threads`, `tenant_crm_messages` |
| Tenant resolution | 多半缺少 `tenant_slug`，須人工與 metadata 判定 | URL path + tenant channel configuration |

其他 route 必須納入人工驗證：`/line-webhook/{tenant}`、`/platform-line-webhook` 及其他 legacy aliases。每條 route 都要確認 entrypoint、handler、signature、tenant 判定、寫入表、reply/push、replyToken 保存、實際使用與停用安全性。

## Data mapping

| Field | Legacy | Tenant-v2 | Decision |
|---|---|---|---|
| LINE UID | legacy user/thread UID | `line_user_uid` | 欄名與格式需驗證 |
| display_name | profile/thread field if present | `tenant_crm_profiles.display_name` | 可直接對映，衝突時保留較新且可追溯來源 |
| picture_url | profile field if present | `tenant_crm_profiles.picture_url` | 可直接對映 |
| thread ID | legacy PK | `tenant_crm_threads.id` | 重新產生並保存 legacy reference |
| status | legacy status | `status`, `queue_status` | 需狀態轉換表 |
| risk | 常缺少 | `risk` | 預設值須經核准，不可假造歷史風險 |
| note/tags | 格式不明 | v2 note/tags | 正規化並保留原始來源 hash |
| message type/text | legacy type/content | `message_type`, `content` | 可轉換；盤點輸出禁止全文 |
| event ID | 可能缺少或重複 | `webhook_event_id` | 空值以 deterministic fingerprint 補助，不能偽造 LINE event ID |
| created_at | legacy timestamp | `created_at` | 統一時區與格式 |
| owner_uid/assignee | 常缺少 | v2 ownership fields | unknown 不可自動指派 |
| unread | boolean/count | `unread_count` | 需轉換規則 |
| direction/send status | 可能隱含 | explicit v2 fields | 需轉換與驗證 |
| SLA | 缺少 | structured v2 fields | 歷史資料不回推 SLA |
| tenant_slug | 通常缺少 | required | 最高風險；unknown 必須 quarantine |

## Safe inventory requirements

Production D1 僅可執行 read-only aggregate，輸出：`line_threads`／`line_messages` counts、distinct UID count、duplicate event ID、duplicate fingerprint、null/invalid UID、orphan messages、thread/message 關聯問題、message type 分布、最早/最新時間、replyToken 非空筆數與多 OA／多 tenant 訊號。禁止輸出完整 UID、訊息全文、Token、Secret、replyToken、ciphertext 或 IV。

Staging 僅讀取 schema 與 row counts。若環境未提供唯讀 binding，報告必須標示 `not_provided`，不得以零取代未查詢。

## Tenant attribution and quarantine

判定可信度依序為：

1. 明確 webhook route tenant、Channel ID 或 bot user ID 可唯一對應 tenant。
2. 經人工確認單一正式 OA 全部屬同一 tenant。
3. owner／agency／客戶來源等間接證據，只能標示 `inferred`。
4. 僅有 LINE UID、display name 或時間者為 `unknown`。

建議狀態：`resolved`、`inferred`、`conflict`、`unknown`、`quarantined`。未知資料不得自動歸入 `demo`，不得進正式 tenant-v2 主表；先進離線 migration manifest，僅保存 legacy record hash、candidate tenant、判定理由、衝突數與審核資訊。

## Options

### A. Legacy 保留，tenant-v2 僅供新租戶

上線風險最低、無需停機、rollback 容易，但兩套 UI/API/Webhook/Table 長期並存，租戶隔離能力不一致且維護成本最高。

### B. 一次性 Legacy → tenant-v2 migration

最終架構最乾淨，但停機、漏訊息、重複、tenant 誤歸屬與 rollback 風險最高。只有在單一 OA／單一 tenant 已人工確認、資料品質合格且 dry run/reconciliation 全通過時才可考慮。

### C. 漸進式切換

以 read-only comparison、backfill dry run、v2 staging UI、受控 inbound 切換、UI 切換、停止 legacy write、legacy archive 逐步進行。過渡期複雜，但可量化風險並逐階段 rollback。

## Recommended migration path

推薦 C，但不推薦長期 dual-write。目標為單一 primary write：先完成 inventory 與 tenant attribution，再 dry-run/backfill；新 inbound 切 v2 時 legacy 僅短期 read fallback，完成 reconciliation 後停止 legacy write。

## Dual-write risk

兩套表無跨表 transaction。無論先寫 legacy 或 v2，都可能一邊成功、一邊失敗；retry 可能 duplicate，兩套 idempotency 與 Thread ID 不一致，且 legacy/v2 UI 可能顯示重複。若另案核准短期 controlled dual-write，必須具備 outbox/delivery receipt、共同 idempotency key、failure retry、reconciliation、feature flag、明確終止日期與演練過的 rollback。

## Staged cutover and rollback

1. **Read-only comparison**：指標為 route/schema/count/duplicate/orphan/tenant resolution；任何 unknown 比率超標即 NO-GO。
2. **Legacy backfill dry run**：只產生 mapping manifest，不寫 v2；驗證可重跑與 deterministic IDs。
3. **v2 UI staging**：驗證權限、Thread/Message parity、status/risk/note/tags；Outbound/Queue/SLA 保持關閉。
4. **New inbound to v2**：需人工核准；以 feature flag 控制單一 primary write，legacy 可短期 read fallback。
5. **UI switch to v2**：驗證最新訊息、未讀、Thread counts、權限與錯誤率；可即時切回 legacy read。
6. **Stop legacy write**：保留 legacy 唯讀 rollback window，持續 reconciliation。
7. **Legacy archive**：不刪除表或程式；route 停用需另案核准。

建議 flags：`LINE_INBOUND_WRITE_TARGET`、`LINE_UI_READ_TARGET`、`LINE_LEGACY_WRITE_ENABLED`、`LINE_V2_WRITE_ENABLED`、`LINE_READ_FALLBACK_ENABLED`。

## Go／No-Go checklist

GO 前必須全部成立：production UI deployment commit/API host 已確認；所有 webhook route 已盤點；Production/Staging safe inventory 已完成；tenant `resolved` 比率達核准門檻；duplicate/orphan/invalid UID 可解釋；dry run 可重跑且結果一致；v2 UI staging 通過；rollback 演練通過；credential/plaintext scan、`node --check`、inventory/route/schema tests、`npm test`、`git diff --check` 全通過。

任一條未成立即 NO-GO。Shadow 真實驗證已明確排除，不是本 Phase blocker。

## 尚需人工決策事項

1. Production 實際 UI deployment source、版本與 API host。
2. Production 是否確定只有單一正式 OA／單一 tenant。
3. unknown/conflict 可接受比例與人工審核責任人。
4. migration batch 大小、maintenance window 與 rollback window。
5. 是否核准短期 controlled dual-write；預設不核准。
6. 新 inbound primary write 切換時點。
7. legacy read fallback 保留期限。
8. legacy route/archive 的最終核准。
