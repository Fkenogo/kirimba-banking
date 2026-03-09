# MEMBER_INSTITUTION_SELECTION_REPORT

## Files changed
Backend:
- `functions/src/members.js`
- `functions/index.js`

Frontend (member app):
- `apps/member/src/App.jsx`
- `apps/member/src/features/Profile/InstitutionSelectionScreen.jsx` (new)
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/member/src/features/Groups/CreateGroupScreen.jsx`
- `apps/member/src/features/Groups/JoinGroupScreen.jsx`

Frontend (admin app):
- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx`

## Final institution selection flow
1. Member is approved (existing flow unchanged).
2. Member opens **Select Institution** in member app.
3. Member selects institution (currently only **Umuco**) and saves.
4. Member can then create a group or join a group.
5. Group approval by admin no longer asks for institution account reference.

## Data fields used
- `users/{uid}.institutionId`
  - Set via new callable: `setMemberInstitution`
  - Current supported value: `"umuco"`
- `groups/{groupId}.institutionId`
  - Set at group creation from leader's selected member institution

Legacy/backward compatibility:
- `groups.umucoAccountNo` is left in existing documents/code paths for compatibility, but admin approval no longer requires it.
- Group join validation only enforces mismatch when group has `institutionId` set; legacy groups without `institutionId` are still joinable.

## Backend logic changes
- Added callable: `setMemberInstitution`
  - Requires active member/leader context
  - Validates institution against supported set (`umuco`)
  - Writes `users/{uid}.institutionId`
- `createGroup`
  - Now requires member institution to be selected
  - Group inherits `institutionId` from member profile
- `joinGroup` and `joinGroupByInviteCode`
  - Now require member institution selection first
  - Validate member institution matches group institution when group institution exists
- `approveJoinRequest`
  - Added member/group institution consistency check before final membership write
- `approveGroup`
  - Removed `umucoAccountNo` requirement; admin now approves group with `groupId` only

## Frontend changes
- Added member institution screen and route: `/app/institution`
- Added **Select Institution / Institution Selected** card on member home
- `CreateGroupScreen` and `JoinGroupScreen` now:
  - Load member profile institution
  - Block action when institution is not selected
  - Show clear prompt + shortcut to institution selection screen
- Admin group approvals screen now approves without institution-account prompt

## Test steps
1. Login as approved member with no `institutionId`.
2. Try `Join Group` and `Request New Group`:
   - Expected: blocked with instruction to select institution.
3. Open `/app/institution`, choose **Umuco**, save.
4. Retry `Request New Group`:
   - Expected: succeeds; new group doc has `institutionId: "umuco"`.
5. Admin opens `/admin/approvals` and approves pending group:
   - Expected: approval works with one click (no account reference input).
6. From another member account with `institutionId: "umuco"`, join group by code:
   - Expected: join succeeds.
7. Set a test member with different institution (future value) and attempt join:
   - Expected: blocked with institution mismatch message.

## Build verification
- `apps/member`: `npm run build` succeeded.
- `apps/admin`: `npm run build` succeeded.
