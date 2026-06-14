# WeGo Release Checklist

Use this checklist before deploying or pushing customer-visible changes for TravelKeeper.

## 1. Release Metadata

- Feature or fix:
- Owner:
- Date:
- Branch or commit:
- Worker version:
- Pages URL:
- Related files:
- Rollback plan:

## 2. LINE Webhook

- [ ] Webhook route is still reachable.
- [ ] Signature verification behavior is unchanged or intentionally updated.
- [ ] LINE retry events do not create duplicate replies or duplicate records.
- [ ] Reply token path is tested or reviewed.
- [ ] Push-message fallback is intentional and permission-checked.
- [ ] Incoming text, image, file, follow, and unfollow events are handled safely.
- [ ] Customer image/file events do not trigger unintended business actions.
- [ ] Logs do not expose access tokens, secrets, or customer-private data.

## 3. LIFF and Customer Pages

- [ ] LIFF URL and callback route still load.
- [ ] Login state and profile access still work.
- [ ] Required query parameters are preserved.
- [ ] Mobile viewport layout is usable.
- [ ] Customer forms validate required fields.
- [ ] Duplicate submit is blocked or idempotent.
- [ ] Error messages are understandable to customers.
- [ ] Production and test data paths are not mixed.

## 4. Admin Backend and Operator UI

- [ ] Admin UID check is enforced for admin-only APIs.
- [ ] Non-admin users cannot access restricted actions.
- [ ] Existing operator workflows still load: monitor, CRM, itinerary, payment, reports.
- [ ] Form save and reload behavior is tested.
- [ ] Secret fields are masked and leave-empty-does-not-overwrite behavior works.
- [ ] Pagination, filters, and search still work for touched views.
- [ ] UI labels match the real data model.
- [ ] GitHub Pages cache behavior is accounted for when HTML changes are pushed.

## 5. AI Customer Service

- [ ] AI auto-reply allowlist is verified.
- [ ] Manual-response mode stops AI replies.
- [ ] AI disabled mode is truly silent.
- [ ] Knowledge base source is correct: R2 manifest, local file, or fallback.
- [ ] Public/internal/private knowledge boundaries are respected.
- [ ] Prompt changes were tested with real examples.
- [ ] AI reply does not invent payment, visa, travel, or refund policy.
- [ ] AI does not reuse customer-uploaded private content as general knowledge.

## 6. AI Itinerary Publishing

- [ ] Image DM upload still works.
- [ ] PDF upload still works or the limitation is stated.
- [ ] AI itinerary JSON contains title, region, price, days, description, notes, and cover image.
- [ ] Section images use destination/place lookup or generation, not raw DM screenshots.
- [ ] Draft remains editable before publishing.
- [ ] Human review is still required before customer-facing use.
- [ ] Uploaded files are stored in the intended R2 path.
- [ ] Failed image lookup has a safe fallback image.

## 7. Payment

- [ ] NewebPay settings load and save.
- [ ] LINE Pay settings load and save if touched.
- [ ] Secrets are never returned in plaintext.
- [ ] Disabled payment config blocks payment creation safely.
- [ ] Deposit and balance payment amounts are calculated correctly.
- [ ] Notify/return/confirm routes are idempotent.
- [ ] Paid state is written only from trusted backend callback or approved admin action.
- [ ] Payment attempts are recorded with enough evidence for reconciliation.
- [ ] Revenue dashboard source of truth is documented.

## 8. Data and Privacy

- [ ] D1 schema changes are backward compatible or migrated.
- [ ] R2/Wasabi paths are intentional and not public unless required.
- [ ] Customer names, phones, UIDs, and payment data are not exposed to unauthorized users.
- [ ] Test records are marked or isolated.
- [ ] Logs are useful but do not leak secrets.
- [ ] Backup or rollback path exists for data-changing release.
- [ ] Destructive operations are not included unless explicitly approved.

## 9. Deployment Checks

- [ ] `node --check worker.js` passes when Worker is changed.
- [ ] `npx.cmd wrangler deploy --dry-run` passes when Worker is changed.
- [ ] Worker deployed successfully if backend changed.
- [ ] Git commit created with scoped files only.
- [ ] Git push completed if Pages/source HTML changed.
- [ ] Untracked reference folders are not accidentally committed.
- [ ] Live endpoint or page is verified after deploy.

## 10. Final Handoff

- [ ] Summarize exact files changed.
- [ ] Summarize exact behavior changed.
- [ ] Include deployed Worker version or commit.
- [ ] State what was verified.
- [ ] State any verification gap or cache delay.
- [ ] State next operator action if required.

