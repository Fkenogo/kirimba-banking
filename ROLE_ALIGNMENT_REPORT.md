# Kirimba Role Alignment Report

Date: 2026-03-07

## Scope
This report audits and aligns role model, account creation flows, group/leader lifecycle, and permissions across:
- Cloud Functions (`functions/src/*`, `functions/index.js`)
- Firestore Rules (`firestore.rules`)
- Frontend apps (`apps/member`, `apps/agent`, `apps/admin`, `apps/umuco`)

## Phase 1 Audit

### A) Role Definitions Across Codebase

| Layer | Current Source of Truth | Status |
|---|---|---|
| Role constants | `functions/src/constants.js` (`super_admin`, `admin`, `leader`, `agent`, `member`, `umuco`, `finance`) | Aligned |
| Custom claims | Set by callables (`approveMember`, `approveGroup`, `provisionAgent`, `provisionAdmin`, `provisionInstitutionUser`) | Aligned after fixes |
| Firestore `users.role` | Written by registration/provisioning/approval functions | Aligned after fixes |
| Route guards | Claim-based gating in each app shell (`App.jsx`) | Aligned after fixes |
| Callable guards | `requireRole/requireRoles` checks in members/savings/loans/groups/reconciliation/agents | Aligned after fixes |
| Firestore rules | `isAdmin()` now includes `super_admin` + `admin` (+ `finance`) | Aligned for admin hierarchy |

Notes:
- `super_admin` now has full admin-equivalent access anywhere `admin` is allowed in current callable/rules coverage.
- `finance` remains an elevated operational role (existing behavior retained).

### B) User Creation Paths (Who Can Create What)

| User Type | Creation Path | Who Can Create | Where Enforced |
|---|---|---|---|
| Member | Self registration | Member self-register flow | `registerMember` callable + member app UX |
| Leader | Not self-registered | Derived from group approval | `approveGroup` sets leader claim/role |
| Agent | Provisioned only | `admin` or `super_admin` | `provisionAgent` callable guard |
| Institution staff (`umuco`) | Provisioned only | `admin` or `super_admin` | `provisionInstitutionUser` callable guard |
| Admin | Provisioned only | `super_admin` only | `provisionAdmin` callable guard |
| Super admin | Bootstrap/manual only | N/A | No self-registration/provision callable |

### C) Group Creation / Leader Flow (Actual Code)

Current aligned flow:
1. Active member calls `createGroup`.
2. Group is created as `pending_approval` with `leaderId = requesting member` (proposed leader).
3. User is marked `proposedLeaderForGroupId` (not `isLeader=true` yet).
4. Admin/super_admin calls `approveGroup`.
5. On approval, backend sets:
   - custom claim `role=leader`
   - `users/{uid}.role=leader`
   - `users/{uid}.isLeader=true`
   - `users/{uid}.ledGroupId={groupId}`

Result: leader role is now assigned only after admin approval.

### D) UI Coverage by Role

| Role | App | Routes/Screens Reachable | Status |
|---|---|---|---|
| `super_admin` | `apps/admin` | Dashboard, Approvals, Deposits, Agent Mgmt, Reconciliation, Create Admin, Create Institution User | Reachable |
| `admin` | `apps/admin` | Dashboard, Approvals, Deposits, Agent Mgmt, Reconciliation, Create Institution User | Reachable |
| `member` | `apps/member` | Home, Savings, Deposit, Withdraw, Loan Request, Join Group, Request New Group, Manage Group | Reachable |
| `leader` | `apps/member` | All member routes + leader actions unlocked by backend/claim after group approval | Reachable (limited UI for join-request approvals remains backend-capable only) |
| `agent` | `apps/agent` | Home, Scan Deposit, Today Summary, Dashboard, Close Day | Reachable |
| `umuco` | `apps/umuco` | Home, Pending Batches, Batch Detail (confirm/flag), History | Reachable |

### E) Permission Mismatches Found

#### Fixed
1. `super_admin`/`admin` inconsistency in callable guards and rules.
- Fixed by adding/normalizing `ROLES.ADMIN` usage and allowing `super_admin` everywhere admin actions exist.
- Also updated Firestore `isAdmin()` to include `admin`.

2. Wrong self-registration paths for admin/agent/umuco UIs.
- Signup removed from login pages in those apps (login-only).

