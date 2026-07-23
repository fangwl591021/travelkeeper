# Phase 16 Staging Readiness

## 1. Overview

Phase 16 prepares TravelKeeper tenant LINE operations for staging validation before any production Worker deployment. The scope is migration dry run, environment separation, LINE test OA readiness, webhook safety, feature flags, rollback planning, and evidence collection.

No production Worker deploy, remote D1 migration, production secret edit, or real LINE API call is part of this phase.

Current go/no-go: NO-GO until a distinct `[env.staging]` configuration, staging D1 id, and staging-only secret set are added outside this task.

## 2. Staging Resources

Required staging resources:

- Cloudflare Worker staging environment using `worker-tenant.js`.
- Distinct staging D1 database. It must not reuse the default `travelkeeper` D1 database id.
- Staging R2 bucket or a read-only/mock asset path if media is not part of the smoke test.
- LINE test OA channel mapped to a staging tenant row in `tenant_line_channels`.
- Mock LINE push endpoint when test OA credentials are not present.

The current `wrangler.toml` has only the default D1 binding. A future `[env.staging]` block must use a separate `database_id` and explicit staging vars.

## 3. Required Secrets

Check presence only; never print values.

- Tenant LINE Channel Secret, encrypted per `tenant_line_channels`.
- Tenant LINE Channel Access Token, encrypted per `tenant_line_channels`.
- `TENANT_PAYMENT_MASTER_KEY` for tenant secret encryption.
- `TENANT_PAYMENT_KEY_VERSION` for active key metadata.
- Auth/session secret used by LINE LIFF authentication.
- Any staging-only webhook or diagnostic token, if added later.

Readiness evidence should say present/missing only. Token, Secret, Authorization header, replyToken, ciphertext, and IV must not appear in logs, audit rows, docs, screenshots, or commits.

## 4. Migration Dry Run

Run:

```powershell
npm run staging:migration-check
```

The command is local and read-only. It inventories migration order, required tables, Phase 13-15B schema, local row counts, and `foreign_key_check`. It does not call remote D1 and does not apply migrations.

Migration readiness expectations:

- Migrations `0109` through `0113` exist and are ordered after baseline migrations.
- Phase 13 CRM tables and indexes are present.
- Phase 14 LINE channel, webhook log, outbound message columns, and safe credential storage are present.
- Phase 15A work queue fields and assignment audit support are present.
- Phase 15B SLA settings table and thread SLA columns are present.
- Migrations contain schema/data-preserving backfills only, not seed/test data.

## 5. D1 Backup

Before real staging migration execution outside this task:

```powershell
npx wrangler d1 export <staging-db-name> --env staging --output .\backups\staging-before-phase16.sql
```

Do not export production D1 for staging tests. Keep backups out of Git if they can contain customer data.

## 6. Worker Staging Deployment Command

After staging config and secrets are present, deploy staging only:

```powershell
npx wrangler deploy --env staging
```

Do not run production deploy in Phase 16. Verify the deployed Worker reports staging metadata only and does not expose secrets or debug internals.

## 7. LINE Test OA Webhook Setup

Use a LINE test OA, not the production OA.

Webhook URL format:

```text
https://<staging-worker-host>/api/v2/line/webhook/<tenant-slug>
```

Required checks:

- Tenant slug comes only from the webhook path.
- The tenant's Channel Secret verifies the exact raw request body.
- Invalid signature returns 401.
- Missing channel config returns 404.
- Disabled channel returns 409.
- There is no demo or production fallback.
- replyToken is reduced to presence metadata and is never persisted as plaintext.

If staging credentials are absent, use `LINE_PUSH_API_URL` with a mock push endpoint and keep outbound test cases off the real LINE API.

## 8. Smoke Test

Use a staging tenant and test OA:

1. Apply local migrations and run `npm run staging:migration-check`.
2. Confirm staging secret presence without printing values.
3. Send a signed follow event.
4. Send a signed text message.
5. Send postback, media, and profile update cases.
6. Open `line-oa-monitor.html` against staging API.
7. Confirm profile, thread, unread count, inbound message, SLA waiting state, and audit rows.
8. Send a mock outbound message and confirm `sent` when mock returns 200.
9. Confirm failed, retryable, duplicate, 401, 429, 5xx, timeout, and rotation cases.
10. Confirm no credential/plaintext leakage in UI, logs, D1, or audit rows.

## 9. Negative Tests

Required negative tests:

- Invalid signature returns 401 and records safe error metadata only.
- Unknown tenant path returns no authenticated tenant fallback.
- Missing tenant channel config returns 404.
- Disabled channel returns 409.
- Sales/editor cannot modify SLA settings or assign arbitrary agents.
- Finance/member cannot read or mutate LINE monitor data.
- Tenant A cannot read Tenant B threads, messages, SLA settings, or channel metadata.
- Failed outbound does not close SLA.
- Duplicate outbound does not increment response count or wait totals again.
- Multiple inbound messages do not extend an existing SLA deadline.

## 10. Rollback

Feature flags default on for existing behavior and can be disabled in staging or production rollback:

- `TENANT_LINE_MONITOR_ENABLED=0` disables monitor API routes.
- `TENANT_LINE_OUTBOUND_ENABLED=0` disables outbound push creation.
- `TENANT_LINE_QUEUE_ENABLED=0` disables assignment and claim writes.
- `TENANT_LINE_SLA_ENABLED=0` disables dynamic SLA calculation/start in LINE monitor and webhook paths.

Rollback order:

1. Disable outbound if LINE send behavior is risky.
2. Disable queue if assignment/claim conflicts appear.
3. Disable SLA if deadlines or breach audit is incorrect.
4. Disable monitor if UI/API access must be stopped.
5. Revert the staging Worker version if flags are insufficient.
6. Restore staging D1 from the pre-migration backup only if schema/data corruption is confirmed.

## 11. Evidence Collection

Collect:

- `git status -sb` before and after.
- `npm run staging:migration-check` JSON output.
- Local D1 table counts before and after smoke tests.
- `PRAGMA foreign_key_check` result.
- `PRAGMA integrity_check` result from a local sqlite read-only check if Wrangler blocks it.
- `node --check` results for modified JS files.
- `npm test` result.
- Headless browser screenshot/check output for LINE monitor UI.
- Credential/plaintext scan result.
- Commit hash and push output.

Do not include secret values, Authorization headers, replyToken, ciphertext, or IV.

## 12. Go/No-Go Criteria

GO requires all of the following:

- `[env.staging]` exists and uses a distinct staging D1 database id.
- Staging secrets are present and checked by presence only.
- Local migration readiness is clean.
- Staging migration is backed up and applied only to staging.
- LINE test OA webhook accepts valid signatures and rejects invalid signatures.
- Outbound mock/test OA cases pass without real production LINE API calls.
- Feature flags are documented and verified.
- UI smoke test passes without credential display.
- Foreign key and integrity checks are clean.
- Automated tests pass.

Current result from repository configuration alone: NO-GO, because staging environment resources and secrets are not configured in `wrangler.toml` in this checkout.
