# LEADER_PERMISSIONS_AUDIT_REPORT

## 1) Leader action read trace

All current leader actions route to `apps/member/src/features/Groups/GroupManageScreen.jsx`:
- `View Group Code` → `/app/group/manage#group-code`
- `Manage Group` → `/app/group/manage`
- `View Pending Join Requests` → `/app/group/manage#pending-requests`
- `Split Group` → `/app/group/manage#split-group`

### Screen-level read map

| Screen/action | Read/call path | Direct Firestore or Callable | Rule/guard applied |
|---|---|---|---|
| Group resolve (load) | `groupMembers/{uid}` (`getDoc`, line 40) | Direct Firestore | `match /groupMembers/{memberId}` allow read if owner/admin/agent/leader (`firestore.rules:72-75`) |
| Group resolve fallback | `users/{uid}` (`getDoc`, line 46) | Direct Firestore | `match /users/{userId}` allow read if owner/admin/agent (`firestore.rules:39-42`) |
| Group load | `groups/{groupId}` (`getDoc`, line 114) | Direct Firestore | `match /groups/{groupId}` allow read if admin/agent/umuco OR membership via `groupMembers/{uid}` (`firestore.rules:54-63`) |
| Pending requests list | `groups/{groupId}/joinRequests` (`getDocs`, lines 60/64) | Direct Firestore | `match /groups/{groupId}/joinRequests/{joinRequestId}` allow read only admin or `isLeader()` (`firestore.rules:66-69`) |
| Requester profile enrichment | `users/{requesterId}` (`getDoc`, line 75) | Direct Firestore | `users` rule does **not** allow leader to read other users (`firestore.rules:39-42`) |
| Group members list | `getGroupMembers({ groupId })` (line 123) | Callable | Backend guard `requireRole(...leader...)` (`functions/src/members.js:717-752`) |
| Approve join request | `approveJoinRequest(...)` (line 148) | Callable | Backend guard `requireRole(...leader...)` (`functions/src/members.js:502`) |
| Split group | `initiateGroupSplit(...)` (line 170) | Callable | Backend guard `requireRole(...leader...)` (`functions/src/members.js:754`) |

## 2) Claim state trace

### Backend claim write
- `approveGroup` sets leader claim at `functions/src/members.js:418-420`:
  - `await auth.setCustomUserClaims(leaderId, { role: ROLES.LEADER });`

### Client claim refresh behavior
- Member app refreshes token only on auth-state change (`apps/member/src/App.jsx:30-66` via `getIdTokenResult(true)` once per auth event).
- There is no explicit refresh in `GroupManageScreen` before leader-only Firestore reads/callables.

### UI leader gating vs auth source
- Leader menu visibility comes from `role` prop in `MemberHomeScreen` (`apps/member/src/features/Home/MemberHomeScreen.jsx:35,107`), where `role` is computed as `claimRole || firestoreRole` in `App.jsx:54`.
- This means leader UI can appear based on Firestore role fallback when claim is stale/unavailable.

## 3) Root cause

### Primary failure path (exact)
1. `GroupManageScreen` resolves `groupId` from fallback `users/{uid}.groupId || ledGroupId` (`line 49`) when `groupMembers/{uid}` is missing.
2. It then reads `groups/{groupId}` (`line 114`).
3. Firestore rule for `groups` (`firestore.rules:54-63`) does **not** allow leader-by-leaderId. It requires either:
   - admin/agent/umuco role, or
   - an existing `groupMembers/{uid}` doc matching that group.
4. If `groupMembers/{uid}` is missing/inconsistent, read is denied with `Missing or insufficient permissions.`

### Secondary mismatch (claim-dependent)
- `joinRequests` read (`firestore.rules:66-69`) requires `request.auth.token.role == leader`.
- If UI shows leader state from Firestore fallback but token claim is stale/non-leader, pending-requests reads fail.

### Direct answer to requested questions
1. **Which exact read is failing?**
   - Primary: `getDoc(doc(db, "groups", groupId))` in `GroupManageScreen` line 114 when `groupMembers/{uid}` is absent/mismatched.
2. **Which exact rule denies it?**
   - `firestore.rules` `match /groups/{groupId}` allow-read condition (`lines 55-63`).
3. **Issue category?**
   - Primary: rule + data-link mismatch (group read depends on membership doc, not leader ownership).
   - Secondary: stale token claim can deny `joinRequests` because that rule is claim-based.

## 4) Minimal recommended fix sequence

1. **Repair data first (no model redesign)**
- Run leader linkage backfill so legacy leaders have `groupMembers/{uid}` aligned to `ledGroupId`.
- This directly satisfies current `groups` read rule dependency.

2. **Tight rule alignment for leader-owned group reads**
- Update only `groups` read rule to allow leader ownership by group document itself, e.g. add condition equivalent to:
  - `isLeader() && resource.data.leaderId == request.auth.uid`
- Keep existing membership-based access intact.

3. **Claim/UI alignment hardening (minimal)**
- Before loading leader-only pending requests/callables, refresh ID token once in `GroupManageScreen` (or gate pending-requests section on confirmed claim leader).
- This prevents Firestore `joinRequests` and leader callables from failing when claim lags.

## 5) Notes on noisy but non-fatal denials
- `GroupManageScreen` tries to read `users/{requesterId}` for each pending request (`line 75`), but rules disallow leader reading arbitrary user profiles.
- This is currently swallowed by local `try/catch`, so it does not cause the top-level screen failure, but it can generate permission errors in console/logs.
