# KIRIMBA Fund Management — Implementation Report

**Date**: 2026-03-14
**Scope**: Audit, standardize, and fully implement Kirimba Fund Management end-to-end.

---

## 1. Files Changed

### Backend
| File | Change |
|------|--------|
| `functions/src/loans.js` | Added lendingPaused check, fund update on default, repaidReturned tracking, fundLedger entries |
| `functions/src/superAdmin.js` | Added 7 fund management functions + updated getExecutiveSummary |
| `functions/index.js` | Exported 7 new fund management functions |
| `firestore.rules` | Added `fundLedger` collection rule |
| `firestore.indexes.json` | Added 2 composite indexes for `fundLedger` |

### Frontend
| File | Change |
|------|--------|
| `apps/admin/src/features/SuperAdmin/KirimbaFundManagementScreen.jsx` | **New file** — full fund management UI |
| `apps/admin/src/App.jsx` | Added route `/admin/super/fund` |
| `apps/admin/src/features/Admin/AdminDashboardScreen.jsx` | Added "Fund Management" NavCard to Business Oversight section |
| `apps/admin/src/features/SuperAdmin/ExecutiveDashboardScreen.jsx` | Added lending-paused warning banner in Fund Health section |

---

## 2. Existing Fund Schema (Before)

```typescript
// kirimbaFund/current — fields found in production code
{
  availableFund:   number,   // liquid capital available to lend
  deployedFund:    number,   // capital locked in active loans
  totalCollateral: number,   // sum of confirmed member savings (written by confirmBatch)
  lastUpdated:     Timestamp, // set by loans.js production writes
  updatedAt:       Timestamp, // set by seed script only (orphaned field — never updated in prod)
  updatedBy:       string,   // actor UID
}
```

**Issues found**:
- `lastUpdated` vs `updatedAt` dual timestamp inconsistency (orphaned field)
- No `totalCapital` field (initial capital injection never recorded)
- No `lendingPaused` system-wide flag
- No `defaultedExposure` — defaulted loans never moved `deployedFund`
- No `repaidReturned` cumulative tracking
- No `fundLedger` audit trail
- Default events did not update `kirimbaFund` at all (critical gap)
- `deployedFund` could go mathematically negative on full repayment with interest (guarded by Math.max(0) but masked)

---

## 3. Canonical Fund Schema (After)

```typescript
// kirimbaFund/current
{
  // Existing fields (preserved, backward compatible)
  availableFund:         number,    // liquid capital available to lend
  deployedFund:          number,    // capital currently locked in active loans
  totalCollateral:       number,    // sum of all confirmed member savings
  lastUpdated:           Timestamp, // set on every write
  updatedBy:             string,    // actor UID

  // New fields (added)
  totalCapital:          number,    // total money ever injected: seed + topups - deductions
  defaultedExposure:     number,    // cumulative principal written off to defaults
  repaidReturned:        number,    // cumulative repayments received (running total, includes interest)
  lendingPaused:         boolean,   // system-wide lending pause flag
  lendingPausedReason:   string | null,
  lendingPausedAt:       Timestamp | null,
  lendingPausedBy:       string | null,
}
```

Note: `updatedAt` (the orphaned seed-script field) is left in place; it will be ignored going forward but not deleted to avoid breaking any tooling that reads it.

---

## 4. New `fundLedger` Collection

```typescript
// fundLedger/{entryId}
{
  type:          "seed" | "topup" | "deduction" | "loan_out" | "repayment_return" | "default_loss",
  amount:        number,
  beforeBalance: number | null,  // availableFund before this operation (null for scheduled defaults)
  afterBalance:  number | null,  // availableFund after this operation
  notes:         string,
  actorId:       string,         // UID or "system" for scheduled functions
  actorRole:     string | null,  // role at time of action or "system"
  loanId:        string | null,  // set for loan-related entries
  createdAt:     Timestamp,
}
```

Ledger entries are created for:
- **seed** — `seedKirimbaFund` call
- **topup** — `topUpKirimbaFund` call
- **deduction** — `deductKirimbaFund` call
- **loan_out** — every loan disbursement (inside the disbursement transaction)
- **repayment_return** — every loan repayment (inside the repayment transaction)
- **default_loss** — every loan default (inside manual default transaction; batch for scheduled defaults)

---

## 5. Backend Functions Added/Updated

### New functions (all in `functions/src/superAdmin.js`, exported from `functions/index.js`)

