# TravelKeeper 租戶隔離 Phase 2：預約與付款寫入

## 已完成

- `POST /api/v2/bookings`
  - 必須使用有效 LINE Access Token
  - 顧客 LINE UID 只採用 Worker 驗證後的 `X-User-Uid`
  - 行程必須屬於指定租戶、已上架、未刪除且未過期
  - 推薦碼與業務必須屬於相同租戶且會員狀態為 active
  - 訂單與客戶資料明確寫入 `tenant_slug`
  - 跨租戶電話主鍵衝突時安全拒絕，不覆蓋其他業者資料

- `POST /api/v2/payments/create`
  - 訂單必須屬於指定租戶
  - 付款操作人必須是該訂單的 LINE 顧客
  - `demo` 暫時沿用既有藍新金流邏輯
  - 非 `demo` 租戶在獨立金流設定完成前回傳 `TENANT_PAYMENT_CONFIGURATION_REQUIRED`

- `booking.html`
  - 租戶、推薦碼與行程全部改用 V2 API
  - 不再下載全平台行程
  - 建單及付款使用驗證後的 LINE Access Token
  - 非 demo 金流未設定時，保留已建立訂單並顯示人工付款提示

## 安全決策

現有藍新參數仍儲存在全平台 `system_settings/payment`。在建立 `tenant_payment_settings` 並完成各租戶通知驗證前，禁止其他租戶使用 demo 商店，避免款項進入錯誤商戶。

## 已知限制

1. `customers.customer_phone` 仍是全域主鍵；不同租戶使用相同電話時，系統會拒絕第二筆，而不是污染資料。
2. 分享事件與 Telegram 通知尚未接回 V2 建單流程。
3. 藍新 Notify／Return 仍由舊路由處理，現階段只開放 demo。
4. `dashboard.html` 尚未全面切換 V2 API。

## 驗證

GitHub Actions `Tenant isolation checks` 執行：

```bash
node --check worker-tenant.js
node --check lib/tenant-context.js
node --check lib/line-auth.js
node --check lib/tenant-api.js
node --check lib/tenant-booking-api.js
node --test tests/tenant-isolation.test.mjs tests/tenant-booking-isolation.test.mjs
```

驗證包含：跨租戶行程阻擋、偽造 LINE UID 無效、跨租戶電話衝突保護、付款租戶驗證，以及非訂單本人不得建立付款。
