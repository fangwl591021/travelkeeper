# Server-signed Referral Token

## 目的

推薦歸屬不能由瀏覽器提交的 `distributor_uid`、`invite_code` 或 URL query 直接決定。分享服務現在可簽發只讀 bearer token，booking API 只在 HMAC 驗證成功且內容符合租戶與行程時採用推薦歸屬。

## Token claims

Token payload 包含：

- `v`
- `tenant_slug`
- `itinerary_id`
- `distributor_uid`
- `invite_code`
- `iat`
- `exp`
- `jti`

Token 使用 HMAC-SHA-256，預設有效期 7 天，最長 30 天。Payload 不包含客戶資料、LINE credential、session token 或付款資料。

## 簽發邊界

既有 server-side `/api/flex/build` 在產生 booking/detail URI 前驗證：

- `REFERRAL_SIGNING_SECRET` 存在
- `uid` 與 `inviteCode` 均存在
- distributor 為 `approved`
- distributor 的 `invite_code` 與 `uid` 一致
- distributor 的 `agency_slug` 與請求 tenant 一致

簽發失敗會 fail closed，不產生未簽名的新推薦連結。

## 驗證邊界

`POST /api/v2/bookings` 若收到 `referral_token`，會驗證：

- HMAC signature
- token version
- issued time / expiry
- tenant_slug
- itinerary_id
- body 內若另帶 `distributor_uid` 或 `invite_code`，必須與 token 完全一致
- token claims 對應的 tenant membership 必須是 active 的 `sales` 或 `editor`

驗證失敗不會寫入 customer 或 order。

## 相容性與 rollout

- 新 Flex booking/detail links 使用 `rt` token query。
- `booking.html` 可接受 token-only link。
- 舊 raw referral links 暫時保留相容，但不應再由新分享流程產生。
- 啟用前必須在 production Worker 與 staging Worker 設定相同的 `REFERRAL_SIGNING_SECRET`。
- secret 缺少時 server-side share builder 回傳 `REFERRAL_SIGNING_NOT_CONFIGURED`，不 fallback 成未簽名新連結。

## 風險與後續

Token 是 bearer credential，取得 token 的人可在有效期內使用該推薦歸屬。應透過 HTTPS 傳輸、避免寫入 analytics/referrer，並在需要撤銷時旋轉 signing secret。若需要單次使用或即時撤銷，下一階段再增加 server-side nonce ledger；本次不新增 migration 或資料表。