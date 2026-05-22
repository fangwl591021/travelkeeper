# Wasabi to TravelKeeper D1 migration plan

Last updated: 2026-05-22

## Current finding

The provided document is a Wasabi S3-compatible object storage guide, not a relational database export guide.

The first inventory pass successfully listed Wasabi objects from bucket `tonyuse` in region `us-west-1`.
The inventory output is local only:

- `.tmp/wasabi_inventory.json`

No D1 data has been changed.

## Source groups found

| Source prefix | Shape | Initial decision |
| --- | --- | --- |
| `referrals/codes/*.json` | Single referral-code object with `ref_code`, `owner_user_id`, `status`, timestamps | Candidate for `distributors.invite_code`, but must match owner UID first |
| `imports/line-engine/users-*.json` | Import log object with `imported[]` rows containing `user_id`, `line_user_id`, `legacy_row_id`, `status` | Candidate identity map; deduplicate by `line_user_id` before use |
| `shops/action/high-risk/users.json` | Array of `{ key, data }`; `data` contains user profile fields | Candidate for staging customer/member records |
| `shops/action/high-risk/orders.json` | Array of product/point order records | Do not import directly to TravelKeeper `orders`; schema is not travel-order compatible |
| `shops/action/data/courses.json` | Array of course/product-like records | Review manually before mapping to `itineraries`; likely from another project |
| `shops/action/data/products.json` | Array of product records | Not a TravelKeeper itinerary by default |

## Safety rule

Do not import Wasabi records directly into production tables first.

Use a two-stage migration:

1. Inventory and sample only.
2. Import raw source records into staging tables.
3. Build mapping views or preview reports.
4. Only after manual approval, upsert selected records into formal tables.

## Proposed staging tables

These tables keep the original data and prevent accidental corruption of orders, commissions, or itinerary records.

```sql
CREATE TABLE IF NOT EXISTS wasabi_import_objects (
  object_key TEXT PRIMARY KEY,
  source_group TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  last_modified TEXT NOT NULL DEFAULT '',
  sha256 TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS wasabi_import_records (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL,
  source_group TEXT NOT NULL DEFAULT '',
  source_id TEXT NOT NULL DEFAULT '',
  record_json TEXT NOT NULL DEFAULT '{}',
  mapped_table TEXT NOT NULL DEFAULT '',
  mapped_key TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'staged',
  note TEXT NOT NULL DEFAULT '',
  imported_at TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (object_key) REFERENCES wasabi_import_objects(object_key)
);
```

## Mapping direction

### Referral codes

Target only after UID verification:

- `ref_code` -> `distributors.invite_code`
- `owner_user_id` -> `distributors.uid`
- `status` -> only active/valid records should be applied

### Users / members

Possible target depends on role:

- If the record is a sales partner: `distributors`
- If the record is an end customer: `customers`
- If unclear: keep in `wasabi_import_records` until reviewed

### Orders

Wasabi `orders.json` currently looks like product/point orders, not travel booking orders.

Do not map directly to:

- `orders`
- `payment_attempts`
- `payout_batch_orders`

Use staging first, then manually decide whether these are historical references only.

### Courses/products

Do not map directly to TravelKeeper itineraries unless the business confirms they are travel products.

Potential itinerary mapping if approved:

- `id` -> `itineraries.id`
- `name` -> `itineraries.title`
- `price` -> `itineraries.price`
- `capacity` -> `itineraries.capacity_limit`
- `image` -> `itineraries.image`
- `description` -> `itineraries.description`
- `isPublished` -> `review_status`

## Next safe step

Create and apply a D1 migration for the two staging tables, then import only a tiny sample:

- 5 referral code records
- 5 user/member records
- 3 order records as staging only

After that, verify:

- staging row count
- no change to production `orders`
- no change to production `itineraries`
- no change to production `distributors` except after explicit approval

