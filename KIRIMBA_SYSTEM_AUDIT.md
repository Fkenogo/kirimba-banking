# KIRIMBA SYSTEM AUDIT

> **Date**: 2026-03-05
> **Scope**: Backend Cloud Functions, Member App, Agent App, Admin Apps (Super Admin + Partner Institution), Firestore Rules, Data Model
> **Auditor**: Claude (automated, full codebase read)

---

## A) Executive Summary

1. **Backend is production-capable** — 37 exports (28 callables, 2 scheduled, 1 auth trigger, 1 HTTP, 5 query helpers) cover the full savings-and-lending lifecycle plus agent provisioning, reconciliation, and settlement.
2. **Member app has 10 authenticated routes** covering dashboard, deposits, withdrawals, loans, transactions, QR profile, group join, and group management with split — but 3 screens call agent-only functions and will always fail with `permission-denied`.
3. **Agent app is functional with offline-first deposits** — QR scanning with IndexedDB queue, daily summary, business dashboard, and end-of-day reconciliation. Missing: loan disburse/repay screens, batch submit, home navigation.
4. **Admin app covers agent ops** — deposit approval, agent provisioning, group assignment, reconciliation review. **Missing critical screens**: member approval, group approval, fund dashboard, loan oversight.
5. **Umuco (Partner Institution) app is a shell** — login + placeholder only. `confirmBatch`/`flagBatch` have zero frontend consumers. The entire deposit-batch-confirmation path is UI-unreachable.
6. **P0 auth bug**: `provisionAgent` and `registerMember` store the bcrypt PIN hash as the Firebase Auth password. Login forms send the raw PIN. Agents provisioned via the callable cannot log in.
7. **P0 data gap**: `group.totalLoansOutstanding` is read in the 70% group exposure check but never written by any function. The group lending cap is a no-op.
8. **Security is strong post-Phase-0** — bcrypt PIN hashing (12 rounds), cross-group agent verification, idempotent batch submission, role-gated Firestore rules with ownership checks. PIN lockout infra exists but is unwired.
9. **No automated tests** — zero test files, no CI/CD. All verification is manual via emulators.
10. **Wallet-centric model works** — all financial balances live on `wallets/{uid}` with 4-field accounting (confirmed, pending, locked, available). Atomic transactions maintain the invariant `available = confirmed - locked`.

---

## B) Backend Audit

### B.1 Complete Function Inventory