| Function | Role | Description |
|----------|------|-------------|
| `getKirimbaFundOverview` | `super_admin` | Returns full canonical fund document |
| `seedKirimbaFund(initialCapital, notes?)` | `super_admin` | Initializes fund (throws if already exists) |
| `topUpKirimbaFund(amount, notes?)` | `super_admin` | Adds capital; transactional + ledger entry |
| `deductKirimbaFund(amount, notes)` | `super_admin` | Removes capital; validates available balance; transactional + ledger entry |
| `pauseKirimbaLending(reason)` | `super_admin` | Sets `lendingPaused = true` |
| `resumeKirimbaLending()` | `super_admin` | Clears `lendingPaused` |
| `getKirimbaFundLedger(limit?)` | `super_admin` | Returns `fundLedger` entries (desc by createdAt, max 200) |

### Updated functions

**`getExecutiveSummary`**: now returns `fund.lendingPaused` alongside existing fund fields.

---

## 6. Loan Lifecycle Changes (`functions/src/loans.js`)

### `requestLoan`
Added system-wide lending pause check immediately after reading `kirimbaFund/current`:
```javascript
if (fund.lendingPaused === true) {
  throw httpsError("failed-precondition", "Lending is temporarily paused system-wide. Please try again later.");
}
```
Behaviour: throws without creating a loan document (same pattern as the existing group-level `borrowingPaused` check).

### `executeLoanDisbursement`
Added `fundLedger` entry (type: `loan_out`) inside the Firestore transaction, recording `beforeBalance` and `afterBalance` of `availableFund`.

### `executeLoanRepayment`
- Added `repaidReturned: FieldValue.increment(amount)` to the `kirimbaFund` update.
- Added `fundLedger` entry (type: `repayment_return`) inside the transaction.

### `executeLoanDefault` (manual admin default)
- Now reads `kirimbaFund/current` inside the transaction.
- Moves `remainingDue` from `deployedFund` to `defaultedExposure`.
- Writes a `fundLedger` entry (type: `default_loss`).

### `markLoanDefaulted` (scheduled daily)
- Computes total defaulted principal across all newly-defaulted loans.
- Adds to the batch: `kirimbaFund` update (`deployedFund -= total`, `defaultedExposure += total`) and a single `fundLedger` entry.
- Note: `beforeBalance`/`afterBalance` are `null` in the scheduled entry (batch cannot atomically read-then-write without a transaction).

---

## 7. Frontend Changes

### New screen: `KirimbaFundManagementScreen.jsx`
Route: `/admin/super/fund`
Visible to: `super_admin` (via `ProtectedRoute`; backend enforces `super_admin` on all write actions)

**Section A — Fund Overview**: 6 metric cards (Total Capital, Available Balance, Locked in Loans, Total Collateral, Defaulted Exposure, Repayments Returned). If fund doesn't exist, shows an empty state with a "Seed Initial Fund" button.

**Section B — Fund Actions**: 4 action cards (Top Up, Deduct, Pause/Resume Lending, View Ledger). The Pause/Resume card toggles based on current `lendingPaused` state.

**Section C — Fund Ledger**: Table of all `fundLedger` entries (latest 100). Columns: Date, Type (color-coded badge), Amount, Before, After, Notes, Actor.

**Amber banner**: Displayed prominently at the top if `lendingPaused === true`, with an inline "Resume Lending" button.

### `AdminDashboardScreen.jsx`
Added "Fund Management" `NavCard` to the "Business Oversight" (Super Admin) section.

### `ExecutiveDashboardScreen.jsx`
Added an amber warning banner in the Fund Health section when `fund.lendingPaused === true`, with a "Manage →" link to `/admin/super/fund`.

---

## 8. Migration / Backfill Notes

**No destructive migration required.**

- Existing `kirimbaFund/current` documents are read with field-level defaults (`|| 0`, `=== true`) so missing new fields are treated as zero/false.
- `totalCapital` will be `0` on existing documents. After the first `topUpKirimbaFund` or `seedKirimbaFund` call, it will be set correctly.
- `defaultedExposure` starts at `0` on existing documents. Historical defaults are not backfilled (fund already has `Math.max(0, deployedFund - amount)` from those old repayments, so the balance is approximately correct even without the historical exposure figure).
- `repaidReturned` starts at `0` and accumulates going forward.
- `lendingPaused` is treated as `false` when absent.

