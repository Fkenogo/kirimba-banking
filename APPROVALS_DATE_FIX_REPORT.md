# APPROVALS_DATE_FIX_REPORT

## Root cause
`ApprovalsScreen.jsx` used a date formatter that directly did:
- `const d = ts.toDate ? ts.toDate() : new Date(ts)`
- then always rendered `d.toLocaleString(...)`

When `createdAt` arrived as missing/invalid/non-parseable input, `new Date(...)` produced an invalid date object, so UI rendered `Created Invalid Date`.

## File changed
- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx`

## Exact formatting behavior now used
A new safe helper path was added:
- `toValidDate(value)` supports:
  - Firestore Timestamp (`value.toDate()`)
  - JavaScript `Date`
  - ISO string (and numeric timestamp)
  - `null` / `undefined`
- `formatCreatedAt(value)` now:
  - returns `Created <localized date/time>` when parseable
  - returns `Created —` when missing or invalid
  - never returns `Invalid Date`

The member and group rows now both use `formatCreatedAt(createdAt)` directly.
