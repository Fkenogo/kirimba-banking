# LEADER_JOIN_FLOW_RESTORE_REPORT

## Root cause of direct join
- `joinGroupByInviteCode` in `functions/src/members.js` was writing membership immediately:
  - created `groupMembers/{uid}`
  - wrote `users/{uid}.groupId`
  - incremented `groups.memberCount`
- This bypassed leader approval and skipped pending-review semantics.

## Files changed

### Backend
- `functions/src/members.js`
- `functions/index.js`

### Member app
- `apps/member/src/App.jsx`
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/member/src/features/Groups/JoinGroupScreen.jsx`
- `apps/member/src/features/Groups/GroupManageScreen.jsx`
- `apps/member/src/features/Groups/GroupCodeScreen.jsx` (new)
- `apps/member/src/features/Groups/GroupPendingRequestsScreen.jsx` (new)
- `apps/member/src/features/Groups/GroupSplitScreen.jsx` (new)
- `apps/member/src/features/Groups/leaderGroupAccess.js` (new)

## Join flow fix implemented

### `joinGroupByInviteCode` (restored approval model)
Now it:
1. validates member + institution + group
2. creates/updates `groups/{groupId}/joinRequests/{uid}` with `status: pending`
3. creates `join_request` notification for leader
4. returns pending response (`status: pending`, group/leader info)

It no longer directly writes:
- `groupMembers/{uid}`
- `users/{uid}.groupId`
- `groups.memberCount`

### Finalization remains in `approveJoinRequest`
Membership is finalized only there:
- writes `groupMembers/{uid}`
- writes `users/{uid}.groupId`
- increments `groups.memberCount` when appropriate

### Added `rejectJoinRequest`
- New callable for leader rejection flow.
- Pending requests screen now has functional `Approve` and `Reject` controls.

## Leader modules/routes separation

Old behavior:
- All leader actions routed to one hash-based screen (`/app/group/manage#...`).

New mapping:
- `View Group Code` → `/app/group/code` → `GroupCodeScreen`
- `Manage Group` → `/app/group/manage` → `GroupManageScreen`
- `View Pending Join Requests` → `/app/group/pending-requests` → `GroupPendingRequestsScreen`
- `Split Group` → `/app/group/split` → `GroupSplitScreen`

Each route now renders distinct content and purpose-specific logic.

## Final join-request lifecycle
1. Member enters valid group code in `JoinGroupScreen`.
2. App calls `joinGroupByInviteCode`.
3. Backend creates pending join request only.
4. Member sees: request submitted, awaiting leader approval.
5. Leader opens Pending Join Requests module.
6. Leader approves request via `approveJoinRequest`.
7. Only then member is added to group membership and appears as joined.

## Deploy/build commands used

### Functions
```bash
firebase deploy --only functions:joinGroupByInviteCode,functions:rejectJoinRequest --project kirimba-banking
```

### Member app build
```bash
cd apps/member && npm run build
```

## Verification steps
1. Sign in as member not in a group.
2. Enter valid group code and submit.
3. Confirm member does **not** immediately appear in `groupMembers` and has no `users.groupId` set.
4. Confirm `groups/{groupId}/joinRequests/{uid}` exists with `status: pending`.
5. Sign in as leader and open `/app/group/pending-requests`.
6. Approve request.
7. Confirm membership finalization occurs only after approval:
   - `groupMembers/{uid}` exists
   - `users/{uid}.groupId` set
   - `groups.memberCount` updated
8. Visit each leader route and confirm distinct module content:
   - `/app/group/code`
   - `/app/group/manage`
   - `/app/group/pending-requests`
   - `/app/group/split`