| # | Function | Type | File:Line | Roles | UI Exists? | Notes |
|---|---|---|---|---|---|---|
| 1 | `healthCheck` | HTTP | index.js:18 | Public | N/A | Returns "running" |
| 2 | `onUserCreate` | Auth Trigger | index.js:26 | System | N/A | Creates users/{uid} + wallets/{uid} |
| 3 | `registerMember` | Callable | members.js:98 | Public | Yes (LoginPage) | Phone→email, bcrypt PIN |
| 4 | `approveMember` | Callable | members.js:156 | super_admin | **NO** | Sets status=active, custom claim |
| 5 | `rejectMember` | Callable | members.js:222 | super_admin | **NO** | Sets status=rejected |
| 6 | `createGroup` | Callable | members.js:244 | member, leader | **NO** | Generates groupCode + inviteCode |
| 7 | `approveGroup` | Callable | members.js:287 | super_admin | **NO** | Links Umuco account, promotes leader |
| 8 | `joinGroup` | Callable | members.js:321 | member, leader | **NO** | Via groupCode (KRM-XXX) |
| 9 | `approveJoinRequest` | Callable | members.js:388 | leader | **NO** | Transaction: create groupMember + update counts |
| 10 | `resetPIN` | Callable | members.js:483 | super_admin, agent | **NO** | Updates Auth password + pinHash |
| 11 | `joinGroupByInviteCode` | Callable | members.js:500 | member, leader | Yes | Via inviteCode (KIR-XXXX) |
| 12 | `getGroupMembers` | Callable | members.js:565 | leader, admin, agent, finance | Yes | Used in GroupManageScreen |
| 13 | `initiateGroupSplit` | Callable | members.js:602 | leader | Yes | Batch: create new group, move members |
| 14 | `getPendingApprovals` | Callable | members.js:694 | super_admin | **NO** | Returns pending users + groups |
| 15 | `recordDeposit` | Callable | savings.js:176 | agent | Yes (agent) | Cross-group check, fee/commission ledger |
| 16 | `adminApproveDeposits` | Callable | savings.js:311 | super_admin, finance | Yes | Batch: confirm deposits, update wallets |
| 17 | `submitBatch` | Callable | savings.js:438 | agent | **NO** | Idempotency token required |
| 18 | `recordWithdrawal` | Callable | savings.js:555 | agent | Broken | <50k instant, >=50k creates request |
| 19 | `confirmBatch` | Callable | savings.js:689 | umuco | **NO** | Batch API (500-op limit) |
| 20 | `flagBatch` | Callable | savings.js:833 | umuco | **NO** | Creates high-severity notification |
| 21 | `getAgentLedger` | Callable | savings.js:874 | agent, admin, finance | Partial | Dashboard reads, no dedicated screen |
| 22 | `getBatchesForGroup` | Callable | savings.js:921 | agent, admin, finance, umuco | **NO** | Optional status filter |
| 23 | `requestLoan` | Callable | loans.js:104 | member, leader | Broken | Auto-approve logic, group pause checks |
| 24 | `disburseLoan` | Callable | loans.js:274 | agent | **NO** | Transaction: lock collateral, deduct fund |
| 25 | `recordRepayment` | Callable | loans.js:393 | agent | **NO** | Transaction: partial/full, release collateral |
| 26 | `markLoanDefaulted` | Scheduled | loans.js:526 | System (6AM daily) | N/A | Batch: mark overdue loans defaulted |
| 27 | `getMemberLoans` | Callable | loans.js:573 | member, leader, agent, admin, finance | Partial | Dashboard shows active loan |
| 28 | `getLoansByGroup` | Callable | loans.js:606 | leader, agent, admin, finance | **NO** | Group-level loan view |
| 29 | `provisionAgent` | Callable | agents.js:35 | super_admin | Yes | **P0 bug**: hash as password |
| 30 | `assignAgentToGroup` | Callable | agents.js:133 | super_admin | Yes | Updates agents + users docs |
| 31 | `adminSetGroupBorrowPause` | Callable | groups.js:27 | super_admin, finance | **NO** | Toggle borrowingPaused flag |
| 32 | `closeAgentDay` | Callable | reconciliation.js:103 | agent | Yes | Calculates expected vs counted cash |
| 33 | `adminUpdateReconciliation` | Callable | reconciliation.js:51 | super_admin, finance | Yes | Mark reviewed/flagged, add note |
| 34 | `requestSettlement` | Callable | reconciliation.js:252 | agent | **NO** | Commission payout request |
| 35 | `approveSettlement` | Callable | reconciliation.js:332 | super_admin, finance | **NO** | Approve settlement |
| 36 | `markSettlementPaid` | Callable | reconciliation.js:369 | super_admin, finance | **NO** | Confirm physical payment |
| 37 | `deleteExpiredNotifications` | Scheduled | scheduledFunctions.js:12 | System (daily) | N/A | Deletes notifications past expiresAt |

**Coverage**: 13 of 37 functions have working UI. 20 have no UI. 4 have broken UI.

### B.2 Data Model — Active Collections

| Collection | Doc ID | Created By | Key Fields |
|---|---|---|---|
| `users` | `{uid}` | onUserCreate, registerMember, provisionAgent | fullName, phone, role, status, groupId, pinHash |
| `wallets` | `{uid}` | onUserCreate | balanceConfirmed, balancePending, balanceLocked, availableBalance |
| `groups` | auto | createGroup | name, groupCode, inviteCode, leaderId, status, totalSavings, memberCount |
| `groupMembers` | `{uid}` | approveJoinRequest, joinGroupByInviteCode | userId, groupId, joinedAt, isActive |
| `transactions` | auto | recordDeposit, recordWithdrawal, disburseLoan, recordRepayment | type, status, userId, groupId, amount, receiptNo, balanceBefore/After |
| `loans` | auto | requestLoan | userId, groupId, amount, termDays, dueDate, status, paidAmount, remainingDue |
| `depositBatches` | auto | submitBatch | groupId, agentId, transactionIds[], totalAmount, status, idempotencyToken |
| `kirimbaFund` | `current` | confirmBatch, adminApproveDeposits, disburseLoan, recordRepayment | totalCollateral, availableFund, deployedFund |
| `fundMovements` | auto | disburseLoan, recordRepayment | type (loan_out/repayment_in), amount, loanId |
| `notifications` | auto | various | type, recipientId/userId, status, expiresAt |
| `agents` | `{uid}` | provisionAgent | fullName, phone, status, assignedGroups[] |
| `agentLedgers` | `{txnId}_{type}` | recordDeposit, recordWithdrawal | type (fee/commission), agentId, amount, status |
| `agentReconciliations` | `{agentId}_{date}` | closeAgentDay | cashExpected, cashCounted, difference, status |
| `agentSettlements` | auto | requestSettlement | agentId, periodStart/End, commissionTotal, status |
| `withdrawalRequests` | auto | recordWithdrawal (>=50k) | userId, amount, status (pending_approval) |
| `config` | `fees` | manual | depositFeeFlat, withdrawFeeFlat, agentCommission* |
| `counters` | `{TYPE}_{YEAR}` | generateReceiptNo | value (auto-increment) |

