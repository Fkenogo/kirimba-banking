# Member Transactions Index Fix Report

**Date**: 2026-03-11

---

## Problem

The member Transactions screen failed with a Firestore index error on load.

---

## Phase 1 — Diagnosis

**File**: `apps/member/src/features/Transactions/TransactionHistoryScreen.jsx` (line 152–158)

**Exact query causing the error**:

```javascript
query(
  collection(db, "transactions"),
  where("userId", "==", user.uid),
  orderBy("createdAt", "desc"),
  limit(50)
)
```

- Collection: `transactions`
- Filter: `userId == <current user uid>`
- Order: `createdAt DESC`
- Query type: **Direct Firestore client query** (not callable-backed)

**Root cause**: Firestore requires a composite index for any query combining `where` on one field with `orderBy` on a different field. The index `transactions(userId ASC, createdAt DESC)` did not exist in `firestore.indexes.json`.

Existing transactions indexes before fix:
1. `groupId ASC + createdAt DESC`
2. `agentId ASC + type ASC + createdAt ASC`

Neither covers the member-facing `userId + createdAt` query.

---

## Phase 2 — Fix

**File changed**: `firestore.indexes.json`

**Index added**:

```json
{
  "collectionGroup": "transactions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
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

## Phase 3 — Expected Data on Member Transactions Screen

With the index active, the screen will display the last 50 transactions for the logged-in member, including:

| Field shown | Source field |
|---|---|
| Transaction type (Deposit / Withdrawal / Loan Out / Loan Repayment) | `type` |
| Amount | `amount` |
| Status badge (confirmed / pending_confirmation / rejected) | `status` |
| Date | `createdAt` |
| Channel (Agent / Institution Branch) | `channel` |
| Receipt No | `receiptNo` |
| Group ID | `groupId` |
| Balance Before / After | `balanceBefore` / `balanceAfter` |
| Ledger Impact | `ledgerImpact` |

Pending deposits (`status: "pending_umuco"`) will also appear — the status badge maps unknown statuses to their raw value with underscores replaced by spaces, so they render gracefully.

---

## Files Changed

| File | Change |
|---|---|
| `firestore.indexes.json` | Added `transactions(userId ASC, createdAt DESC)` composite index |

No frontend changes required — the query and UI were already correct.

---

## Retest Checklist

- [ ] Log in as a member who has at least one deposit transaction
- [ ] Navigate to the Transactions tab
- [ ] Confirm the screen loads without error
- [ ] Confirm confirmed deposits appear with green "confirmed" badge
- [ ] Confirm pending deposits appear with yellow "pending umuco" / "pending confirmation" badge (if any)
- [ ] Tap a transaction row — confirm the detail modal opens showing amount, receipt no, date, status, channel
- [ ] Confirm timestamps display correctly (e.g. "11 Mar 2026, 14:32")
- [ ] Log in as a member with no transactions — confirm "No transactions yet." empty state renders
- [ ] Confirm the deposit pipeline still works end-to-end (record → batch → confirm → savings update) — no regression
