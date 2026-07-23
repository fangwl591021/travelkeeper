# TravelKeeper 租戶收款模式

租戶與收款方式分開管理。被授權業者不代表一定擁有自己的金流商店。

## 三種模式

### 1. `platform_collect`：平台代收

適用：

- 合作業務
- 經銷或推廣夥伴
- 沒有自有金流，但由平台統一收款及後續結算的業者

規則：

- 使用平台既有藍新金流商店
- 必須由平台總管理員核准
- 訂單、付款紀錄仍保留原租戶 `tenant_slug`
- 後續須建立平台代收結算報表與對帳流程

### 2. `tenant_gateway`：租戶自有金流

適用：

- 擁有自己藍新、LINE Pay 或其他商戶帳號的旅行業者
- 款項必須直接進入該業者商戶

規則：

- 不得 fallback 使用平台商店
- 自有密鑰、Notify、Return 尚未完成前不啟用付款
- 訂單可先建立，付款方式由客服協助

### 3. `offline`：人工收款

適用：

- 僅合作推廣、報名後人工確認
- 匯款、現金、業務收款或其他線下方式

規則：

- 不建立線上付款紀錄
- 預約訂單正常建立
- 畫面提示業務或客服另行聯絡付款

## 安全預設

- `demo`：`platform_collect + newebpay`
- 其他新租戶：`offline + none`
- 平台代收只能由 `platform_admin` 核准
- 租戶管理員可選擇人工收款或提出自有金流設定

## API

```http
GET /api/v2/tenant/payment-policy
Authorization: Bearer <LINE access token>
X-Tenant-Slug: <tenant>
```

```http
POST /api/v2/tenant/payment-policy
Authorization: Bearer <LINE access token>
X-Tenant-Slug: <tenant>
Content-Type: application/json

{
  "collection_mode": "offline",
  "provider": "none",
  "enabled": true,
  "display_label": "人工收款",
  "settlement_note": "業務將另行聯絡付款"
}
```

平台代收設定需使用平台總管理員身分：

```json
{
  "collection_mode": "platform_collect",
  "provider": "newebpay",
  "enabled": true,
  "display_label": "平台代收"
}
```

## 後續

1. 建立自有金流密鑰加密儲存
2. 建立租戶專屬 Notify／Return
3. 建立平台代收結算及應付業務款
4. 後台增加收款模式設定畫面
5. 增加雙租戶端到端付款測試
