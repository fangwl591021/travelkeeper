# TravelKeeper mother-site API contract

This document defines the TravelKeeper-only mother-site integration contract.
Do not reuse API shapes, storage paths, or data from other projects.

## Boundary

TravelKeeper owns real-time operation in Cloudflare:

- D1 is the operational database.
- R2 stores TravelKeeper images and DM-derived assets.
- The Worker is the API gateway, validation layer, and sync adapter.

The mother site is the central archive/CRM/reporting system. It receives clean TravelKeeper records and may return approved master data. It must not push unrelated project data into TravelKeeper.

## Sync Principles

1. Every request must include `project = "travelkeeper"`.
2. Every record must include `entity_type`, `local_id`, and `updated_at`.
3. Sync must be idempotent. Repeating the same payload must not create duplicates.
4. TravelKeeper D1 remains the source of truth for live booking, payment, commission, and share tracking unless a later decision changes that ownership.
5. Mother-site data can update master/profile fields, but must not overwrite payment or commission state without an explicit settlement event.
6. Non-TravelKeeper payloads must be rejected or marked ignored.

## Authentication

Use both an API key and HMAC signature.

Required headers:

- `Authorization: Bearer <TRAVELKEEPER_MOTHER_API_KEY>`
- `X-TK-Timestamp: <unix seconds>`
- `X-TK-Signature: sha256=<hex hmac>`
- `Content-Type: application/json`

HMAC base string:

```text
<timestamp>.<raw request body>
```

Reject when timestamp drift exceeds 5 minutes.

## Direction Model

### TravelKeeper to Mother

Push operational facts:

- distributor registration and approval state
- itinerary publication and maintenance state
- orders
- payment updates
- commission settlement status
- customer profile captured from orders or LINE OA monitor

### Mother to TravelKeeper

Pull or receive master data only:

- approved distributor profile corrections
- itinerary metadata approved by admin
- global configuration such as payment method availability
- blacklist or compliance flags

Do not push unrelated course, product, point, LINE card, or ACTION data into TravelKeeper.

## Required Endpoints

These endpoints describe the mother-site API that TravelKeeper Worker can call.

### Health

`GET /tk/v1/health`

Response:

```json
{
  "success": true,
  "project": "travelkeeper",
  "server_time": "2026-05-23T00:00:00.000Z"
}
```

### Upsert Distributor

`POST /tk/v1/distributors/upsert`

Payload:

```json
{
  "project": "travelkeeper",
  "local_id": "Uxxxxxxxx",
  "name": "Tonyfang",
  "phone": "0927136847",
  "email": "fangwl591021@gmail.com",
  "company_name": "",
  "tax_id": "",
  "invite_code": "HTSCQY",
  "status": "approved",
  "can_upload": true,
  "profile": {
    "avatar": "",
    "bio": "",
    "line_link": "",
    "line_at_link": "",
    "fb_link": "",
    "ig_link": "",
    "web_link": "",
    "map_link": ""
  },
  "bank": {
    "bank_name": "",
    "bank_branch": "",
    "bank_account": "",
    "bank_holder": ""
  },
  "updated_at": "2026-05-23T00:00:00.000Z"
}
```

Mapping to D1:

| Payload field | D1 table.field |
| --- | --- |
| `local_id` | `distributors.uid` |
| `name` | `distributors.name` |
| `phone` | `distributors.phone` |
| `email` | `distributors.email` |
| `company_name` | `distributors.company_name` |
| `tax_id` | `distributors.tax_id` |
| `invite_code` | `distributors.invite_code` |
| `status` | `distributors.status` |
| `can_upload` | `distributors.can_upload` |
| `profile.*` | matching distributor profile fields |
| `bank.*` | matching bank fields |

### Upsert Itinerary

`POST /tk/v1/itineraries/upsert`

Payload:

```json
{
  "project": "travelkeeper",
  "local_id": "1778493172612",
  "title": "洪玩土樓人文慢旅",
  "region": "國旅",
  "price": 19900,
  "days": 5,
  "image": "https://pub-...r2.dev/tours/cover.jpg",
  "description": "行程描述 markdown/text",
  "notes": "注意事項",
  "owner_uid": "Uf729764dbb5b652a5a90a467320bea29",
  "owner_name": "Tonyfang",
  "review_status": "published",
  "payment_mode": "deposit",
  "deposit_ratio": 20,
  "balance_collect": "online",
  "commission_mode": "amount",
  "commission_amount": 1650,
  "commission_percent": 0,
  "seat_limit": 30,
  "min_group_size": 10,
  "allowed_payment_methods": ["credit_card", "linepay", "atm"],
  "share_enabled": true,
  "deleted_at": "",
  "updated_at": "2026-05-23T00:00:00.000Z"
}
```