**Recommended one-time action after deploy**: Call `topUpKirimbaFund` with the actual starting capital amount and a note like "Production initial capital backfill" to set `totalCapital` correctly. This creates a visible ledger entry.

---

## 9. Security Rules

```
// Added to firestore.rules
match /fundLedger/{entryId} {
  allow read: if isSignedIn() && isAdmin();
  allow write: if false; // backend-only writes
}
```

`kirimbaFund` rule was already correct (`isAdmin()` read, `false` write).

---

## 10. Firestore Indexes Added

Two composite indexes added to `firestore.indexes.json`:
```json
{ "collectionGroup": "fundLedger", "fields": [{ "fieldPath": "type", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] }
{ "collectionGroup": "fundLedger", "fields": [{ "fieldPath": "actorId", "order": "ASCENDING" }, { "fieldPath": "createdAt", "order": "DESCENDING" }] }
```

The `getKirimbaFundLedger` query (`orderBy("createdAt", "desc").limit(N)`) uses a single-field order so no composite index is required for it.

---

## 11. Deploy Commands

```bash
# 1. Build all frontend apps
npm run build:all

# 2. Deploy functions (new fund management functions + loan changes)
firebase deploy --only functions

# 3. Deploy Firestore rules (new fundLedger rule)
firebase deploy --only firestore:rules

# 4. Deploy Firestore indexes (new fundLedger indexes — takes 2-3 min to build)
firebase deploy --only firestore:indexes

# 5. Deploy updated frontend (AdminDashboardScreen, ExecutiveDashboardScreen, new KirimbaFundManagementScreen)
firebase deploy --only hosting

# Or deploy everything at once:
firebase deploy
```

---

## 12. Manual Test Checklist

### Fund Initialization
- [ ] Log in as `super_admin`
- [ ] Navigate to Admin Dashboard → Business Oversight → Fund Management
- [ ] Confirm "Fund not initialized yet" empty state appears
- [ ] Click "Seed Initial Fund", enter 5,000,000 BIF, click "Seed Fund"
- [ ] Confirm Fund Overview shows Total Capital = 5,000,000, Available Balance = 5,000,000
- [ ] Confirm fundLedger table shows one entry with type "Seed"
- [ ] Try seeding again — confirm error "Fund already seeded"

### Top Up
- [ ] Click "Top Up Fund", enter 1,000,000 BIF, add a note, confirm
- [ ] Confirm Total Capital = 6,000,000, Available Balance = 6,000,000
- [ ] Confirm new "Top-up" ledger entry with correct before/after values

### Deduct
- [ ] Click "Deduct from Fund", enter 500,000 BIF, enter a reason, confirm
- [ ] Confirm Total Capital = 5,500,000, Available Balance = 5,500,000
- [ ] Try deducting more than available — confirm error "Cannot deduct X BIF: only Y BIF available"
- [ ] Confirm new "Deduction" ledger entry

### Lending Pause
- [ ] Click "Pause Lending", enter a reason, confirm
- [ ] Confirm amber banner appears at top of Fund Management screen
- [ ] Confirm amber warning appears on Executive Dashboard → Fund Health
- [ ] As a member, attempt to request a loan — confirm rejection with "Lending is temporarily paused system-wide"
- [ ] Click "Resume Lending" — confirm banner disappears, lending re-enabled

### Loan Disbursement Ledger Entry
- [ ] Disburse a loan
- [ ] Go to Fund Management → Fund Ledger
- [ ] Confirm "Loan Out" entry with correct amount and before/after balance

### Loan Repayment Ledger Entry
- [ ] Record a repayment on an active loan
- [ ] Confirm "Repayment In" entry in Fund Ledger
- [ ] Confirm `repaidReturned` field incremented in Fund Overview (visible via Firebase console or `getKirimbaFundOverview`)

### Default — Manual
- [ ] Admin marks a loan as defaulted
- [ ] Confirm `deployedFund` decreased by `remainingDue`
- [ ] Confirm `defaultedExposure` increased by `remainingDue`
- [ ] Confirm "Default Loss" entry in Fund Ledger

### Default — Scheduled (emulator test)
- [ ] Create an active loan with a past-due date
- [ ] Trigger `markLoanDefaulted` function via Firebase emulator UI
- [ ] Confirm kirimbaFund updated + fundLedger entry created

### Executive Dashboard
- [ ] Confirm lending paused state shows warning banner when lending is paused
- [ ] Confirm "Manage →" link navigates to Fund Management screen
