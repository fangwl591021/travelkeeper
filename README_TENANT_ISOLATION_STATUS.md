# TravelKeeper Tenant Isolation Status

目前分支：`agent/tenant-isolation-phase1`

## 已完成

- 租戶會員、角色、權限與分銷商租戶資料
- 核心資料表 `tenant_slug`
- LINE Access Token 身分驗證
- V2 租戶、推薦碼、行程、訂單、客戶、付款查詢
- 公開行程頁與預約建單租戶化
- 三種收款模式：平台代收、自有金流、人工收款
- 平台代收付款紀錄保留正確租戶
- 自有金流密鑰 AES-GCM 加密儲存
- 租戶專屬藍新 Notify／Return
- 在途付款不受後續政策停用影響
- 平台代收應付款帳本、結算規則與批次流程
- 收款帳戶加密、平台驗證與稽核式解密
- 私有 R2 匯款憑證與租戶授權下載
- 獨立結算報表頁、日期篩選與 CSV 匯出
- 精準 HTTP 狀態碼與 GitHub Actions 隔離測試

## 尚未完成

- 本機套用 `0106_settlement_accounts_and_proofs.sql`
- 本機 R2 憑證上傳、下載、刪除及跨租戶驗收
- Dashboard 加入結算報表入口
- 正式上線前是否強制帳戶驗證與匯款憑證
- 客戶電話改為租戶複合鍵或內部 UUID
- Dashboard 全面改用 V2 API
- 自有 LINE Pay 商戶
- LINE OA、分享事件、Telegram、知識庫、圖文選單租戶化
- 正式 CORS 白名單
- 正式 D1 migration 與正式金流沙盒端到端驗收

本分支仍為 Draft，不可直接部署正式環境。
