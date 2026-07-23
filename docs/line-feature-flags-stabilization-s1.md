# Stabilization S1: LINE Feature Flags Fail-Closed

## Scope

S1 hardens the tenant-v2 LINE flags only:

- `TENANT_LINE_MONITOR_ENABLED`
- `TENANT_LINE_QUEUE_ENABLED`
- `TENANT_LINE_SLA_ENABLED`
- `TENANT_LINE_OUTBOUND_ENABLED`

Each runtime path now enables a feature only when its value is one of `1`, `true`, `on`, `yes`, or `enabled`, after trimming and lowercasing. Missing, blank, `0`, disabled values, and misspellings are disabled.

## Before

The two tenant-v2 LINE runtime modules accepted a `defaultEnabled = true` fallback and treated unknown values as enabled. This made missing or misspelled configuration unsafe. Monitor thread listing could also call breach confirmation without an enabled SLA flag.

## After

- Monitor routes fail closed before D1 work when `TENANT_LINE_MONITOR_ENABLED` is absent or invalid.
- Queue assignment and claim require an explicit queue flag.
- Outbound message creation requires an explicit outbound flag and does not call the LINE mock when disabled.
- SLA breach confirmation is only executed with an explicit SLA flag.
- Tenant-v2 inbound webhook still stores required profile, thread, and message data when SLA is disabled; only SLA waiting/breach state and audit side effects are suppressed.
- Legacy `/line-webhook` and legacy tables are unchanged.

## Operational rule

Every environment must explicitly configure the feature flags it intends to enable. No production or staging deployment is performed by S1, and the repository does not prove the current production deployment state.

## Verification boundary

Tests use local fakes and mock LINE endpoints only. S1 does not call the real LINE API, deploy a Worker, write Remote D1, change secrets, change the LINE Developers webhook, run migrations, or enable any feature remotely.

Final state:

```text
Stabilization S1 code-level fail-closed completed.
Production deployment state: not_verified.
Migration: NO-GO.
```