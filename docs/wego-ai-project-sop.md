# WeGo AI Project Development SOP

This SOP is the default workflow for WeGo TravelKeeper feature work, especially LINE OA, LIFF, CRM, AI reply, knowledge base, payment, itinerary publishing, and reporting features.

## 1. Purpose

WeGo features must be planned as business workflows, not isolated code changes. Every change should explain:

- Which business result it improves: leads, booking, payment, service speed, repeat purchase, referral, or reporting.
- Which user journey it changes: customer, operator, guide, distributor, or admin.
- Which data is created, updated, read, sent to LINE, or exposed in the backend.
- Which safety boundary prevents AI, payment, or customer data from misbehaving.

## 2. Default Development Order

1. Define the business goal.
2. Map the user journey.
3. Define the MVP and explicitly list what is not included.
4. Identify affected LINE modules: Webhook, Messaging API, LIFF, Rich Menu, postback, tags, or broadcast.
5. Identify affected WeGo modules: monitor, knowledge base, itinerary publishing, CRM, payment, order, revenue dashboard, or mother-site sync.
6. Define data model and storage impact: D1, R2, Wasabi, GitHub Pages HTML, local docs, or external API.
7. Define permissions: admin, operator, distributor, customer, allowlist, or system-only.
8. Write test cases before final implementation.
9. Deploy only after safety checks pass.
10. Record reusable decisions in docs or memory notes when the work changes future behavior.

## 3. Required Feature Brief

Before starting any non-trivial feature, create or fill `docs/wego-feature-brief-template.md`.

Required sections:

- Business goal
- User journey
- MVP scope
- Non-goals
- Data model
- API and Webhook impact
- UI impact
- AI behavior impact
- Security and privacy risk
- Acceptance tests
- Rollback plan

Small emergency fixes can skip the full brief, but the final response must still state what was changed and how it was verified.

## 4. AI Feature Rules

AI features include auto-reply, knowledge base, AI monitor learning, AI itinerary publishing, image/OCR extraction, and document conversion.

Rules:

- AI output must be reviewable by a human before it mutates important business data unless explicitly approved.
- AI customer replies must respect the current allowlist and manual-response switch.
- AI must not answer from private customer data unless the data is explicitly allowed for that use.
- Knowledge base data must be classified as public, internal, or customer-private.
- AI should not reuse DM screenshots as itinerary section images; use place keywords and image lookup/generation instead.
- AI-generated itinerary drafts must remain editable before publishing.
- Prompt changes must be treated as behavior changes and tested with examples.

## 5. LINE OA Rules

LINE OA behavior must be conservative because mistakes are customer-visible.

Rules:

- Do not enable broad AI auto-reply without explicit approval.
- Test admin allowlist behavior before enabling customer-facing replies.
- Manual-response mode must stop AI replies for the selected thread.
- LINE retry events must not produce duplicate replies or duplicate business records.
- Reply token use must stay within LINE limits; fallback push behavior must be explicit.
- Message logs must not expose secrets or unnecessary personal data.

## 6. Payment Rules

Payment work includes NewebPay, LINE Pay, order payment state, deposits, balances, refunds, and revenue dashboards.

Rules:

- Separate settings UI from actual payment execution logic.
- Never expose payment secrets in API responses or frontend state.
- Test both disabled and incomplete-config states.
- Test idempotency for notify/confirm callbacks.
- Do not mutate paid status from frontend-only state.
- Revenue dashboards must state which source of truth they use.
- Test data must not be mixed into production revenue unless clearly marked.

## 7. Data and Security Rules

The following are sensitive:

- LINE Channel Secret and access tokens
- Payment keys and channel secrets
- Customer names, phones, travel dates, payment status, and uploaded files
- Admin UID allowlists
- AI prompts that include private business logic

Rules:

- Do not log full secrets.
- Mask secrets in admin APIs.
- Keep admin-only APIs protected by UID checks.
- Keep customer-private files out of public knowledge base paths.
- Prefer reversible, scoped migrations.
- For destructive actions, define rollback before implementation.

## 8. Documentation Requirements

Every shipped feature should leave at least one of:

- Feature brief
- Release checklist result
- API contract update
- Operator SOP
- Test evidence in final response
- Deployment note with version or commit

For features that change operator behavior, add or update a document under `docs/`.

## 9. Definition of Done

A feature is done only when:

- Code is implemented.
- Relevant local checks pass.
- Live Worker or Pages source is updated if needed.
- The exact deployed URL, version, or commit is known.
- Admin/operator UI behavior is verified or the verification gap is stated.
- Safety impact is reviewed.
- The user knows what changed and where to find it.