Mapping to D1:

| Payload field | D1 table.field |
| --- | --- |
| `local_id` | `itineraries.id` |
| `title` | `itineraries.title` |
| `region` | `itineraries.region` |
| `price` | `itineraries.price` |
| `days` | `itineraries.days` |
| `image` | `itineraries.image` |
| `description` | `itineraries.description` |
| `notes` | `itineraries.notes` |
| `owner_uid` | `itineraries.owner_uid` |
| `owner_name` | `itineraries.owner_name` |
| `review_status` | `itineraries.review_status` |
| `payment_mode` | `itineraries.payment_mode` |
| `deposit_ratio` | `itineraries.deposit_ratio` |
| `balance_collect` | `itineraries.balance_collect` |
| `commission_amount` | `itineraries.commission_amount` |
| `commission_mode` | `itineraries.commission_mode` |
| `commission_percent` | `itineraries.commission_percent` |
| `seat_limit` | `itineraries.seat_limit` |
| `min_group_size` | `itineraries.min_group_size` |
| `allowed_payment_methods` | `itineraries.allowed_payment_methods` as CSV |
| `share_enabled` | `itineraries.share_enabled` |
| `deleted_at` | `itineraries.deleted_at` |

### Upsert Customer

`POST /tk/v1/customers/upsert`

Payload:

```json
{
  "project": "travelkeeper",
  "local_id": "0927136847",
  "customer_phone": "0927136847",
  "customer_name": "Tonyfang",
  "customer_line_uid": "Uxxxxxxxx",
  "owner_uid": "Uf729764dbb5b652a5a90a467320bea29",
  "owner_name": "Tonyfang",
  "source": "referral",
  "note": "",
  "updated_at": "2026-05-23T00:00:00.000Z"
}
```

`customer_phone` is the D1 primary key. If a mother-site record has no phone, it must not be inserted into `customers`; keep it in a review queue.

### Upsert Order

`POST /tk/v1/orders/upsert`

Payload:

```json
{
  "project": "travelkeeper",
  "local_id": "ORD17774212122589648",
  "order_id": "ORD17774212122589648",
  "itinerary_id": "1778493172612",
  "itinerary_title": "洪玩土樓人文慢旅",
  "price": 16500,
  "distributor_uid": "Uf729764dbb5b652a5a90a467320bea29",
  "customer_name": "Tonyfang",
  "customer_phone": "0927136847",
  "customer_line_uid": "Uxxxxxxxx",
  "travelers": 2,
  "travel_date": "2026-05-02",
  "note": "",
  "status": "confirmed",
  "commission_amount": 1650,
  "total_amount": 16500,
  "deposit_amount": 3300,
  "balance_amount": 13200,
  "payment_mode": "deposit",
  "balance_collect": "online",
  "deposit_status": "paid",
  "deposit_paid_at": "2026-05-23T00:00:00.000Z",
  "deposit_method": "linepay",
  "deposit_trade_no": "LP123",
  "balance_status": "unpaid",
  "balance_paid_at": "",
  "balance_method": "",
  "balance_trade_no": "",
  "commission_status": "pending",
  "source": "referral",
  "updated_at": "2026-05-23T00:00:00.000Z"
}
```

Order upsert must verify these D1 dependencies first:

- `itineraries.id = itinerary_id`
- `distributors.uid = distributor_uid`
- `customers.customer_phone = customer_phone`

If any dependency is missing, write to a sync error queue instead of inserting a partial order.

### Payment Event

`POST /tk/v1/payments/event`

Payload:

```json
{
  "project": "travelkeeper",
  "order_id": "ORD17774212122589648",
  "leg": "deposit",
  "merchant_order_no": "TKP123",
  "amount": 3300,
  "status": "paid",
  "method": "linepay",
  "trade_no": "LP123",
  "raw_notify_json": {},
  "updated_at": "2026-05-23T00:00:00.000Z"
}
```

Mapping to D1:

- `payment_attempts`
- matching payment fields on `orders`

### Commission Settlement Event

`POST /tk/v1/commissions/settle`

Payload:

