# Codex Handoff — TravelKeeper 租戶隔離

## 工作分支

```text
agent/tenant-isolation-phase1
```

Draft PR：#1。

## 已完成

### 資料與會員邊界

- `migrations/0100_tenant_isolation_phase1.sql`
  - 建立 `tenant_memberships`
  - 行程、客戶、訂單、付款、結算及稽核資料加入 `tenant_slug`
  - 回填既有 `demo` 資料
  - 建立租戶索引及跨租戶 Trigger
- `migrations/0101_tenant_profiles_and_relations.sql`
  - 建立 `tenant_distributor_profiles`
  - 同一 LINE 使用者可在不同租戶保存不同推薦碼、佣金、銀行與社群資料
  - `payout_batch_orders` 加入租戶關聯

### 驗證與 V2 API

- `lib/tenant-context.js`：租戶、會員、角色與權限驗證
- `lib/line-auth.js`：LINE Access Token 與 Channel 驗證
- `lib/tenant-api.js`：租戶資料、推薦碼、行程、訂單、客戶、付款查詢及訂單狀態
- `worker-tenant.js`：V2 API 先驗證身分，再轉交租戶路由
- `js/tenant-api-client.js`：統一送出 `Authorization` 與 `X-Tenant-Slug`
- `tour.html`：指定租戶、指定行程單筆讀取

### 預約與付款寫入

- `lib/tenant-booking-api.js`
  - `POST /api/v2/bookings`
  - `POST /api/v2/payments/create`
- `booking.html`
  - 租戶、推薦碼、行程、建單與付款改走 V2 API
  - 顧客 UID 只採用後端驗證結果
  - 行程與業務必須同租戶
  - 訂單、客戶明確寫入 `tenant_slug`
  - 付款必須是同租戶且屬於目前 LINE 顧客的訂單
- 非 `demo` 租戶在獨立金流設定完成前安全阻擋線上付款，不會誤用 demo 藍新商店

### 測試

- `tests/tenant-isolation.test.mjs`
- `tests/tenant-booking-isolation.test.mjs`
- `.github/workflows/tenant-isolation-check.yml`

GitHub Actions 已通過：

```bash
node --check worker-tenant.js
node --check lib/tenant-context.js
node --check lib/line-auth.js
node --check lib/tenant-api.js
node --check lib/tenant-booking-api.js
node --test tests/tenant-isolation.test.mjs tests/tenant-booking-isolation.test.mjs
```

## 下一階段優先順序

1. 建立 `tenant_payment_settings`，讓每個租戶使用自己的藍新／LINE Pay 商店。
2. 將 Notify、Return、Thank-you 流程加入租戶識別與簽章驗證。
3. 重建 customers 主鍵為 `(tenant_slug, customer_phone)`，解除不同租戶電話衝突。
4. 將 `dashboard.html` 的登入、行程、訂單、客戶、付款全面切換 V2 API。
5. 將分享事件、Telegram、LINE OA、知識庫及圖文選單加入租戶欄位。
6. 限制正式 CORS 網域。

## 部署限制

- PR 保持 Draft。
- 不要直接套用正式 D1 migration。
- 不要部署正式 Worker。
- 在本機或測試環境完成雙租戶驗收前，不得開放第二個正式租戶。
