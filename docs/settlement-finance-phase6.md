# TravelKeeper Phase 6：收款帳戶、私有憑證與結算報表

## 目標

在 Phase 5 的平台代收帳本與批次流程之上，加入：

1. 每個租戶的收款帳戶。
2. 平台匯款後的憑證附件。
3. 平台管理員、租戶管理員及財務人員可閱讀的結算報表。

## 收款帳戶安全規則

- 完整銀行帳號不以明文存入 D1。
- 使用 `TENANT_PAYMENT_MASTER_KEY` 與 AES-256-GCM 加密。
- 加密 AAD 綁定 `tenant_slug + payout_account + key_version`。
- 一般查詢只回傳銀行、戶名及帳號末四碼。
- 租戶管理員可設定自己租戶的帳戶；設定或修改後狀態回到 `pending`。
- 只有 `platform_admin` 可核准、退回、停用或解密查看完整帳號。
- 解密查看必須提供原因，並嘗試寫入租戶稽核紀錄。

## 私有匯款憑證

憑證物件存放在 R2 `TRAVEL` binding：

```text
private/settlement-proofs/{tenant_slug}/{batch_id}/{proof_id}-{filename}
```

規則：

- 不使用公開 R2 URL。
- 僅能透過已登入的 Worker API 下載。
- 檔案類型限 PDF、JPG、PNG、WebP。
- 單檔上限 8MB。
- D1 保存檔名、MIME、大小、SHA-256、參考編號及上傳者。
- 跨租戶批次與憑證由 D1 Trigger 阻擋。
- 上傳失敗時會刪除已寫入的 R2 物件，避免孤兒檔案。

## API

### 收款帳戶

```http
GET  /api/v2/settlement-finance/payout-account
POST /api/v2/settlement-finance/payout-account
POST /api/v2/settlement-finance/payout-account/verify
POST /api/v2/settlement-finance/payout-account/reveal
```

### 匯款憑證

```http
GET  /api/v2/settlement-finance/batches/{batch_id}/proofs
POST /api/v2/settlement-finance/batches/{batch_id}/proofs
GET  /api/v2/settlement-finance/proofs/{proof_id}/file
DELETE /api/v2/settlement-finance/proofs/{proof_id}
```

### 結算報表

```http
GET /api/v2/settlement-finance/report?from=YYYY-MM-DD&to=YYYY-MM-DD
```

回傳：

- 租戶收款帳戶摘要。
- 平台代收總額。
- 金流費、平台費、暫留款與應付淨額。
- 已付款與待付款金額。
- 各狀態應付款統計。
- 結算批次與憑證數量。

## 報表頁

正式或既有 Worker：

```text
settlements.html?tenant={tenant_slug}
```

本機 Worker 測試：

```text
settlements.html?tenant=partner-a&worker=http://127.0.0.1:8787
```

`worker` 查詢參數只接受 `localhost`、`127.0.0.1` 或 `[::1]`，其他外部網址會被忽略，避免把 LIFF Access Token 傳送到未受信任的主機。

功能：

- LIFF 登入與租戶權限驗證。
- 日期篩選。
- 結算摘要卡片。
- 收款帳戶設定與驗證。
- 結算批次列表。
- 私有憑證上傳及查看。
- CSV 匯出。

目前先以獨立頁面提供，避免直接重構既有大型 `dashboard.html`。待本機驗收後，再由 Codex 在 Dashboard 選單加入：

```text
settlements.html?tenant=<目前租戶>
```

## Migration

```text
migrations/0106_settlement_accounts_and_proofs.sql
```

新增：

- `tenant_payout_accounts`
- `platform_collection_batch_proofs`
- 結算批次收款帳戶快照欄位
- 憑證與批次跨租戶 Trigger

## 尚未啟用的強制規則

目前不會強制要求「帳戶已驗證」或「已有附件」才能將批次標記為已付款，避免破壞既有 Phase 5 流程。

正式上線前可再加入結算規則開關：

- `require_verified_account`
- `require_payout_proof`

## 部署限制

- PR 維持 Draft。
- 尚未套用 remote D1 migration。
- 尚未部署正式 Worker。
- 尚未驗證正式 R2 的私有讀取與物件刪除。
- 不得把 `.dev.vars`、完整帳號、正式密鑰或正式匯款憑證提交 Git。
