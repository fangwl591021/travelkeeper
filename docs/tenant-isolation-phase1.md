# TravelKeeper 租戶隔離 Phase 1

## 目標

在不破壞既有 `demo` 租戶的前提下，建立真正可擴充的 SaaS 租戶邊界：

1. 每筆核心資料都具有 `tenant_slug`
2. 使用者透過 `tenant_memberships` 加入租戶
3. 同一位 LINE 使用者可在不同租戶擁有不同角色與業務資料
4. V2 API 必須先驗證 LINE Access Token，再解析租戶與權限
5. 舊 API 暫時維持相容，由新版 Worker 入口逐步接管

## 已完成

### 資料庫

- 建立 `tenant_memberships`
- 核心資料加入 `tenant_slug`
  - itineraries
  - customers
  - orders
  - payment_attempts
  - payout_batches
  - payout_batch_orders
  - audit_logs
- 建立 `tenant_distributor_profiles`
  - 租戶內推薦碼
  - 租戶內佣金
  - 租戶內銀行與社群資料
- 既有資料回填到 `demo` 或原本 `agency_slug`
- 建立租戶複合索引
- 建立跨租戶關聯阻擋 Trigger

### 後端

- `lib/tenant-context.js`
  - 解析 Header、網址與來源頁面的租戶
  - membership、角色與權限驗證
  - platform admin 支援
- `lib/line-auth.js`
  - 驗證 LINE Access Token
  - 取得真正 LINE userId
  - 比對 Token 與租戶的 LINE Login Channel
- `lib/tenant-api.js`
  - `GET /api/v2/tenant/context`
  - `GET /api/v2/itineraries`
  - `GET /api/v2/itineraries/:id`
  - `GET /api/v2/orders`
  - `GET /api/v2/customers`
  - `GET /api/v2/payments`
  - `POST /api/v2/orders/:id/status`
- `worker-tenant.js`
  - V2 API 經過 LINE 驗證與租戶驗證
  - 公開行程 API 不要求登入，但強制 tenant filter
  - 尚未改造的舊 API 繼續交給 `worker.js`

## V2 API 呼叫方式

內部 API：

```http
GET /api/v2/orders
Authorization: Bearer <LIFF access token>
X-Tenant-Slug: demo
```

公開行程：

```http
GET /api/v2/itineraries/<id>?tenant=demo&scope=public
```

## 安全原則

禁止使用前端傳入的 `uid` 作為登入證明。V2 API 的 userId 必須由 LINE Access Token 驗證結果取得。

只有在本機或過渡測試環境明確設定以下變數時，才允許舊 UID 模式：

```text
ALLOW_LEGACY_UID_AUTH=1
```

正式環境不得開啟。

## 後續接線

前端必須建立統一 API Client：

1. 從網址取得 tenant
2. 呼叫 `liff.getAccessToken()`
3. 自動加入 Authorization 與 X-Tenant-Slug
4. 401 時重新登入
5. 403 時顯示無租戶權限

詳細執行規格請見：

```text
CODEX_HANDOFF_TENANT_ISOLATION.md
```

## 已知限制

目前舊資料表的部分主鍵仍為全域唯一：

- `customers.customer_phone`
- `itineraries.id`
- `orders.order_id`
- `payment_attempts.id`

其中最重要的是 `customers.customer_phone`，不同租戶暫時不能建立相同電話的客戶。Phase 2 應在完整備份、回復腳本與雙租戶測試完成後，重建 customers/orders 的複合鍵或改為內部 UUID。

## 上線限制

在以下事項完成前，不得合併或部署到正式環境：

- Local D1 migration 全新與既有資料庫測試
- dashboard 核心資料改用 V2 API
- tour／booking 改成租戶單筆行程 API
- 雙租戶資料不可互讀的自動測試
- 正式環境確認未設定 `ALLOW_LEGACY_UID_AUTH=1`