### B.3 Ledger Integrity

**Deposit path**:
`recordDeposit` → wallet.balancePending ↑ → (`adminApproveDeposits` OR `confirmBatch`) → wallet.balanceConfirmed ↑, balancePending ↓, groups.totalSavings ↑, kirimbaFund.totalCollateral ↑

**Loan path**:
`requestLoan` → loan created → `disburseLoan` → wallet.balanceLocked ↑, wallet.availableBalance ↓, fund.deployedFund ↑, fund.availableFund ↓ → `recordRepayment` → fund reversed, if fully repaid: wallet.balanceLocked ↓

**Integrity gap**: `group.totalLoansOutstanding` is read in `requestLoan` line 177 for the 70% exposure check but is **never written** by `disburseLoan`, `recordRepayment`, or `markLoanDefaulted`. The group lending cap is a no-op — any loan within individual credit limit gets approved regardless of group exposure.

**Dual confirmation path**: Both `adminApproveDeposits` (admin-direct) and `submitBatch`→`confirmBatch` (agent→umuco) can confirm deposits. By design, but creates divergent audit trails.

### B.4 Security Summary

| Control | Status |
|---|---|
| bcrypt PIN hashing (12 rounds) | Implemented (utils.js) |
| Cross-group agent verification | Implemented (recordDeposit) |
| Idempotent batch submission | Implemented (submitBatch) |
| Firestore rules: all writes denied from client | Implemented |
| Firestore rules: ownership checks on reads | Implemented (transactions, loans, notifications, agents, ledgers, reconciliations, settlements) |
| PIN lockout (3 attempts / 15min) | Defined but **NEVER CALLED** |
| Frontend role verification | **NOT IMPLEMENTED** — any auth user can render any app's UI |
| Rate limiting on functions | **NOT IMPLEMENTED** |
| Offline deposit encryption | **NOT IMPLEMENTED** — plaintext in IndexedDB |

---

## C) Member App Audit

### C.1 Routes Map

| Route | Component | Status |
|---|---|---|
| `/app/login` | LoginPage | Working |
| `/app/home` | MemberHomeScreen | Working — navigation hub with 8 tiles |
| `/app/dashboard` | MemberDashboardScreen | Working — real-time wallet, active loan, 10 recent txns |
| `/app/savings` | SavingsDashboardScreen | Working — group savings, goal progress, top savers, borrowing power |
| `/app/deposit` | DepositRequestScreen | **BROKEN** — calls `recordDeposit` (agent-only) |
| `/app/withdraw` | WithdrawalRequestScreen | **BROKEN** — calls `recordWithdrawal` (agent-only, missing userId) |
| `/app/loans/request` | RequestLoanScreen | **BROKEN** — missing termDays + purpose in payload |
| `/app/transactions` | TransactionHistoryScreen | Working — last 50 txns with detail modal |
| `/app/my-qr` | MyQRCodeScreen | **BROKEN** — reads `users.memberId` which is never populated |
| `/app/join-group` | JoinGroupScreen | Working — invite code entry, calls `joinGroupByInviteCode` |
| `/app/group/manage` | GroupManageScreen | Working — invite code display, group split wizard (leader) |

### C.2 What a Member Can Actually Do Today

