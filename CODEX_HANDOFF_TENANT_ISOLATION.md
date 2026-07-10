# Codex Handoff — TravelKeeper 租戶隔離 Phase 1 前端接線與測試

## 工作分支

請直接在以下既有分支繼續，不要從 main 另開不相關分支：

```text
agent/tenant-isolation-phase1
```

對應 Draft PR：#1。

## 已完成內容

- `migrations/0100_tenant_isolation_phase1.sql`
  - 建立 `tenant_memberships`
  - 核心資料表加入 `tenant_slug`
  - 回填既有 `demo` 資料
  - 建立租戶索引及跨租戶 Trigger
- `migrations/0101_tenant_profiles_and_relations.sql`
  - 建立 `tenant_distributor_profiles`
  - 同一 LINE 使用者可在不同租戶保存不同推薦碼、佣金、銀行與社群資料
  - `payout_batch_orders` 加入租戶關聯與 Trigger
- `lib/tenant-context.js`
  - 租戶解析、會員角色與權限驗證
- `lib/line-auth.js`
  - 以 LINE Access Token 驗證真正 userId
  - 驗證 Token 的 LINE Login Channel
- `lib/tenant-api.js`
  - `/api/v2/tenant/public`
  - `/api/v2/tenant/context`
  - `/api/v2/invites/:code`
  - `/api/v2/itineraries`
  - `/api/v2/itineraries/:id`
  - `/api/v2/orders`
  - `/api/v2/customers`
  - `/api/v2/payments`
  - `/api/v2/orders/:id/status`
- `worker-tenant.js`
  - 新 API 使用租戶隔離與 LINE 驗證
  - 公開租戶、推薦碼及已上架行程不要求登入
  - 舊 API 暫時轉送原本 `worker.js`
- `js/tenant-api-client.js`
  - 統一解析租戶
  - 自動加入 `Authorization` 與 `X-Tenant-Slug`
  - 統一處理登入失效、跨 Channel 與租戶權限錯誤
- `tour.html`
  - 已改成單筆租戶行程 API
  - 推薦碼改為租戶範圍查詢
  - 不再下載全平台行程列表
- `tests/tenant-isolation.test.mjs`
  - 租戶 slug、membership、公開行程隔離與禁止偽造 UID 測試
- `wrangler.toml`
  - main 已切換為 `worker-tenant.js`

## 尚待完成

### 1. 先驗證 Migration

執行：

```bash
wrangler d1 migrations apply travelkeeper --local
```

若專案原本有本機 D1 資料，先備份 `.wrangler/state`。

檢查：

- 所有既有資料仍屬於 `demo`
- `tenant_memberships` 已有既有業務人員
- `tenant_distributor_profiles` 已回填
- migration 可從全新資料庫一次完成
- migration 不可因欄位已存在而在全新／既有環境產生不同結果

不要直接套用正式 D1。

### 2. 修改 dashboard.html

不要逐個散落地直接加 Header。使用 `js/tenant-api-client.js` 作為共用 Client，再替換核心讀取流程。

第一批改用 V2 API：

- 身分及租戶：`GET /api/v2/tenant/context`
- 行程：`GET /api/v2/itineraries?scope=internal`
- 訂單：`GET /api/v2/orders`
- 客戶：`GET /api/v2/customers`
- 金流：`GET /api/v2/payments`
- 訂單狀態：`POST /api/v2/orders/:id/status`

保留舊 API 作為未改功能的暫時 fallback，但核心畫面不得再以無 tenant 條件的 `getAllOrders`、`getMyCustomers` 等作為資料來源。

### 3. 修改 booking.html

已完成公開行程頁，但預約頁仍需：

- 使用 `GET /api/v2/itineraries/{id}?tenant=<slug>&scope=public`
- 推薦碼改用 `/api/v2/invites/:code`
- 舊 `/api/orders/create` body 與 URL 明確帶 `tenant_slug`／`a`
- 金流建單前驗證訂單與付款屬於同一租戶

在付款 API 完成租戶化前，不得讓第二租戶啟用正式金流。

### 4. 本機雙租戶驗收

建立：

- `demo`
- `tenant-b`

每個租戶各建立：

- 1 位 tenant_admin
- 1 位 sales
- 2 筆行程
- 2 筆訂單
- 2 位客戶
- 1 筆付款

必測：

1. demo 管理員看不到 tenant-b 訂單
2. tenant-b 管理員看不到 demo 訂單
3. sales 只能看到自己的訂單與客戶
4. finance 可看付款但不能取得其他租戶資料
5. 用 tenant-b Header 查 demo 行程 ID，回傳 404
6. 用偽造 UID、沒有 LINE Token 呼叫 V2 API，回傳 401
7. 使用不同 LINE Login Channel 的 Token，回傳 403
8. 公開行程 API 不回傳其他租戶資料
9. 舊 demo 頁面未指定租戶時仍能正常使用

### 5. 測試與交付

至少執行：

```bash
node --check worker-tenant.js
node --check lib/tenant-context.js
node --check lib/line-auth.js
node --check lib/tenant-api.js
node --test tests/tenant-isolation.test.mjs
wrangler dev
```

完成後：

- Commit 到原分支
- 更新 Draft PR #1
- 不要合併
- 不要部署正式 Worker
- 在 PR 說明列出尚未租戶化的舊 API

## 已知限制

1. `customers.customer_phone` 目前仍是全域主鍵，因此不同租戶暫時不能建立相同電話的客戶。不要在未完成備份及回復方案前直接重建 customers/orders 正式表。
2. 舊版 Worker API 仍有大量只用 UID 判權與未加 `tenant_slug` 的路徑；第二租戶只能測試 V2 API，不可全面開放。
3. `booking.html` 與付款建立尚未完全租戶化，第二租戶暫時不得開啟正式收款。
4. CORS 目前仍為 `*`，正式部署前應限制 GitHub Pages、LIFF 與正式品牌網域。
