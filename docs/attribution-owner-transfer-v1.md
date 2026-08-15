# Owner Transfer V1 Boundary

This document records the next attribution boundary after Attribution Contract V1.

- `customers.ref_uid` is the immutable original referrer and MUST NOT change during owner transfer.
- `customers.owner_uid` / `owner_name` represent the current service owner and may change only through an explicit tenant-admin workflow.
- `orders.distributor_uid` remains historical per-order attribution and MUST NOT be rewritten by owner transfer.
- Regular CRM profile edits MUST NOT transfer a bound customer's owner.
- Owner transfer must validate that the target is an active `sales` or `editor` membership in the same tenant.
- Owner transfer must write an audit record containing the before/after owner only; it must not copy sensitive customer data into audit logs.
- Customer remains the canonical authority. CRM owner projection follows through the Attribution Contract D1 projection trigger.
- V1 does not support changing the original referrer.