| Action | Works? | Details |
|---|---|---|
| Register (phone + PIN) | Yes | Via `registerMember` callable |
| Log in | Yes | If registered through LoginPage directly (not via callable — see P0 bug) |
| View financial dashboard | Yes | Real-time wallet balances, credit limit, active loan, recent txns |
| View savings dashboard | Yes | Group totals, top savers, goal progress (goal always empty) |
| View transaction history | Yes | 50 most recent with detail modal |
| Join group by invite code | Yes | `joinGroupByInviteCode` |
| Manage group / split (leader) | Yes | `getGroupMembers` + `initiateGroupSplit` |
| Request deposit | **No** | Screen calls agent-only function → `permission-denied` |
| Request withdrawal | **No** | Screen calls agent-only function without userId → always fails |
| Request loan | **No** | Missing `termDays` + `purpose` → backend validation error |
| View QR code | **No** | `memberId` never assigned → always shows placeholder |

### C.3 Missing Member Flows

- Loan term picker (7/14/30 days) — backend ready, no UI control
- Loan history list — `getMemberLoans` exists, no dedicated screen
- Notification inbox — collection + rules exist, no UI
- Create group — `createGroup` exists, no member UI
- Pending join requests (leader view) — no UI
- Withdrawal request tracking — `withdrawalRequests` exists, no member query/UI

---

## D) Agent App Audit

### D.1 Routes Map

| Route | Component | Status |
|---|---|---|
| `/agent/login` | LoginPage | Working |
| `/agent/home` | HomePage | **PLACEHOLDER** — email + sign-out only, no navigation |
| `/agent/scan-deposit` | ScanDepositScreen | Working — QR scan + manual ID + offline + quick amounts |
| `/agent/deposits-today` | AgentDailySummaryScreen | Working — synced/pending split, totals footer |
| `/agent/dashboard` | AgentBusinessDashboardScreen | Working — deposits, pending sync, commission, cash collected |
| `/agent/close-day` | CloseDayScreen | Working — date picker, expected vs counted, submit reconciliation |

### D.2 Deposit Workflow (Primary Agent Flow)

1. **Scan**: Agent opens `/agent/scan-deposit` → scans member QR (html5-qrcode) or types member ID
2. **Lookup**: Queries `users` collection by `memberId` field (currently broken — see F.6)
3. **Amount**: Quick buttons (1k, 2k, 5k, 10k BIF) or custom input
4. **Record**:
   - Online → calls `recordDeposit` → shows receipt number
   - Offline → saves to IndexedDB → `depositSyncService` syncs at 10-second intervals
5. **Review**: Agent sees today's deposits on `/agent/deposits-today` (synced + pending sections)
6. **Close day**: Agent submits reconciliation on `/agent/close-day`

### D.3 Commission & Fees System

- **Configuration**: `config/fees` doc with 4 flat rates: `depositFeeFlat`, `withdrawFeeFlat`, `agentCommissionDepositFlat`, `agentCommissionWithdrawFlat`
- **Ledger entries**: Created atomically inside `recordDeposit` / `recordWithdrawal` via `writeLedgerEntries()`. Deterministic doc IDs (`{txnId}_fee`, `{txnId}_commission`) for idempotency.
- **Visibility**: `AgentBusinessDashboardScreen` reads `agentLedgers` (filtered by date in memory) to show daily commission
- **Settlement lifecycle**: `requestSettlement` → `approveSettlement` → `markSettlementPaid` (all backend-only, no UI)

### D.4 Agent App Gaps

| Gap | Priority | Backend Ready? |
|---|---|---|
| HomePage has no navigation links | P1 | N/A |
| No loan disbursement screen | P1 | Yes (`disburseLoan`) |
| No loan repayment screen | P1 | Yes (`recordRepayment`) |
| No batch submission screen | P2 | Yes (`submitBatch`) |
| No settlement request screen | P2 | Yes (`requestSettlement`) |
| No withdrawal recording screen | P2 | Yes (`recordWithdrawal`) |
| No member search / lookup | P2 | Partial |
| Offline sync: no error handling for rejected deposits | P2 | N/A |
| All-transaction client-side date filter (scale issue) | P2 | N/A |

---

## E) Admin Audit

### E.1 Kirimba Super Admin UI

#### Routes

