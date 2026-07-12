# Phase 16.1 Staging Environment Preparation

## Current Result

Phase 16.2 created the independent staging D1 and bound its id locally. The repository remains NO-GO for remote migration, Worker deploy, secrets, and LINE Test OA until those targets are manually confirmed.

Completed locally:

- Added `[env.staging]` to `wrangler.toml`.
- Kept production default Worker and D1 binding unchanged.
- Added staging-only Worker name `travelkeeper-staging`.
- Bound `[env.staging]` to the independent D1 `travelkeeper-staging` id `e055e868-1a4f-4fdd-8e8f-f24594e52079`.
- Added staging feature flags with monitor-only rollout start.
- Added staging UI badge support.
- Added staging readiness checks that fail closed until secrets and LINE Test OA are confirmed.

Not performed:

- Staging D1 `travelkeeper-staging` was created in Phase 16.2.
- No remote migration was applied.
- No Worker was deployed.
- No production D1 or production secrets were modified.
- No LINE API or production LINE OA was called.

## Staging Separation

Production remains:

```toml
name = "travelkeeper-worker"
main = "worker-tenant.js"
[[d1_databases]]
binding = "DB"
database_name = "travelkeeper"
database_id = "184f9dff-18fe-401f-9374-098ed7b0eb38"
```

Staging is prepared as:

```toml
[env.staging]
name = "travelkeeper-staging"
workers_dev = true

[env.staging.vars]
APP_ENV = "staging"
TENANT_LINE_MONITOR_ENABLED = "1"
TENANT_LINE_QUEUE_ENABLED = "0"
TENANT_LINE_SLA_ENABLED = "0"
TENANT_LINE_OUTBOUND_ENABLED = "0"

[[env.staging.d1_databases]]
binding = "DB"
database_name = "travelkeeper-staging"
database_id = "e055e868-1a4f-4fdd-8e8f-f24594e52079"
```

The binding name remains `DB` because Worker code expects `env.DB`, but the environment-specific D1 database name and id are distinct from production. Remote migration and deploy remain blocked until staging secrets, host, and LINE Test OA are confirmed.

## Manual Remote Commands And Status

Do not run remaining remote operations until the operator confirms the target account, resource names, and test OA. Phase 16.2 completed only the D1 create command.

1. Create staging D1:

```powershell
npx wrangler d1 create travelkeeper-staging # completed in Phase 16.2
```

2. Confirmed staging D1 id now bound in `wrangler.toml`:

```toml
database_id = "e055e868-1a4f-4fdd-8e8f-f24594e52079"
```

3. Set staging Worker-level secret after the staging Worker exists, value entered interactively or through secure stdin and never logged:

```powershell
npx wrangler secret put TENANT_PAYMENT_MASTER_KEY --env staging
```

`TENANT_PAYMENT_KEY_VERSION` is version metadata and can remain a staging var unless rotation requires secret-only handling. Current Worker code does not reference `TENANT_CREDENTIAL_MASTER_KEY` or `SESSION_SECRET`; do not set them for staging until code starts using them. LINE test OA credentials should be stored in the staging D1 tenant channel row through the existing encrypted tenant LINE channel API, not in `wrangler.toml` and not as global Worker secrets.

4. Staging migration inventory before apply:

```powershell
npx wrangler d1 execute travelkeeper-staging --remote --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
npx wrangler d1 execute travelkeeper-staging --remote --command "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table'"
```

5. Apply migrations to staging only:

```powershell
npx wrangler d1 migrations apply travelkeeper-staging --env staging --remote
```

6. Verify staging D1 only:

```powershell
npx wrangler d1 execute travelkeeper-staging --remote --command "PRAGMA foreign_key_check"
npx wrangler d1 execute travelkeeper-staging --remote --command "PRAGMA integrity_check"
```

7. Deploy staging Worker only:

```powershell
npx wrangler deploy --env staging
```

8. Staging webhook URL:

```text
https://<confirmed-travelkeeper-staging-host>/api/v2/line/webhook/{tenant_slug}
```

## Secrets Checklist

Presence/status only, never values:

