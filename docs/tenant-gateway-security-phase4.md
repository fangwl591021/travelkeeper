# TravelKeeper Phase 4：租戶自有金流安全層

本階段只適用於：

```text
tenant_payment_settings.collection_mode = tenant_gateway
```

合作業務使用的 `platform_collect` 或 `offline` 不需要設定自有金流密鑰。

## 已完成

### 1. 密鑰加密儲存

新增：

```text
tenant_payment_gateway_credentials
```

明文欄位：

- tenant_slug
- provider
- merchant_id
- environment
- gateway_url
- protocol_version
- enabled

加密欄位：

- Hash Key
- Hash IV

Hash Key 與 Hash IV 會先組成 JSON，再使用 AES-256-GCM 加密。

資料庫只保存：

- secrets_ciphertext
- secrets_iv
- key_version

加密 Additional Authenticated Data：

```text
<tenant_slug>:<provider>:<key_version>
```

因此密文不能複製到另一個租戶或金流服務商使用。

### 2. Worker Secrets

正式環境必須設定：

```text
TENANT_PAYMENT_MASTER_KEY
TENANT_PAYMENT_KEY_VERSION=v1
```

主密鑰不得寫入：

- GitHub
- wrangler.toml
- D1
- 前端程式
- 日誌

金鑰輪替時可保留舊版本，例如：

```text
TENANT_PAYMENT_MASTER_KEY_V1
TENANT_PAYMENT_MASTER_KEY=<新的 v2 key>
TENANT_PAYMENT_KEY_VERSION=v2
```

### 3. 設定 API

```http
GET /api/v2/tenant/payment-gateway
Authorization: Bearer <LINE access token>
X-Tenant-Slug: agency-b
```

回傳只包含設定狀態，不回傳 Hash Key 或 Hash IV。

```http
POST /api/v2/tenant/payment-gateway
Authorization: Bearer <LINE access token>
X-Tenant-Slug: agency-b
Content-Type: application/json

{
  "merchant_id": "MS123456",
  "environment": "sandbox",
  "gateway_url": "https://ccore.newebpay.com/MPG/mpg_gateway",
  "protocol_version": "2.0",
  "hash_key": "32 characters",
  "hash_iv": "16 characters",
  "enabled": true
}
```

只有 `platform_admin` 或該租戶 `tenant_admin` 可以更新。

### 4. 租戶專屬回呼

藍新 Notify：

```text
/api/v2/payments/notify/tenant/<tenant_slug>
```

藍新 Return：

```text
/api/v2/payments/return/tenant/<tenant_slug>
```

回呼處理會驗證：

- TradeSha
- Merchant ID
- Merchant Order No
- tenant_slug
- payment_attempts 歸屬
- 回傳金額是否與付款紀錄相同

所有付款及訂單更新都包含：

```sql
WHERE tenant_slug = ?
```

### 5. 在途付款保護

付款表單建立後，即使管理員：

- 停用自有金流
- 把收款模式改為 offline
- 暫停新的付款

已經送往藍新的付款回呼仍會使用原加密設定驗證，並完成原訂單入帳。

這可避免政策異動造成已付款但系統未入帳。

## 安全限制

- 目前自有金流先支援藍新。
- LINE Pay 自有商戶尚未實作。
- 正式回呼必須使用 HTTPS Worker 網址。
- 不得刪除仍可能有在途交易的 gateway credentials；應先停用，再保留至少交易最長有效期。
- 正式金鑰輪替需要保留舊版環境密鑰，直到所有舊交易完成。

## 自動測試

GitHub Actions 已驗證：

- AES-GCM 加密／解密
- 密文不含明文 Hash Key／Hash IV
- 密文不可跨租戶使用
- 缺少或過短主密鑰會被拒絕
- Notify／Return 是公開 server-to-server 路由
- 金流停用後，在途成功回呼仍可更新原租戶付款及訂單
