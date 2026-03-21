# KIRIMBA Architecture Freeze Report
> **Date**: 2026-03-16
> **Status**: Phase 1 complete — Phase 2 (dashboard completion) may begin
> **Purpose**: Canonical reference for data contracts, role model, institution scoping, and remaining gaps

---

## Table of Contents
1. [Final Data Contracts](#1-final-data-contracts)
2. [Role-Permission Matrix](#2-role-permission-matrix)
3. [Institution Scoping Map](#3-institution-scoping-map)
4. [Legacy Audit Results](#4-legacy-audit-results)
5. [Remaining Architecture Gaps](#5-remaining-architecture-gaps)
6. [Recommended Phase 2 Implementation Order](#6-recommended-phase-2-implementation-order)

---

## 1. Final Data Contracts

> **Ownership**: All writes are backend-only (Cloud Functions via Admin SDK). Firestore rules deny all client writes.

---

### 1.1 `institutions/{institutionId}`

**Purpose**: Registry of partner microfinance institutions (e.g., Umuco). All groups, agents, and institution users are scoped to one institution.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `name` | string | Display name |
| `code` | string | Unique short code, 2–20 chars (e.g. "UMUCO") |
| `status` | string | Enum: `active`, `suspended` |
| `createdAt` | Timestamp | Server-set on creation |
| `createdBy` | string (uid) | Super admin who created |

**Optional fields**: `contactEmail`, `notes`, `suspendedAt`, `suspendedBy`, `suspendReason`

**Status enum**: `active` | `suspended`

**Role ownership**: Created/managed exclusively by `super_admin`

**Institution scoping**: This IS the institution root — not scoped itself

**Cross-links**: Referenced by `groups.institutionId`, `users.institutionId`, `depositBatches.institutionId`, `institutionPools.{institutionId}`

**Computed vs stored**: All stored

---

### 1.2 `users/{uid}`

**Purpose**: User profile for all roles. Firebase Auth is the auth source of truth; this document holds profile data and role metadata.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `uid` | string | Matches Firebase Auth UID and doc ID |
| `fullName` | string | 3–100 chars |
| `phone` | string | +257XXXXXXXX format |
| `role` | string | Enum: see Roles section |
| `status` | string | Enum: `pending_approval`, `active`, `suspended`, `rejected` |
| `pinHash` | string | bcrypt hash of 6-digit PIN |
| `createdAt` | Timestamp | |

**Optional fields**: `nationalId`, `groupId` (FK → groups), `isLeader` (bool), `ledGroupId` (FK → groups, leader only), `memberId` (assigned at approval), `institutionId` (FK → institutions, for agents and institution_user), `proposedLeaderForGroupId` (transient, during group creation), `groupCodeToJoin` (transient, during self-registration), `approvedAt`, `rejectionReason`, `updatedAt`, `createdBy`, `isActive`

**Status enum**: `pending_approval` | `active` | `suspended` | `rejected`

**Role enum**: `super_admin` | `admin` | `finance` | `agent` | `leader` | `member` | `institution_user` | `umuco` *(legacy, being migrated to institution_user)*

**Role ownership**: `super_admin` approves members; `super_admin`/`admin` provision agents/admins; Auth trigger creates on signup

**Institution scoping**: `institutionId` required for `agent` and `institution_user` roles; null for `member`, `leader`

**Cross-links**: `groupMembers/{uid}`, `wallets/{uid}`, `agents/{uid}` (agent role), `auditLog` (actorId)

**Custom claims** (Firebase Auth JWT): `{ role: string, institutionId?: string }`

**Computed vs stored**:
- `creditLimit` and `availableCredit` are on `groupMembers`, not `users`
- `memberId` is stored (generated at approval)

**Legacy**: `umucoAccountNo` field on `groups` (not users) is a legacy label for `institutionAccountNo`

---

### 1.3 `groupMembers/{uid}`

**Purpose**: Tracks financial position of a member within their group. Doc ID = user UID (one member per group model).

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `userId` | string | FK → users/{uid}, matches doc ID |
| `groupId` | string | FK → groups/{groupId} |
| `personalSavings` | number | Confirmed savings balance (BIF) |
| `pendingSavings` | number | Deposits not yet confirmed by institution |
| `lockedSavings` | number | Collateral locked against active loans |
| `creditLimit` | number | = personalSavings × 1.5 |
| `availableCredit` | number | = creditLimit − lockedSavings |
| `joinedAt` | Timestamp | |
| `isActive` | boolean | |

**Optional fields**: `updatedAt`

**Computed vs stored**:
- `creditLimit` = `personalSavings × 1.5` — stored for query efficiency; recalculated on every deposit confirmation and loan event
- `availableCredit` = `creditLimit − lockedSavings` — stored, recalculated on loan disburse/repay/default

**Institution scoping**: Inherited from group

**Cross-links**: `groups/{groupId}`, `users/{uid}`, `wallets/{uid}`

---

### 1.4 `groups/{groupId}`

**Purpose**: A savings collective. Each group is linked to one institution and has one leader.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `name` | string | 3–100 chars |
| `description` | string | 10–500 chars |
| `groupCode` | string | KRM-XXX, unique |
| `inviteCode` | string | Unique invite link code |
| `leaderId` | string | FK → users/{uid} |
| `status` | string | Enum: see below |
| `totalSavings` | number | Sum of all members' confirmed savings |
| `pendingSavings` | number | Sum of pending deposits |
| `memberCount` | number | Maintained by Cloud Functions |
| `institutionId` | string | FK → institutions/{id} |
| `createdAt` | Timestamp | |

**Optional fields**: `umucoAccountNo` *(legacy name for institutionAccountNo — kept for backward compat, should be renamed in Phase 3)*, `approvedAt`, `updatedAt`, `borrowPaused` (bool), `pauseReason`, `pausedAt`, `pausedBy`, `splitFromGroupId`, `totalLoansOutstanding`

**Status enum**: `pending_approval` | `active` | `suspended`

**Role ownership**: Created by `member`/`leader`; approved by `super_admin`/`admin`

**Institution scoping**: `institutionId` required on all active groups; used to route deposit batches

**Cross-links**: `groupMembers/*`, `depositBatches`, `loans`, `transactions`

**Subcollection**: `joinRequests/{joinRequestId}` — shape: `{ userId, groupId, status, createdAt, requestedBy, inviteCode?, fullName?, phone?, memberId? }`

**Computed vs stored**: `totalSavings`, `pendingSavings`, `memberCount` are stored aggregates, maintained atomically by Cloud Functions

---

### 1.5 `wallets/{uid}`

**Purpose**: Real-time financial balance for a user. Separate from `groupMembers` to allow atomic wallet updates without touching savings metadata.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `balanceConfirmed` | number | Confirmed savings in BIF |
| `balancePending` | number | Deposits awaiting confirmation |
| `balanceLocked` | number | Locked as loan collateral |
| `availableBalance` | number | = balanceConfirmed − balanceLocked |
| `currency` | string | Always "BIF" |

**Optional fields**: `updatedAt`

**Computed vs stored**: `availableBalance` = `balanceConfirmed − balanceLocked` — stored for fast reads

**Institution scoping**: Not directly scoped (tied to user)

**Cross-links**: `users/{uid}`, `groupMembers/{uid}`

**Notes**: Created by `onUserCreate` trigger with all fields at zero. Never deleted.

---

### 1.6 `transactions/{txnId}`

**Purpose**: Immutable record of every financial event (deposit, withdrawal, loan disbursement, loan repayment).

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `userId` | string | FK → users/{uid} |
| `memberId` | string | Same as userId (legacy alias, kept for compat) |
| `groupId` | string | FK → groups/{groupId} |
| `type` | string | Enum: `deposit`, `withdrawal`, `loan_disburse`, `loan_repay` |
| `amount` | number | BIF, positive integer |
| `status` | string | Enum: see below |
| `channel` | string | Enum: `agent`, `institution_branch`, `agent_qr` |
| `receiptNo` | string | TXN-YYYY-NNNNN format |
| `recordedBy` | string (uid) | Agent or admin who created the record |
| `balanceBefore` | number | Wallet balance before this transaction |
| `createdAt` | Timestamp | |

**Optional fields**: `balanceAfter`, `ledgerImpact`, `walletId`, `agentId`, `institutionId`, `batchId` (deposits only), `loanId` (loan transactions), `notes`, `source` (`online`/`offline`), `updatedAt`

**Status enum**: `pending_confirmation` | `confirmed` | `rejected`

> ⚠️ **Critical**: The status `"pending_umuco"` does NOT exist in the backend. All frontends must use `"pending_confirmation"`.

**Role ownership**: Created by `agent` (via `recordDeposit`, `recordWithdrawal`), confirmed atomically by `institution_user` (via `confirmBatch`)

**Institution scoping**: `institutionId` copied from group at creation time

**Cross-links**: `depositBatches.transactionIds[]`, `loans.loanId`

---

### 1.7 `depositBatches/{batchId}`

**Purpose**: Groups a set of deposit transactions for a single institution confirmation action. Provides the audit trail between agent cash collection and institution verification.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `groupId` | string | FK → groups/{groupId} |
| `agentId` | string | FK → users/{uid} |
| `institutionId` | string | FK → institutions/{id} — required for institution scoping |
| `transactionIds` | string[] | FK → transactions/{id} |
| `totalAmount` | number | Sum of all transactions in batch |
| `memberCount` | number | Distinct member count |
| `status` | string | Enum: see below |
| `submittedAt` | Timestamp | |
| `idempotencyToken` | string | Required on submit to prevent duplicate batches |

**Optional fields**: `confirmedBy`, `confirmedAt`, `institutionRef` *(canonical name, replaces `umucoAccountRef`)*, `institutionNotes` *(canonical name, replaces `umucoNotes`)*, `umucoAccountRef` *(legacy, accepted for backward compat)*, `umucoNotes` *(legacy, read-only compat)*, `flaggedBy`, `flaggedAt`, `updatedAt`

**Status enum**: `submitted` | `confirmed` | `flagged`

**Role ownership**: Submitted by `agent`; confirmed/flagged by `institution_user`

**Institution scoping**: `institutionId` required. `institution_user` can only confirm/flag batches where `institutionId == their own institutionId` (enforced in both Firestore rules and Cloud Function).

**Cross-links**: `transactions.batchId`, `groups.groupId`

---

### 1.8 `loans/{loanId}`

**Purpose**: Tracks the full lifecycle of a loan from request through repayment or default.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `userId` | string | FK → users/{uid} |
| `groupId` | string | FK → groups/{groupId} |
| `amount` | number | Principal in BIF |
| `interestRate` | number | Decimal: 0.04, 0.05, or 0.06 |
| `interestAmount` | number | = amount × interestRate, rounded |
| `totalDue` | number | = amount + interestAmount |
| `termDays` | number | 7, 14, or 30 |
| `dueDate` | Timestamp | = createdAt + termDays |
| `status` | string | Enum: see below |
| `purpose` | string | 10–500 chars |
| `fundSource` | string | Always `"kirimba_fund"` |
| `paidAmount` | number | Running total of repayments |
| `remainingDue` | number | = totalDue − paidAmount |
| `createdAt` | Timestamp | |

**Optional fields**: `rejectionReason`, `approvalType` (`"auto"`), `disbursedBy`, `disbursedAt`, `repaidAt`, `defaultedAt`, `defaultedBy`, `approvedAt`, `approvedBy`, `approvalStatus`, `updatedAt`, `memberId` *(legacy alias for userId)*

**Status enum**: `pending` | `active` | `repaid` | `defaulted` | `rejected`

**Role ownership**: Requested by `member`/`leader`; auto-approved by system; disbursed by `agent` or `admin`

**Institution scoping**: Not directly scoped (scoped via group)

**Computed vs stored**: `remainingDue`, `paidAmount` are stored running totals; `totalDue`, `interestAmount` are stored at creation

**Cross-links**: `groupMembers.lockedSavings`, `kirimbaFund`, `fundLedger`, `transactions.loanId`

---

### 1.9 `transactions/{txnId}` (Repayments)

Loan repayments are stored as `transactions` with `type: "loan_repay"`. See section 1.6.

**Key fields for repayment transactions**:
- `type`: `"loan_repay"`
- `loanId`: FK → loans/{loanId}
- `channel`: `"agent"` or `"institution_branch"`
- `status`: always `"confirmed"` (repayments are confirmed immediately)

---

### 1.10 `withdrawalRequests/{requestId}`

**Purpose**: Holds large withdrawal requests (≥ 50,000 BIF) pending approval, or member-initiated withdrawal requests pending agent execution.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `userId` | string | FK → users/{uid} |
| `amount` | number | BIF |
| `status` | string | Enum: see below |
| `createdAt` | Timestamp | |

**Optional fields**: `groupId`, `notes`, `requestedBy` (uid), `approvedBy`, `approvedAt`, `rejectedBy`, `rejectedAt`, `minRequiredBalance`

**Status enum**: `pending_approval` | `pending_agent` | `approved` | `rejected`

**Role ownership**: Created by `agent` (large withdrawals) or `member` (self-initiated); approved by `admin`

---

### 1.11 `auditLog/{logId}`

**Purpose**: Immutable audit trail for all admin and system actions. Non-fatal writes (failures are logged to console, never block the operation).

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `actorId` | string | UID of who performed the action |
| `actorRole` | string | Role claim at time of action |
| `action` | string | Snake-case event name (e.g. `"member_approved"`) |
| `targetType` | string | `"user"`, `"group"`, `"loan"`, `"institution"`, `"systemConfig"` |
| `targetId` | string \| null | Firestore doc ID of the affected entity |
| `meta` | object | Action-specific payload (e.g. `{ reason, amount }`) |
| `createdAt` | Timestamp | |

**Role ownership**: Written by backend only. Readable by `super_admin`, `admin`.

**Institution scoping**: Not scoped — admins see all

**Action vocabulary** (currently emitted):
- `member_approved`, `member_rejected`, `group_approved`
- `loan_disbursed`, `loan_disbursed_admin`, `loan_defaulted_manual`
- `institution_backfilled`, `institution_repaired`
- `user_suspended`, `user_reactivated`, `group_suspended`, `group_reactivated`
- `admin_suspended`, `admin_reactivated`
- `config_updated`, `institution_created`, `institution_suspended`, `institution_reactivated`

---

### 1.12 `notifications/{notificationId}`

**Purpose**: In-app notification inbox for members, agents, and admins.

**Required fields**:
| Field | Type | Notes |
|-------|------|-------|
| `type` | string | Event type (see below) |
| `status` | string | `"unread"` | `"read"` |
| `createdAt` | Timestamp | |

**Optional fields**: `userId`, `groupId`, `loanId`, `recipientId`, `severity` (`"high"`/`"normal"`), `createdBy`, `expiresAt` (TTL for cleanup)

**Type vocabulary**: `join_request`, `join_request_rejected`, `loan_defaulted`

**Role ownership**: Written by backend; read by owners (`recipientId == uid` or `userId == uid`) and admins

**Institution scoping**: Not scoped

---

### 1.13 `systemConfig/fees`

**Purpose**: Fee and commission rates applied to deposits and withdrawals.

**Fields**:
| Field | Type | Notes |
|-------|------|-------|
| `depositFeeFlat` | number | Flat fee per deposit (BIF) |
| `withdrawFeeFlat` | number | Flat fee per withdrawal (BIF) |
| `agentCommissionDepositFlat` | number | Commission per confirmed deposit (BIF) |
| `agentCommissionWithdrawFlat` | number | Commission per withdrawal (BIF) |
| `agentCommissionRate` | number | *Legacy field name — superseded by flat fields above* |
| `updatedAt` | Timestamp | |
| `updatedBy` | string (uid) | |

**Role ownership**: Read by `super_admin`, `admin`, `finance`; written by `super_admin` via `updateSystemConfig`

> ⚠️ `config/fees` (the old collection) is deprecated. All reads must use `systemConfig/fees`.

---

### 1.14 `systemConfig/loanPolicy`

**Fields**: `maxLoanMultiplier` (1.5), `minLoanAmount`, `maxLoanAmount`, `defaultTermDays`, `interestRates` (`{ 7: 0.06, 14: 0.05, 30: 0.04 }`), `updatedAt`, `updatedBy`

> ⚠️ Loan interest rates are currently **hardcoded** in `loans.js:calculateInterest()`. They should be read from this document. This is listed as a Phase 2 medium-priority item.

---

### 1.15 `systemConfig/businessRules`

**Fields**: `minBalanceBIF` (5000), `largeWithdrawalThresholdBIF` (50000), `maxGroupSize`, `groupSplitThreshold`, `updatedAt`, `updatedBy`

> ⚠️ `MIN_WITHDRAWAL_REMAINING_BALANCE` (5000) and `WITHDRAWAL_APPROVAL_THRESHOLD` (50000) are hardcoded in `savings.js`. They should be read from this document.

---

### 1.16 `systemConfig/commissionPolicy`

**Fields**: `agentDepositCommissionRate`, `agentLoanCommissionRate`, `settlementCycleDays`, `updatedAt`, `updatedBy`

---

## 2. Role-Permission Matrix

### Role Definitions

| Role | JWT Claim | Description |
|------|-----------|-------------|
| `super_admin` | `role: "super_admin"` | Full platform control, no restrictions |
| `admin` | `role: "admin"` | Business operations, cannot change system config |
| `finance` | `role: "finance"` | Read-only financials + settlement approval |
| `agent` | `role: "agent"` | Field staff — deposits, withdrawals, loan disburse/repay |
| `leader` | `role: "leader"` | Group leader — approve join requests, initiate splits |
| `member` | `role: "member"` | Regular saver — request loans, view own data |
| `institution_user` | `role: "institution_user"`, `institutionId: <id>` | Institution staff — confirm/flag batches for their institution |
| `umuco` | `role: "umuco"` | **Legacy** — being migrated to `institution_user` |

---

### Dashboard Access

| Dashboard | super_admin | admin | finance | agent | leader | member | institution_user |
|-----------|:-----------:|:-----:|:-------:|:-----:|:------:|:------:|:----------------:|
| Admin portal (`/admin`) | ✅ | ✅ | ✅ | ✗ | ✗ | ✗ | ✗ |
| Agent portal (`/agent`) | ✗ | ✗ | ✗ | ✅ | ✗ | ✗ | ✗ |
| Member portal (`/app`) | ✗ | ✗ | ✗ | ✗ | ✅ | ✅ | ✗ |
| Institution portal (`/umuco`) | ✗ | ✗ | ✗ | ✗ | ✗ | ✗ | ✅ |

---

### Cloud Function Permissions

| Function | super_admin | admin | finance | agent | leader | member | institution_user |
|----------|:-----------:|:-----:|:-------:|:-----:|:------:|:------:|:----------------:|
| `registerMember` | — | — | — | — | — | self | — |
| `approveMember` | ✅ | ✅ | — | — | — | — | — |
| `rejectMember` | ✅ | ✅ | — | — | — | — | — |
| `createGroup` | — | — | — | — | ✅ | ✅ | — |
| `approveGroup` | ✅ | ✅ | — | — | — | — | — |
| `joinGroup` / `joinGroupByInviteCode` | — | — | — | — | — | ✅ | — |
| `approveJoinRequest` | — | — | — | — | ✅ | — | — |
| `rejectJoinRequest` | — | — | — | — | ✅ | — | — |
| `resetPIN` | ✅ | ✅ | — | ✅ | — | — | — |
| `recordDeposit` | — | — | — | ✅ | — | — | — |
| `recordWithdrawal` | — | — | — | ✅ | — | — | — |
| `memberRequestWithdrawal` | — | — | — | — | ✅ | ✅ | — |
| `submitBatch` | — | — | — | ✅ | — | — | — |
| `confirmBatch` | — | — | — | — | — | — | ✅ |
| `flagBatch` | — | — | — | — | — | — | ✅ |
| `requestLoan` | — | — | — | — | ✅ | ✅ | — |
| `disburseLoan` | — | — | — | ✅ | — | — | — |
| `recordRepayment` | — | — | — | ✅ | — | — | — |
| `adminDisburseLoan` | ✅ | ✅ | ✅ | — | — | — | — |
| `adminMarkRepayment` | ✅ | ✅ | ✅ | — | — | — | — |
| `adminMarkLoanDefault` | ✅ | ✅ | ✅ | — | — | — | — |
| `approveLoan` | ✅ | ✅ | ✅ | — | — | — | — |
| `getLoansDashboard` | ✅ | ✅ | ✅ | — | — | — | — |
| `provisionAgent` | ✅ | ✅ | — | — | — | — | — |
| `provisionAdmin` | ✅ | — | — | — | — | — | — |
| `provisionInstitutionUser` | ✅ | — | — | — | — | — | — |
| `assignAgentToGroup` | ✅ | ✅ | — | — | — | — | — |
| `adminSetGroupBorrowPause` | ✅ | ✅ | — | — | — | — | — |
| `suspendUser` / `reactivateUser` | ✅ | — | — | — | — | — | — |
| `suspendGroup` / `reactivateGroup` | ✅ | — | — | — | — | — | — |
| `updateSystemConfig` | ✅ | — | — | — | — | — | — |
| `getSystemConfig` | ✅ | ✅ | ✅ | — | — | — | — |
| `getExecutiveSummary` | ✅ | — | — | — | — | — | — |
| `getLoanPortfolioSummary` | ✅ | ✅ | ✅ | — | — | — | — |
| `getExceptions` | ✅ | ✅ | — | — | — | — | — |
| `getAuditLog` | ✅ | ✅ | — | — | — | — | — |
| `closeAgentDay` | — | — | — | ✅ (own) | — | — | — |
| `requestSettlement` | — | — | — | ✅ (own) | — | — | — |
| `approveSettlement` | ✅ | — | ✅ | — | — | — | — |
| `markSettlementPaid` | ✅ | — | ✅ | — | — | — | — |

---

### Firestore Read Permissions

| Collection | super_admin / admin | finance | agent | leader | member | institution_user |
|------------|:-------------------:|:-------:|:-----:|:------:|:------:|:----------------:|
| `users` | All | — | All | — | Own | Own |
| `wallets` | All | — | All | — | Own | — |
| `groups` | All | — | All | Own | Own (via groupMembers) | All |
| `groupMembers` | All | — | All | All | Own | — |
| `transactions` | All | — | All | — | Own | All |
| `loans` | All | — | All | — | Own | All |
| `depositBatches` | All | — | All | — | — | Own institution only |
| `kirimbaFund` | All | — | — | — | — | — |
| `fundLedger` | All | — | — | — | — | — |
| `systemConfig` | All | All | — | — | — | — |
| `auditLog` | All | — | — | — | — | — |
| `institutions` | All | — | All | All | All | All |
| `withdrawalRequests` | All | — | All | — | Own | — |
| `notifications` | All | — | — | — | Own | — |
| `agentLedgers` | All | — | Own | — | — | — |
| `agentReconciliations` | All | — | Own | — | — | — |
| `agentSettlements` | All | — | Own | — | — | — |

**All client writes**: `false` — enforced by Firestore security rules on every collection

---

### Restricted Actions (must go through Cloud Functions only)

The following actions **must never be performed by direct Firestore writes**:

1. All balance mutations (`wallets`, `groupMembers.personalSavings/lockedSavings`, `kirimbaFund`)
2. Loan status changes (pending → active → repaid/defaulted)
3. Deposit batch confirmation/flagging
4. Auth custom claims changes (role assignment)
5. Audit log writes
6. PIN changes (must update both Firestore `pinHash` and Firebase Auth password simultaneously)
7. Agent ledger entries (fee/commission accrual)

---

## 3. Institution Scoping Map

### Where `institutionId` is Required

| Entity | Field | Enforcement | Notes |
|--------|-------|-------------|-------|
| `groups` | `groups.institutionId` | Set at creation; backfilled at approveGroup | Required on all active groups |
| `depositBatches` | `depositBatches.institutionId` | Set at submitBatch from group | Required for institution_user read scope |
| `users` (agents) | `users.institutionId` | Set at provisionAgent (optional) | Not currently required — medium gap |
| `users` (institution_user) | `users.institutionId` | Set at provisionInstitutionUser | Required; included in JWT as custom claim |
| JWT token | `institutionId` claim | Set at provisionInstitutionUser | Required for institution-scoped reads |

### Where `institutionId` is Optional

| Entity | Notes |
|--------|-------|
| `users` (member, leader) | Members join an institution-scoped group; institutionId on user is convenience denorm only |
| `transactions` | Inherited from group at creation; may be null for old records |
| `loans` | Not directly scoped; scoped via group |
| `notifications` | Not scoped |
| `auditLog` | Not scoped; admins see all |

### Where Cross-Institution Access is Forbidden

1. **`institution_user` on `depositBatches`**: Firestore rule enforces `resource.data.institutionId == request.auth.token.institutionId`. Cloud Function `confirmBatch` enforces the same check.
2. **`institution_user` on `flagBatch`**: Same as above.
3. **`institutionPools`**: Firestore rule enforces `institutionId == request.auth.token.institutionId`.
4. **`adminBulkConfirmBatches`**: If added, must filter by `institutionId`.

### Legacy Compat Rules (to be removed after migration)

- Firestore rule `role() == "umuco"` on `depositBatches`: grants unscoped read access to legacy umuco users. **Remove after `migrateInstitutionUserRoles` is run.**
- Firestore rule `isUmuco()` alias: currently `= isInstitutionUser()`. Remove the alias and inline after migration.
- `institutionPools` rule: `role() == "umuco"` access — **remove after migration**.

---

## 4. Legacy Audit Results

### Search Terms Audited
- `"umuco"` (all forms)
- `"umuco_branch"` channel
- `"pending_umuco"` status
- `"config/fees"` (legacy config path)
- `"fundMovements"` writes
- Hardcoded business rule values

---

### Findings

#### BLOCKER — Now Fixed (Phase 1)

| ID | File | Issue | Fix Applied |
|----|------|-------|-------------|
| B1 | `functions/src/savings.js` | `getFeesConfig` read from `config/fees` | Migrated to `systemConfig/fees` ✅ |
| B2 | `functions/src/loans.js` | `fundMovements` dual-write in disburse + repay | Removed, `fundLedger` is sole record ✅ |
| B3 | `functions/src/savings.js` | `"umuco_branch"` in allowedChannels | Removed ✅ |
| B4 | `functions/src/loans.js` | `"umuco_branch"` in repayment channel check | Removed ✅ |
| B5 | `apps/agent/src/features/Loans/LoanRepaymentScreen.jsx` | `CHANNELS = ["agent", "umuco_branch"]` | Fixed to `institution_branch` ✅ |
| B6 | `apps/member/src/features/Transactions/TransactionHistoryScreen.jsx` | `umuco_branch` in CHANNEL_LABELS | Replaced with `institution_branch` ✅ |
| B7 | `apps/member/src/features/Deposits/DepositRequestScreen.jsx` | `pending_umuco` status key in style/label maps | Fixed to `pending_confirmation` ✅ |
| B8 | `apps/member/src/features/Withdrawals/WithdrawalRequestScreen.jsx` | `pending_umuco` status key | Fixed to `pending_confirmation` ✅ |
| B9 | `apps/admin/src/features/SuperAdmin/TransactionOversightScreen.jsx` | `pending_umuco` in STATUS_OPTIONS and STATUS_COLORS | Fixed to `pending_confirmation` ✅ |
| B10 | `apps/agent/src/features/Loans/LoanRepaymentScreen.jsx` | "Umuco Branch" display label | Fixed to "Institution Branch" ✅ |

---

#### HIGH — Remaining

| ID | File | Issue | Severity | Fix |
|----|------|-------|----------|-----|
| H1 | `functions/src/savings.js:748` | `confirmBatch` accepts `ROLES.UMUCO` — unscoped institution access | HIGH | Remove `ROLES.UMUCO` from allowedRoles after `migrateInstitutionUserRoles` is run |
| H2 | `functions/src/savings.js:902` | `flagBatch` accepts `ROLES.UMUCO` | HIGH | Same as H1 |
| H3 | `firestore.rules:117` | `role() == "umuco"` on depositBatches grants unscoped read | HIGH | Remove after migration |
| H4 | `firestore.rules:200` | `role() == "umuco"` on institutionPools grants unscoped read | HIGH | Remove after migration |
| H5 | `functions/src/loans.js` | Interest rates hardcoded: `{ 7: 0.06, 14: 0.05, 30: 0.04 }` | HIGH | Read from `systemConfig/loanPolicy.interestRates` |
| H6 | `functions/src/savings.js:23–24` | `MIN_WITHDRAWAL_REMAINING_BALANCE` (5000) and `WITHDRAWAL_APPROVAL_THRESHOLD` (50000) hardcoded | HIGH | Read from `systemConfig/businessRules` |

---

#### MEDIUM — Remaining

| ID | File | Issue | Severity | Fix |
|----|------|-------|----------|-----|
| M1 | `functions/src/members.js:362,980` | `umucoAccountNo: ""` written on new groups | MEDIUM | Rename field to `institutionAccountNo` in Phase 3 |
| M2 | `apps/admin/src/features/SuperAdmin/RiskExceptionScreen.jsx:142` | Displays `b.umucoNotes` without fallback | MEDIUM | Use `b.institutionNotes \|\| b.umucoNotes` |
| M3 | `scripts/seed-kirimba-test-env.js` | Uses `role: "umuco"` and `institutionId: "umuco"` | MEDIUM | Update seed script to use `institution_user` role |
| M4 | `functions/src/members.js` | `initiateGroupSplit` creates new group without `institutionId` field | MEDIUM | Copy `institutionId` from source group |
| M5 | `apps/agent/src/features/Deposits/AgentDailySummaryScreen.jsx:188` | Reads `batch.umucoNotes` with `institutionNotes` fallback — order reversed | MEDIUM | Prefer `institutionNotes` first |

---

#### LOW — Remaining

| ID | File | Issue | Severity | Fix |
|----|------|-------|----------|-----|
| L1 | `firestore.rules:132-135` | `fundMovements` collection has a read rule — collection no longer written to | LOW | Remove rule in Phase 3 cleanup |
| L2 | `firestore.rules:161-164` | `config` (legacy) collection has a read rule | LOW | Remove after confirming no reads in prod |
| L3 | `apps/admin/src/features/Deposits/PendingDepositsScreen.jsx:315` | Reads `b.umucoNotes` — should also check `b.institutionNotes` | LOW | Use `b.institutionNotes \|\| b.umucoNotes` |
| L4 | `functions/src/superAdmin.js:522-575` | `backfillUmucoInstitution` and `migrateInstitutionUserRoles` are one-time utilities that should be removed once run | LOW | Remove after confirming migration complete |
| L5 | `scripts/seed-kirimba-test-env.js:531` | Uses `db.collection("config")` directly — should use `systemConfig` | LOW | Update seed script |

---

### New Constants Added (Phase 1)

`TRANSACTION_CHANNEL` added to `functions/src/constants.js`:
```js
TRANSACTION_CHANNEL = {
  AGENT: "agent",
  INSTITUTION_BRANCH: "institution_branch",
  AGENT_QR: "agent_qr",
}
```

**Next step**: `savings.js` and `loans.js` should import and use `TRANSACTION_CHANNEL` rather than inline strings. This is tracked as a Phase 2 medium item.

---

## 5. Remaining Architecture Gaps

### Critical Path to Phase 2 (Dashboard Completion)

The following gaps must be resolved to safely build complete dashboards:

| Gap | Impact | Location |
|-----|--------|----------|
| `umuco` role still accepted in `confirmBatch` / `flagBatch` | Any remaining umuco-role users bypass institution scoping | `savings.js:748,902` |
| `migrateInstitutionUserRoles` not yet run | 0–N users still have `role: "umuco"` in prod | One-time callable |
| Interest rates hardcoded | Cannot be updated via Super Admin config UI | `loans.js` |
| Business rules hardcoded | Cannot be updated via Super Admin config UI | `savings.js` |
| `initiateGroupSplit` drops `institutionId` | New group from split has no institution binding | `members.js:970-984` |

### Acceptable State for Phase 2 Start

The following are **NOT blockers** for Phase 2:

- `umucoAccountNo` field rename (additive, backward compat display works)
- Seed script using legacy role (dev/test only)
- `fundMovements` read rule in Firestore (no writes occur, no harm)
- `config` read rule in Firestore (no reads in app code confirmed)

---

## 6. Recommended Phase 2 Implementation Order

### Immediately Before Dashboard Work

1. **Run `migrateInstitutionUserRoles`** in production to migrate any legacy `umuco` users
2. **Remove `ROLES.UMUCO` from `confirmBatch` and `flagBatch`** once migration is confirmed
3. **Remove legacy `umuco` Firestore rules** (depositBatches and institutionPools)

### Phase 2 Dashboard Priorities

**Priority 1 — Admin Dashboards** (highest business value):
1. Admin: Pending Approvals (members + groups)
2. Admin: Loan Portfolio Dashboard (`getLoansDashboard`)
3. Admin: Group Management (borrowing pause, group overview)
4. Admin: Executive Summary (`getExecutiveSummary`)

**Priority 2 — Institution User Dashboards**:
5. Institution: Pending Batches (scoped to institutionId)
6. Institution: Batch History + Detail
7. Institution: Flagged Batches

**Priority 3 — Agent Dashboards**:
8. Agent: Daily Summary / Reconciliation (`closeAgentDay`)
9. Agent: Settlement Request flow

**Priority 4 — Member Dashboards**:
10. Member: Transaction History (uses `pending_confirmation` status — now fixed)
11. Member: Loan Request + My Loans

### Phase 3 (Technical Debt Cleanup)

- Rename `umucoAccountNo` → `institutionAccountNo` across all collections (requires data migration)
- Remove `fundMovements` and `config` Firestore rules
- Read interest rates from `systemConfig/loanPolicy`
- Read business rules from `systemConfig/businessRules`
- Remove one-time migration utilities from `superAdmin.js`
- Update seed script to use canonical roles/field names

---

## Appendix: File-by-File Change Summary (Phase 1)

| File | Changes |
|------|---------|
| `functions/src/constants.js` | Added `TRANSACTION_CHANNEL` constant |
| `functions/src/savings.js` | `getFeesConfig` → reads `systemConfig/fees`; removed `"umuco_branch"` from allowed channels |
| `functions/src/loans.js` | Removed `fundMovements` writes (disburse + repay); removed `"umuco_branch"` from repayment channel check; added `writeAuditLog` helper; added audit log calls to `disburseLoan`, `adminDisburseLoan`, `adminMarkLoanDefault` |
| `functions/src/members.js` | Added `writeAuditLog` helper; added audit log calls to `approveMember`, `rejectMember`, `approveGroup` |
| `functions/src/superAdmin.js` | Added `activeAgentCount` and `activeInstitutionCount` to `getExecutiveSummary` |
| `apps/agent/src/features/Loans/LoanRepaymentScreen.jsx` | Fixed `CHANNELS` to `institution_branch`; fixed "Umuco Branch" display label |
| `apps/member/src/features/Transactions/TransactionHistoryScreen.jsx` | Updated `CHANNEL_LABELS` to use `institution_branch` and `agent_qr` |
| `apps/member/src/features/Deposits/DepositRequestScreen.jsx` | Fixed `pending_umuco` → `pending_confirmation` in STATUS_STYLE and STATUS_LABEL |
| `apps/member/src/features/Withdrawals/WithdrawalRequestScreen.jsx` | Fixed `pending_umuco` → `pending_confirmation` in TXN_STATUS_STYLE |
| `apps/admin/src/features/SuperAdmin/TransactionOversightScreen.jsx` | Fixed `pending_umuco` → `pending_confirmation` in STATUS_OPTIONS and STATUS_COLORS |