- `TENANT_PAYMENT_MASTER_KEY`: Worker-level secret used by current tenant gateway and tenant LINE credential encryption.
- `TENANT_PAYMENT_KEY_VERSION`: key-version metadata, currently defaults to `v1` if absent.
- `TENANT_CREDENTIAL_MASTER_KEY`: checked in Phase 16.3; not referenced by current Worker code.
- `SESSION_SECRET`: checked in Phase 16.3; not referenced by current Worker code.
- Test LINE OA Channel Secret: encrypted in staging D1 `tenant_line_channels` through the tenant channel API.
- Test LINE OA Access Token: encrypted in staging D1 `tenant_line_channels` through the tenant channel API.

## LINE Test OA Plan

Use only a LINE test OA. The production LINE OA must not be used.

Required checks:

1. Webhook verify succeeds for the staging tenant path.
2. Invalid signature returns 401.
3. Unknown tenant returns 404 or a safe not-configured response without fallback.
4. Disabled channel returns 409.
5. Follow event creates/updates only staging tenant data.
6. Text event creates inbound message and thread unread state.
7. Postback event is stored safely.
8. Image, sticker, location, and file events create basic message records without storing credentials.
9. Thread/profile/message rows are scoped to the staging tenant.
10. UI shows inbound thread and `STAGING` badge.
11. Human客服 Push API remains disabled until final rollout step.
12. Outbound sent is tested only after test OA token is confirmed.
13. Duplicate `client_request_id` does not resend.
14. Wrong test token returns 401 without credential leakage.
15. 429, 5xx, and timeout cases use mock/safe tests, not deliberate abuse of LINE API.
16. Credential rotation updates encrypted staging channel config only.
17. `replyToken` is not persisted as plaintext.
18. Logs and audit rows contain no credential values.

## Feature Rollout

Initial staging vars start with monitor only:

1. `TENANT_LINE_MONITOR_ENABLED=1`, smoke test UI and read-only thread list.
2. Set `TENANT_LINE_QUEUE_ENABLED=1`, smoke test claim/assign/read.
3. Set `TENANT_LINE_SLA_ENABLED=1`, smoke test waiting/due soon/breach states.
4. Set `TENANT_LINE_OUTBOUND_ENABLED=1` last, smoke test test OA outbound.

If any step fails, set that flag back to `0` and stop rollout.

## Rollback

- Set `TENANT_LINE_OUTBOUND_ENABLED=0` first.
- Disable the test OA webhook or remove the staging webhook URL.
- Roll back the staging Worker version.
- Revoke staging LINE token.
- Restore staging D1 from the staging backup if needed.
- Use forward-fix migrations; do not automatically drop production or staging data.

## GO Criteria

GO requires:

- Confirmed staging D1 id replacing the placeholder.
- Confirmed staging secrets set by presence-only checks.
- Confirmed LINE test OA identity and webhook URL.
- Staging D1 schema inventory proves empty or synthetic-only data.
- Staging migrations applied to `travelkeeper-staging` only.
- Feature rollout smoke tests pass in order.
- No credential values in UI, logs, D1 audit rows, or Git.

## Phase 16.3 Remote Precheck

- Cloudflare account confirmed: `Fangwl591021@gmail.com's Account` / `8058cf61f0cd44c4edd78080b193033a`.
- Production D1 confirmed: `travelkeeper` / `184f9dff-18fe-401f-9374-098ed7b0eb38`.
- Staging D1 confirmed: `travelkeeper-staging` / `e055e868-1a4f-4fdd-8e8f-f24594e52079`.
- Staging D1 remote schema inventory before migration shows only Cloudflare internal `_cf_KV`; app migrations are pending.
- `PRAGMA foreign_key_check` on staging D1 returned no rows.
- `PRAGMA integrity_check` on staging D1 was blocked by Cloudflare D1 with `SQLITE_AUTH`.
- `npx wrangler d1 migrations list DB --env staging --remote` shows all 34 migrations pending.
- `travelkeeper-staging` Worker is not deployed yet; Wrangler cannot list or set Worker secrets for that Worker until it exists.
- No remote migration, Worker deploy, LINE API call, webhook setting, production D1 operation, or production secret change was performed.

## Phase 16.4A Remote Staging Migration

Date: 2026-07-12

