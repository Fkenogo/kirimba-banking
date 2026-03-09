# LEADER_JOIN_ALIGNMENT_REPORT

## Files changed
- `apps/member/src/App.jsx`
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/member/src/features/Groups/JoinGroupScreen.jsx`
- `apps/member/src/features/Groups/GroupManageScreen.jsx`

## Leader actions added
Leader users now remain in the member app and get explicit leader tools on Home:
- **View Group Code** (`/app/group/manage#group-code`)
- **Manage Group** (`/app/group/manage`)
- **View Pending Join Requests** (`/app/group/manage#pending-requests`)
- **Split Group** (`/app/group/manage#split-group`)

Implementation details:
- `App.jsx` now passes `role` into `MemberHomeScreen`.
- `MemberHomeScreen.jsx` renders a leader-only **Leader Actions** section when `role === "leader"`.

## Join method changes
Group join was aligned to code-first language while keeping backend compatibility:
- In `JoinGroupScreen.jsx`, user-facing wording changed from invite-link/invite-centric wording to **group code** wording:
  - "Enter a group code to join"
  - "Group Code"
  - "Ask your group leader to share the group code"
- Backend callable is unchanged (`joinGroupByInviteCode`) for compatibility; UI now treats it as group-code entry.

## Additional leader flow alignment
`GroupManageScreen.jsx` was enhanced for leader operations without backend redesign:
- Group code card text changed to code-first wording:
  - "Group Code"
  - "Share this group code with members"
- Added a **Pending Join Requests** panel for leaders:
  - Reads `groups/{groupId}/joinRequests` (pending)
  - Enriches with requester profile data where available
  - Approve action wired to existing callable `approveJoinRequest`
- Split section remains in place and is leader-only.

## Backward compatibility
- Existing backend invite-code field/callable usage remains intact.
- No link-based backend flow was removed.
- UI emphasis is now code-first; legacy internals are preserved.

## Final recommended primary group onboarding flow
1. Member requests new group.
2. Admin approves group.
3. Member becomes leader and sees leader tools in member app.
4. Leader shares short **group code** verbally/physically with members.
5. Members join by entering the group code in Join Group screen.
6. Leader reviews pending join requests (if used) and approves from Manage Group.
7. Leader uses Split Group when group size grows.

## Verification
- Member app build completed successfully after changes (`npm run build` in `apps/member`).
