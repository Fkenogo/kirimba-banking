# BUILD-STATUS-REPORT.md

> **Generated**: 2026-03-04
> **Mode**: Gap Analysis — Execution Discipline
> **Sources**: AGENT-PROVISION-DESIGN.md, AGENT-PROVISION-AUDIT.md, SECURITY-VERIFICATION.md,
>              REVISED_IMPLEMENTATION_PLAN.md, STATE.md, KIRIMBA_BUILD_ALIGNMENT.md,
>              functions/src/*.js, firestore.rules, apps/*/src/**

---

## 1. Backend Function Status

### 1.1 Member Management (9 functions)

| Function | Status | Notes |
|---|---|---|
| `registerMember` | ✅ Complete | bcrypt `await hashPIN` now correctly awaited (P0 fixed) |
| `approveMember` | ✅ Complete | Sets `role: "member"` custom claim; processes deferred joinGroup |
| `rejectMember` | ✅ Complete | |
| `createGroup` | ✅ Complete | |
| `approveGroup` | ✅ Complete | Stamps `role: "leader"` claim on leader |
| `joinGroup` | ✅ Complete | |
| `approveJoinRequest` | ✅ Complete | Firestore transaction; increments memberCount |
| `resetPIN` | ✅ Complete | bcrypt `await hashPIN` now correctly awaited (P0 fixed) |
| `getPendingApprovals` | ✅ Complete | |

### 1.2 Agent Provisioning (2 functions — NEW since last audit)

| Function | Status | Notes |
|---|---|---|
| `provisionAgent` | ✅ Complete | Creates Auth user + `users/{uid}` + `agents/{uid}`; sets `role: "agent"` custom claim; bcrypt PIN correctly awaited |
| `assignAgentToGroup` | ✅ Complete | Adds `groupId` to `agents/{uid}.assignedGroups[]` array; mirrors to `users/{uid}.assignedGroups` |

> **Key change from design doc**: `agents.js` uses `assignedGroups: []` (array model) instead of scalar `assignedGroupId: null`. This is aligned with `AGENT-ARRAY-MODEL-DIFF.md` and `recordDeposit`'s `allowedGroups.includes()` check.

### 1.3 Savings Management (6 functions)

| Function | Status | Notes |
|---|---|---|
| `recordDeposit` | ✅ Complete | Agent-group auth enforced; reads `agents/{agentId}.assignedGroups[]` |
| `recordWithdrawal` | ✅ Complete | < 50k instant; ≥ 50k creates `withdrawalRequests` |
| `submitBatch` | ⚠️ Partial | Logic correct; idempotency fallback uses `Date.now()` — not retry-safe (P1 unfixed) |
| `confirmBatch` | ⚠️ Partial | Correctly updates `personalSavings` + `totalSavings` + `kirimbaFund`; does NOT recalculate `creditLimit`/`availableCredit` in `groupMembers` (P1 unfixed — stale credit data until next loan request) |
| `flagBatch` | ✅ Complete | Notifications include `expiresAt` |
| `getBatchesForGroup` | ✅ Complete | |

### 1.4 Loan Lifecycle (6 functions)

| Function | Status | Notes |
|---|---|---|
| `requestLoan` | ✅ Complete | Auto-approval logic; checks availableCredit, fund, active loans |
| `disburseLoan` | ✅ Complete | Atomic transaction; locks collateral; updates fund |
| `recordRepayment` | ✅ Complete | Full and partial; releases collateral on full repayment |
| `markLoanDefaulted` | ✅ Complete | Scheduled daily; does not release locked collateral |
| `getMemberLoans` | ✅ Complete | |
| `getLoansByGroup` | ✅ Complete | |

### 1.5 Scheduled Functions

| Function | Status | Notes |
|---|---|---|
| `deleteExpiredNotifications` | ✅ Complete | Daily at midnight Africa/Bujumbura; 500-doc batch; index present |
| `markLoanDefaulted` (scheduled) | ✅ Complete | Daily at 06:00 Africa/Bujumbura |

### 1.6 Auth Trigger

| Function | Status | Notes |
|---|---|---|
| `onUserCreate` | ✅ Complete | Idempotent; creates `users/{uid}` + `wallets/{uid}` |

### 1.7 Fund Management (0 of 3 functions)

| Function | Status | Notes |
|---|---|---|
| `topUpFund` | ❌ Not Started | Finance/super_admin adds capital to `kirimbaFund/current` |
| `getFundStatus` | ❌ Not Started | Read current fund state |
| `getFundMovements` | ❌ Not Started | Query `fundMovements` collection |

---

## 2. Security / Rules Status

### 2.1 P0 Items (Production Blockers)

| Item | Status | Detail |
|---|---|---|
| bcrypt `await hashPIN` in `registerMember` | ✅ Fixed | `members.js:106` |
| bcrypt `await hashPIN` in `resetPIN` | ✅ Fixed | `members.js:480` |
| `groups` Firestore rule uses `groupMembers` lookup (not `memberIds`) | ✅ Fixed | `firestore.rules:51-61` — uses `get(/groupMembers/uid).data.groupId == groupId` |
| `agents/{uid}` Firestore rule missing | ✅ Fixed | `firestore.rules` now has `match /agents/{agentId}` block |
| No `provisionAgent` function (deposit flow broken) | ✅ Fixed | `agents.js` implemented and exported |

### 2.2 P1 Items (Unfixed)

| Item | Status | Detail |
|---|---|---|
| `submitBatch` idempotency fallback uses `Date.now()` | ❌ Unfixed | `savings.js:211` — retry without token creates duplicate batch |
| `confirmBatch` does not update `creditLimit`/`availableCredit` | ❌ Unfixed | `savings.js:530-531` — stale credit until member's next loan request |
| `loan_defaulted` notifications missing `expiresAt` | ❌ Unfixed | `loans.js:487-495` — will never be purged by cleanup function |
| PIN lockout (`checkPINLockout`, `incrementPINAttempts`) is dead code | ❌ Unfixed | Defined in `utils.js:35-73`; never called from any function |

---

## 3. Firestore Rules Status

| Collection | Rule Status | Notes |
|---|---|---|
| `users` | ✅ Correct | Owner, admin, agent read |
| `wallets` | ✅ Correct | Owner, admin, agent read |
| `groups` | ✅ Fixed | Uses `groupMembers` cross-doc lookup (no longer broken `memberIds` check) |
| `groups/joinRequests` | ✅ Correct | Admin, leader read |
| `groupMembers` | ✅ Correct | Owner, admin, agent, leader read |
| `transactions` | ✅ Correct | Owner, admin, agent, umuco read |
| `loans` | ✅ Correct | Owner, admin, agent, umuco read |
| `depositBatches` | ✅ Correct | Admin, agent, umuco read |
| `kirimbaFund` | ✅ Correct | Admin read only |
| `fundMovements` | ✅ Correct | Admin read only |
| `withdrawalRequests` | ✅ Correct | Owner, admin, agent read |
| `notifications` | ✅ Correct | Owner (recipientId or userId), admin read |
| `agents` | ✅ Added | Admin, owner, agent read |
| `counters` | ❌ Missing rule | Used by `generateReceiptNo`; catch-all denies client reads (acceptable — backend-only) |

---

## 4. Frontend Status

### 4.1 Screens Exist

| App | Screen | Status |
|---|---|---|
| All 4 apps | `LoginPage.jsx` | ✅ Auth scaffold (email/password login + signup) |
| All 4 apps | `HomePage.jsx` | ✅ Displays user info + sign-out button |

### 4.2 Screens Missing

**Agent App** (highest priority — blocks pilot launch):
- Dashboard / quick actions
- Find member (search by phone)
- Record deposit form
- Record withdrawal form
- Submit batch (select transactions)
- Disburse loan
- Record repayment
- Receipt display / share

**Admin App**:
- Pending approvals queue (members + groups)
- Approve / reject member
- Approve group + Umuco account
- Provision agent
- Assign agent to group
- Fund management (topUp, status, movements)
- Loans overview

**Umuco App**:
- Batch list (by group, filterable by status)
- Batch confirmation flow
- Flag batch
- Confirmed history

**Member App**:
- Savings/credit dashboard
- Loan request form
- Active loan status + repayment status
- Transaction history
- Join group flow
- Notifications list

### 4.3 Shared Infrastructure Missing

| Item | Status |
|---|---|
| Shared component library | ❌ Not started |
| Phone + PIN auth (replace email/password UX) | ❌ Not started |
| Role-based routing (redirect by custom claim) | ❌ Not started |
| React Query or data-fetching layer | ❌ Not started |
| Error boundary / toast notification system | ❌ Not started |

---

## 5. Milestone Map

### Authentication
- Backend: ✅ Complete (Firebase Auth, PIN hashing, custom claims)
- Frontend: ⚠️ Partial (email/password scaffold — phone+PIN UX not built)

### Member Lifecycle
- Backend: ✅ Complete (register → approve → join group → groupMembers)
- Frontend: ❌ Not started (no approval queue, no join flow UI)

### Group Lifecycle
- Backend: ✅ Complete (create → approve → join request → approve member)
- Frontend: ❌ Not started

### Agent Workflow
- Backend: ✅ Complete (`provisionAgent`, `assignAgentToGroup`, `recordDeposit`, `recordWithdrawal`)
- Frontend: ❌ Not started (agent app is auth scaffold only)

### Deposit Workflow
- Backend: ✅ Complete (`recordDeposit` → `submitBatch` → `confirmBatch`)
- Frontend: ❌ Not started

### Loan Workflow
- Backend: ✅ Complete (`requestLoan` → `disburseLoan` → `recordRepayment` → `markLoanDefaulted`)
- Frontend: ❌ Not started

### Notifications
- Backend: ⚠️ Partial (created on key events; cleanup scheduled; `loan_defaulted` missing `expiresAt`)
- Frontend: ❌ Not started

### Admin Dashboard
- Backend: ⚠️ Partial (`getPendingApprovals` exists; fund management missing)
- Frontend: ❌ Not started

---

## 6. Summary Table

| Area | Completed | In Progress | Not Started | Broken / Untested |
|---|---|---|---|---|
| Member management | ✅ 9/9 functions | — | — | PIN lockout (dead code) |
| Agent provisioning | ✅ 2/2 functions | — | — | Not emulator-tested |
| Savings management | ✅ 4/6 functions | — | — | submitBatch idempotency; confirmBatch credit recalc |
| Loan lifecycle | ✅ 6/6 functions | — | — | loan_defaulted notifications missing expiresAt |
| Fund management | — | — | ❌ 3 functions | — |
| Scheduled functions | ✅ 2/2 | — | — | — |
| Auth trigger | ✅ 1/1 | — | — | — |
| Firestore rules | ✅ Fixed | — | counters (acceptable) | — |
| Agent app frontend | Auth scaffold only | — | ❌ 8 screens | — |
| Admin app frontend | Auth scaffold only | — | ❌ 7 screens | — |
| Umuco app frontend | Auth scaffold only | — | ❌ 4 screens | — |
| Member app frontend | Auth scaffold only | — | ❌ 6 screens | — |
| Shared components | — | — | ❌ Not started | — |

---

## 7. Proposed Next Milestone

### MILESTONE: Fix 3 Remaining P1 Backend Bugs

**Scope**: Backend only. No frontend changes. No new features. No architecture changes.

**Rationale**: The 3 P1 items are small, isolated fixes in existing functions. They do not require new files. They do not affect the API surface. Fixing them now cleans the backend to a stable, fully-correct state before any frontend work begins — which will need to rely on correct backend behavior.

**Items (in order):**

#### Fix 1 — `loan_defaulted` notifications missing `expiresAt`
- **File**: `functions/src/loans.js` ~line 487
- **Change**: Add `expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)` to the `loan_defaulted` notification set call
- **Effort**: 1 line

#### Fix 2 — `confirmBatch` must recalculate `creditLimit` and `availableCredit`
- **File**: `functions/src/savings.js` — inside the member update loop in `confirmBatch`
- **Change**: After `FieldValue.increment()` for `personalSavings`, also write `creditLimit` and `availableCredit` as computed values (read `personalSavings` + `lockedSavings` from the pre-read member snapshots — which are already available before the batch)
- **Effort**: ~5 lines per member update call

#### Fix 3 — `submitBatch` idempotency fallback
- **File**: `functions/src/savings.js` ~line 211
- **Change**: Remove the `|| \`${agentId}_${groupId}_${Date.now()}\`` fallback. Instead, make `idempotencyToken` a required field — throw `invalid-argument` if it is absent.
- **Effort**: 3 lines

**Out of scope for this milestone:**
- PIN lockout wiring (requires a custom login endpoint — separate architectural decision)
- Fund management functions (new file, larger scope)
- Any frontend work
- Any new Firestore indexes or rules changes

**How to test**: Firebase emulator — call `submitBatch` without token (should error), call `confirmBatch` and verify `creditLimit`/`availableCredit` update in `groupMembers`, trigger `markLoanDefaulted` and verify notification has `expiresAt`.

---

_Report generated by static analysis of source files. No code was modified._