Target confirmed before write:

- Cloudflare account: `Fangwl591021@gmail.com's Account` / `8058cf61f0cd44c4edd78080b193033a`.
- Production D1 was identified only through read-only inventory: `travelkeeper` / `184f9dff-18fe-401f-9374-098ed7b0eb38`.
- Staging D1 migration target: `travelkeeper-staging` / `e055e868-1a4f-4fdd-8e8f-f24594e52079`.
- `[env.staging]` references only the staging D1 id.
- No Worker deploy, Worker secret write, LINE API call, LINE webhook change, seed import, or production D1 command was performed.

Pre-migration inventory:

- Staging D1 contained Cloudflare internal `_cf_KV`, `d1_migrations`, and `sqlite_sequence` only before app migrations.
- `PRAGMA foreign_key_check` returned no rows.
- `PRAGMA integrity_check` was blocked by D1 remote with `SQLITE_AUTH`.
- `npx wrangler d1 migrations list DB --env staging --remote` initially showed 34 pending migrations.

Migration execution:

- `npx wrangler d1 migrations apply travelkeeper-staging --env staging --remote` first applied `0001` through `0020`; `0100` through `0113` remained pending.
- Applying `0100` through `0113` initially failed with D1 remote `incomplete input` on `CREATE TRIGGER` migration statements.
- Phase 16.4A changed pending tenant/LINE migrations to be D1 remote migration compatible by removing cross-table `CREATE TRIGGER` statements and replacing `CASE` expressions with equivalent `IIF(...)` where needed for Wrangler statement splitting.
- Application-level tenant scoping and authorization checks remain required for cross-table tenant mismatch prevention. This is a known residual risk to re-evaluate before production migration.
- Re-running `npx wrangler d1 migrations apply travelkeeper-staging --env staging --remote` completed the remaining 14 migrations.
- Post-apply migration ledger count: 34.
- Post-apply `npx wrangler d1 migrations list DB --env staging --remote`: `No migrations to apply`.

Post-migration schema verification:

- Required tables present: `tenant_line_channels`, `tenant_crm_profiles`, `tenant_crm_threads`, `tenant_crm_messages`, `tenant_line_sla_settings`, `tenant_memberships`, `audit_logs`, `customers`, `orders`.
- Required Phase 15B thread columns present: `priority`, `sla_status`, `sla_due_at`, `sla_started_at`, `sla_paused_at`, `sla_remaining_seconds`, `waiting_since`, `last_customer_wait_seconds`, `total_customer_wait_seconds`, `response_count`, `sla_breached_at`.
- Required outbound/idempotency message columns present: `text_content`, `send_status`, `line_message_id`, `error_code`, `error_message_safe`, `sent_by_uid`, `sent_by_role`, `sent_at`, `client_request_id`, `retryable`.
- Required indexes observed include `idx_tenant_line_channels_enabled`, `idx_tenant_crm_messages_event_id`, `idx_tenant_crm_messages_fingerprint`, `idx_tenant_crm_messages_client_request`, `idx_tenant_crm_threads_queue`, `idx_tenant_crm_threads_assignee`, `idx_tenant_crm_threads_sla`, and `idx_tenant_crm_threads_priority_sla`.

Post-migration row counts:

- `tenants`: 1 (`demo`, migration-created legacy/system tenant)
- `platform_collection_settlement_rules`: 1 (`demo`, migration-created platform rule)
- `tenant_memberships`: 0
- `customers`: 0
- `orders`: 0
- `tenant_crm_profiles`: 0
- `tenant_crm_threads`: 0
- `tenant_crm_messages`: 0
- `tenant_line_channels`: 0
- `tenant_line_sla_settings`: 0
- `audit_logs`: 0

Integrity:

- `PRAGMA foreign_key_check`: success, no rows.
- `PRAGMA integrity_check`: blocked by Cloudflare D1 remote with `SQLITE_AUTH`; this is a tool/platform restriction, not a reported schema violation.

Next step:

- Phase 16.4B / 16.5 should perform staging Worker bootstrap deployment only after explicit approval of staging Worker target, staging secrets, and LINE Test OA. Do not enable outbound until monitor, queue, and SLA smoke tests pass in order.
