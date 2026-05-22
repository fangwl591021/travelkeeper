# Wasabi field profile for TravelKeeper D1 migration

Generated from `.tmp/wasabi_stage_all.sql` after full Wasabi inventory.

This report lists field names only. It intentionally avoids printing customer values or secret material.

## Summary by source group

| Source group | Records | Top-level fields | Nested `data` fields | Migration note |
| --- | ---: | --- | --- | --- |
| `json_object` | 426 | updated_at, source, created_at, owner_user_id, card_id, visibility, public_slug, fields, line_card, reward_status, reward_points, legacy_source, user_id, ref_code, source_image_url, ecard_config | - | 其他 JSON 物件，需人工再分類。 |
| `legacy_course` | 28 | id, name, priceText, price, type, capacity, enrolled, startDate, endDate, timeSlotType, instructor, location, image, description, isPublished, isRegistrationOpen | - | 可參照 itineraries 欄位，但需確認這些 course 是否真的是旅遊行程。 |
| `legacy_order` | 17 | orderId, userId, name, phone, amount, status, createdAt, pointsUsed, courseId, type, productId, productName, productCode, originalAmount, paymentMethod, quantity | - | 舊商品/點數訂單，不可直接寫入 TravelKeeper orders，可作歷史參考。 |
| `legacy_point_ledger` | 13 | logId, uid, type, amount, points, reason, balanceAfter, createdAt, createdTs, source, operatorUid, operatorName, targetName | - | 點數流水資料，TravelKeeper 目前沒有等價正式表。 |
| `legacy_points` | 16 | key, data | balance, logs, wpMigrated | 點數餘額/狀態資料，TravelKeeper 目前沒有等價正式表。 |
| `legacy_product` | 5 | id, name, code, storeName, status, price, pointsPrice, image, description, sourceUrl, stock, isPublished, updatedAt, createdAt | - | 偏商品資料，不直接等於 TravelKeeper itinerary。 |
| `legacy_video` | 10 | id, title, teacher, episode, driveFileId, isPublished, createdAt | - | 內容素材資料，目前不直接對應正式表。 |
| `line_engine_card_import` | 154 | imported_at, source, total_rows, imported_count, skipped_count, imported, skipped | - | 偏 LINE 商機卡片資料，目前不直接對應旅遊訂單。 |
| `line_engine_user_import` | 75 | user_id, line_user_id, legacy_row_id, status | - | 偏身份對照資料，可用於 LINE user id 去重與舊資料追蹤。 |
| `member_user` | 14 | key, data | userId, name, phone, createdAt, memberTier, referrerUid, gender, birthday, industry, address, pictureUrl, updatedAt, isAdmin, crmOperator, role, crmRole | 可參照 customers 或 distributors；data.role / isAdmin / crmRole 可協助判斷身份。 |
| `referral_code` | 25 | ref_code, owner_user_id, status, created_at, updated_at | - | 可參照 distributors.invite_code，但必須先確認 owner_user_id 是否等於 TravelKeeper 經銷商 uid。 |
| `snapshot_manifest` | 2 | type, exportedAt, source, datasets, note | - | 快照清單，只做稽核參考。 |

## TravelKeeper target fields to protect

### `distributors`

`uid`, `name`, `phone`, `company`, `invite_code`, `status`, `can_upload`, `sales_revenue`

### `customers`

`owner_uid`, `customer_line_uid`, `name`, `phone`, `total_orders`, `total_spent`

### `itineraries`

`id`, `title`, `region`, `days`, `price`, `image`, `description`, `owner_uid`, `review_status`

### `orders`

`order_id`, `itinerary_id`, `distributor_uid`, `customer_name`, `customer_phone`, `total_amount`, `status`

## Recommended next migration order

1. `referral_code` -> preview against `distributors.uid`; only update `invite_code` after owner UID matches.
2. `member_user` -> preview possible `customers` rows; do not create distributors automatically unless role confirms it.
3. `legacy_course` -> preview possible `itineraries`; keep separate because these may be courses, not travel products.
4. `legacy_order` -> keep as historical staging until a real TravelKeeper order mapping is approved.

## Safe rule

Nothing from Wasabi should be upserted into production tables until the preview report shows exact row counts and field mapping.
