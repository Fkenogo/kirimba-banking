# Loan Group Pause Rule

## What it does

If **any** active loan in a member's group is past due, all new loan requests
from that group are hard-blocked until every overdue loan is cleared.

This is a hard stop (`failed-precondition` error), not a soft rejection — no
loan document is created for the requesting member.

## Fields required on each `loans` document

| Field | Type | Purpose |
|---|---|---|
| `groupId` | string | Links loan to a group |
| `status` | string | Must be `"active"` for the check to apply |
| `dueDate` | Firestore Timestamp | Compared to server time to determine "past due" |
| `remainingDue` | number | Guard against already-fully-paid loans that haven't been marked repaid yet; loan is only counted as overdue when `remainingDue > 0` |

## How "past due" is determined

A loan is considered past due when **all three** conditions hold at the moment
of the new loan request:

1. `status === "active"` — disbursed and not yet repaid/defaulted
2. `dueDate.toMillis() < Date.now()` — the repayment deadline has passed
3. `remainingDue > 0` — there is still an outstanding balance

`defaulted` loans do **not** trigger this rule (the scheduled `markLoanDefaulted`
job already updates `status` to `"defaulted"`). Only loans that are still
`active` but whose `dueDate` has elapsed are caught here.

## Implementation note

The check reuses the `groupActiveLoansSnap` result already fetched in the
`requestLoan` `Promise.all` (query: `groupId == X AND status IN [pending, active]`).
No additional Firestore query and no new composite index are needed.

## Error returned

```
code:    "failed-precondition"
message: "Group borrowing paused: overdue loan(s) must be cleared first."
```

## Evaluation order in `requestLoan`

1. Authenticate + verify active member and group (`requireActiveMember`)
2. Validate inputs (amount, termDays, purpose)
3. Parallel data fetch (fund, wallet, group, active loans)
4. **Group Pause check** ← this rule (hard stop, no doc created)
5. Group exposure ratio check (hard stop)
6. Borrower concentration check (hard stop)
7. Soft rejection logic (credit limit, existing loan, fund availability)
8. Write loan document