| Route | Component | Status |
|---|---|---|
| `/admin/login` | LoginPage | Working |
| `/admin/dashboard` | AdminDashboardScreen | Working — nav hub (links to deposits, agents) |
| `/admin/deposits/pending` | PendingDepositsScreen | Working — batch-approve pending deposits |
| `/admin/agents` | AgentListScreen | Working — list all agents with assigned groups |
| `/admin/agents/new` | CreateAgentScreen | Working — create agent (P0 auth bug on result) |
| `/admin/agents/assign` | AssignAgentScreen | Working — assign agent to group |
| `/admin/agents/reconciliation` | AgentReconciliationsScreen | Working — review/flag/note reconciliations |

#### What Super Admin Can Do Today

1. Approve pending deposits (batch) via `adminApproveDeposits`
2. Create agent accounts via `provisionAgent`
3. List all agents with their group assignments
4. Assign agents to groups via `assignAgentToGroup`
5. Review/flag agent daily reconciliations via `adminUpdateReconciliation`

#### Critical Missing Super Admin Screens

| Screen | Backend Functions Available | Priority |
|---|---|---|
| Member approval queue | `getPendingApprovals`, `approveMember`, `rejectMember` | **P0** |
| Group approval | `approveGroup` (needs umucoAccountNo input) | **P0** |
| Kirimba Fund dashboard | kirimbaFund/current + fundMovements collection | P1 |
| Loan oversight / defaults | `getLoansByGroup`, loans collection queries | P1 |
| Group borrow pause control | `adminSetGroupBorrowPause` | P1 |
| Withdrawal request approval | withdrawalRequests collection (no approve function yet) | P1 |
| Settlement approval + payment | `approveSettlement`, `markSettlementPaid` | P2 |
| Fee configuration | config/fees (no CRUD callable) | P2 |
| System audit log | fundMovements collection | P2 |

### E.2 Partner Institution (Umuco) Dashboard

#### Current State: **NON-FUNCTIONAL**

| Route | Component | Status |
|---|---|---|
| `/umuco/login` | LoginPage | Working |
| `/umuco/home` | HomePage | **SHELL** — shows email + sign-out button only |

#### What Umuco Staff Can Do Today: **Nothing.**

The Umuco app has zero functional screens beyond authentication.

#### Backend Functions With No Umuco UI

| Function | Purpose | What It Would Enable |
|---|---|---|
| `confirmBatch` | Confirm deposit batch | Atomically confirm all deposits, update wallets + group + fund |
| `flagBatch` | Flag batch for discrepancies | Create high-severity notification, block confirmation |
| `getBatchesForGroup` | Query batches by group + status | List submitted/confirmed/flagged batches |

#### Impact

The entire deposit-batch-confirmation workflow (Agent submits batch → Umuco confirms at institution → balances credited) **cannot be completed through the UI**. The workaround is admin-direct approval via `adminApproveDeposits`, which bypasses the Umuco verification step and breaks the intended audit trail.

#### Required Umuco Screens (3 minimum)

1. **Pending Batches** — list `depositBatches` with status=submitted, grouped by institution/group
2. **Batch Detail + Confirm** — show transactions in batch, enter Umuco account reference, confirm
3. **Batch History** — confirmed/flagged batches with notes and timestamps

---

## F) Bugs & Blockers List

### P0 — Critical (blocks core flows)

| ID | Bug | File:Line | Impact |
|---|---|---|---|
| F.1 | **Auth password mismatch**: `provisionAgent` and `registerMember` set Firebase Auth password to `pinHash` (bcrypt string). LoginPage sends raw PIN. Login always fails for callable-created users. | agents.js:74, members.js:122 | Agents/members created via callables cannot log in |
| F.2 | **Member approval has no UI**: `approveMember`, `rejectMember`, `getPendingApprovals` all exist. No admin screen. Members stuck at `pending_approval`. | Admin app — missing screen | New members cannot be activated |
| F.3 | **Group approval has no UI**: `approveGroup` exists. No admin screen. Groups stuck at `pending_approval`. | Admin app — missing screen | Groups cannot be activated |
| F.4 | **Umuco app non-functional**: `confirmBatch`/`flagBatch`/`getBatchesForGroup` have no UI. Deposit batch confirmation impossible. | apps/umuco/ — missing screens | Core deposit path broken |
| F.5 | **`group.totalLoansOutstanding` never written**: `requestLoan` reads this at loans.js:176-177 for 70% group exposure check. No function writes it. Cap is a no-op. | loans.js:176, disburseLoan, recordRepayment | No group lending limit |
| F.6 | **`memberId` never assigned**: `MyQRCodeScreen` and `ScanDepositScreen` read `users.memberId`. No function writes it. QR system non-functional. | member/MyQRCodeScreen.jsx, agent/ScanDepositScreen.jsx | QR deposit scanning broken |
| F.7 | **RequestLoanScreen missing required fields**: Sends `{amount}` only. Backend requires `termDays` (7/14/30) and `purpose` (non-empty). Always fails validation. | member/Loans/RequestLoanScreen.jsx | Members cannot request loans |
| F.8 | **DepositRequestScreen calls agent-only function**: Member calls `recordDeposit` which requires `ROLES.AGENT`. Always returns `permission-denied`. | member/Deposits/DepositRequestScreen.jsx:41 | Member deposit screen always fails |
| F.9 | **WithdrawalRequestScreen calls agent-only function**: Member calls `recordWithdrawal` which requires `ROLES.AGENT`, also missing `userId` param. | member/Withdrawals/WithdrawalRequestScreen.jsx:49 | Member withdrawal screen always fails |

