# KIRIMBA Pre-Reset Architecture & Data Reset Report

> **Generated**: 2026-03-15
> **Codebase Version**: v3.1.9
> **Purpose**: Authoritative reference document to be reviewed before any destructive data reset. Do not proceed with a reset until every BLOCKER item in Section 6 is resolved.

---

## Table of Contents

1. [Final Role Model](#section-1-final-role-model)
2. [Final Collection & Data Model](#section-2-final-collection--data-model)
3. [Dashboard Responsibility Map](#section-3-dashboard-responsibility-map)
4. [Reset Impact Analysis](#section-4-reset-impact-analysis)
5. [Post-Reset Seed Order](#section-5-post-reset-seed-order)
6. [Critical Fixes Before Reset](#section-6-critical-fixes-before-reset)
7. [Recommended Execution Plan](#section-7-recommended-execution-plan)
8. [Appendix: Architecture Debt Inventory](#appendix-architecture-debt-inventory)

---

## Section 1: Final Role Model

### Role: `member`

**Purpose**: Regular savings group member who deposits funds, borrows against savings, and monitors their own account.

**App/dashboard used**: Member app (`/app`, port 5173)

**Allowed actions**:
- Register via `registerMember` (unauthenticated)
- Request to join a group via code or invite link (`joinGroup`, `joinGroupByInviteCode`)
- Create a new savings group (`createGroup`)
- Request a loan (`requestLoan`)
- Initiate a self-service withdrawal request (`memberRequestWithdrawal`)
- View own transaction history, loans, savings balances (Firestore reads)
- View own QR code for agent scanning
- Link to an institution (`setMemberInstitution`)
- View their group details (read-only)

**Blocked actions**:
- Cannot read any other user's data
- Cannot write to any Firestore collection directly (all writes via functions)
- Cannot approve their own join request
- Cannot disburse or repay loans
- Cannot access admin, agent, or umuco apps
- Cannot view other members' balances or loans

**Auth source**: Firebase Auth custom claim `role: "member"` + Firestore `users/{uid}.role` field (both checked; claim takes precedence, Firestore used as fallback in member app)

**Current status**: Clean and implemented. The member app has 19 routes covering all core flows. Minor gap: no in-app notification inbox screen.

---

### Role: `leader`

**Purpose**: Group leader who manages membership approval for their savings group and can initiate group splits.

**App/dashboard used**: Member app (`/app`, port 5173) — same app as member, same routes available

**Allowed actions**:
- All actions available to `member`
- Approve or reject group join requests (`approveJoinRequest`, `rejectJoinRequest`)
- Initiate a group split for large groups (`initiateGroupSplit`)
- View all group member records (`getGroupMembers`)
- View join requests for their group (Firestore read: `groups/{groupId}/joinRequests`)

**Blocked actions**:
- Cannot approve their own member record
- Cannot access admin/agent/umuco apps
- Cannot manage system configuration or institution settings

**Auth source**: Firebase Auth custom claim `role: "leader"` + Firestore `users/{uid}.role` and `isLeader: true`. The member app `canAccessMemberApp` check accepts both `"member"` and `"leader"` roles.

**Current status**: Clean and implemented. Leader-specific screens (`GroupPendingRequestsScreen`, `GroupSplitScreen`, `GroupManageScreen`, `GroupCodeScreen`) are all routed correctly. Note: the Firestore rules grant leader access to `groupMembers` reads and `groups/joinRequests` subcollection reads.

---

### Role: `agent`

**Purpose**: Field staff member who physically processes cash deposits, withdrawals, and loan disbursements on behalf of members.

**App/dashboard used**: Agent app (`/agent`, port 5174)

**Allowed actions**:
- Record cash deposits for members (`recordDeposit`)
- Record withdrawals for members (`recordWithdrawal`)
- Submit deposit batches to institution for confirmation (`submitBatch`)
- Disburse approved loans to members (`disburseLoan`)
- Record loan repayments (`recordRepayment`)
- Close daily cash reconciliation (`closeAgentDay`)
- Request commission settlement (`requestSettlement`)
- View agent ledger / commissions (`getAgentLedger`)
- Read user profiles (to resolve member names by phone/QR scan)
- Read group members list
- Reset member PINs (`resetPIN`)

**Blocked actions**:
- Cannot confirm or flag deposit batches (that is institution_user/umuco)
- Cannot approve members or groups
- Cannot access admin or umuco apps
- Cannot write to Firestore directly
- Cannot access other agents' reconciliation records

**Auth source**: Firebase Auth custom claim `role: "agent"` only. The agent app enforces `role !== "agent"` → blocked screen. No Firestore fallback role check in the agent app.

**Current status**: Implemented. The agent app has 10 routes. The `depositSyncService` is referenced in `App.jsx` (offline support for scanning). The `ScanDepositScreen` uses QR scanning. Missing: no explicit route for batch submission — `AgentDailySummaryScreen` appears to embed batch submission logic.

---

### Role: `admin`

**Purpose**: Business operations staff who oversee deposit approvals, loan operations, group management, and agent reconciliation. Distinct from `super_admin` — cannot manage system config or institution provisioning.

**App/dashboard used**: Admin app (`/admin`, port 5175)

**Allowed actions**:
- View admin dashboard with pending approvals summary
- Approve bulk deposits (`adminApproveDeposits`)
- View and manage loans (`getLoansDashboard`, `getLoanDetails`, `approveLoan`, `adminDisburseLoan`, `adminMarkRepayment`, `adminMarkLoanDefault`)
- Pause/unpause group borrowing (`adminSetGroupBorrowPause`)
- View all groups (`getExecutiveSummary` data feed)
- Assign agents to groups (`assignAgentToGroup`)
- View agent reconciliation records
- Create institution users (`provisionInstitutionUser`)
- View exceptions/risk alerts (`getExceptions`)
- View loan portfolio summary (`getLoanPortfolioSummary`)
- View and query audit log (`getAuditLog`)
- Read system config (`getSystemConfig`)
- View institution list (`getInstitutions`)

**Blocked actions**:
- Cannot update system configuration (`updateSystemConfig` — super_admin only)
- Cannot suspend users or groups (`suspendUser` / `suspendGroup` — super_admin only)
- Cannot provision agents or admins (super_admin only)
- Cannot manage institutions (create/suspend — super_admin only)
- Cannot access executive summary (super_admin only)
- Cannot seed or manage the Kirimba fund
- Cannot access the fund management or system config screens (rendered in same app but would fail at function layer)

**Auth source**: Firebase Auth custom claim `role: "admin"`. The admin app accepts `super_admin`, `admin`, or `finance` to pass the role gate.

**Current status**: Implemented. The admin app correctly accepts all three elevated roles. Individual function-level role checks further restrict `admin` from super_admin-only operations.

---

### Role: `super_admin`

**Purpose**: Full-access platform controller with authority over system configuration, user/group lifecycle, institution management, and fund oversight.

**App/dashboard used**: Admin app (`/admin`, port 5175) — same app as `admin`, with all screens accessible

**Allowed actions**:
- All actions available to `admin`
- Approve/reject member registrations (`approveMember`, `rejectMember`)
- Approve/reject group creations (`approveGroup`)
- Suspend and reactivate users, groups, admins, institutions
- Provision agents, admins, and institution users (`provisionAgent`, `provisionAdmin`, `provisionInstitutionUser`)
- Manage system configuration (`updateSystemConfig`, `seedSystemConfig`)
- Manage institutions (`createInstitution`, `suspendInstitution`, `reactivateInstitution`)
- View executive summary dashboard (`getExecutiveSummary`)
- Seed and manage Kirimba fund (`seedKirimbaFund`, `topUpKirimbaFund`, `deductKirimbaFund`)
- Pause/resume global lending (`pauseKirimbaLending`, `resumeKirimbaLending`)
- Run migration utilities (`backfillUmucoInstitution`, `migrateInstitutionUserRoles`, `backfillGroupInstitutionIds`, `backfillLeaderGroupMembership`)
- Approve and mark settlements paid

**Blocked actions**:
- Cannot suspend themselves
- Cannot target another `super_admin` for suspension

**Auth source**: Firebase Auth custom claim `role: "super_admin"`. This must be set manually by a Firebase Admin SDK call — there is no self-service provisioning path for the first super_admin.

**Current status**: Implemented. The first super_admin must be created manually (see Section 5, Step 2). The `ExecutiveDashboardScreen`, `SystemConfigScreen`, `KirimbaFundManagementScreen`, `InstitutionManagementScreen`, and `AdminManagementScreen` are all routed in the admin app.

---

### Role: `institution_user`

**Purpose**: Staff at a partner microfinance institution (e.g., Umuco, Difo) who confirm or flag deposit batches, scoped to their own institution's data.

**App/dashboard used**: Umuco/Institution app (`/umuco`, port 5176)

**Allowed actions**:
- View pending deposit batches for their institution (`PendingBatchesScreen` — filtered by `institutionId`)
- View batch detail and member transaction list (`BatchDetailScreen`)
- Confirm deposit batches (`confirmBatch`)
- Flag deposit batches with notes (`flagBatch`)
- View batch history for their institution (`BatchHistoryScreen`)
- View flagged batches (`FlaggedBatchesScreen`)

**Blocked actions**:
- Cannot view batches belonging to a different institution (enforced by Firestore rules: `resource.data.institutionId == request.auth.token.institutionId`)
- Cannot manage users, loans, or system configuration
- Cannot access admin, agent, or member apps

**Auth source**: Firebase Auth custom claim `role: "institution_user"` AND `institutionId: "<id>"`. The `institutionId` custom claim is the scoping mechanism. The umuco app reads both from `getIdTokenResult()`.

**Current status**: Implemented. The `institution_user` role is the new canonical role. The app correctly checks `role !== "institution_user" && role !== "umuco"` to preserve backward compatibility during the migration window.

---

### Role: `umuco` (Legacy)

**Purpose**: Legacy institution staff role used before the `institution_user` generalization. Functionally identical to `institution_user` but lacks institutionId scoping.

**App/dashboard used**: Umuco/Institution app (`/umuco`, port 5176)

**Allowed actions**:
- Same as `institution_user` but with **unscoped** access — can confirm/flag any institution's batches (a security gap)
- Access is granted by Firestore rules via the legacy `isUmuco()` alias which wraps `isInstitutionUser()`

**Blocked actions**: Same as `institution_user`

**Auth source**: Firebase Auth custom claim `role: "umuco"`. No `institutionId` claim present.

**Current status**: NEEDS MIGRATION. Active `umuco` users should be migrated to `institution_user` via the `migrateInstitutionUserRoles()` callable before or immediately after reset. After migration is complete, the `umuco` role should be retired and the legacy `isUmuco()` alias removed from Firestore rules.

---

### Role: `finance`

**Purpose**: Financial oversight staff who can read financial data and approve settlements, but cannot perform operational mutations.

**App/dashboard used**: Admin app (`/admin`, port 5175)

**Allowed actions**:
- Read system configuration (`getSystemConfig`)
- View loan portfolio summary (`getLoanPortfolioSummary`)
- View institutions list (`getInstitutions`)
- View exceptions (`getExceptions`)
- Approve and mark settlements paid (`approveSettlement`, `markSettlementPaid`)
- Update agent reconciliation records (`adminUpdateReconciliation`)
- Pause group borrowing (`adminSetGroupBorrowPause`)

**Blocked actions**:
- Cannot approve members, groups, or join requests
- Cannot manage system configuration (read-only)
- Cannot provision users
- Cannot manage institutions
- Cannot access executive summary or fund management

**Auth source**: Firebase Auth custom claim `role: "finance"`. The admin app accepts this role.

**Current status**: Implemented. The admin app does not implement fine-grained screen-level role filtering between `super_admin`, `admin`, and `finance` — all three see the same menu. Function-level role checks enforce the actual permissions. This is acceptable but means `finance` users see screens that will 403 them if they try to use restricted features.

---

## Section 2: Final Collection & Data Model

### Collection: `users`

**How created**: Auth trigger `onUserCreate` creates the initial stub; `registerMember` fills in profile fields; `approveMember`/`provisionAgent`/`provisionAdmin`/`provisionInstitutionUser` set role and status.

**Who can write**: Backend only (Admin SDK)

**Required fields**:
- `uid`: string — Firebase Auth UID (matches document ID)
- `role`: string — one of ROLES enum values
- `status`: string — `pending_approval | active | suspended | rejected`
- `createdAt`: Timestamp — set by `onUserCreate`

**Optional fields**:
- `fullName`: string — set by `registerMember` or provisioning functions
- `phone`: string — `+257XXXXXXXX` format
- `email`: string — Firebase Auth email (phone@kirimba.app pattern)
- `nationalId`: string — optional national ID
- `pinHash`: string — bcrypt hash of 4-digit PIN (12 rounds)
- `groupId`: string — FK → `groups/{groupId}` (set on group membership)
- `ledGroupId`: string — FK → `groups/{groupId}` (set when user is a group leader)
- `isLeader`: boolean — true if user leads a group
- `institutionId`: string — FK → `institutions/{id}` (for institution staff and members)
- `memberId`: string — internal member identifier
- `approvedAt`: Timestamp — set when approved
- `rejectionReason`: string — set when rejected
- `updatedAt`: Timestamp — set on updates
- `suspendedAt`: Timestamp — set on suspension
- `suspendedBy`: string — UID of actor who suspended
- `suspendReason`: string — reason for suspension
- `reactivatedAt`: Timestamp — set on reactivation
- `reactivatedBy`: string — UID of actor who reactivated
- `proposedLeaderForGroupId`: string — temporary field for backfill utility
- `groupCodeToJoin`: string — temporary field for deferred group join after approval

**Legacy fields to retire**:
- ⚠️ `proposedLeaderForGroupId` — backfill utility field, should be removed after backfill run
- ⚠️ `groupCodeToJoin` — should be cleared after join processing

**Foreign key references**:
- `groupId` → `groups/{groupId}`
- `ledGroupId` → `groups/{groupId}`
- `institutionId` → `institutions/{institutionId}`

---

### Collection: `institutions`

**How created**: `createInstitution()` callable (super_admin only) or `backfillUmucoInstitution()` for Umuco

**Who can write**: Backend only

**Required fields**:
- `name`: string — institution display name
- `code`: string — unique short code (2–20 chars, e.g., "UMUCO")
- `status`: string — `active | suspended`
- `createdAt`: Timestamp
- `createdBy`: string — UID of creator

**Optional fields**:
- `institutionType`: string — classification
- `contactName`, `contactEmail`, `contactPhone`: string — contact details
- `country`, `currency`: string — geographic/currency info
- `supportsDeposits`, `supportsWithdrawals`, `supportsLoans`: boolean — capability flags
- `settlementReferencePrefix`: string — prefix for batch references
- `notes`: string — free-text notes
- `updatedAt`: Timestamp
- `updatedBy`: string
- `suspendedAt`: Timestamp
- `suspendedBy`: string
- `suspendReason`: string
- `isBackfilled`: boolean — marks documents created by backfill utility
- `backfilledAt`: Timestamp

**Foreign key references**: None (institutions are root entities)

**Current status**: Clean. No legacy fields. The `isBackfilled` flag is intentional and informational.

---

### Collection: `groups`

**How created**: `createGroup()` callable (active member); approved via `approveGroup()` (super_admin)

**Who can write**: Backend only

**Required fields**:
- `name`: string
- `description`: string
- `groupCode`: string — unique `KRM-XXX` format
- `leaderId`: string — FK → `users/{uid}`
- `status`: string — `pending_approval | active | suspended`
- `totalSavings`: number — confirmed savings total (BIF)
- `pendingSavings`: number — pending deposit total (BIF)
- `memberCount`: number
- `createdAt`: Timestamp

**Optional fields**:
- `inviteCode`: string — `KIR-XXXX` format for invite links
- `institutionId`: string — FK → `institutions/{id}`
- `approvedAt`: Timestamp
- `borrowingPaused`: boolean — set by `adminSetGroupBorrowPause`
- `pauseReason`: string
- `pausedAt`: Timestamp
- `pausedBy`: string
- `splitFromGroupId`: string — FK → `groups/{groupId}` if this is a split group
- `suspendedAt`, `suspendedBy`, `suspendReason`: string/Timestamp
- `reactivatedAt`, `reactivatedBy`: string/Timestamp
- `updatedAt`: Timestamp

**Legacy fields to retire**:
- ⚠️ `umucoAccountNo`: string — superseded by `institutionId` FK; still written for backward compat. Should be removed after all batches are associated with institutions.

**Subcollection `joinRequests/{joinRequestId}`**:
- `userId`: string
- `status`: `pending | approved | rejected`
- `requestedAt`: Timestamp
- `reason`: string (optional, for rejections)

**Foreign key references**:
- `leaderId` → `users/{uid}`
- `institutionId` → `institutions/{institutionId}`
- `splitFromGroupId` → `groups/{groupId}`

---

### Collection: `groupMembers`

**How created**: `approveJoinRequest()` callable (group leader); also created by `backfillLeaderGroupMembership()` for leaders who lacked a record

**Who can write**: Backend only

**Document ID**: matches `userId` (denormalized for O(1) lookup)

**Required fields**:
- `userId`: string — FK → `users/{uid}`
- `groupId`: string — FK → `groups/{groupId}`
- `personalSavings`: number — confirmed balance (BIF)
- `pendingSavings`: number — pending deposit amount (BIF)
- `lockedSavings`: number — collateral for active loans (BIF)
- `creditLimit`: number — 1.5 × personalSavings (BIF)
- `availableCredit`: number — creditLimit − lockedSavings (BIF)
- `joinedAt`: Timestamp
- `isActive`: boolean
- `updatedAt`: Timestamp

**Optional fields**: None — all fields required on creation

**Foreign key references**:
- `userId` → `users/{uid}`
- `groupId` → `groups/{groupId}`

**Current status**: Clean. The denormalized document ID (= userId) is intentional and used extensively in Firestore rules for efficient member-to-group lookup.

---

### Collection: `wallets`

**How created**: Auth trigger `onUserCreate` creates wallet for every new Auth user

**Who can write**: Backend only

**Document ID**: matches `userId`

**Required fields**:
- `userId`: string
- `balanceConfirmed`: number — confirmed savings (BIF)
- `balancePending`: number — pending deposits (BIF)
- `balanceLocked`: number — locked as loan collateral (BIF)
- `availableBalance`: number — balanceConfirmed − balanceLocked
- `createdAt`: Timestamp
- `updatedAt`: Timestamp

**Optional fields**: None

**Notes**: The `wallets` collection exists in parallel with `groupMembers` and holds overlapping balance data. The `groupMembers` document is the authoritative source for financial computations; `wallets` is used for UI display in the member app. This duplication is a known architecture debt item (see Appendix).

---

### Collection: `transactions`

**How created**: `recordDeposit()`, `recordWithdrawal()`, `memberRequestWithdrawal()`, `disburseLoan()`, `recordRepayment()` callables

**Who can write**: Backend only

**Required fields**:
- `userId`: string — FK → `users/{uid}`
- `groupId`: string — FK → `groups/{groupId}`
- `type`: string — `deposit | withdrawal | loan_disburse | loan_repay`
- `status`: string — `pending_confirmation | confirmed | rejected`
- `amount`: number (BIF)
- `channel`: string — `agent | umuco_branch`
- `recordedBy`: string — agent UID (FK → `users/{uid}`)
- `receiptNo`: string — `TXN-YYYY-NNNNN` format
- `balanceBefore`: number
- `createdAt`: Timestamp

**Optional fields**:
- `memberId`: string — internal member reference (legacy alias for userId in some paths)
- `agentId`: string — FK → `users/{uid}` (denormalized from recordedBy for ledger queries)
- `batchId`: string — FK → `depositBatches/{id}` (set when deposit is submitted in a batch)
- `notes`: string
- `balanceAfter`: number — set on confirmation
- `institutionId`: string — FK → `institutions/{id}`
- `walletId`: string — FK → `wallets/{uid}`
- `loanId`: string — FK → `loans/{id}` (for loan transactions)
- `ledgerImpact`: object — commission/fee impact metadata
- `source`: string

**Legacy fields to retire**:
- ⚠️ `memberId` as a separate field (same value as `userId`; created confusion in the original data model). Should be deprecated in favour of using `userId` consistently.
- ⚠️ `status: "pending_umuco"` — an early status value predating the formal `TRANSACTION_STATUS` enum. Code in `savings.js` still sets `status: "pending_umuco"` for deposit transactions before batch confirmation, while the constant says `PENDING_CONFIRMATION: "pending_confirmation"`. **This is a live discrepancy** — see Section 6.

---

### Collection: `loans`

**How created**: `requestLoan()` callable (member/leader)

**Who can write**: Backend only

**Required fields**:
- `userId`: string — FK → `users/{uid}`
- `groupId`: string — FK → `groups/{groupId}`
- `amount`: number (BIF)
- `interestRate`: number — 0.04 | 0.05 | 0.06
- `interestAmount`: number (BIF)
- `totalDue`: number — amount + interestAmount (BIF)
- `termDays`: number — 7 | 14 | 30
- `dueDate`: Timestamp
- `status`: string — `pending | active | repaid | defaulted | rejected`
- `paidAmount`: number (BIF)
- `remainingDue`: number (BIF)
- `purpose`: string
- `fundSource`: string — `kirimba_fund`
- `createdAt`: Timestamp

**Optional fields**:
- `memberId`: string — legacy alias for userId
- `approvalType`: string — `auto`
- `rejectionReason`: string
- `disbursedBy`: string — FK → `users/{uid}` (agent UID)
- `disbursedAt`: Timestamp
- `repaidAt`: Timestamp
- `defaultedAt`: Timestamp
- `updatedAt`: Timestamp

**Legacy fields to retire**:
- ⚠️ `memberId` — same alias issue as in transactions; use `userId`

---

### Collection: `depositBatches`

**How created**: `submitBatch()` callable (agent)

**Who can write**: Backend only

**Required fields**:
- `groupId`: string — FK → `groups/{groupId}`
- `agentId`: string — FK → `users/{uid}`
- `transactionIds`: string[] — FKs → `transactions/{id}`
- `totalAmount`: number (BIF)
- `memberCount`: number
- `status`: string — `submitted | confirmed | flagged`
- `idempotencyToken`: string — required since v3.1.9
- `submittedAt`: Timestamp
- `updatedAt`: Timestamp

**Optional fields**:
- `institutionId`: string — FK → `institutions/{id}`
- `confirmedBy`: string — UID of institution user
- `confirmedAt`: Timestamp
- `institutionNotes`: string — notes from institution user on confirmation
- `institutionRef`: string — external reference number from institution
- `flaggedBy`: string
- `flaggedAt`: Timestamp

**Legacy fields to retire**:
- ⚠️ `umucoAccountRef`: string — old parameter name for `institutionRef`; still accepted by `confirmBatch()` for backward compat
- ⚠️ `umucoNotes`: string — old field name for `institutionNotes`; still accepted

**Foreign key references**:
- `groupId` → `groups/{groupId}`
- `agentId` → `users/{uid}`
- `transactionIds[]` → `transactions/{id}`
- `institutionId` → `institutions/{institutionId}`
- `confirmedBy` → `users/{uid}`

---

### Collection: `withdrawalRequests`

**How created**: `recordWithdrawal()` for amounts ≥ 50,000 BIF; `memberRequestWithdrawal()` for member-initiated requests

**Who can write**: Backend only

**Required fields**:
- `userId`: string — FK → `users/{uid}`
- `groupId`: string — FK → `groups/{groupId}`
- `amount`: number (BIF)
- `status`: string — `pending_approval | approved | rejected`
- `requestedAt`: Timestamp

**Optional fields**:
- `approvedAt`: Timestamp
- `approvedBy`: string — UID of approver
- `notes`: string

---

### Collection: `settlements` (aka `agentSettlements` in Firestore rules)

**Note**: The Firestore rules name this collection `agentSettlements`, but the CLAUDE.md and functions reference it as `settlements`. The code in `reconciliation.js` writes to `agentSettlements`. **This is a naming inconsistency** — see Section 6.

**How created**: `requestSettlement()` callable (agent)

**Who can write**: Backend only

**Required fields**:
- `agentId`: string — FK → `users/{uid}`
- `status`: string — `requested | approved | paid | rejected`
- `commissionTotal`: number (BIF)
- `createdAt`: Timestamp

**Optional fields**:
- `periodStart`, `periodEnd`: Timestamp — settlement period
- `notes`: string
- `approvedAt`: Timestamp
- `approvedBy`: string
- `paidAt`: Timestamp
- `paidBy`: string
- `reference`: string — payment reference
- `updatedAt`: Timestamp

---

### Collection: `agentReconciliations`

**How created**: `closeAgentDay()` callable (agent)

**Who can write**: Backend only

**Required fields**:
- `agentId`: string — FK → `users/{uid}`
- `date`: string — `YYYY-MM-DD` format
- `cashExpected`: number (BIF)
- `cashCounted`: number (BIF)
- `difference`: number (BIF)
- `depositCount`: number
- `withdrawCount`: number
- `commissionAccrued`: number (BIF)
- `status`: string
- `createdAt`: Timestamp

**Optional fields**:
- `offlinePendingCount`: number
- `notes`: string
- `updatedAt`: Timestamp
- `reviewedBy`: string
- `reviewedAt`: Timestamp
- `adminNote`: string

---

### Collection: `kirimbaFund`

**How created**: `seedKirimbaFund()` callable (super_admin). Single document at path `kirimbaFund/current`.

**Who can write**: Backend only

**Required fields**:
- `totalCapital`: number — total capital seeded (BIF)
- `availableFund`: number — capital available for new loans (BIF)
- `deployedFund`: number — capital locked in active loans (BIF)
- `totalCollateral`: number — sum of all confirmed group savings (BIF)
- `lastUpdated`: Timestamp
- `updatedBy`: string — UID of last updater

**Optional fields**:
- `defaultedExposure`: number — capital in defaulted loans (BIF)
- `repaidReturned`: number — total repaid (BIF)
- `lendingPaused`: boolean — set by `pauseKirimbaLending`
- `lendingPausedReason`: string
- `lendingPausedAt`: Timestamp
- `lendingPausedBy`: string

**Notes**: Must exist before any loan can be requested. If missing, `requestLoan()` will throw `not-found`. Must be seeded as Step 3 of post-reset seed order.

---

### Collection: `fundLedger`

**How created**: Written atomically whenever kirimbaFund changes (topUp, deduction, loan_out, repayment_return, default_loss, seed)

**Who can write**: Backend only

**Required fields**:
- `type`: string — `seed | topup | deduction | loan_out | repayment_return | default_loss`
- `amount`: number (BIF)
- `beforeBalance`: number (BIF)
- `afterBalance`: number (BIF)
- `actorId`: string — UID
- `actorRole`: string
- `createdAt`: Timestamp

**Optional fields**:
- `notes`: string
- `loanId`: string — FK → `loans/{id}`

---

### Collection: `fundMovements` (Deprecated)

**Status**: ⚠️ DEPRECATED. Still written by `disburseLoan()` and `recordRepayment()` for backward compatibility but superseded by `fundLedger`. Should be retired after verifying all fund history is captured in `fundLedger`.

**Fields written**: `type`, `amount`, `description`, `loanId`, `recordedBy`, `createdAt`

---

### Collection: `auditLog`

**How created**: Written by the `writeAuditLog()` internal helper, called in every mutating super_admin operation

**Who can write**: Backend only

**Required fields**:
- `actorId`: string — UID
- `actorRole`: string
- `action`: string — descriptive action name
- `targetType`: string — `user | group | systemConfig | institution | admin | kirimbaFund`
- `createdAt`: Timestamp

**Optional fields**:
- `targetId`: string — FK to target document
- `meta`: object — action-specific payload (before/after values, amounts, reasons)

---

### Collection: `notifications`

**How created**: Written by various backend functions to alert users of significant events

**Who can write**: Backend only

**Required fields**:
- `userId`: string (also stored as `recipientId` in some code paths — inconsistency)
- `type`: string
- `title`: string
- `message`: string
- `status`: string
- `createdAt`: Timestamp
- `expiresAt`: Timestamp — TTL marker consumed by `deleteExpiredNotifications`

**Legacy fields to retire**:
- ⚠️ `recipientId` vs `userId` inconsistency — Firestore rules check both (`resource.data.recipientId == request.auth.uid || resource.data.userId == request.auth.uid`). Should be standardized to one field name.

---

### Collection: `agents`

**How created**: `provisionAgent()` callable. A separate collection from `users` holding agent-specific metadata.

**Who can write**: Backend only

**Required fields**:
- `assignedGroups`: string[] — array of group IDs assigned to this agent (v3.1.9+ model)

**Optional fields**:
- `institutionId`: string — FK → `institutions/{id}`

**Notes**: The `agents` collection supplements `users` — an agent has a `users` doc (with role, status, PIN, etc.) AND an `agents` doc (with assignment data). The two are linked by UID (document ID matches `users` doc ID).

**Legacy fields to retire**:
- ⚠️ `assignedGroupId`: string — old single-group model (pre-v3.1.9). Any existing agent docs with this field must be migrated to `assignedGroups` array.

---

### Collection: `agentLedgers`

**How created**: Written when deposits, withdrawals, or loans are processed by an agent (commission/fee accrual)

**Who can write**: Backend only

**Required fields**:
- `agentId`: string — FK → `users/{uid}`
- `transactionId`: string — FK → `transactions/{id}`
- `type`: string — `fee | commission`
- `status`: string — `accrued | settled | reversed`
- `amount`: number (BIF)
- `recordedAt`: Timestamp

**Optional fields**:
- `settledAt`: Timestamp
- `settlementId`: string — FK → `agentSettlements/{id}`

---

### Collection: `systemConfig`

**How created**: `seedSystemConfig()` callable (super_admin). Four documents: `fees`, `loanPolicy`, `commissionPolicy`, `businessRules`.

**Who can write**: Backend only (super_admin via `updateSystemConfig`)

**Document `fees`**:
- `depositFeeFlat`: number
- `withdrawFeeFlat`: number
- `agentCommissionRate`: number
- `updatedAt`: Timestamp, `updatedBy`: string

**Document `loanPolicy`**:
- `maxLoanMultiplier`: number (default: 1.5)
- `minLoanAmount`: number
- `maxLoanAmount`: number
- `defaultTermDays`: number
- `interestRates`: object `{ 7: 0.06, 14: 0.05, 30: 0.04 }`
- `updatedAt`: Timestamp, `updatedBy`: string

**Document `commissionPolicy`**:
- `agentDepositCommissionRate`: number
- `agentLoanCommissionRate`: number
- `settlementCycleDays`: number
- `updatedAt`: Timestamp, `updatedBy`: string

**Document `businessRules`**:
- `minBalanceBIF`: number (default: 5000)
- `largeWithdrawalThresholdBIF`: number (default: 50000)
- `maxGroupSize`: number (default: 30)
- `groupSplitThreshold`: number (default: 25)
- `updatedAt`: Timestamp, `updatedBy`: string

**Notes**: The `savings.js` function still reads from the legacy `config/fees` collection as a fallback. After reset, only `systemConfig` should be seeded; the legacy `config` collection should not be recreated.

---

### Collection: `config` (Deprecated)

**Status**: ⚠️ DEPRECATED. Superseded by `systemConfig/fees`. Still read by `savings.js` as a fallback. Should not be recreated after reset; `savings.js` fallback path should be removed in a future cleanup.

---

### Collection: `counters`

**How created**: Automatically on first receipt number generation (`generateReceiptNo()`)

**Who can write**: Backend only (via Firestore transaction)

**Document ID pattern**: `TXN_{YEAR}` (e.g., `TXN_2026`)

**Fields**:
- `value`: number — current counter value
- `updatedAt`: Timestamp

**Notes**: Counters must be reset to 0 (or deleted) as part of a data reset, otherwise receipt numbers will not restart from 00001.

---

### Collection: `kirimbaPools` (Found in Firestore rules, not in CLAUDE.md)

**Status**: Referenced in Firestore rules (`/kirimbaPools/{poolId}`) but not found in any backend function code. May be planned for future use or a stale rule.

**Access rule**: `isAdmin()` read-only. No write path exists.

**Action required**: ⚠️ Verify whether this collection is in active use. If not, remove the rule.

---

### Collection: `institutionPools` (Found in Firestore rules, not in CLAUDE.md)

**Status**: Referenced in Firestore rules (`/institutionPools/{institutionId}`) with institution-scoped read access but not found in any backend function code. Likely planned for future use.

**Action required**: ⚠️ Verify whether this collection is in active use. If not, remove the rule.

---

## Section 3: Dashboard Responsibility Map

### App: Member (`/app`, port 5173)

**Roles that can access it**: `member`, `leader`

**Role gate**: `canAccessMemberApp = isActiveProfile && (role === "member" || role === "leader")`. Pending users see a friendly "Account Pending" screen. Users with unrecognized roles see "Account Access Not Ready."

**Implemented screens**:

| Route | Component | Purpose |
|-------|-----------|---------|
| `/app/login` | `LoginPage` | Phone + PIN login / self-registration |
| `/app/home` | `MemberHomeScreen` | Navigation hub, account status |
| `/app/dashboard` | `MemberDashboardScreen` | Summary: savings, loans, credit limit |
| `/app/savings` | `SavingsDashboardScreen` | Detailed savings breakdown |
| `/app/transactions` | `TransactionHistoryScreen` | Transaction history list |
| `/app/deposit` | `DepositRequestScreen` | Initiate deposit request (informational — actual deposit is recorded by agent) |
| `/app/find-agent` | `FindAgentScreen` | Find nearby agents by group assignment |
| `/app/withdraw` | `WithdrawalRequestScreen` | Request withdrawal (member-initiated path) |
| `/app/loans/request` | `RequestLoanScreen` | Submit loan request with term/purpose |
| `/app/loans/my` | `MyLoansScreen` | View own loan history and active loan status |
| `/app/my-qr` | `MyQRCodeScreen` | Display QR code for agent scanning |
| `/app/institution` | `InstitutionSelectionScreen` | Link account to an institution |
| `/app/join-group` | `JoinGroupScreen` | Join existing group by code |
| `/app/group/create` | `CreateGroupScreen` | Create a new savings group |
| `/app/group/my` | `MyGroupScreen` | View own group details |
| `/app/group/manage` | `GroupManageScreen` | Leader: manage group settings (leader-only in practice) |
| `/app/group/code` | `GroupCodeScreen` | Display group invite code (leader-only in practice) |
| `/app/group/pending-requests` | `GroupPendingRequestsScreen` | Leader: approve/reject join requests |
| `/app/group/split` | `GroupSplitScreen` | Leader: initiate group split |

**Missing screens/features**:
- P1: Notification inbox — no screen for viewing system notifications
- P1: Loan repayment submission — members can view loans but cannot initiate repayment from the app (repayment is agent-recorded only; no member-side repayment flow)
- P2: Group member list screen (viewable by leader, currently not routed)
- P2: Withdrawal request status tracking (no screen to see pending withdrawal request status after submission)

**Broken or partial flows**:
- `DepositRequestScreen` is informational only — it does not call `recordDeposit` (that is the agent's job). The screen should clarify this to users and perhaps show pending deposits.
- `InstitutionSelectionScreen` is new but no clear entry point from the home screen navigation.

**View-only screens**: `TransactionHistoryScreen`, `MyLoansScreen`, `SavingsDashboardScreen`, `MyGroupScreen`, `FindAgentScreen`

**Action screens**: `WithdrawalRequestScreen`, `RequestLoanScreen`, `JoinGroupScreen`, `CreateGroupScreen`, `GroupPendingRequestsScreen`, `GroupSplitScreen`, `InstitutionSelectionScreen`

---

### App: Agent (`/agent`, port 5174)

**Roles that can access it**: `agent`

**Role gate**: Hard `role !== "agent"` check — any other role sees "Access Restricted" screen.

**Implemented screens**:

| Route | Component | Purpose |
|-------|-----------|---------|
| `/agent/login` | `LoginPage` | Phone + PIN login |
| `/agent/home` | `HomePage` | Navigation hub with action tiles |
| `/agent/scan-deposit` | `ScanDepositScreen` | QR scan + record deposit for member |
| `/agent/deposits-today` | `AgentDailySummaryScreen` | Today's deposits, batch submission button |
| `/agent/dashboard` | `AgentBusinessDashboardScreen` | Activity summary, commission tracking |
| `/agent/close-day` | `CloseDayScreen` | Daily cash reconciliation form |
| `/agent/loans/disburse` | `LoanDisbursementScreen` | Search member, disburse pending loan |
| `/agent/loans/repay` | `LoanRepaymentScreen` | Record loan repayment from member |
| `/agent/withdrawals` | `AgentWithdrawalScreen` | Process member withdrawal request |
| `/agent/settlements` | `SettlementScreen` | View commissions, request settlement payout |

**Missing screens/features**:
- P1: No route for explicit batch review before submission — `AgentDailySummaryScreen` handles this but the flow is condensed
- P1: No screen for viewing historical reconciliations (close-day history)
- P2: No screen for viewing flagged batches (to know which past batches need re-submission)
- P2: No offline sync status screen — the `depositSyncService` runs in the background but there is no UI visibility into pending-sync items

**Broken or partial flows**:
- The `depositSyncService` import in `App.jsx` (`startSyncService`/`stopSyncService`) implies offline deposit recording exists, but no dedicated offline sync management screen exists.

**View-only screens**: `AgentBusinessDashboardScreen`, `SettlementScreen` (view only, with action button)

**Action screens**: `ScanDepositScreen`, `AgentDailySummaryScreen`, `CloseDayScreen`, `LoanDisbursementScreen`, `LoanRepaymentScreen`, `AgentWithdrawalScreen`

---

### App: Admin (`/admin`, port 5175)

**Roles that can access it**: `super_admin`, `admin`, `finance`

**Role gate**: `role === "super_admin" || role === "admin" || role === "finance"`. No per-screen role checks in frontend — all screens visible to all three roles; access control enforced at function layer.

**Implemented screens**:

| Route | Component | Purpose |
|-------|-----------|---------|
| `/admin/login` | `LoginPage` | Email/PIN login |
| `/admin/dashboard` | `AdminDashboardScreen` | Primary dashboard: pending approvals, recent activity |
| `/admin/approvals` | `ApprovalsScreen` | Approve/reject pending members and groups |
| `/admin/deposits/pending` | `PendingDepositsScreen` | Pending deposits awaiting admin bulk approval |
| `/admin/loans` | `LoansDashboardScreen` | Loan list with filters by status |
| `/admin/loans/:loanId` | `LoanDetailScreen` | Loan detail: approve, disburse, repayment, default actions |
| `/admin/agents` | `AgentListScreen` | List all agents |
| `/admin/agents/new` | `CreateAgentScreen` | Provision new agent |
| `/admin/agents/assign` | `AssignAgentScreen` | Assign agent to group |
| `/admin/agents/reconciliation` | `AgentReconciliationsScreen` | View agent daily reconciliations |
| `/admin/admins/new` | `CreateAdminScreen` | Provision admin/finance user |
| `/admin/institutions/new` | `CreateInstitutionUserScreen` | Provision institution staff user |
| `/admin/super/executive` | `ExecutiveDashboardScreen` | Platform metrics (super_admin) |
| `/admin/super/loans` | `LoanPortfolioScreen` | Detailed loan portfolio analysis |
| `/admin/super/admins` | `AdminManagementScreen` | List and manage admin users |
| `/admin/super/audit` | `AuditLogScreen` | Browse audit log |
| `/admin/super/config` | `SystemConfigScreen` | View/update system configuration |
| `/admin/super/groups` | `AllGroupsScreen` | View all groups with borrow-pause toggle |
| `/admin/super/institutions` | `InstitutionManagementScreen` | Manage partner institutions |
| `/admin/super/exceptions` | `RiskExceptionScreen` | View exceptions: defaults, flagged batches, suspensions |
| `/admin/super/transactions` | `TransactionOversightScreen` | Transaction-level oversight |
| `/admin/super/fund` | `KirimbaFundManagementScreen` | Fund capital management |

**Missing screens/features**:
- P1: No screen for viewing/approving individual withdrawal requests (≥50k BIF). The function `recordWithdrawal` creates `withdrawalRequests` docs but no admin UI surfaces these.
- P1: No screen for running migration utilities (`migrateInstitutionUserRoles`, `backfillGroupInstitutionIds`). These must currently be triggered via Firebase console or CLI.
- P2: No settlement management screen for finance/super_admin to view pending settlement requests from agents (the settlement approval flow has backend functions but no admin UI).
- P2: No member suspension/reactivation screen (functions exist: `suspendUser`, `reactivateUser` — no UI).

**Broken or partial flows**:
- The `super/` prefixed screens are routed to all three admin roles without role-based navigation hiding. A `finance` user will see "Executive Dashboard" in navigation but the function call will return `permission-denied`. This will confuse users.
- No navigation sidebar or menu component is visible in the file listing — navigation must be embedded in `AdminDashboardScreen` or similar. This should be verified.

---

### App: Umuco/Institution (`/umuco`, port 5176)

**Roles that can access it**: `institution_user`, `umuco` (legacy)

**Role gate**: `role !== "institution_user" && role !== "umuco"` → "Access Restricted." The `institutionId` claim is read and passed as prop to screens.

**Implemented screens**:

| Route | Component | Purpose |
|-------|-----------|---------|
| `/umuco/login` | `LoginPage` | Phone + PIN login |
| `/umuco/home` | `HomePage` | Navigation hub with batch stats |
| `/umuco/batches` | `PendingBatchesScreen` | Pending batches for this institution |
| `/umuco/batch/:batchId` | `BatchDetailScreen` | Batch detail: member transactions, confirm/flag actions |
| `/umuco/history` | `BatchHistoryScreen` | Confirmed/processed batch history |
| `/umuco/exceptions` | `FlaggedBatchesScreen` | Flagged batches requiring attention |

**Missing screens/features**:
- P1: No screen for viewing institution-level statistics or collateral totals
- P2: No notification/alert screen for the institution user
- P2: No profile/account screen for the institution user

**Broken or partial flows**:
- `PendingBatchesScreen`, `BatchHistoryScreen`, and `FlaggedBatchesScreen` receive `institutionId` as prop — for legacy `umuco` users, this will be `null` (no `institutionId` claim), which means these screens may show all batches or none depending on implementation. This is the security gap from the legacy role.

---

## Section 4: Reset Impact Analysis

### Collection Reset Table

| Collection | Safe to Wipe | Notes | Risks if Wiped |
|---|---|---|---|
| `users` | YES (after Auth wipe) | Must wipe in sync with Auth users | New Auth users will trigger `onUserCreate` creating fresh stubs |
| `wallets` | YES | Recreated by `onUserCreate` on next sign-in | Balance history lost; must wipe before members transact |
| `groups` | YES | All financial history gone | Groups must be recreated and re-approved |
| `groupMembers` | YES | Savings history gone | Members must re-join groups after reset |
| `transactions` | YES | All transaction history wiped | No audit trail for past activity |
| `loans` | YES | All loan history wiped | Active loans become orphaned if not wiped with members |
| `depositBatches` | YES | Wipe with transactions | Orphaned batches will confuse institution users |
| `withdrawalRequests` | YES | Safe to wipe | |
| `kirimbaFund` | YES (then reseed) | Must reseed via `seedKirimbaFund` | No loans possible until reseeded |
| `fundLedger` | YES | History only; reseed will start fresh | Audit trail lost |
| `fundMovements` | YES (deprecated) | Deprecated collection; no need to recreate | |
| `agentLedgers` | YES | Commission history gone | Agents lose commission tracking; settlements must also be wiped |
| `agentReconciliations` | YES | Historical only | |
| `agentSettlements` (aka `settlements`) | YES | Must wipe with agentLedgers | Orphaned settlements if ledger wiped without settlements |
| `notifications` | YES | Ephemeral by design | |
| `systemConfig` | YES (then reseed) | Must reseed via `seedSystemConfig` | Functions using config will fail (commission calculations, thresholds) |
| `config` (legacy) | YES | Do NOT recreate — deprecated | |
| `auditLog` | YES | History only | Compliance audit trail lost |
| `institutions` | CONDITIONAL | Only wipe if rebuilding institution data from scratch | All groups and users lose `institutionId` FK references |
| `counters` | YES | Must wipe so receipt numbers restart from 1 | Receipt numbers won't restart from 00001 without wiping |
| `agents` | YES (with users) | Must wipe in sync with users collection | Orphaned agent assignment data |
| `kirimbaPools` | YES | No functions write here | |
| `institutionPools` | YES | No functions write here | |

---

### Auth Users

**What happens if wiped**: All Firebase Auth users are deleted. Their corresponding `users/{uid}` and `wallets/{uid}` Firestore documents become orphaned with no corresponding Auth user. New Auth user creation will re-trigger `onUserCreate` and create fresh stubs.

**Wipe process**: Must use Firebase Admin SDK (cannot be done from Firebase Console for large user sets):
```bash
# via Firebase CLI emulators in dev:
firebase emulators:start --only auth
# then clear via emulator UI

# in production:
# Use Admin SDK script to enumerate and delete all Auth users in batches
```

**Critical**: Wipe Firestore `users` and `wallets` BEFORE or SIMULTANEOUSLY with Auth wipe. If Auth is wiped but Firestore docs remain, the UID mapping is broken.

---

### Custom Claims

**What needs to be re-issued**: Every approved user must have their role claim re-set after Auth wipe. Roles are stored in both Firebase Auth custom claims AND in `users/{uid}.role`.

**Re-issuance process**: After the super_admin Auth user is recreated manually, they can run `approveMember` / `provisionAgent` / `provisionAdmin` / `provisionInstitutionUser` which call `setCustomUserClaims()` internally. The first super_admin claim must be set manually via Admin SDK.

---

### System Config

**What needs reseeding**: All four `systemConfig` documents: `fees`, `loanPolicy`, `commissionPolicy`, `businessRules`.

**How**: Call `seedSystemConfig()` as the super_admin user after reset. This writes all four documents with default values. After seeding, any non-default values must be updated via `updateSystemConfig()`.

---

### Counters

**What needs resetting**: The `counters` collection stores yearly transaction receipt number counters (e.g., `TXN_2026`). After a data reset, either:
1. Delete the `counters` collection entirely (receipts restart from TXN-2026-00001), or
2. Leave as-is if you want receipt numbers to continue from where they left off

**Recommendation**: DELETE the counters collection on reset so receipt numbers restart cleanly from 00001 for the new dataset.

---

### Indexes

**No action needed**. Firestore indexes are defined in `firestore.indexes.json` and deployed via `firebase deploy --only firestore:indexes`. They are not affected by data wipes. However, they must be deployed before any data is written if the emulator is being reset, as the emulator does not auto-create indexes on document creation.

---

## Section 5: Post-Reset Seed Order

### Step 1: Deploy code and rules (no data yet)

**What to create**: Nothing in Firestore yet.
**Which callable**: N/A — Firebase deployment only.
**Dependencies**: None.
**Verification check**: `firebase functions:list` shows all 50+ functions deployed. Firestore rules deployed. Indexes deployed (wait for build).

```bash
firebase deploy --only functions,firestore:rules,firestore:indexes
```

---

### Step 2: Create the first super_admin user

**What to create**: One Firebase Auth user + `users/{uid}` document with `role: "super_admin"` and `status: "active"`.

**Which callable**: Cannot use a callable — no callable allows creating a super_admin. Must use Firebase Admin SDK directly.

**Process**:
```javascript
// Run in a one-off Node.js script with service account credentials:
const admin = require("firebase-admin");
admin.initializeApp({ credential: admin.credential.cert("./serviceAccount.json") });

const auth = admin.auth();
const db = admin.firestore();

const phone = "+257XXXXXXXXX"; // super_admin phone
const pin = "XXXX"; // 4-digit PIN
const email = `${phone}@kirimba.app`;

// 1. Create Auth user
const user = await auth.createUser({ email, password: pin, displayName: "Super Admin" });

// 2. Set custom claim
await auth.setCustomUserClaims(user.uid, { role: "super_admin" });

// 3. Create Firestore profile
await db.collection("users").doc(user.uid).set({
  uid: user.uid,
  fullName: "Super Admin",
  phone: phone,
  role: "super_admin",
  status: "active",
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  approvedAt: admin.firestore.FieldValue.serverTimestamp(),
});

// 4. Create wallet
await db.collection("wallets").doc(user.uid).set({
  userId: user.uid,
  balanceConfirmed: 0, balancePending: 0, balanceLocked: 0, availableBalance: 0,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
});

console.log("Super admin created:", user.uid);
```

**Dependencies**: Step 1 (code deployed).
**Verification check**: Log in to `/admin` app with the super_admin credentials. Should redirect to `/admin/dashboard`. Check `users/{uid}.role == "super_admin"` and `status == "active"` in Firestore.

---

### Step 3: Seed Kirimba Fund

**What to create**: `kirimbaFund/current` document with initial capital.
**Which callable**: `seedKirimbaFund({ initialCapital: <amount_in_BIF> })`
**Dependencies**: Step 2 (super_admin must be authenticated).
**Verification check**: `kirimbaFund/current` exists with `availableFund > 0`, `deployedFund == 0`, `lendingPaused == false`.

---

### Step 4: Seed System Configuration

**What to create**: Four `systemConfig` documents: `fees`, `loanPolicy`, `commissionPolicy`, `businessRules`.
**Which callable**: `seedSystemConfig()` — call once as super_admin.
**Dependencies**: Step 2 (must be authenticated as super_admin).
**Verification check**: `systemConfig/fees`, `systemConfig/loanPolicy`, `systemConfig/commissionPolicy`, `systemConfig/businessRules` all exist with their default fields.

---

### Step 5: Create Umuco Institution

**What to create**: `institutions/umuco` document (or any institution document for the primary partner).
**Which callable**: `backfillUmucoInstitution()` for the default Umuco institution, OR `createInstitution({ name: "Umuco", code: "UMUCO", ... })` for a fresh start.
**Dependencies**: Step 2.
**Verification check**: `institutions` collection has at least one active institution. Record its document ID — it will be needed for agent/group/user assignments.

---

### Step 6: Provision institution user(s)

**What to create**: Firebase Auth user + `users/{uid}` for each institution staff member.
**Which callable**: `provisionInstitutionUser({ phone, fullName, pin, institutionId })` — call as super_admin.
**Dependencies**: Step 5 (institutionId must exist).
**Verification check**: Log in to `/umuco` app as institution user. Should see `PendingBatchesScreen`. Check `users/{uid}.role == "institution_user"` and the Auth token has `institutionId` claim set.

---

### Step 7: Provision admin users

**What to create**: Firebase Auth user + `users/{uid}` for each admin/finance staff member.
**Which callable**: `provisionAdmin({ phone, fullName, pin, role: "admin" | "finance" })`
**Dependencies**: Step 2.
**Verification check**: Log in to `/admin` app as admin. Check dashboard loads. Verify role in Auth token.

---

### Step 8: Provision agents

**What to create**: Firebase Auth user + `users/{uid}` + `agents/{uid}` for each field agent.
**Which callable**: `provisionAgent({ phone, fullName, pin, assignedGroups: [] })` — groups can be assigned after groups are created.
**Dependencies**: Step 2.
**Verification check**: Log in to `/agent` app as agent. Should reach `/agent/home`. Check `users/{uid}.role == "agent"`.

---

### Step 9: Register member users (test members or real members)

**What to create**: Firebase Auth user + `users/{uid}` (pending) + `wallets/{uid}` for each member.
**Which callable**: `registerMember({ phone, fullName, pin, nationalId?, joinCode? })` — no auth required.
**Dependencies**: None (but approval in Step 10 requires super_admin from Step 2).
**Verification check**: `users/{uid}.status == "pending_approval"` in Firestore.

---

### Step 10: Approve members and create groups

**What to create**: Approve members (updates status + sets custom claims), then create groups.
**Which callables**:
1. `approveMember({ userId })` — for each pending member
2. `createGroup({ name, description })` — called by an approved member (leader)
3. `approveGroup({ groupId, umucoAccountNo: "<institution_ref>" })` — called by super_admin
**Dependencies**: Step 9 (members must exist).
**Verification check**: Members have `status: "active"` and can log in to member app. Groups have `status: "active"`. Group leader has `isLeader: true` and `ledGroupId` set.

---

### Step 11: Assign agents to groups

**What to create**: Update `agents/{agentId}.assignedGroups` array.
**Which callable**: `assignAgentToGroup({ agentId, groupId })` — called by super_admin or admin.
**Dependencies**: Steps 8 and 10 (agents and groups must exist).
**Verification check**: `agents/{agentId}.assignedGroups` contains the expected group IDs.

---

### Step 12: Backfill group institution IDs

**What to create**: Update `groups/{groupId}.institutionId` for any groups missing this field.
**Which callable**: `backfillGroupInstitutionIds({ dryRun: true })` first to preview, then `backfillGroupInstitutionIds({ dryRun: false })` to apply.
**Dependencies**: Steps 5 and 10 (institutions and groups must exist).
**Verification check**: All `groups` documents have `institutionId` set to a valid institution ID.

---

### Step 13: Verify member app flow end-to-end

**What to test**:
1. Member logs in → sees home screen
2. Member views their group
3. Member requests a loan → check auto-approval or rejection
4. Agent records a deposit → transaction appears in member's transaction history
5. Agent submits batch → batch appears in umuco app
6. Institution user confirms batch → member's savings balance updated
**Dependencies**: Steps 6–12 all complete.
**Verification check**: No errors in Firebase Functions logs. All Firestore documents have expected fields and statuses.

---

## Section 6: Critical Fixes Before Reset

### Issue 1: Transaction status enum mismatch (`pending_umuco` vs `pending_confirmation`)

**Issue description**: The `TRANSACTION_STATUS` constant defines `PENDING_CONFIRMATION: "pending_confirmation"`, but `savings.js` writes `status: "pending_umuco"` to transaction documents when a deposit is recorded. The two values are different strings. Queries that filter by `TRANSACTION_STATUS.PENDING_CONFIRMATION` will not find deposit transactions created by `recordDeposit`.

**File and location**: `/Users/theo/kirimba-banking/functions/src/savings.js` — wherever `status: "pending_umuco"` is set; also `/Users/theo/kirimba-banking/functions/src/constants.js` (the `TRANSACTION_STATUS` constant).

**Fix required**: Code change. Either:
- Update `savings.js` to use `TRANSACTION_STATUS.PENDING_CONFIRMATION` consistently, and migrate existing data; OR
- Add `PENDING_UMUCO: "pending_umuco"` to the `TRANSACTION_STATUS` constant and use it consistently.
The first option is cleaner. After code fix, a data migration is needed for any existing transactions with `status: "pending_umuco"`.

**Severity**: BLOCKER — after reset, new deposit transactions will have a status value that does not match the constant, breaking any query that uses the constant.

---

### Issue 2: Settlement collection naming mismatch (`settlements` vs `agentSettlements`)

**Issue description**: The CLAUDE.md documentation, some function comments, and the Firestore rules use different names for the settlement collection. Firestore rules reference `agentSettlements/{settlementId}`. The `reconciliation.js` function writes to `agentSettlements`. However, CLAUDE.md describes it as `settlements`. This creates confusion but is not a runtime bug — the code consistently uses `agentSettlements`.

**File and location**: `/Users/theo/kirimba-banking/firestore.rules` line 181 (`agentSettlements`), `/Users/theo/kirimba-banking/CLAUDE.md` (says `settlements`).

**Fix required**: Documentation update only. Standardize the canonical name to `agentSettlements` in CLAUDE.md, or rename to `settlements` throughout code and rules. Either way, must be consistent.

**Severity**: MEDIUM — causes developer confusion but no runtime error currently.

---

### Issue 3: `fundMovements` still written alongside `fundLedger` (deprecated collection)

**Issue description**: `disburseLoan()` and `recordRepayment()` in `loans.js` still write to both `fundLedger` (new) and `fundMovements` (deprecated). The `fundMovements` collection has a Firestore rule allowing admin reads, indicating it is still in active use. However, CLAUDE.md marks it as deprecated.

**File and location**: `/Users/theo/kirimba-banking/functions/src/loans.js` — disburseLoan and recordRepayment functions.

**Fix required**: Code change. Remove the `fundMovements` write path in `loans.js`. Remove the `fundMovements` rule from `firestore.rules`. After the reset, the `fundMovements` collection will no longer exist and should not be recreated.

**Severity**: HIGH — not a blocker for reset but creates confusing dual writes and must be resolved before production launch.

---

### Issue 4: Legacy `config` collection still read by `savings.js`

**Issue description**: `savings.js` still reads from the deprecated `config/fees` collection as a fallback when calculating agent commissions, even though `systemConfig/fees` is the canonical source. After reset, `config/fees` will not exist (deliberately not recreated), causing the fallback read to silently return null and potentially compute a zero commission rate.

**File and location**: `/Users/theo/kirimba-banking/functions/src/savings.js` — commission calculation logic.

**Fix required**: Code change. Remove the fallback read from `config/fees`. All commission calculations should read exclusively from `systemConfig/fees`.

**Severity**: HIGH — will silently miscalculate commissions after reset if not fixed.

---

### Issue 5: `notifications` collection uses two different recipient field names

**Issue description**: The Firestore rules check BOTH `resource.data.recipientId == request.auth.uid` AND `resource.data.userId == request.auth.uid`, suggesting different functions write notifications using different field names for the recipient. This is confirmed by the rules comment.

**File and location**: `/Users/theo/kirimba-banking/firestore.rules` lines 143–149 (notifications rule).

**Fix required**: Code audit of all notification creation calls across `loans.js`, `savings.js`, `members.js`, `superAdmin.js`. Standardize to a single field name (recommend `userId` to match the user profile convention). Update Firestore rules to check only that field after standardization.

**Severity**: MEDIUM — works at runtime due to the OR condition in rules, but is confusing and fragile.

---

### Issue 6: `kirimbaPools` and `institutionPools` referenced in rules but no backend code

**Issue description**: The Firestore rules define read access for `kirimbaPools` and `institutionPools` collections, but no backend Cloud Function writes to these collections. They appear to be planned future features or abandoned stubs.

**File and location**: `/Users/theo/kirimba-banking/firestore.rules` lines 191–203.

**Fix required**: Either implement the collections or remove the rule stubs. Leaving unused rules causes confusion.

**Severity**: LOW — no runtime impact, but architecture debt.

---

### Issue 7: The first super_admin has no automated provisioning path

**Issue description**: There is no callable function to create a super_admin user. The `provisionAdmin` function only accepts `"admin"` or `"finance"` roles. The `provisionAgent` function sets role to `"agent"`. There is no path to create a super_admin via a callable — it requires direct Admin SDK access or manual Firebase Console configuration.

**File and location**: `/Users/theo/kirimba-banking/functions/src/agents.js` — `provisionAdmin` function.

**Fix required**: Document the bootstrap process clearly (this report does so in Section 5, Step 2). This is not a bug but a design decision that must be explicitly handled during every reset.

**Severity**: HIGH (for reset operations) — if the manual step is skipped, the entire admin app is inaccessible.

---

### Issue 8: Admin app has no per-screen role filtering for `finance` vs `admin` vs `super_admin`

**Issue description**: The admin app renders all screens to all three admin roles (finance, admin, super_admin). A `finance` user can navigate to the "Executive Dashboard" or "System Config" screen, attempt an action, and receive a `permission-denied` error from the function. This is a poor UX and may expose sensitive data views even when mutation is blocked.

**File and location**: `/Users/theo/kirimba-banking/apps/admin/src/App.jsx` — ProtectedRoute only checks `user`, not role.

**Fix required**: Add role-prop to ProtectedRoute and implement screen-level role filtering. Super_admin-only screens (`/super/executive`, `/super/fund`, `/super/config`, `/super/admins`, `/super/institutions`) should show "Access Restricted" for `admin` and `finance` roles.

**Severity**: MEDIUM — UX issue with potential data exposure. Not a data integrity blocker for reset.

---

### Issue 9: `agents` documents with legacy `assignedGroupId` field

**Issue description**: The v3.1.9 migration changed the `agents` schema from a single `assignedGroupId` string to an `assignedGroups` array. Any existing agent documents with the old field will not work with `assignAgentToGroup` or any function that iterates `assignedGroups`.

**File and location**: `/Users/theo/kirimba-banking/functions/src/agents.js` — `assignAgentToGroup` function.

**Fix required**: Data migration. Run a script to convert any `assignedGroupId` fields to `assignedGroups: [assignedGroupId]` arrays. After the data reset, all new agents will use the array model — this fix is only needed for pre-reset data preservation.

**Severity**: HIGH for existing data (pre-reset); LOW for post-reset fresh start (not applicable).

---

## Section 7: Recommended Execution Plan

### Step 1: Code fixes (before any deployment or reset)

Apply these code changes in the given order:

1. **Fix transaction status enum** (`savings.js`): Replace all `status: "pending_umuco"` literals with `TRANSACTION_STATUS.PENDING_CONFIRMATION` (value: `"pending_confirmation"`). Search for all occurrences of the string `"pending_umuco"` across the entire codebase.

2. **Remove legacy `config` collection reads** (`savings.js`): Remove the fallback path that reads from `config/fees`. Replace with direct read from `systemConfig/fees` only.

3. **Remove `fundMovements` writes** (`loans.js`): Remove the `fundMovements` batch write from `disburseLoan` and `recordRepayment`. Keep the `fundLedger` writes.

4. **Standardize notifications recipient field** (all function files): Audit all `notifications` collection writes. Standardize to `userId` as the recipient field. Update Firestore rules to remove the `recipientId` OR condition.

5. **Remove unused Firestore rule stubs**: Remove `kirimbaPools` and `institutionPools` rules from `firestore.rules` unless these collections are going to be implemented.

After code changes, verify locally with emulators:
```bash
npm run emulators:core
# Run through deposit → batch → confirm flow
# Run through loan request → disburse → repay flow
# Verify no functions:log errors
```

---

### Step 2: Deploy order

Deploy in this exact sequence:

```bash
# 1. Deploy Firestore rules (must precede data writes)
firebase deploy --only firestore:rules

# 2. Deploy Firestore indexes (must be deployed before indexed queries run)
firebase deploy --only firestore:indexes
# Wait 2–5 minutes for indexes to build before proceeding

# 3. Deploy Cloud Functions
firebase deploy --only functions

# 4. Deploy hosting (after frontend builds)
npm run build:all
firebase deploy --only hosting
```

---

### Step 3: Reset order (what to delete, in what order)

**This is a destructive operation. Take a Firestore export backup first.**

```bash
# Export current Firestore data (backup)
gcloud firestore export gs://<your-bucket>/backup-$(date +%Y%m%d)

# Step 3a: Delete Firestore collections (via Firebase Console or Admin SDK script)
# Delete in this order to avoid orphaned FK references:
# 1. notifications
# 2. agentLedgers
# 3. agentSettlements
# 4. agentReconciliations
# 5. withdrawalRequests
# 6. fundLedger
# 7. fundMovements (deprecated, delete without recreating)
# 8. fundMovements
# 9. auditLog
# 10. loans
# 11. transactions
# 12. depositBatches
# 13. groupMembers
# 14. agents (the agents-specific collection, not users)
# 15. wallets
# 16. groups
# 17. users
# 18. kirimbaFund
# 19. systemConfig
# 20. counters
# 21. config (deprecated, delete without recreating)
# DO NOT delete: institutions (unless full reset)

# Step 3b: Delete Firebase Auth users
# Use Admin SDK script:
# list all users, delete in batches of 100

# Step 3c: Verify Firestore is empty (spot-check via Console or emulator UI)
```

---

### Step 4: Reseed order (exact callables to invoke, in order)

Execute the steps in Section 5 of this report, in order (Steps 2 through 12). The exact callables are:

```
1. Manual Admin SDK: create super_admin Auth user + set custom claim + create users/{uid}
2. seedKirimbaFund({ initialCapital: <BIF_amount> })
3. seedSystemConfig()
4. backfillUmucoInstitution()  -- or createInstitution() for a fresh institution record
5. provisionInstitutionUser({ phone, fullName, pin, institutionId })  -- repeat per user
6. provisionAdmin({ phone, fullName, pin, role: "admin" })  -- repeat per user
7. provisionAgent({ phone, fullName, pin })  -- repeat per agent
8. registerMember({ phone, fullName, pin })  -- for each test/real member
9. approveMember({ userId })  -- for each member
10. createGroup({ name, description })  -- as a member
11. approveGroup({ groupId, umucoAccountNo: "..." })  -- as super_admin
12. assignAgentToGroup({ agentId, groupId })  -- as super_admin or admin
13. backfillGroupInstitutionIds({ dryRun: false })  -- if any groups missing institutionId
```

---

### Step 5: Verification tests (exact checks to do)

After seeding, perform these verification checks in sequence:

1. **Auth check**: Log in to all four apps (member, agent, admin, umuco) with the seeded users. All should reach their respective home screens without errors.

2. **Custom claims check**: For each user, call `firebase auth:export --format=json | jq '.users[] | {email, customAttributes}'` and verify role claims are set correctly.

3. **System config check**: In admin app, navigate to `/admin/super/config`. Verify all four config sections show default values.

4. **Fund check**: In admin app, navigate to `/admin/super/fund`. Verify `availableFund > 0` and `lendingPaused == false`.

5. **Deposit flow**: As agent, navigate to `/agent/scan-deposit`. Record a test deposit for a test member. Verify `transactions/{id}` created with `status: "pending_confirmation"` (NOT `pending_umuco` — this verifies fix #1 applied).

6. **Batch submission**: As agent, navigate to `/agent/deposits-today`. Submit batch. Verify `depositBatches/{id}` created with `idempotencyToken` field present.

7. **Batch confirmation**: As institution_user, navigate to `/umuco/batches`. Confirm the submitted batch. Verify:
   - `depositBatches/{id}.status == "confirmed"`
   - `transactions` in batch have `status: "confirmed"`
   - `groupMembers/{userId}.personalSavings > 0`
   - `kirimbaFund/current.totalCollateral > 0`

8. **Loan request**: As member, navigate to `/app/loans/request`. Request a small loan. Verify:
   - Auto-approved if within credit limit and fund available
   - `loans/{id}` created with correct status
   - No `fundMovements` document created (verifies fix #3 applied)
   - `fundLedger` entry created with type `loan_out`

9. **Function logs check**: `firebase functions:log --only recordDeposit,confirmBatch,requestLoan` — verify no unhandled errors.

10. **Rules check**: Attempt to read `kirimbaFund/current` as a member user (should fail with `permission-denied`). Attempt to read own `users/{uid}` as member (should succeed).

---

## Appendix: Architecture Debt Inventory

### Security Concerns

1. **Legacy `umuco` role has unscoped batch access**: Any user with `role: "umuco"` custom claim can confirm or flag batches belonging to any institution, not just their own. The Firestore rule for `depositBatches` grants `role() == "umuco"` full read access with no `institutionId` scoping. **Migration path**: Run `migrateInstitutionUserRoles()` to convert all legacy `umuco` users to `institution_user` with proper `institutionId` claims.

2. **PIN stored as bcrypt hash, but legacy SHA256 hashes may exist**: v3.1.9 switched from SHA256 to bcrypt for PIN hashing. Any users created before this update have SHA256 PIN hashes. If those users still exist after the code update is deployed, they cannot log in (hash comparison will fail). After reset, all new users will use bcrypt — this is only a concern for production data migration.

3. **Finance role can see super_admin screens in the UI**: The admin app does not filter screen visibility by role level. A `finance` user can navigate to and see the data on screens like `ExecutiveDashboardScreen` and `KirimbaFundManagementScreen` even though the underlying functions would reject their calls. This is an information exposure risk.

4. **`institutions` collection readable by any authenticated user**: Firestore rules for `institutions` grant `allow read: if isSignedIn()` — any authenticated user (including a `member`) can list and read all institution documents. This may expose institution contact details, phone numbers, and status. Consider restricting to elevated roles.

5. **No rate limiting on `registerMember`**: The `registerMember` callable requires no authentication, making it vulnerable to bulk registration spam. Consider adding a CAPTCHA or registration token mechanism.

---

### Data Model Inconsistencies

1. **`memberId` redundant field in `transactions` and `loans`**: `memberId` duplicates `userId` throughout the transactions and loans collections. This is a legacy naming artifact. Should be removed and all queries updated to use `userId`.

2. **`wallets` vs `groupMembers` balance duplication**: Member financial balances are stored in both `wallets/{uid}` and `groupMembers/{uid}`. The `groupMembers` document is the authoritative source for loan calculations, while `wallets` is used for UI display. These can drift out of sync. A single source of truth is needed.

3. **`notifications.recipientId` vs `notifications.userId`**: Two different field names used by different code paths for the notification recipient. Firestore rules handle this with an OR condition, but it is fragile.

4. **`groups.umucoAccountNo` legacy field still written**: The `umucoAccountNo` field on groups was used before the `institutionId` FK relationship was introduced. It should be retired after `institutionId` is fully backfilled.

5. **`agentSettlements` vs `settlements` naming mismatch**: The collection is named `agentSettlements` in Firestore and code, but documentation refers to it as `settlements`. Pick one.

6. **`depositBatches.umucoAccountRef` / `umucoNotes` legacy params**: `confirmBatch()` still accepts both old and new parameter names. After the `umuco` → `institution_user` migration is complete, the legacy parameter handling should be removed.

7. **`groups.status` index has duplicate definition**: In `firestore.indexes.json`, there are two indexes on `groups` with `status ASC + createdAt`. One has `createdAt ASCENDING` and the other `createdAt DESCENDING`. Both appear needed for different query directions, but the duplication should be verified.

---

### Hardcoded Values

1. **`superAdmin.js` hardcodes `db.collection("institutions").doc("umuco")`**: The `backfillUmucoInstitution()` function uses the hardcoded document ID `"umuco"` for the institution. If the actual institution document was created with a different ID (auto-generated), this hardcoded reference will not match.

2. **`savings.js` hardcodes channel values**: The `channel` field accepts `"agent"` or `"umuco_branch"`. The `"umuco_branch"` value is institution-specific naming that should be generalized (e.g., `"institution_branch"`).

3. **`MIN_WITHDRAWAL_REMAINING_BALANCE = 5000` and `WITHDRAWAL_APPROVAL_THRESHOLD = 50000`** in `savings.js`: These business rules are hardcoded constants rather than reading from `systemConfig/businessRules`. After `systemConfig` is properly seeded, these should be read dynamically.

4. **Interest rates in `calculateInterest()`**: The rates `{ 7: 0.06, 14: 0.05, 30: 0.04 }` are hardcoded in `utils.js` rather than reading from `systemConfig/loanPolicy.interestRates`.

5. **Max loan multiplier (1.5) hardcoded**: The credit limit calculation uses a hardcoded `1.5` multiplier rather than reading from `systemConfig/loanPolicy.maxLoanMultiplier`.

---

### Missing Features

1. **No admin UI for withdrawal request approval**: Large withdrawals (≥50k BIF) create `withdrawalRequests` documents, but no admin screen surfaces these for approval. The backend function for approval may not even exist (not visible in the exports).

2. **No admin UI for settlement management**: Agents can request settlements and the functions `approveSettlement` and `markSettlementPaid` exist, but there is no admin screen in the admin app for managing these.

3. **No notification inbox on any frontend**: The `notifications` collection is written by multiple backend functions, but no frontend app has a screen to display notifications to users.

4. **No member-facing loan repayment screen**: Members can view loans but cannot initiate repayment — only agents can record repayments. This may be intentional (cash-only repayments) but limits the UX.

5. **No agent offline sync status UI**: The agent app has a `depositSyncService` for offline operation but no UI to show sync status, pending items, or sync errors.

6. **No member group member list screen**: Members and leaders cannot see the list of other members in their group from the member app.

7. **Missing admin screens for `migrateInstitutionUserRoles` and `backfillGroupInstitutionIds`**: These one-off migration callables require direct Firebase invocation (console, REST, or SDK). Admin screens for running these safely (with dry-run preview) would reduce operational risk.

---

### Legacy Compatibility Patterns to Eventually Remove

1. **`ROLES.UMUCO` constant in `constants.js`**: This constant and all code paths that check for `role === "umuco"` can be removed after the `migrateInstitutionUserRoles()` migration is verified complete. Target: post-migration cleanup sprint.

2. **`isUmuco()` alias in Firestore rules**: The `isUmuco()` function is an alias for `isInstitutionUser()`. After all `umuco` users are migrated, this alias should be removed and all call sites updated to use `isInstitutionUser()` directly.

3. **`umucoAccountRef` / `umucoNotes` parameter handling in `confirmBatch()`**: Dual parameter acceptance (`institutionRef` OR `umucoAccountRef`) can be removed once all callers use the new parameter names.

4. **`config/fees` fallback in `savings.js`**: The legacy `config` collection read should be removed entirely in favour of `systemConfig/fees`.

5. **`fundMovements` collection and writes**: Should be removed from `loans.js` and the Firestore rule deleted once `fundLedger` is confirmed as the sole fund audit mechanism.

6. **`umucoAccountNo` field on `groups`**: Once `institutionId` FK is fully backfilled and confirmed, the `umucoAccountNo` field write in `approveGroup()` can be removed.

7. **`memberId` field on `transactions` and `loans`**: Legacy alias for `userId`. Remove once data model is cleaned up post-reset.

---

*End of Report*

> This document was generated from direct analysis of the KIRIMBA v3.1.9 codebase on 2026-03-15. It reflects the state of the code at the time of generation. Any code changes made after this date may invalidate specific findings. Review all BLOCKER and HIGH severity items in Section 6 before proceeding with any reset operation.
