# TravelKeeper 租戶隔離 Phase 1

## 目標

先建立不破壞既有 `demo` 租戶的隔離基礎，再逐步將 Worker API 改為「先解析租戶、再驗證成員、最後查詢資料」。

## 已完成

1. 建立 `tenant_memberships`：同一位 LINE 使用者可以加入不同租戶，角色與狀態分開保存。
2. 為核心資料補上 `tenant_slug`：
   - itineraries
   - customers
   - orders
   - payment_attempts
   - payout_batches
   - audit_logs
3. 將既有資料回填為 `demo` 或由既有 distributor 的 `agency_slug` 推導。
4. 建立租戶複合索引。
5. 建立訂單／行程、付款／訂單的跨租戶阻擋 Trigger。
6. 新增 `lib/tenant-context.js`，統一租戶解析與 membership 驗證。

## 下一個程式修改順序

### 1. Worker 入口建立 Context

每個內部 API 必須先取得：

```js
const tenantSlug = requestedTenantSlug(request, body);
const context = await requireTenantContext(env, {
  tenantSlug,
  userUid: verifiedLineUid,
  allowedRoles: ['tenant_admin', 'editor', 'sales', 'finance', 'support'],
});
```

`verifiedLineUid` 必須來自 LINE token 驗證，不可以直接相信 body.uid。

### 2. 所有 SQL 強制帶租戶條件

錯誤：

```sql
SELECT * FROM orders WHERE distributor_uid = ?
```

正確：

```sql
SELECT * FROM orders
WHERE tenant_slug = ? AND distributor_uid = ?
```

### 3. 所有 INSERT 強制由 Context 寫入 tenant_slug

錯誤：

```js
body.tenant_slug
```

正確：

```js
context.tenantSlug
```

前端傳入的租戶只能作為「請求租戶」，最終必須通過 membership 驗證。

### 4. 首批必改 API

依風險與資料敏感度排序：

1. `checkUserStatus`
2. `getItineraries` / add / update / review / hide
3. `getAllOrders` / `getUserOrders` / update status
4. `getMyCustomers` / `getCustomerOrders`
5. payment create / payment detail / payment config
6. commission summary / payout
7. LINE OA monitor / broadcast
8. knowledge base / promo DM / rich menu

## 相容策略

- 沒有指定租戶時暫時使用 `demo`。
- 舊資料先歸屬 `demo`。
- 新租戶不得依賴預設值，建立帳號時必須建立 tenant 與 membership。
- 在所有核心 API 完成 tenant filter 前，不應正式開放第二個租戶。

## 已知限制

目前舊資料表的主鍵仍是全域唯一，例如：

- distributors.uid
- customers.customer_phone
- itineraries.id
- orders.order_id

Phase 1 可防止讀取與關聯資料串租，但尚未允許不同租戶使用相同 phone / id。Phase 2 需要重建為複合主鍵或改用內部 UUID：

```text
PRIMARY KEY (tenant_slug, customer_phone)
PRIMARY KEY (tenant_slug, user_uid)
```

建議 Phase 2 將 `distributors` 拆成：

- `user_profiles`：全域 LINE 身分
- `tenant_memberships`：租戶角色
- `tenant_sales_profiles`：租戶內業務資料、推薦碼、佣金與銀行資訊
