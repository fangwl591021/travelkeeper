# TravelKeeper Tenant Isolation Status

目前分支：`agent/tenant-isolation-phase1`

## 已完成

- 租戶會員、角色、權限與分銷商租戶資料
- 核心資料表 `tenant_slug`
- LINE Access Token 身分驗證
- V2 租戶、推薦碼、行程、訂單、客戶、付款查詢
- 公開行程頁租戶化
- 預約建單租戶化
- 三種收款模式：平台代收、自有金流、人工收款
- 平台代收付款紀錄保留正確租戶
- 自有金流密鑰 AES-GCM 加密儲存
- 租戶專屬藍新 Notify／Return
- 在途付款不受後續政策停用影響
- GitHub Actions 語法與隔離測試

## 尚未完成

- 平台代收結算及應付合作業務款
- customers 複合主鍵或內部 UUID
- dashboard 全面改用 V2 API
- 自有 LINE Pay 商戶
- LINE OA、分享事件、Telegram、知識庫、圖文選單租戶化
- 正式 CORS 白名單
- 正式 D1 migration 與正式金流沙盒端到端驗收

本分支仍為 Draft，不可直接部署正式環境。