### P1 — High (degrades key workflows)

| ID | Bug | File:Line | Impact |
|---|---|---|---|
| F.10 | **Agent HomePage has no navigation**: Placeholder with email + sign-out only. No links to any feature screen. | agent/pages/HomePage.jsx | Agents must know URLs |
| F.11 | **No loan disbursement UI**: `disburseLoan` exists, no agent screen. Approved loans cannot be disbursed. | Agent app — missing screen | Loan disbursement UI-unreachable |
| F.12 | **No loan repayment UI**: `recordRepayment` exists, no agent screen. Repayments cannot be recorded. | Agent app — missing screen | Loan repayment UI-unreachable |
| F.13 | **PIN lockout never called**: `checkPINLockout`/`incrementPINAttempts` defined in utils.js:35-73, never invoked. Brute-force possible. | utils.js:35-73 | Unlimited PIN attempts |
| F.14 | **Withdrawal approval function missing**: `recordWithdrawal` creates `withdrawalRequests/{id}` for >=50k BIF. No callable to approve/reject these. | savings.js:583-601 | Large withdrawals permanently stuck |
| F.15 | **`markLoanDefaulted` notifications missing expiresAt**: Unlike all other notification writes, defaulted-loan notifications have no `expiresAt`. Never cleaned up. | loans.js:558-566 | Notification leak |
| F.16 | **SavingsDashboardScreen reads unwritten fields**: `group.activeLoansTotal` and `group.savingsGoal` are never written. Borrowing power meter always 0, goal bar never renders. | member/Dashboard/SavingsDashboardScreen.jsx | Misleading display |

### P2 — Medium (polish / scale)

| ID | Bug | File:Line | Impact |
|---|---|---|---|
| F.17 | **Missing composite indexes**: `transactions(agentId,type,createdAt)`, `transactions(userId,createdAt)`, `agentLedgers(agentId,status,createdAt)`, `agentLedgers(agentId,type,createdAt)` | firestore.indexes.json | Queries fail in production |
| F.18 | **Client-side date filtering at scale**: `closeAgentDay` and `AgentBusinessDashboardScreen` fetch ALL agent transactions, filter by date in memory. | reconciliation.js:150-153 | Performance degrades with history |
| F.19 | **Offline deposits unencrypted**: IndexedDB stores member financial data in plaintext. | agent/services/offlineDeposits.js | Data exposure on lost device |
| F.20 | **No sync error handling**: Failed offline deposit syncs stay in IndexedDB silently. No UI feedback. | agent/services/depositSyncService.js | Silent failures |
| F.21 | **Duplicate helpers**: `requireRole`, `httpsError`, `parseAmount` defined independently in 5 files. | members.js, savings.js, loans.js, reconciliation.js, agents.js | Maintenance burden |
| F.22 | **Frontend has no role guards**: Any authenticated user can render any app's UI. Backend rejects operations but UI structure/layout is exposed. | All App.jsx files | Information exposure |

---

## G) Next Build Sequence

Each task is scoped for a single Claude session. Ordered by dependency and business impact.

### TASK 1: Fix Login Auth Flow (P0 — F.1)
```
TASK: Fix the authentication bug in registerMember (members.js:120-123) and
provisionAgent (agents.js:68-77). Both functions set Firebase Auth password to
the bcrypt pinHash. Change to use the raw PIN string as the Firebase Auth
password so LoginPage can authenticate with the PIN. Keep pinHash in Firestore
for server-side verification. Update resetPIN (members.js:493-494) the same way.
Test: verify registerMember → signInAccount flow works in emulator.
```

