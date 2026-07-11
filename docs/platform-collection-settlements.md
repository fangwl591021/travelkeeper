# TravelKeeper 平台代收結算

平台代收結算只處理「平台代替租戶收取的旅費本金」。

個別合作業務的佣金仍使用既有：

- `orders.commission_amount`
- `orders.commission_status`
- 原佣金結算／付款流程

兩者不可混算，避免同一筆訂單重複扣款或重複付款。

## 資料流程

```text
payment_attempts.status = paid
  ↓
POST /api/v2/platform-settlements/sync
  ↓
platform_collection_payables
  ↓ 等待 hold_days
eligible
  ↓ 建立批次
platform_collection_batches = draft
  ↓ 平台管理員核准
approved
  ↓ 實際匯款並填寫憑證
paid
```

## 結算公式

```text
應付金額 = 代收總額
         - 金流手續費
         - 平台服務費
         - 暫留款
```

支援：

- 金流費率
- 金流固定費
- 平台服務費率
- 平台固定費
- 暫留款比例
- 保留天數
- 最低結算金額

所有金額以整數新台幣儲存。

## demo 與合作租戶

- `demo` 的 `beneficiary_type = platform`：只建立留存帳本，不建立對外撥款批次。
- 其他平台代收租戶預設 `beneficiary_type = tenant`，並採 7 天保留期。
- 非 `platform_collect` 租戶不可同步平台代收應付款。

## API

### 查詢規則

```http
GET /api/v2/platform-settlements/rule
Authorization: Bearer <LINE access token>
X-Tenant-Slug: partner-a
```

### 修改規則

僅 `platform_admin`：

```http
POST /api/v2/platform-settlements/rule
Content-Type: application/json
Authorization: Bearer <LINE access token>
X-Tenant-Slug: partner-a

{
  "beneficiary_type": "tenant",
  "gateway_fee_rate": 2.8,
  "gateway_fee_fixed": 0,
  "platform_fee_rate": 5,
  "platform_fee_fixed": 0,
  "reserve_rate": 10,
  "hold_days": 7,
  "minimum_payout": 1000,
  "enabled": true
}
```

### 同步已付款資料

```http
POST /api/v2/platform-settlements/sync
```

每個 `payment_attempt_id` 在同一租戶只會建立一筆應付款。

### 查詢應付款

```http
GET /api/v2/platform-settlements/payables?status=eligible
```

### 建立批次

```http
POST /api/v2/platform-settlements/batches

{
  "payable_ids": ["PCP..."],
  "note": "2026 年 7 月第一批"
}
```

不傳 `payable_ids` 時，會選取該租戶目前所有 eligible 且未入批次的應付款。

### 核准批次

```http
POST /api/v2/platform-settlements/batches/{batchId}/approve
```

### 標記已付款

```http
POST /api/v2/platform-settlements/batches/{batchId}/paid

{
  "payout_reference": "BANK-20260711-001"
}
```

## 權限

- `platform_admin`：設定規則、同步、建立、核准、標記付款。
- `tenant_admin`、`finance`：只能查詢自己租戶的規則、應付款與批次。
- 其他角色：無結算權限。

## 安全規則

- 應付款、訂單、付款紀錄及批次必須具有相同 `tenant_slug`。
- Migration Trigger 會阻擋跨租戶關聯。
- 一筆付款嘗試不可重複建立應付款。
- 已加入批次的應付款不可再次入批。
- 批次必須先核准才能標記付款。
- 標記付款必須填寫付款憑證編號。
- HTTP 狀態碼會區分 401、403、404、409、400 與 503。

## 上線前仍需驗證

1. 本機套用 `0104_platform_collection_settlements.sql`。
2. 使用真實 D1 日期格式驗證 `hold_days`。
3. 測試跨租戶 Trigger。
4. 測試同一付款重複執行 sync 不會重複入帳。
5. 測試兩位管理員同時建立批次的競態情境。
6. 確認平台服務費、金流費與暫留款的實際商業規則。