3. Missing provisioning callables for operating model.
- Added `provisionAdmin` (super_admin only).
- Added `provisionInstitutionUser` (admin/super_admin).

4. Leader assignment timing mismatch.
- `createGroup` no longer sets active leader flags.
- Leader flags and role now set at group approval stage.

5. Navigation gaps preventing role actions from being discoverable.
- Added dashboard links/routes for admin/institution provisioning.
- Added member “Request New Group” route.

#### Remaining (non-blocking for this role model alignment)
1. Some exported callables are not yet wired in UI (`approveJoinRequest`, `resetPIN`, `submitBatch`, `disburseLoan`, `recordRepayment`, etc.).
- Backend exists; dedicated UI coverage is partial by design stage.

## Phase 2 Implemented Fixes

### Files Changed (Role Alignment)

#### Backend
- `functions/src/constants.js`
- `functions/src/members.js`
- `functions/src/agents.js`
- `functions/src/savings.js`
- `functions/src/loans.js`
- `functions/src/groups.js`
- `functions/src/reconciliation.js`
- `functions/index.js`
- `firestore.rules`

#### Admin App
- `apps/admin/src/App.jsx`
- `apps/admin/src/features/Admin/AdminDashboardScreen.jsx`
- `apps/admin/src/features/Admin/CreateAdminScreen.jsx` (new)
- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx` (new)
- `apps/admin/src/pages/LoginPage.jsx`

#### Member App
- `apps/member/src/App.jsx`
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/member/src/features/Groups/CreateGroupScreen.jsx` (new)

#### Agent/Umuco Apps
- `apps/agent/src/App.jsx`
- `apps/agent/src/pages/LoginPage.jsx`
- `apps/umuco/src/App.jsx`
- `apps/umuco/src/pages/LoginPage.jsx`

## Verification Matrix (Emulator)

### Test Accounts to Prepare
1. `super_admin` account (bootstrap claim)
2. `admin` account (created by `provisionAdmin`)
3. `institution staff` account (created by `provisionInstitutionUser`)
4. `agent` account (created by `provisionAgent`)
5. `member` account (self-registered)

### Must-Pass Flows

1. super_admin parity
- Sign in as `super_admin` in admin app.
- Confirm access to approvals, agent provisioning, assignment, reconciliations, deposits.
- Expected: no “Insufficient permissions” for admin-equivalent actions.

2. admin creation governance
- As `super_admin`, call Create Admin UI.
- Sign in with new admin account.
- As `admin`, attempt Create Admin.
- Expected: denied on `provisionAdmin` (super_admin only).

3. institution user governance
- As `admin`, create institution user.
- Sign in via `apps/umuco`.
- Expected: access granted to `/umuco/home`, `/umuco/batches`, `/umuco/history`.

4. self-registration disabled where required
- Open admin/agent/umuco login pages.
- Expected: no signup/self-register controls.

5. member group-to-leader lifecycle
- As member, request group from `/app/group/create`.
- As admin/super_admin, approve group from `/admin/approvals`.
- Refresh member token/sign in again.
- Expected: member receives leader claim/role after approval (not before).

6. role-app gating
- Try logging each role into wrong app shell.
- Expected: Access Restricted / Account Pending gates trigger, with sign-out path.

## Callable UI Coverage Snapshot

### Used by UI now
`adminApproveDeposits`, `adminUpdateReconciliation`, `approveGroup`, `approveMember`, `assignAgentToGroup`, `closeAgentDay`, `confirmBatch`, `createGroup`, `flagBatch`, `getBatchesForGroup`, `getGroupMembers`, `getPendingApprovals`, `initiateGroupSplit`, `joinGroupByInviteCode`, `provisionAdmin`, `provisionAgent`, `provisionInstitutionUser`, `recordDeposit`, `recordWithdrawal`, `rejectMember`, `requestLoan`.

### Exported but not wired in current UI
`registerMember`, `joinGroup`, `approveJoinRequest`, `resetPIN`, `submitBatch`, `getAgentLedger`, `disburseLoan`, `recordRepayment`, `getMemberLoans`, `getLoansByGroup`, `adminSetGroupBorrowPause`, `requestSettlement`, `approveSettlement`, `markSettlementPaid`.

