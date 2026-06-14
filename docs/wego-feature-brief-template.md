# WeGo Feature Brief Template

Copy this template before starting a non-trivial TravelKeeper feature.

## 1. Feature Name

- Name:
- Requested by:
- Date:
- Priority:
- Target release:

## 2. Business Goal

What business result should this feature improve?

- [ ] More leads
- [ ] More bookings
- [ ] Faster customer service
- [ ] Better itinerary publishing
- [ ] Better payment collection
- [ ] Better operator visibility
- [ ] Better distributor tracking
- [ ] Better customer retention
- [ ] Other:

Success metric:

## 3. User Journey

Who uses this feature?

- [ ] Customer
- [ ] Operator
- [ ] Admin
- [ ] Distributor
- [ ] Guide
- [ ] AI/system

Journey:

1. 
2. 
3. 

## 4. MVP Scope

Must have:

- 

Nice to have:

- 

Explicit non-goals:

- 

## 5. Affected System Areas

- [ ] LINE Webhook
- [ ] LINE Messaging API
- [ ] LIFF
- [ ] Rich Menu
- [ ] LINE OA monitor
- [ ] AI auto-reply
- [ ] Knowledge base
- [ ] AI itinerary publishing
- [ ] CRM
- [ ] Orders
- [ ] Payment
- [ ] Revenue dashboard
- [ ] Mother-site sync
- [ ] R2/Wasabi storage
- [ ] GitHub Pages HTML
- [ ] Cloudflare Worker

Notes:

## 6. Data Model

New tables:

- 

Changed tables:

- 

New fields:

- 

Data source of truth:

Data retention and privacy notes:

## 7. API, Webhook, and Jobs

New API routes:

- 

Changed API routes:

- 

LINE webhook impact:

Scheduled or background jobs:

External APIs:

## 8. UI and Operator Workflow

Pages changed:

- 

Operator workflow:

1. 
2. 
3. 

Empty/error states:

Mobile considerations:

## 9. AI Behavior

Does this feature use AI?

- [ ] No
- [ ] Yes, draft only
- [ ] Yes, customer-facing reply
- [ ] Yes, internal recommendation
- [ ] Yes, extraction/OCR/document parsing

Prompt or knowledge source:

Human review point:

AI safety rules:

- [ ] No private customer data in public knowledge
- [ ] Manual-response switch respected
- [ ] Allowlist respected
- [ ] AI output can be edited before publishing
- [ ] Prompt injection considered

## 10. Security and Permissions

Required roles:

- [ ] Admin
- [ ] Operator
- [ ] Distributor
- [ ] Customer
- [ ] System only

Sensitive data involved:

- [ ] LINE UID
- [ ] Customer phone/name
- [ ] Uploaded files
- [ ] Payment data
- [ ] API secret
- [ ] Internal knowledge

Permission checks:

Secret handling:

## 11. Payment Impact

Does this affect payment?

- [ ] No
- [ ] NewebPay
- [ ] LINE Pay
- [ ] Deposit
- [ ] Balance
- [ ] Refund
- [ ] Revenue dashboard

Amount calculation rule:

Callback/idempotency rule:

Reconciliation evidence:

## 12. Test Plan

Local checks:

- [ ] 

Live checks:

- [ ] 

Negative cases:

- [ ] Permission denied
- [ ] Missing config
- [ ] Duplicate submit or retry
- [ ] AI disabled/manual mode
- [ ] Payment callback repeated
- [ ] Network/API failure

## 13. Release Plan

Files expected to change:

- 

Deploy steps:

1. 
2. 
3. 

Rollback:

Cache or propagation notes:

## 14. Final Handoff Notes

What changed:

Where to find it:

What was verified:

Remaining risk:

Next action:

