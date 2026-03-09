# MEMBER_STATE_ALIGNMENT_IMPLEMENTATION_REPORT

## Summary
Implemented the minimal state-alignment sequence from `MEMBER_STATE_MODEL_AUDIT_REPORT.md` without adding new flows.

## Files changed
- `apps/member/src/App.jsx`
- `functions/src/members.js`
- `apps/member/src/features/Groups/GroupManageScreen.jsx`
- `apps/member/src/features/Dashboard/MemberDashboardScreen.jsx`
- `apps/member/src/features/Dashboard/SavingsDashboardScreen.jsx`
- `scripts/backfill-leader-group-links.js` (new)

## Exact fixes implemented

### 1) Member app access gate tightened to active-only
- File: `apps/member/src/App.jsx`
- Change:
  - `canAccessMemberApp` now requires `profileStatus === "active"`.
  - Role (`member`/`leader`) alone no longer grants access.
  - Pending users (`pending_approval`) are blocked from dashboard routes.

### 2) `requireActiveMember` resilient to claim lag
- File: `functions/src/members.js`
- Function: `requireActiveMember`
- Change:
  - Reads Firestore user profile before member-role decision.
  - Accepts member eligibility when either token claim role OR Firestore role is `member`/`leader`.
  - Still requires Firestore `status === "active"`.
- Result:
  - Active approved members/leaders are not rejected solely due stale/missing claim role.

### 3) Atomic leader-group linkage in `approveGroup`
- File: `functions/src/members.js`
- Function: `approveGroup`
- Change:
  - Moved approval writes into a Firestore transaction.
  - On leader promotion, writes:
    - `users/{leaderId}.role = leader`
    - `users/{leaderId}.status = active`
    - `users/{leaderId}.groupId = groupId`
    - `users/{leaderId}.ledGroupId = groupId`
    - `users/{leaderId}.isLeader = true`
    - merge `groupMembers/{leaderId}` with `userId`, `groupId`, `joinedAt`, `isActive`.
  - If `groupMembers/{leaderId}` did not exist, increments `groups/{groupId}.memberCount` once.
  - Keeps claim promotion: `setCustomUserClaims(leaderId, { role: "leader" })`.

### 4) Defensive leader group lookup fallback
- Files:
  - `apps/member/src/features/Groups/GroupManageScreen.jsx`
  - `apps/member/src/features/Dashboard/MemberDashboardScreen.jsx`
  - `apps/member/src/features/Dashboard/SavingsDashboardScreen.jsx`
- Change:
  - Primary lookup remains `groupMembers/{uid}`.
  - If missing, fallback to `users/{uid}.groupId || users/{uid}.ledGroupId`.
- Result:
  - Leader screens no longer fail immediately when old records are missing `groupMembers`.

### 5) Legacy backfill script
- New file: `scripts/backfill-leader-group-links.js`
- Behavior:
  - Finds `users` with `role == "leader"` and non-empty `ledGroupId`.
  - Sets `users/{uid}.groupId = ledGroupId` when missing.
  - Creates missing `groupMembers/{uid}` with `{ userId, groupId, joinedAt, isActive }`.
  - Prints per-user actions + summary counts.
  - Supports dry run by default; use `--apply` to persist.

## Deploy command used
```bash
firebase deploy --only functions:approveGroup,functions:setMemberInstitution,functions:createGroup,functions:joinGroup,functions:joinGroupByInviteCode --project kirimba-banking
```

## Deployment result
- Successful updates:
  - `approveGroup(us-central1)`
  - `setMemberInstitution(us-central1)`
  - `createGroup(us-central1)`
  - `joinGroup(us-central1)`
  - `joinGroupByInviteCode(us-central1)`

## Backfill script path
- `scripts/backfill-leader-group-links.js`

## Verification steps
1. Pending gate check
- Register a new member and log in before approval.
- Expected: app shows pending/access-not-ready state; no dashboard access.

2. Institution selection with stale claim scenario
- Approve member in Firestore (`status=active`, role member) and test sign-in.
- Call `setMemberInstitution` from member UI.
- Expected: succeeds when profile role/status are valid even if claim refresh lags.

3. Leader linkage on group approval
- Active member selects institution and creates group.
- Admin approves group.
- Expected Firestore immediately after approval:
  - `users/{leaderId}.role=leader`
  - `users/{leaderId}.groupId=<groupId>`
  - `users/{leaderId}.ledGroupId=<groupId>`
  - `groupMembers/{leaderId}` exists with same `groupId`.

4. Leader UI/actions runtime
- Leader signs in and opens `Manage Group`, `View Group Code`, `Pending Join Requests`.
- Expected: no `"You are not in a group."` for properly linked leader.

5. Legacy repair
- Run dry run:
  - `node scripts/backfill-leader-group-links.js`
- Apply:
  - `node scripts/backfill-leader-group-links.js --apply`
- Re-test legacy leader accounts on group management screens.
