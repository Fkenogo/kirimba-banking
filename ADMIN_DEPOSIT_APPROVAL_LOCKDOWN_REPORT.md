# Admin Deposit Approval Lockdown Report

**Date**: 2026-03-11

---

## Problem

Admin users could confirm deposits and update member balances directly, bypassing the required Umuco (institution) batch confirmation workflow. This is a financial control flaw.

### Correct business rule

```
Agent records deposit
  → Agent submits batch
    → Umuco (institution) confirms batch  ← ONLY path that moves balances
```

Admin is monitoring/oversight only — they must not be able to trigger balance updates.

---

## Phase 1 — Flawed Path Identified

### Frontend entry point

**File**: `apps/admin/src/features/Deposits/PendingDepositsScreen.jsx`

An **"Approve Batch"** button was visible to admin when pending deposits existed. Clicking it called:

```javascript
const fn = httpsCallable(functions, "adminApproveDeposits");
const result = await fn({ transactionIds });
```

### Backend callable

**File**: `functions/src/savings.js` — `exports.adminApproveDeposits` (line 299)

**Previous permission check**:

```javascript
const adminRole = context.auth.token?.role;
if (adminRole !== ROLES.SUPER_ADMIN && adminRole !== ROLES.ADMIN && adminRole !== ROLES.FINANCE) {
  throw httpsError("permission-denied", "Requires super_admin, admin, or finance role.");
}
```

`super_admin`, `admin`, and `finance` roles could all confirm deposits.

### What the function did (the flaw)

In one atomic batch write it:
1. Set each transaction `status → confirmed`, set `approvedBy`, `approvedAt`
2. Updated each member's `wallet`: `balanceConfirmed +=`, `balancePending -=`, `availableBalance` recalculated
3. Updated each `group`: `totalSavings +=`, `pendingSavings -=`
4. Updated `kirimbaFund/current`: `totalCollateral +=`

This is the same effect as `confirmBatch` — but with no Umuco oversight, no batch audit record, and no institution reference number.

---

## Phase 2 — Backend Locked

**File changed**: `functions/src/savings.js`

**New permission logic** — the function now immediately throws for any caller:

```javascript
exports.adminApproveDeposits = functions.https.onCall(async (data, context) => {
  // Deposit confirmation is exclusively handled by institution (Umuco) staff via confirmBatch.
  // Admin approval of deposits is not permitted.
  throw httpsError(
    "permission-denied",
    "Deposit confirmation is not permitted for admin. Only institution staff can confirm deposits via batch confirmation."
  );
  // ... rest of function body is now unreachable
```

Any direct call to `adminApproveDeposits` — regardless of role — returns `permission-denied`. The function body that updates balances is permanently unreachable.

**Deploy command**:
```bash
firebase deploy --only functions:adminApproveDeposits
```
**Deploy result**: ✅ `functions[adminApproveDeposits(us-central1)] Successful update operation.`

---

## Phase 3 — Frontend Made View-Only

**File changed**: `apps/admin/src/features/Deposits/PendingDepositsScreen.jsx`

**Removed**:
- `httpsCallable` / `functions` import
- `confirming` state and confirmation bar UI
- `approving` state and loading indicator
- `approveResult` success state and success screen
- `approveError` state and error display
- `handleApprove()` function
- **"Approve Batch (N)"** button

**Added**:
- Subtitle: `"View-only — deposits are confirmed by institution staff"`
- Empty-state copy updated: `"All deposits have been confirmed by the institution."`

**Kept**:
- Full pending deposits table (member, member ID, group, agent, amount, date)
- Total pending amount banner
- Loading and error states
- Navigation back to dashboard

---

## Files Changed

| File | Change |
|---|---|
| `functions/src/savings.js` | `adminApproveDeposits` permission gate now throws `permission-denied` unconditionally |
| `apps/admin/src/features/Deposits/PendingDepositsScreen.jsx` | Removed all approval UI; screen is now view-only |

---

## What Admin Can Still See

The Pending Deposits screen remains fully functional as a **monitoring view**:

- List of all `pending_confirmation` deposit transactions
- Per-row: member name, member ID, group name, agent name, amount (BIF), date
- Total pending amount banner
- Newest-first ordering

Admin cannot trigger any write operations from this screen.

---

## Confirmation: Only Institution Can Confirm Balances

The only code path that can move deposits from `pending_confirmation` to `confirmed` and update member balances is:

**`confirmBatch`** (`functions/src/savings.js`) — callable restricted to `ROLES.UMUCO` only.

The `adminApproveDeposits` function is now permanently blocked at the permission gate before any reads or writes execute.

---

## Retest Checklist

- [ ] Log in as `super_admin` → navigate to Admin → Pending Deposits
- [ ] Confirm the screen loads without error
- [ ] Confirm there is **no** "Approve Batch" button visible
- [ ] Confirm subtitle reads "View-only — deposits are confirmed by institution staff"
- [ ] Confirm the deposits table and total banner still render correctly
- [ ] Attempt to call `adminApproveDeposits` directly (e.g. via Firebase Functions shell or test client) — confirm it returns `permission-denied` immediately
- [ ] Log in as Umuco user → navigate to batch confirmation → confirm `confirmBatch` still works and moves balances correctly
- [ ] Verify after Umuco confirms: admin Pending Deposits screen no longer shows confirmed rows
- [ ] Verify member Transactions screen still shows confirmed deposits with correct status
