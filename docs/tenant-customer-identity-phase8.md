# TravelKeeper Phase 8：租戶安全客戶識別

## 問題

舊版 `customers.customer_phone` 是全域主鍵，`orders.customer_phone` 也透過舊外鍵依賴它。因此，不同租戶無法保存相同電話；直接移除主鍵或重建資料表又會一次影響大量舊版 API。

## 相容遷移策略

Phase 8 保留舊欄位作為內部 relation key，新增正式客戶識別欄位：

- `customers.customer_id`：V2 客戶識別碼。
- `customers.contact_phone`：實際聯絡電話。
- `orders.customer_id`：訂單對應的 V2 客戶識別碼。
- `orders.contact_phone`：訂單顯示及搜尋用電話。

新增租戶內唯一規則：

```text
UNIQUE (tenant_slug, contact_phone)
```

新增訂單與客戶的租戶關聯 Trigger，避免 customer id 或舊 relation key 跨租戶誤接。

## 新客戶識別規則

`customer_id` 由以下資料產生穩定 SHA-256 識別碼：

```text
tenant_slug + normalized contact phone
```

因此：

- 同租戶、同電話會取得相同 customer id。
- 不同租戶、同電話會取得不同 customer id。
- 電話格式中的空白與連字號不會造成重複客戶。

## 舊欄位相容性

舊版 `customer_phone` 欄位暫時繼續作為內部 relation key，以維持既有訂單外鍵及 demo 舊版流程。

V2 API 對外回傳：

```json
{
  "customer_id": "CUS...",
  "customer_phone": "0912000000",
  "customer_key": "內部 relation key"
}
```

一般畫面應使用 `customer_phone`，不得把 `customer_key` 當成聯絡電話。

## Migration

```text
migrations/0108_tenant_customer_identity.sql
```

Migration 會：

1. 為既有 customers 補 customer id 及 contact phone。
2. 為既有 orders 補 customer id 及 contact phone。
3. 建立租戶內電話唯一索引。
4. 建立 customer id 唯一索引。
5. 建立訂單與客戶跨租戶 Trigger。

## 已切換的 V2 流程

- `POST /api/v2/bookings`
- `GET /api/v2/customers`
- `GET /api/v2/orders`
- `GET /api/v2/payments`

預約建單會把客戶更新與訂單新增放在同一個 D1 batch，降低部分寫入風險。

## 尚未切換

- 大量 legacy Worker 客戶 API。
- 舊 Dashboard 內仍直接使用 legacy API 的部分畫面。
- 最終移除舊 phone primary key 的資料表重建。

正式開放第二租戶前，必須以 local D1 驗證：

- 不同租戶可使用同一電話。
- 同租戶相同電話只會有一筆 customer。
- 舊 demo 訂單與客戶資料不減少。
- 舊外鍵與新 Trigger 同時正常。
