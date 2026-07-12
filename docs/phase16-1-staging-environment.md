# Phase 16.1 Staging Environment Preparation

## Current Result

Phase 16.1 repository preparation is intentionally NO-GO for remote execution until a human confirms the staging D1 database id, staging secrets, staging Worker host, and LINE test OA channel.

Completed locally:

- Added `[env.staging]` to `wrangler.toml`.
- Kept production default Worker and D1 binding unchanged.
- Added staging-only Worker name `travelkeeper-staging`.
- Added staging D1 binding block for `travelkeeper-staging` with placeholder id `REPLACE_WITH_STAGING_D1_DATABASE_ID`.
- Added staging feature flags with monitor-only rollout start.
- Added staging UI badge support.
- Added staging readiness checks that fail closed until remote resources are confirmed.

Not performed:

- No staging D1 was created.
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
database_id = "REPLACE_WITH_STAGING_D1_DATABASE_ID"
```

The binding name remains `DB` because Worker code expects `env.DB`, but the environment-specific D1 database name and id must be distinct from production. The placeholder id prevents accidental staging deploy until the real staging D1 id is manually confirmed.

## Manual Remote Commands Awaiting Confirmation

Do not run these until the operator confirms the target account, resource names, and test OA.

1. Create staging D1:

```powershell
npx wrangler d1 create travelkeeper-staging
```

2. After Cloudflare returns the id, replace only the staging placeholder:

```toml
database_id = "<confirmed-staging-d1-id>"
```

3. Set staging secrets, values entered interactively and never logged:

```powershell
npx wrangler secret put TENANT_CREDENTIAL_MASTER_KEY --env staging
npx wrangler secret put SESSION_SECRET --env staging
npx wrangler secret put TENANT_PAYMENT_MASTER_KEY --env staging
npx wrangler secret put TENANT_PAYMENT_KEY_VERSION --env staging
```

LINE test OA credentials should be stored in the staging D1 tenant channel row through the existing encrypted tenant LINE channel API, not in `wrangler.toml`.

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

Presence only, never values:

- `TENANT_CREDENTIAL_MASTER_KEY`
- `SESSION_SECRET` or the current auth/session secret used by this Worker
- `TENANT_PAYMENT_MASTER_KEY` while current tenant encryption code still uses it
- `TENANT_PAYMENT_KEY_VERSION`
- Test LINE OA Channel Secret, encrypted in staging D1 tenant channel config
- Test LINE OA Access Token, encrypted in staging D1 tenant channel config

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
