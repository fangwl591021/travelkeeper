# Phase 16.5 LINE Shadow Mirror

## Decision

A separate LINE Test OA will not be created. The approved alternative is a disabled-by-default shadow mirror from the production webhook to the independent staging Worker.

## Architecture

The production Worker keeps the existing LINE webhook URL and signature verification. After a successful `2xx` webhook response, it may schedule a bounded, non-blocking `ctx.waitUntil()` task to send selected events to:

`https://travelkeeper-staging.fangwl591021.workers.dev/api/v2/internal/line-shadow/staging-line-shadow`

The staging endpoint is accepted only when `APP_ENV=staging`. Production rejects the endpoint. The endpoint does not use the public LINE signature flow; it requires a dedicated HMAC signature and a fresh timestamp.

## Configuration

The following production-only settings are required for a future human-approved enablement:

- `LINE_STAGING_SHADOW_ENABLED`: exact `1`; default disabled.
- `LINE_STAGING_SHADOW_URL`: must equal the fixed HTTPS staging URL above.
- `LINE_STAGING_SHADOW_UIDS`: comma-separated exact LINE user IDs; empty, wildcard, and partial matching are rejected.
- `LINE_STAGING_SHADOW_SIGNING_SECRET`: staging/production shared shadow HMAC secret, at least 32 bytes; values are never logged or committed.

No query string or request body field can override `tenant_slug`. The staging tenant is always `staging-line-shadow`.

## Payload And Privacy

Only `follow`, `message`, and `postback` events from allowlisted `source.userId` values are eligible. Supported message metadata is limited to `text`, `sticker`, `image`, `location`, `file`, and `video`. The mirror removes `replyToken` and never copies Channel Secret, Channel Access Token, Authorization headers, ciphertext, IV, or full production headers. Media binaries are not copied; only safe message metadata is mirrored.

The staging endpoint writes only tenant-scoped profile/thread/message data through the existing inbound insert path. It does not create `customers` or `orders`. Queue, SLA, and outbound remain disabled, and the staging endpoint has no LINE API client or reply path.

## HMAC And Replay Protection

The request body is signed as `HMAC-SHA256(timestamp + '.' + rawBody)`. The endpoint requires `X-TravelKeeper-Shadow-Timestamp` and `X-TravelKeeper-Shadow-Signature`. Timestamps older than five minutes, future/replayed timestamps outside the window, invalid signatures, malformed envelopes, and non-allowlisted UIDs are rejected. Event idempotency remains tenant-scoped through `webhook_event_id` and `event_fingerprint`; a duplicate envelope is rejected with `409 SHADOW_REPLAY` and is never inserted twice.

## Enablement Steps

1. Confirm written approval for the exact test UID and data subject consent.
2. Generate independent shadow signing secret material; configure production and staging presence only.
3. Configure production-only settings with the exact staging URL and UID allowlist.
4. Deploy production Worker only after reviewing the diff and rollback plan.
5. Send one allowlisted event and verify staging Monitor-only display.
6. Keep Queue, SLA, and Outbound disabled until separate approval.

## Disable And Rollback

Set `LINE_STAGING_SHADOW_ENABLED=0`, redeploy the production Worker, and revoke/rotate the shadow signing secret if compromise is suspected. The existing production LINE webhook URL is not changed. Shadow failures are swallowed from the production response path, bounded to one request per selected event, and never retried indefinitely.

## Data Cleanup And Risks

After testing, remove only synthetic `staging-line-shadow` rows from staging through an approved forward cleanup procedure. Do not modify production rows. The allowlisted production UID may contain personal data; obtain consent, limit retention, and treat staging data as a controlled copy. A misconfigured allowlist or signing secret could mirror more data than intended, so enablement remains a manual production approval point.

## Current Status

This phase implements code, tests, and documentation only. Shadow is disabled, no production secret is configured, no production Worker is deployed, no LINE API is called, no webhook URL is changed, and no staging remote D1 write is performed.

Current result: `NO-GO` for production shadow deploy until the exact UID, consent, secret configuration, and production deployment are separately approved.