```json
{
  "project": "travelkeeper",
  "order_id": "ORD17774212122589648",
  "commission_status": "paid_out",
  "commission_settled_at": "2026-05-23T00:00:00.000Z",
  "commission_paid_out_at": "2026-05-23T00:00:00.000Z",
  "payout_batch_id": "PB20260523001",
  "operator_uid": "Uf729764dbb5b652a5a90a467320bea29"
}
```

Only this event may update commission payout state from mother site.

## Sync Tracking Table

Add this table before enabling write-back:

```sql
CREATE TABLE IF NOT EXISTS mother_sync_map (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  local_id TEXT NOT NULL,
  mother_id TEXT NOT NULL DEFAULT '',
  direction TEXT NOT NULL DEFAULT 'push',
  status TEXT NOT NULL DEFAULT 'pending',
  checksum TEXT NOT NULL DEFAULT '',
  last_pushed_at TEXT NOT NULL DEFAULT '',
  last_pulled_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(entity_type, local_id)
);

CREATE INDEX IF NOT EXISTS idx_mother_sync_map_status
  ON mother_sync_map(status, entity_type);
```

Allowed `entity_type` values:

- `distributor`
- `itinerary`
- `customer`
- `order`
- `payment`
- `commission`

Allowed `status` values:

- `pending`
- `synced`
- `failed`
- `ignored`

## Worker Environment Variables

```text
MOTHER_API_BASE_URL=https://example.com/tk/v1
MOTHER_API_KEY=<secret>
MOTHER_HMAC_SECRET=<secret>
MOTHER_SYNC_ENABLED=0
```

Keep `MOTHER_SYNC_ENABLED=0` until health checks, field mapping, and dry-run logs are verified.

## Wasabi Storage Mode

If the mother site does not provide a business API yet, TravelKeeper may use Wasabi as the mother storage layer. This is storage, not business logic.

Use only this TravelKeeper-owned prefix:

```text
travelkeeper/
```

Recommended object paths:

```text
travelkeeper/distributors/<uid>.json
travelkeeper/itineraries/<itinerary_id>.json
travelkeeper/customers/<customer_phone>.json
travelkeeper/orders/<order_id>.json
travelkeeper/payments/<merchant_order_no>.json
travelkeeper/commissions/<order_id>.json
travelkeeper/sync-log/<yyyy>/<mm>/<id>.json
travelkeeper/_diagnostics/*.json
```

Do not read or write these non-TravelKeeper paths:

```text
shops/action/
tonyuse/imports/line-engine/
tonyuse/users/
tonyuse/referrals/
```

Required Worker variables for Wasabi storage mode:

```text
WASABI_ENDPOINT=https://s3.us-west-1.wasabisys.com
WASABI_REGION=us-west-1
WASABI_BUCKET=<bucket>
WASABI_PREFIX=travelkeeper
WASABI_ACCESS_KEY_ID=<secret>
WASABI_SECRET_ACCESS_KEY=<secret>
MOTHER_STORAGE_WRITE_ENABLED=0
```

Diagnostics:

- `GET /api/mother/health?uid=<admin_uid>` checks D1 sync map and Wasabi config.
- `POST /api/mother/storage-probe` can write/read/delete one diagnostic object only when `MOTHER_STORAGE_WRITE_ENABLED=1` and the request body includes `confirm = "PROBE_TRAVELKEEPER_WASABI"`.
- `POST /api/mother/export-itinerary` exports one D1 itinerary to `travelkeeper/itineraries/<itinerary_id>.json`.
- `POST /api/mother/export-itineraries` exports a controlled batch of D1 itineraries. Body supports `ids`, `limit`, `status`, `includeDeleted`, and `dryRun`.

Storage object rules:

1. Every JSON object must include `project = "travelkeeper"`.
2. Every JSON object must include `entity_type`, `local_id`, and `updated_at`.
3. Object keys must stay under the configured `WASABI_PREFIX`.
4. The Worker must reject product, course, point, or unrelated LINE card data.
5. Wasabi objects are an archive/sync layer. D1 remains the live operational database.

## Rejection Rules

Reject or ignore payloads when:

- `project !== "travelkeeper"`
- required IDs are missing
- payload contains non-travel entity types such as product, course, point, or unrelated LINE card data
- order dependencies are missing
- payment amount is negative or not numeric
- status value is outside D1 enum values

## First Implementation Order

1. Add `mother_sync_map` migration.
2. Add Worker helper for signed mother-site requests.
3. Add `/api/mother/health` diagnostic endpoint.
4. Add dry-run push endpoint for one itinerary and one order.
5. Enable write-back only after dry-run response is visible in admin UI.
