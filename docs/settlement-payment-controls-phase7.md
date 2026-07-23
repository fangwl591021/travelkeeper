# TravelKeeper Phase 7：結算付款強制管控

## 目的

在 Phase 5、Phase 6 已完成的結算批次、收款帳戶與私有憑證之上，加入兩個可逐租戶啟用的付款前檢核：

1. `require_verified_account`：收款帳戶必須已由平台核准。
2. `require_payout_proof`：結算批次必須至少存在一份未刪除的私有憑證。

## 相容性策略

兩個開關預設均為 `0`，所以既有租戶與既有結算批次不會突然被阻擋。

平台總管理員完成帳戶核對、操作流程與 R2 驗收後，可逐租戶啟用。

## Migration

```text
migrations/0107_settlement_payment_controls.sql
```

在 `platform_collection_settlement_rules` 新增：

```text
require_verified_account INTEGER NOT NULL DEFAULT 0
require_payout_proof INTEGER NOT NULL DEFAULT 0
```

## API

### 查詢管控設定

```http
GET /api/v2/platform-settlements/controls
Authorization: Bearer <LINE access token>
X-Tenant-Slug: <tenant>
```

允許角色：

- `platform_admin`
- `tenant_admin`
- `finance`

### 更新管控設定

```http
POST /api/v2/platform-settlements/controls
Authorization: Bearer <LINE access token>
X-Tenant-Slug: <tenant>
Content-Type: application/json

{
  "require_verified_account": true,
  "require_payout_proof": true
}
```

只有 `platform_admin` 可以更新。

## 付款前檢核

`POST /api/v2/platform-settlements/batches/{id}/paid` 目前由 `settlement-payment-control-api.js` 優先攔截。

執行順序：

1. 驗證平台總管理員。
2. 驗證付款參考編號。
3. 驗證批次存在且狀態為 `approved`。
4. 讀取租戶付款管控。
5. 若要求帳戶核准，確認 `tenant_payout_accounts`：
   - `enabled = 1`
   - `verification_status = verified`
6. 若要求付款憑證，確認 `platform_collection_batch_proofs` 至少一筆：
   - 相同 `tenant_slug`
   - 相同 `batch_id`
   - 尚未刪除
7. 通過後標記批次與應付款為 `paid`。
8. 若有已核准帳戶，同步保存銀行代碼、銀行名稱、戶名與末四碼快照。

## 錯誤代碼

```text
PAYOUT_ACCOUNT_NOT_VERIFIED  HTTP 409
SETTLEMENT_PROOF_REQUIRED    HTTP 409
```

任何一項檢核失敗時：

- 批次不得改成 `paid`。
- 應付款不得改成 `paid`。
- 不得寫入部分付款狀態。

## 建議正式啟用順序

1. 先完成租戶收款帳戶設定與平台核准。
2. 先啟用 `require_verified_account`。
3. 確認平台財務已習慣上傳匯款憑證。
4. 再啟用 `require_payout_proof`。
5. 不建議一次對全部既有租戶啟用。

## 部署限制

- PR 維持 Draft。
- 尚未套用 remote D1 migration。
- 尚未部署正式 Worker。
- 完成本機 0107、開關、阻擋與付款成功驗收前，不得正式啟用。