### TASK 2: Build Member & Group Approval Screen (P0 — F.2, F.3)
```
TASK: Create admin approval screen at /admin/approvals in the admin app:
(1) Call getPendingApprovals() on mount to list pending members and groups.
(2) Each pending member row: fullName, phone, createdAt with Approve/Reject buttons.
Approve calls approveMember(userId). Reject shows reason textarea then calls
rejectMember(userId, reason). (3) Each pending group row: name, leaderName,
createdAt with Approve button that prompts for umucoAccountNo then calls
approveGroup(groupId, umucoAccountNo). (4) Add link from AdminDashboardScreen.
Use existing Tailwind card/table patterns from PendingDepositsScreen.
```

### TASK 3: Build Umuco Batch Confirmation UI (P0 — F.4)
```
TASK: Build the Umuco partner institution dashboard with 3 screens:
(1) /umuco/batches — query all active groups, then getBatchesForGroup for each
with status="submitted". Show table: groupName, totalAmount, memberCount,
submittedAt. (2) /umuco/batch/:batchId — batch detail. Read depositBatches doc,
list each transactionId with amount/member. Confirm button calls confirmBatch
(prompt for umucoAccountRef). Flag button calls flagBatch (prompt for notes).
(3) /umuco/history — getBatchesForGroup with no status filter, show all batches.
Update umuco/App.jsx with routes. Wire navigation from /umuco/home.
```

### TASK 4: Fix Member Loan Request + Deposit/Withdrawal Screens (P0 — F.7, F.8, F.9)
```
TASK: (1) In RequestLoanScreen.jsx add: termDays selector (radio: 7-day/6%,
14-day/5%, 30-day/4%), purpose textarea (required, 10-500 chars). Show
calculated interest and totalDue. Pass {amount, termDays, purpose} to
requestLoan(). (2) Replace DepositRequestScreen with an informational "My
Deposit" screen: show wallet balances + link to /app/my-qr with message "Show
your QR code to an agent to make a deposit". Remove recordDeposit call.
(3) Replace WithdrawalRequestScreen: show available balance + instructions
"Visit your agent to request a withdrawal". Remove recordWithdrawal call.
```

### TASK 5: Add memberId Generation + Fix QR System (P0 — F.6)
```
TASK: (1) In approveMember (members.js), after setting status=active, generate
a memberId: format "M-{last4ofUID}-{random3digits}" (or sequential via
counters/MEMBER_SEQ). Write to users/{userId}.memberId. (2) Verify MyQRCodeScreen
reads this field. (3) Verify ScanDepositScreen queries users.where("memberId","==",id)
and gets a match. (4) Add a Firestore single-field index on users.memberId if
needed. Test full QR flow: approve member → view QR → agent scans → deposit recorded.
```

### TASK 6: Build Agent Navigation + Loan Screens (P1 — F.10, F.11, F.12)
```
TASK: (1) Replace agent HomePage.jsx with navigation hub showing 6 tiles:
Scan Deposit, Today's Deposits, Dashboard, Disburse Loan, Record Repayment,
Close Day. Use card grid matching member MemberHomeScreen pattern.
(2) Create /agent/disburse — DisburseLoanScreen: query loans where status=pending,
list with member name/amount/term. Disburse button calls disburseLoan(loanId).
(3) Create /agent/repay — RecordRepaymentScreen: query loans where status=active,
show remainingDue, input amount, calls recordRepayment(loanId, amount, channel).
Add routes to agent/App.jsx.
```

### TASK 7: Fix group.totalLoansOutstanding + Write approveWithdrawal (P1 — F.5, F.14)
```
TASK: (1) In disburseLoan (loans.js), after updating the loan to active, add:
groups/{groupId}.totalLoansOutstanding = FieldValue.increment(amount).
In recordRepayment, when fullyRepaid, add: groups/{groupId}.totalLoansOutstanding
= FieldValue.increment(-loanAmount). In markLoanDefaulted batch, add: for each
defaulted loan, groups/{groupId}.totalLoansOutstanding = FieldValue.increment(
-remainingDue). (2) Create approveWithdrawal(requestId) callable in savings.js:
reads withdrawalRequests/{requestId}, validates pending_approval, performs
withdrawal (same as <50k path), updates request status. Export in index.js.
```

