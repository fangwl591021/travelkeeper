# TravelKeeper Phase 9：Legacy 客戶 API 與母系統匯出相容層

## 目標

Phase 8 已建立 tenant-safe `customer_id` 與 `contact_phone`，但大型 `worker.js` 仍有部分舊路徑把 `customer_phone` 當作全域主鍵或顯示電話。

Phase 9 不直接重寫 `worker.js`，而是在 `worker-tenant.js` 前置一層安全相容模組：

```text
lib/legacy-customer-compat-api.js
```

只要請求明確指定非 `demo` 租戶，相關舊路由就會先進入相容層；沒有指定租戶或指定 `demo` 的請求仍維持舊流程。

## 接管路由

### 舊建單

```http
POST /api/orders/create?a={tenant_slug}
```

非 demo 請求會轉送到：

```http
POST /api/v2/bookings
```

因此使用 Phase 8 的：

- `customer_id`
- `contact_phone`
- tenant-safe internal relation key
- D1 batch 原子寫入
- itinerary、業務與 customer tenant 檢查

### 舊客戶與訂單查詢

```http
GET /api/my/customers
GET /api/itineraries?action=getMyCustomers
GET /api/itineraries?action=getUserOrders
GET /api/itineraries?action=getAllOrders
GET /api/orders/status
```

相容輸出同時提供舊欄位別名，但規則是：

- `customer_phone` / `customerphone`：實際 `contact_phone`
- `customer_id` / `customerid`：正式 customer identity
- `customer_key` / `customerkey`：舊 internal relation key

UI 不得把 `customer_key` 顯示為電話。

### 母系統 / Wasabi 匯出

```http
POST /api/mother/export-customer
POST /api/mother/export-customers
POST /api/mother/export-order
POST /api/mother/export-orders
POST /api/mother/export-commission
POST /api/mother/export-commissions
```

非 demo 匯出必須：

- 通過 `platform_admin` tenant context。
- 所有 D1 查詢包含 `tenant_slug`。
- Customer `local_id` 使用 `customer_id`。
- 顯示電話使用 `contact_phone`。
- Object key 使用租戶目錄：

```text
{prefix}/tenants/{tenant_slug}/customers/{customer_id}.json
{prefix}/tenants/{tenant_slug}/orders/{order_id}.json
{prefix}/tenants/{tenant_slug}/commissions/{order_id}.json
```

- 支援 `dryRun=true`，不寫入 Wasabi。
- 實際寫入使用 AWS Signature V4。

## 安全邊界

相容層只處理「明確非 demo」請求。租戶來源可來自：

- `X-Tenant-Slug`
- `tenant`
- `tenant_slug`
- `a`
- 頁面 Referer 的租戶參數

非 demo Legacy API 現在必須通過 LINE Access Token，或僅在本機設定 `ALLOW_LEGACY_UID_AUTH=1` 後使用 `X-User-Uid`。

這代表尚未改成 Bearer Token 的舊非 demo Dashboard 請求會安全地回 401，而不是繼續使用全域客戶資料。

## demo 相容性

以下請求不由 Phase 9 接管：

```text
沒有明確 tenant 的請求
明確 tenant=demo 的請求
```

因此既有 demo Dashboard、GAS fallback、Telegram 通知及舊建單流程不會因 Phase 9 被直接改寫。

## CI

新增：

```text
tests/legacy-customer-compat.test.mjs
```

檢查：

- demo 不被攔截。
- 非 demo 舊路由被攔截。
- `contact_phone` 與 internal relation key 分離。
- 母系統 Customer local ID 使用 `customer_id`。
- 匯出 key 包含 tenant。
- D1 讀取具有 tenant 條件。
- 相容路由在 `legacyWorker.fetch()` 前執行。
- Mother storage 錯誤狀態碼。

## 尚未完成

1. 舊 `dashboard.html` 全面改用 Bearer Token 與 V2 APIs。
2. demo 舊建單內部仍使用原始 `d1CreateOrder`。
3. worker.js 內舊 Mother export 函式仍保留，但非 demo 明確租戶已被相容層攔截。
4. Wasabi 正式帳號實際寫入與讀回驗證尚未執行。
5. 最終移除 `customers.customer_phone` 舊 primary key 尚未進行。

## 部署限制

- PR 維持 Draft。
- 未套用 remote migration。
- 未部署正式 Worker。
- Wasabi 測試只能使用測試 Prefix，不得覆寫既有正式物件。
