# TravelKeeper Phase 11：租戶化 CRM 主檔、對話與重要紀錄

## 目標

Phase 11 將 CRM 從 demo 專用的全域 LINE OA 資料結構拆出，改成每個租戶都能安全使用的 CRM Schema 與 V2 API。

核心原則：

- CRM 個資、LINE UID、商機、對話與重要紀錄均包含 `tenant_slug`。
- 非 demo 租戶不再讀取全域 `/api/line-oa/crm` 或 `/api/line-oa/customer-profiles`。
- 訂單客戶以 `customer_id` 關聯 CRM profile，電話只作聯絡欄位。
- LINE-only 客戶可以沒有訂單 customer，但仍有獨立 CRM profile。
- Finance 不具備 CRM 敏感個資讀取權限；仍可使用原有訂單、付款與結算 API。

## Migration

新增：

```text
migrations/0109_tenant_crm.sql
```

資料表：

```text
tenant_crm_profiles
tenant_crm_threads
tenant_crm_records
```

### tenant_crm_profiles

保存：

- customer_id
- LINE user UID
- 姓名、電話、Email、生日、地址
- 證件／個資備註
- 旅遊偏好與禁忌
- 個資同意狀態
- 推薦與歸屬資料
- 商機階段、預估金額、風險、處理狀態
- 標籤、摘要與最後訊息時間

唯一性：

- `(tenant_slug, customer_id)` 租戶內唯一
- `(tenant_slug, line_user_uid)` 租戶內唯一

相同 LINE UID 或電話可存在不同租戶，不會跨租戶覆蓋。

### tenant_crm_threads

保存租戶內對話執行緒與目前狀態：

- profile_id
- customer_id
- line_user_uid
- channel_key
- status / risk
- summary / note / tags
- last_message_at / last_inbound_at / last_outbound_at

本階段先提供租戶 staff API；LINE Webhook 自動寫入與各租戶 LINE OA Channel Secret／Access Token 將於後續階段處理。

### tenant_crm_records

保存重要紀錄與跟進任務：

- category
- content
- status
- priority
- due_at
- created_by / updated_by
- deleted_at

## 既有資料回填

Migration 會從 `customers` 回填 CRM profile：

```text
profile.id = customers.customer_id
profile.customer_id = customers.customer_id
profile.phone = customers.contact_phone
profile.line_user_uid = customers.customer_line_uid
profile.owner_uid = customers.owner_uid
```

已成交客戶預設：

```text
status = closed
opportunity_stage = won
opportunity_value = customers.total_amount
```

Migration 不刪除或改寫 customers、orders。

## API

### CRM 整合清單

```http
GET /api/v2/crm
```

整合回傳：

- CRM profile
- customer 主檔
- orders
- thread
- active records
- summary

### CRM Profile

```http
POST /api/v2/crm/profiles
GET  /api/v2/crm/profiles/:id
POST /api/v2/crm/profiles/:id
```

### Threads

```http
GET  /api/v2/crm/threads
POST /api/v2/crm/threads
```

### Important Records

```http
GET    /api/v2/crm/records?profile_id=...
POST   /api/v2/crm/records
POST   /api/v2/crm/records/:id
DELETE /api/v2/crm/records/:id
```

刪除採 soft delete。

## 權限

### platform_admin / tenant_admin

- 可讀取租戶全部 CRM 資料。
- 可修改租戶內全部 profile、thread、record。

### sales / editor

- 只能讀取或修改 `owner_uid` 為自己的 CRM profile。
- 訂單與客戶仍依自身業務歸屬過濾。

### finance

- 不可讀取 CRM 敏感主檔。
- 回 `TENANT_ROLE_DENIED`。
- 仍可使用付款與結算相關 API。

### member / customer

- 不可進入 staff CRM API。

## 跨租戶 Trigger

Migration 包含：

```text
TENANT_MISMATCH:crm_profile_customer
TENANT_MISMATCH:crm_thread_profile
TENANT_MISMATCH:crm_record_profile
TENANT_MISMATCH:crm_record_thread
```

即使未來其他程式直接寫 D1，也不能把另一租戶的 customer、profile、thread 或 record 串在一起。

## 前端

新增：

```text
js/tenant-crm-client.js
```

`crm.html` 統一使用：

```javascript
TravelKeeperTenantCrm.load()
TravelKeeperTenantCrm.saveProfile()
TravelKeeperTenantCrm.listThreads()
TravelKeeperTenantCrm.saveThread()
TravelKeeperTenantCrm.listRecords()
TravelKeeperTenantCrm.saveRecord()
TravelKeeperTenantCrm.deleteRecord()
```

不再區分 demo 使用全域 LINE CRM、非 demo 只讀訂單客戶的兩套資料流程。

## 尚未完成

- 每租戶 LINE OA Channel Secret／Access Token 加密設定。
- LINE Webhook 依 Channel／Tenant 自動辨識與寫入 thread。
- LINE message 明細表與附件私有儲存。
- AI 回覆上下文直接讀取租戶 CRM profile。
- CRM profile 與 LINE Login／Messaging API 身分認領流程。
- 正式 CORS allowlist。
