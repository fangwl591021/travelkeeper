# TravelKeeper Phase 10：租戶化頁面與 Bearer Token

## 完成範圍

- `dashboard.html`：身份與核心客戶／訂單／行程／分銷商資料改用租戶 V2 API。
- `admin.html`：改為保留 tenant/query/hash 的安全轉址，避免維護兩套後台。
- `crm.html`：客戶與訂單改讀 V2；全域 LINE CRM 僅保留 demo 使用。
- `model.html`：公開行程走 V2，登入後的訂單、名片與分銷商管理走租戶 API。
- `Pay balance.html`：租戶 LIFF 驗證後查訂單及建立尾款付款。
- `Thank you.html`：租戶 LIFF 驗證後才可輪詢付款狀態。

## 共用 Browser Client

`js/tenant-page-client.js` 統一處理：

- tenant slug
- localhost-only Worker override
- LINE Access Token / local dev UID
- 客戶與訂單欄位相容
- V2 訂單、客戶、付款、行程、個人資料及分銷商 API

## 新增後端 API

- `POST /api/v2/orders/{order_id}/balance-paid`
- `GET/POST /api/v2/tenant/profile`
- `GET /api/v2/distributors`
- `POST /api/v2/distributors/{uid}/status`
- `POST /api/v2/distributors/{uid}/upload`

## 安全邊界

- 顧客付款頁不再只靠 order id 讀取資料。
- 非 demo CRM 不讀全域 LINE OA CRM。
- Dashboard 核心資料不再以 uid query 作為身份依據。
- `admin.html` 不再保留另一套 uid-only 後台。

## 尚未完成

- 非 demo LINE OA 對話與 CRM profile 的 tenant schema。
- 行程寫入、審核與部分內部營運頁的全面 V2 化。
- 正式 CORS allowlist。
- 最終 customers 表重建及移除舊 phone primary key。