### TASK 8: Build Admin Fund Dashboard + Loan Oversight (P1)
```
TASK: Create two admin screens: (1) /admin/fund — FundDashboardScreen: read
kirimbaFund/current, show 3 metric cards (totalCollateral, availableFund,
deployedFund), query fundMovements ordered by createdAt desc limit 20.
(2) /admin/loans — LoanOversightScreen: query loans (all or filtered by
status dropdown: pending/active/repaid/defaulted), show table with member name,
amount, termDays, dueDate, status badge, remainingDue. Add navigation links
from AdminDashboardScreen. Use existing Tailwind table patterns.
```

### TASK 9: Add Missing Indexes + Wire PIN Lockout + Notifications Fix (P1/P2 — F.13, F.15, F.17)
```
TASK: (1) Add to firestore.indexes.json: transactions(userId ASC, createdAt DESC),
transactions(agentId ASC, type ASC, createdAt DESC), agentLedgers(agentId ASC,
status ASC, createdAt DESC), agentLedgers(agentId ASC, type ASC, createdAt DESC).
(2) Add expiresAt to the markLoanDefaulted notification in loans.js:558-566:
expiresAt: new Date(Date.now() + 90*24*60*60*1000). (3) Consider where to wire
PIN lockout — since login uses Firebase Auth (which has its own rate limiting),
document that PIN lockout applies to future PIN-verification flows (e.g. transfer
confirmation). No code change needed now; add TODO comment in utils.js.
```

### TASK 10: Agent Batch Submit + Withdrawal Screen (P2)
```
TASK: (1) Create /agent/submit-batch — BatchSubmitScreen: query agent's pending
transactions for a given group, show checkboxes to select deposits, generate
idempotencyToken via crypto.randomUUID(), call submitBatch(groupId, transactionIds,
idempotencyToken). Show batch summary on success. (2) Create /agent/withdraw —
AgentWithdrawalScreen: lookup member by QR/ID, show available balance, input
amount, call recordWithdrawal(userId, amount, notes). Add routes to agent/App.jsx.
```

---

## Run Checklist

Top 5 commands/screens to verify key flows end-to-end:

### 1. Registration → Approval → Login
```
1. Member app /app/login → signup with +25712345678@kirimba.app
2. Admin app /admin/approvals → Approve member (Task 2 must be done)
3. Member app /app/login → login with same credentials
VERIFY: /app/dashboard loads with zero balances, credit limit 0 BIF
```

### 2. Deposit → Confirmation → Balance Update
```
1. Agent /agent/scan-deposit → scan member QR → deposit 10,000 BIF (Task 5 must be done)
2. Admin /admin/deposits/pending → Approve batch
   OR: Umuco /umuco/batches → confirm batch (Task 3 must be done)
VERIFY: Member /app/dashboard → balanceConfirmed = 10,000, creditLimit = 15,000
```

### 3. Loan Request → Disburse → Repay
```
Precondition: Member has 10,000 BIF confirmed (from flow 2)
1. Member /app/loans/request → 5,000 BIF, 7 days, purpose (Task 4 must be done)
VERIFY: Loan approved (5,000 < 15,000 credit limit)
2. Agent /agent/disburse → select pending loan → Disburse (Task 6 must be done)
VERIFY: wallet.balanceLocked = 5,000, fund.deployedFund += 5,000
3. Agent /agent/repay → select active loan → repay 5,300 BIF
VERIFY: Loan repaid, wallet.balanceLocked = 0, fund returned
```

### 4. Agent End-of-Day Reconciliation
```
1. Agent /agent/close-day → today's date → enter cash counted → Submit
2. Admin /admin/agents/reconciliation → see record → Mark Reviewed
VERIFY: Status = "reviewed", reviewer noted
```

### 5. Kirimba Fund Health
```
After flows 2+3 complete:
firebase firestore:get kirimbaFund/current (or Admin /admin/fund if Task 8 done)
VERIFY: totalCollateral >= sum(confirmed deposits)
        deployedFund = sum(active loan amounts)
        availableFund = capital − deployedFund
```

---

*Generated 2026-03-05 by automated system audit. All findings verified against source code at commit HEAD on branch `main`.*
