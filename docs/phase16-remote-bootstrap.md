# Phase 16 Remote Bootstrap Baseline

## 目的

本文件定義 TravelKeeper 的 canonical D1 bootstrap baseline。baseline 只由 canonical migrations 0001 至 0114 產生，不修改任何歷史 migration，也不使用 Cloudflare internal d1_migrations 作為 project-owned ledger。

目前 baseline 的來源 commit 是 2aedbcde8829d6dedd5b836ddf87cbc4627d2e9b。若 canonical migration checksum 改變，bootstrap、manifest 與 schema checksum 必須全部重新產生並通過 drift check。

## Canonical Artifacts

generator：

scripts/d1-bootstrap-generator.mjs

輸出：

- artifacts/d1-bootstrap/bootstrap.sql
- artifacts/d1-bootstrap/manifest.json
- artifacts/d1-bootstrap/schema.json

生成命令：

    node scripts/d1-bootstrap-generator.mjs --write
    node scripts/d1-bootstrap-generator.mjs --check

目前 checksum：

- baseline_version：0001-0114
- migration_count：35
- statement_count：301
- bootstrap_checksum：1bf727ca54db5693a48268a5d5d4715bc8f85e1c4b1ef4ee3f10ebc1bccafb53
- manifest_checksum：0caef45ecdda1c9592a4faf1474d146a9dc462dde071fce555925104e7b911b6
- schema_checksum：1f480ea95437c6355ea9d1c823e328e215f5c8ed670b3cd771c173e8eb1f5d16

manifest 逐一記錄每個 migration checksum、每個 SQL statement 的 index/type/checksum，以及 baseline schema checksum。bootstrap SQL 不加入會改變 canonical statement checksum 的額外 SQL 或 metadata comments。

## Schema Equivalence

scripts/d1-schema-equivalence.mjs 會從 SQLite database 產生 normalized snapshot，並比較：

- tables
- columns、type、default、nullable、primary key
- foreign keys
- unique constraints
- indexes
- triggers 與 normalized trigger SQL

project-owned ledger table 不納入 application schema checksum，但 ledger 本身另行驗證。

本機已驗證三條路徑：

1. canonical migrations 直接安裝。
2. generated bootstrap 安裝。
3. generated bootstrap 加上 0115+ forward migration prototype。

三者的 application schema equivalence 通過。

## Project-Owned Ledger

runner：

scripts/d1-bootstrap-runner.mjs

ledger table：

    CREATE TABLE travelkeeper_project_migration_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_type TEXT NOT NULL,
      baseline_version TEXT NOT NULL,
      migration_version TEXT NOT NULL DEFAULT '',
      migration_start TEXT NOT NULL DEFAULT '',
      migration_end TEXT NOT NULL DEFAULT '',
      bootstrap_checksum TEXT NOT NULL DEFAULT '',
      migration_checksum TEXT NOT NULL DEFAULT '',
      source_commit TEXT NOT NULL,
      schema_checksum TEXT NOT NULL,
      status TEXT NOT NULL,
      statement_index INTEGER NOT NULL DEFAULT -1,
      error_type TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

這是 project-owned metadata，不是 Cloudflare internal d1_migrations。任何 remote 使用前都必須先取得人工核准並完成 remote ledger 可追蹤性 proof。

## Bootstrap Install Semantics

bootstrap runner 的安全條件：

- 只接受空 database；發現 user table、index 或 trigger 時 fail closed。
- 先驗證 bootstrap checksum、statement count、statement type 與 statement checksum。
- 每個 statement 個別執行，失敗時回報 statement index/type/checksum。
- 失敗時留下 started 與 failed ledger row，不自動 destructive rollback。
- 只有全部 301 statements 成功後才寫入 completed。
- 失敗狀態永遠不會被視為可繼續 forward 的 baseline。

這是 completion-gated atomicity：不讓不完整 bootstrap 取得 completed 狀態；prototype 不自動刪除或回復已建立的 schema。

## Forward Migration Strategy

- baseline 固定包含 0001 至 0114。
- 後續 migration 從 0115 開始。
- 不重跑 baseline。
- 不把 0115+ migration 寫入 Cloudflare internal d1_migrations。
- forward prototype 只接受名稱以 0115 或更高版本開頭的 migration。
- 每個 forward migration 另記錄 migration checksum、source commit、statement failure index 與 status。

本階段採 project-owned runner 管理 baseline/forward 狀態，但尚未宣稱可直接對 remote D1 部署。需要另外完成 remote ledger 的官方支援與失敗恢復 proof。

## Drift Protection

下列任一差異都必須 fail：

- canonical migration checksum
- statement checksum、順序或 type
- bootstrap SQL checksum
- manifest checksum
- schema snapshot checksum
- trigger SQL normalization
- generated artifact 內容

不得手動編輯 bootstrap.sql、manifest.json 或 schema.json。應重新從 canonical migrations 產生。

## Remote Decision

目前 travelkeeper-staging 仍有 34 個 Cloudflare migrations marked applied、0 個 trigger，與 canonical baseline 不等價。這個 baseline prototype 尚未授權建立 travelkeeper-staging-v2。

方案 A（直接 wrangler d1 execute --remote）不能可信地維護 Cloudflare migration ledger，因此不作為正式 bootstrap 方式。

方案 B（canonical-generated bootstrap + project-owned ledger）是推薦方向，但必須先完成 remote ledger 與失敗恢復 proof。完成前：

- 不刪除 travelkeeper-staging
- 不建立 travelkeeper-staging-v2
- 不執行 remote bootstrap
- 不部署 Worker

下一輪只有在人工核准後，才可考慮：

    npx wrangler d1 create travelkeeper-staging-v2

建立後仍必須先做 database ID/account/schema/read-only inventory，再決定是否進行任何 remote write。

## Validation

- bootstrap generator deterministic check：通過
- bootstrap install prototype：通過
- bootstrap + forward prototype：通過
- canonical/bootstrap schema equivalence：通過
- 26 trigger presence：通過
- generated bootstrap cross-tenant negative tests：通過
- failure diagnostics and no completed ledger on failure：通過
- immutable/checksum drift tests：通過

整體 rollout 仍為 NO-GO，因為 remote schema equivalence 與 trusted remote ledger 尚未證明。

## Phase 16.4A.4 Remote Proof

- Remote target: travelkeeper-staging-v2 / 184b543d-100c-4f02-84bd-2d5edd1efe10
- Bootstrap: 301 statements applied; canonical schema equivalence passed.
- Final application schema: 45 tables, 130 indexes, 40 foreign keys, 23 unique constraints, 26 triggers.
- Remote tenant mismatch proof: 26/26 insert/update cases rejected by the expected trigger with safe error output. Synthetic proof rows were removed; business tables remain empty except the canonical migration-created demo tenant.
- Project-owned ledger: baseline 0001-0114, migration_count 35, statement_count 301, applied_statement_count 301, bootstrap/manifest/schema checksums and source commit recorded, status completed. Completion used a checksum- and statement-count-guarded single-row update.
- Duplicate bootstrap after completion failed closed with duplicate schema error; ledger remained completed and no data changed.
- Cloudflare D1 PRAGMA integrity_check returned SQLITE_AUTH; foreign_key_check returned no rows and normalized schema export equivalence passed.
- No production D1, old staging D1, Worker deploy, secrets, webhook, LINE API, or Cloudflare internal d1_migrations operation was performed.
