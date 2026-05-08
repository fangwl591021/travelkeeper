# TravelKeeper 流程體檢與 SOP

本文件定義 TravelKeeper 目前營運主流程、角色權限、狀態機、異常處理建議，作為後續重構、搬移 D1、補權限驗證與對帳機制的基準。

## 1. 目標流程

TravelKeeper 目前的核心流程如下：

1. 邀請業務註冊成分銷商
2. 管理員核准後成為可推廣的分銷商
3. 管理員可額外授權上架權
4. 分銷商分享推薦碼 / Flex Card / 推廣連結
5. 客戶透過分享入口進入 `tour.html` / `booking.html`
6. 建立訂單並綁定分銷商歸屬
7. 客戶透過藍新 / LINE Pay 完成付款
8. 系統回寫訂單、付款、佣金狀態
9. 管理員月結佣金，將可請款訂單標記為已撥款

## 2. 角色定義

系統角色建議固定為以下四種：

- `admin`
  - 管理分銷商
  - 授權上架
  - 審核行程
  - 查全部訂單
  - 標記尾款已收
  - 佣金撥款
- `distributor`
  - 查看自己的客戶、訂單、佣金
  - 推廣已上架行程
  - 若 `canUpload = true`，可新增 / 修改自己的行程
- `customer`
  - 建立自己的預約
  - 查自己的訂單狀態
  - 完成付款
- `guest`
  - 只能看公開行程、公開品牌頁、註冊頁

## 3. 分銷商 SOP

### 3.1 註冊

入口：

- `register.html`
- Worker: `/api/partner/register`
- GAS: `registerDistributor`

建議 SOP：

1. 管理員發送註冊邀請給業務
2. 業務於 `register.html` 完成申請
3. 系統寫入 `Distributors`
4. 狀態初始為 `pending`
5. 系統產生唯一 `inviteCode`

建議欄位：

- `uid`
- `name`
- `phone`
- `status`
- `agencySlug`
- `inviteCode`
- `canUpload`
- `commission`

### 3.2 審核

入口：

- `dashboard.html` 分銷商管理
- GAS: `updateDistributorStatus`

建議狀態機：

- `pending`
- `active`
- `suspended`
- `rejected`

說明：

- `active`：可推廣
- `suspended`：暫停推廣、暫停上架、保留歷史資料
- `rejected`：未通過申請

不建議同時混用 `approved` 與 `active`。

### 3.3 上架權

入口：

- `grantUploadPermission`

建議規則：

- 分銷資格與上架資格分開
- `status = active` 不代表一定可上架
- 只有 `status = active && canUpload = true` 才可新增或修改行程

## 4. 行程 SOP

### 4.1 推廣行程

推廣頁只顯示：

- `reviewStatus = published`

推廣不應顯示：

- `draft`
- `pending_review`
- `rejected`
- `archived`

### 4.2 上架 / 編輯

入口：

- `dashboard.html`
- GAS: `addItinerary`
- GAS: `updateItinerary`
- GAS: `reviewItinerary`

建議狀態機：

- `draft`
- `pending_review`
- `published`
- `rejected`
- `archived`

建議規則：

1. 管理員新增行程可直接 `published`
2. 分銷商新增行程預設 `pending_review`
3. 分銷商修改已上架行程後，應重新進入 `pending_review`
4. 刪除行程不建議硬刪，應改為 `archived`

## 5. 推廣與歸屬 SOP

### 5.1 推廣入口

目前可用的推廣方式：

- 推薦碼 `inviteCode`
- 推廣連結
- Flex Card

建議最終統一成：

- 所有分享連結都帶 `invite=<inviteCode>`
- 所有推廣素材都由後端組裝，不讓前端自行拼參數

### 5.2 歸屬優先順序

建立訂單時，分銷商歸屬建議固定如下：

1. 若有 `invite_code`，先用 `resolveInviteCode`
2. 若無 `invite_code`，才使用 `distributor_uid`
3. 若兩者都沒有，拒絕建立分銷訂單

### 5.3 客戶歸屬規則

`Customers` 表建議維持「首次歸屬鎖定」：

1. 用正規化後的 `customerPhone` 當唯一鍵
2. 首次下單寫入 `ownerUid`
3. 後續同電話客戶累加訂單與金額
4. `ownerUid` 不再變動

建議一定補 `normalizePhone()`，避免以下資料被當成不同客戶：

- `0912345678`
- `0912-345-678`
- `+886912345678`

