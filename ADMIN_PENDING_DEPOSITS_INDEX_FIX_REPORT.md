# Admin Pending Deposits Index Fix Report

**Date**: 2026-03-11

---

## Problem

The Admin → Pending Deposits screen failed on load with a Firestore index error:
> "The query requires an index"

---

## Phase 1 — Diagnosis

**File**: `apps/admin/src/features/Deposits/PendingDepositsScreen.jsx` (lines 49–54)

**Exact query causing the error**:

```javascript
query(
  collection(db, "transactions"),
  where("type", "==", "deposit"),
  where("status", "==", "pending_confirmation"),
  orderBy("createdAt", "desc")
)
```

- Collection: `transactions`
- Filter 1: `type == "deposit"`
- Filter 2: `status == "pending_confirmation"`
- Order: `createdAt DESC`
- Query type: **Direct Firestore client query** (not callable-backed)

**Root cause**: Firestore requires a composite index for any query with multiple `where` clauses combined with `orderBy`. The 3-field index `transactions(type ASC, status ASC, createdAt DESC)` did not exist.

Existing `transactions` indexes before this fix:
1. `groupId ASC + createdAt DESC`
2. `agentId ASC + type ASC + createdAt ASC`
3. `userId ASC + createdAt DESC` ← added in previous fix

None covered the `type + status + createdAt` combination needed by the admin screen.

---

## Phase 2 — Index Added

**File changed**: `firestore.indexes.json`

**Index added**:

```json
{
  "collectionGroup": "transactions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

**Deploy command**:

```bash
firebase deploy --only firestore:indexes
```

**Deploy result**: ✅ Success — `firestore: deployed indexes in firestore.indexes.json successfully for (default) database`

---

## Phase 3 — Screen Output After Fix

The Admin Pending Deposits screen will now load without error and display a table of all `transactions` where `type == "deposit"` AND `status == "pending_confirmation"`, ordered newest-first.

Each row shows:
| Column | Source field |
|---|---|
| Member (name) | resolved from `users/{userId}.fullName` |
| Member ID | `memberId` |
| Group (name) | resolved from `groups/{groupId}.name` |
| Agent (name) | resolved from `users/{agentId}.fullName` |
| Amount | `amount` (BIF) |
| Date | `createdAt` |

A total pending amount banner is shown above the table.

An **Approve Batch** button is available when deposits are present, which calls the `adminApproveDeposits` Cloud Function with all listed transaction IDs, then updates member balances.

---

## Files Changed

| File | Change |
|---|---|
| `firestore.indexes.json` | Added `transactions(type ASC, status ASC, createdAt DESC)` composite index |

No frontend changes required — the query and UI were already correct.

---

## Retest Checklist

- [ ] Log in as admin
- [ ] Navigate to Admin → Pending Deposits
- [ ] Confirm the screen loads without error (no "index required" message)
- [ ] Confirm pending deposit rows appear in the table with member name, group, agent, amount, and date
- [ ] Confirm total pending amount banner shows the correct sum
- [ ] Click **Approve Batch** → confirm the confirmation bar appears
- [ ] Click **Confirm** → confirm approval succeeds and success state is shown with correct count and total
- [ ] Re-open Pending Deposits → confirm the list is now empty ("No pending deposits")
- [ ] Confirm member savings balances updated correctly after approval
- [ ] Confirm no regression on member Transactions screen (index from previous fix still works)
