# TravelKeeper D1 搬移計畫

目標：把目前 Google Sheets + GAS 的慢查詢逐步搬到 Cloudflare D1，同時避免一次切換造成營運中斷。

## 搬移原則

1. Sheets 先保留為主資料庫。
2. D1 先做影子庫，匯入資料並和 Sheets 比對。
3. 寫入先雙寫：GAS 成功後同步寫 D1。
4. 讀取逐步切 D1，保留 GAS fallback。
5. 穩定後 D1 成為主庫，Sheets 改為備份或營運匯出。

## 階段 1：建立 D1 Schema

第一版 migration：

```text
migrations/0001_initial_schema.sql
```

包含：

- `tenants`
- `distributors`
- `itineraries`
- `customers`
- `orders`
- `payment_attempts`
- `payout_batches`
- `payout_batch_orders`
- `audit_logs`

## 階段 2：建立 Cloudflare D1

在 Cloudflare Worker 專案中執行：

```bash
npx wrangler d1 create travelkeeper
```

把回傳的 `database_id` 加入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "travelkeeper"
database_id = "貼上 Cloudflare 回傳的 id"
migrations_dir = "migrations"
```

套用 migration：

```bash
npx wrangler d1 migrations apply travelkeeper --remote
```

## 階段 3：初次匯入

建議先由 GAS 增加匯出 action，或用現有 action 逐表抓取：

- `getConfig`
- `getDistributors`
- `getItineraries&all=1`
- `getAllOrders`
- 新增 `exportCustomers`

匯入順序：

1. `tenants`
2. `distributors`
3. `itineraries`
4. `customers`
5. `orders`

目前 repo 已提供初次匯入腳本：

```bash
node scripts/import-sheets-to-d1.mjs --gas-url="你的 GAS Web App URL"
```

說明：

- 腳本會抓：
  - `getConfig`
  - `getDistributors`
  - `getItineraries&all=1`
  - `getAllOrders`
- `customers` 先由 `orders` 反推生成
- 預設會：
  - 產生 `.tmp/d1-import.sql`
  - 直接執行 `wrangler d1 execute travelkeeper --remote --file ...`

只想先產生 SQL、不立刻匯入：

```bash
node scripts/import-sheets-to-d1.mjs --gas-url="你的 GAS Web App URL" --dry-run=true
```

不想清空現有 D1 資料：

```bash
node scripts/import-sheets-to-d1.mjs --gas-url="你的 GAS Web App URL" --truncate=false
```

## 階段 4：雙寫

先讓 Worker 寫入 GAS，成功後再寫 D1：

```js
const gasRes = await gasPost(env, body);
if (gasRes.success) {
  await d1MirrorWrite(env.DB, body.action, body, gasRes.data);
}
return json(gasRes);
```

雙寫 action 清單：

- `registerDistributor`
- `updateDistributorProfile`
- `addItinerary`
- `updateItinerary`
- `reviewItinerary`
- `createOrder`
- `updatePaymentStatus`
- `markBalancePaid`
- `payoutCommission`

## 階段 5：逐步切讀

建議切換順序：

1. `resolveInviteCode`
2. `getConfig`
3. `getAgentPublicProfile`
4. `getItineraries`
5. `getUserOrders`
6. `getMyCustomers`
7. `getMyStats`
8. `getAllOrders`
9. `getCommissionSummary`

每個 endpoint 先用 D1，失敗才 fallback GAS：

```js
try {
  return json(await readFromD1(env.DB, params));
} catch (err) {
  console.warn('D1 fallback to GAS:', err.message);
  return json(await gasGet(env, params));
}
```

## 階段 6：D1 成為主庫

D1 穩定後：

- Worker 直接寫 D1
- Sheets 改為每日匯出、備份或營運報表
- GAS 僅保留 migration/export 工具