## 6. 訂單 SOP

入口：

- Worker: `/api/orders/create`
- GAS: `createOrder`

建議建立訂單時寫入以下核心資料：

- `order_id`
- `itinerary_id`
- `itinerary_title`
- `distributor_uid`
- `customer_name`
- `customer_phone`
- `customer_line_uid`
- `travelers`
- `travel_date`
- `total_amount`
- `commission_rate_snapshot`
- `commission_amount`

### 6.1 佣金快照

佣金率應在建單時快照，不應於報表階段再去抓 `Distributors.commission` 重新計算。

理由：

- 月中改佣金率不應影響舊單
- 對帳與請款才有法律與財務一致性

## 7. 金流 SOP

支付入口：

- Worker: `/api/payment/create`
- Worker: `/api/payment/notify`
- Worker: `/api/payment/return`

支付方式：

- `credit_card`
- `linepay`
- `vacc`
- `offline`

### 7.1 訂單狀態機

- `pending`
- `confirmed`
- `completed`
- `cancelled`

定義：

- `pending`：已建單，尚未完成關鍵付款
- `confirmed`：至少訂金已付款
- `completed`：尾款已完成，或全額單已完成
- `cancelled`：作廢

### 7.2 訂金狀態機

- `unpaid`
- `awaiting_atm`
- `paid`
- `failed`

### 7.3 尾款狀態機

- `not_required`
- `unpaid`
- `awaiting_atm`
- `paid_online`
- `paid_offline`
- `failed`

### 7.4 佣金狀態機

- `pending`
- `payable`
- `paid_out`

觸發規則建議固定如下：

1. 全額單付款完成
   - `commission_status => payable`
2. 訂金單只有訂金付款成功
   - `commission_status` 仍為 `pending`
3. 訂金單尾款付款成功
   - `commission_status => payable`
4. 管理員完成月結撥款
   - `commission_status => paid_out`

## 8. 藍新 / LINE Pay 注意事項

### 8.1 Notify 才是真實依據

以下規則不可改：

- `ReturnURL` 只負責導頁
- `NotifyURL` 才是付款成功與否的唯一真實依據

### 8.2 支付建立不可掃整張 Orders

目前若付款建立仍依賴 `getAllOrders` 找單，會有兩個問題：

- 慢
- 快取與付款狀態容易不同步

建議改成單筆查詢：

- `getOrderById`

### 8.3 金流重複建立

建議新增 `payment_attempts` 概念，避免同一筆訂單反覆建立相同交易單號。

建議欄位：

- `attempt_id`
- `order_id`
- `leg`
- `merchant_order_no`
- `status`
- `created_at`

## 9. 權限與安全體檢

目前最需要補強的是：後端不能再信任前端傳入的 `uid` / `operatorUid`。

### 9.1 必補

1. Worker 驗證 LIFF / LINE token
2. Worker 根據驗證結果取得真實 `uid`
3. 敏感 API 不接受前端自填的授權身分
4. GAS 僅接受來自 Worker 的內部呼叫

### 9.2 高風險操作

以下操作都必須做後端權限驗證：

- 核准分銷商
- 授權上架
- 審核行程
- 查全部訂單
- 標記尾款已收
- 佣金撥款

## 10. 管理員營運 SOP

### 每日

1. 查看待審分銷商
2. 查看待審行程
3. 查看未完成付款 / 尾款異常訂單
4. 查看當日新客戶與新訂單

### 每週

1. 檢查異常支付
2. 檢查歸屬不明訂單
3. 檢查重複客戶資料

### 每月

1. 產出 `commission_status = payable` 清單
2. 匯款給分銷商
3. 執行 `payoutCommission`
4. 留下批次號、付款日期、操作者

## 11. 建議補件清單

優先順序建議如下：

1. 後端身份驗證
2. 狀態機收斂
3. 客戶電話正規化
4. 佣金率快照
5. 單筆查詢 API
6. 軟刪除 / archived
7. payout batch 與 audit log
8. D1 正式資料表與索引

## 12. 最終結論

TravelKeeper 現在已經不是單純展示頁，而是一套：

- 分銷招募系統
- 行程上架與審核系統
- 推廣歸屬系統
- 訂單與金流系統
- 佣金結算系統

主流程方向是正確的，商業模型也清楚。下一步不是盲目加新功能，而是把以下四件事做硬：

- 權限
- 歸屬
- 金流狀態
- 佣金對帳

這四件補穩後，再搬 D1 會非常順。
