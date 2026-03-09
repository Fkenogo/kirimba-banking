# MEMBER_GROUP_UX_POLISH_REPORT

## Files Changed
- `functions/src/members.js`
- `apps/member/src/features/Groups/GroupPendingRequestsScreen.jsx`
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/member/src/features/Groups/MyGroupScreen.jsx` (new)
- `apps/member/src/App.jsx`

## Pending Join Request Display Cleanup
Requester identity in leader pending-request rows is now resolved in this order:
1. `fullName`
2. `name`
3. `phone`
4. `memberId`
5. `uid` (last fallback only)

Implementation details:
- Backend join-request writes now include `fullName`, `name`, `phone`, and `memberId` for both:
  - `joinGroup`
  - `joinGroupByInviteCode`
- Frontend pending-request screen now uses these fields as primary identity data, with user profile read only as a legacy fallback.
- Row UI now renders:
  - primary label: best available member identity
  - secondary label: phone or `Member ID: ...` (or uid fallback)

## "My Group" Dashboard Entry
`My Group` now appears on the member dashboard only when a valid group linkage is resolved for the signed-in user.

Resolution logic:
- Uses existing `resolveCurrentGroupId(db, user.uid)` helper.
- This checks `groupMembers/{uid}` first, then falls back to `users/{uid}.groupId` / `users/{uid}.ledGroupId`.

If no group is resolved, `My Group` is hidden.

## Member-Facing Group Summary
Added a new read-only screen at route:
- `/app/group/my`

Screen content:
- group name
- status
- member count
- institution
- total savings

Behavior notes:
- No leader-only controls are included.
- Leaders still use separate leader modules (`group/code`, `group/manage`, `group/pending-requests`, `group/split`).

## Build Verification
- Ran member app build successfully:
  - `cd apps/member && npm run build`
