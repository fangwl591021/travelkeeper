# Wasabi production mapping preview

Last updated: 2026-05-22

## What has been migrated

Wasabi data has been migrated into D1 staging tables only:

- `wasabi_import_objects`
- `wasabi_import_records`

Production TravelKeeper tables were not modified:

- `orders`
- `itineraries`
- `distributors`
- `customers`

## Current staging counts

| Source group | Records |
| --- | ---: |
| `json_object` | 426 |
| `legacy_course` | 28 |
| `legacy_order` | 17 |
| `legacy_point_ledger` | 13 |
| `legacy_points` | 16 |
| `legacy_product` | 5 |
| `legacy_video` | 10 |
| `line_engine_card_import` | 154 |
| `line_engine_user_import` | 75 |
| `member_user` | 14 |
| `referral_code` | 25 |
| `snapshot_manifest` | 2 |

Total staged records: 785

Total staged objects: 635

## Production table safety check

Current production counts after staging import:

| Table | Rows |
| --- | ---: |
| `orders` | 1 |
| `itineraries` | 13 |
| `distributors` | 4 |

## Direct-match preview

### Referral codes

Query:

- Source: `wasabi_import_records.source_group = 'referral_code'`
- Match rule: `record_json.owner_user_id = distributors.uid`

Result:

- Referral records: 25
- Matched existing distributors: 0

Interpretation:

Wasabi referral owners use IDs like `line_U...`, while TravelKeeper distributors currently use LINE UID-style values without that exact prefix pattern. These records should not be directly applied to `distributors.invite_code` yet.

### Member users

Query:

- Source: `wasabi_import_records.source_group = 'member_user'`
- Distributor match: `record_json.data.userId = distributors.uid`
- Customer match: `record_json.data.userId = customers.customer_line_uid`

Result:

- Member records: 14
- Matched existing distributors: 0
- Matched existing customers: 0

Interpretation:

These can be used as reference or imported as new customer/member records after deciding whether they belong to TravelKeeper customers, distributors, or a separate historical member table.

## Recommended next action

Do not upsert directly into production yet.

Current safe workflow:

1. Use `wasabi-import-preview.html` to review `wasabi_import_records`.
2. Let the operator classify individual records:
   - import as customers
   - import as distributors
   - import as itineraries
   - keep as historical reference only
3. Mark only confirmed records as `ready`.
4. Run the import dry-run API before any production write:
   - `GET /api/wasabi/imports/dry-run?uid=ADMIN_UID`
5. Review the dry-run report:
   - `create`: production table does not yet have the mapped key
   - `update`: production table already has the mapped key
   - `blocked`: missing target table, missing key, or invalid mapping
   - `reference`: keep as historical reference only
6. Only after dry-run is reviewed, create explicit one-way upsert logic per target table.

The dry-run endpoint is read-only. It does not write to `orders`, `itineraries`, `distributors`, or `customers`.

