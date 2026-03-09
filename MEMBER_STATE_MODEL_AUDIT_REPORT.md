# MEMBER_STATE_MODEL_AUDIT_REPORT

## 1) Executive summary
- The three recurring issues come from one core mismatch: backend authorization trusts **custom token claims only**, while member UI access often trusts **Firestore profile fallback**.
- Pending-member dashboard access is currently possible because `apps/member/src/App.jsx` computes `canAccessMemberApp` as true when role is `member/leader`, even if profile `status` is `pending_approval`.
- `setMemberInstitution` fails with `"Member account required."` when a user is active in Firestore but token claim `role` is missing/stale/non-member, because `requireActiveMember` checks claims before Firestore profile.
- Leader promotion in `approveGroup` sets leader role/flags but does **not** link leader to group membership (`users.groupId` + `groupMembers/{uid}`), so leader tools that read membership fail with `"You are not in a group."`.
- Frontend leader UI in `MemberHomeScreen` is driven by app role state, but `GroupManageScreen`, `SavingsDashboardScreen`, and `MemberDashboardScreen` depend on `groupMembers/{uid}`; this split causes visible leader UI with broken actions.
- `approveJoinRequest` writes `groupMembers` + `users.groupId` for normal members, but `approveGroup` does not do equivalent writes for newly approved leaders.
- Token-claim drift is expected after role transitions; backend callables should not reject valid active users solely due claim lag if Firestore role/status is authoritative for member eligibility.
- Current source-of-truth usage is inconsistent across layers (claims for backend guards, mixed claim/profile in app bootstrap, membership doc for leader actions, profile `groupId` for QR).
- Minimal fix is a state alignment pass, not feature redesign: unify eligibility checks, enforce active status in app gate, and ensure leader-group linkage at group approval.
- Legacy data backfill is required for already-approved leaders missing `groupMembers/{uid}` and `users.groupId`.

## 2) Source-of-truth matrix

| Product state | Intended source of truth | Current code reads from | Contradiction |
|---|---|---|---|
| A. Can user access member app? | `users/{uid}.status === active` AND role in `{member, leader}` | `apps/member/src/App.jsx`: `role` (claims OR Firestore role fallback) + profile status | Access can be granted by role even when status is pending (`canAccessMemberApp` too permissive). |
| B. Can user save/select institution? | Active member/leader profile | `functions/src/members.js` `requireActiveMember`: token claim role first, then Firestore status | Active Firestore member can be rejected if claim role is stale/missing. |
| C. Is user in a group? | `groupMembers/{uid}.groupId` authoritative; mirrored to `users.groupId` | UI screens mostly read `groupMembers/{uid}`; QR reads `users.groupId`; join guards read `users.groupId` | Mixed reads allow divergence (`groupMembers` missing but `users.groupId` or `ledGroupId` present). |
| D. Is user a leader? | `users.role == leader` (and/or claim) plus `groups.leaderId == uid` | Backend critical ops use claim (`requireRole`), UI leader menu uses app role state | UI may show leader actions even when backend claim not synced. |
| E. Can leader use leader actions? | Leader must be group-linked + leader of that group | `GroupManageScreen` requires `groupMembers/{uid}` first, then checks `groups.leaderId` | Approved leaders without `groupMembers` fail immediately (`You are not in a group`). |

## 3) Lifecycle trace table

| Step | Expected Firestore state | Expected claim state | Actual backend writes | Actual frontend reads |
|---|---|---|---|---|
| 1. Member self-registers | `users/{uid}`: role=member, status=pending, groupId=null, isLeader=false, ledGroupId=null | none/unspecified until approval | `registerMember` writes pending profile; `onUserCreate` may also create minimal pending profile if race | App bootstrap reads profile + claim |
| 2. Signs in before approval | Access blocked (pending screen) | claim may be absent | no backend writes | `App.jsx` may allow access because `role` fallback/member role can satisfy `canAccessMemberApp` despite pending status |
| 3. Admin approves member | status->active, approvedAt set, memberId set | claim role=member | `approveMember` writes status/memberId/approvedAt + `setCustomUserClaims(member)` | App refresh gets claim; profile status active |
| 4. Signs in after approval | Full member access | claim member | no new writes | App allows access (correct) |
| 5. Member selects institution | `institutionId` saved | claim member/leader accepted | `setMemberInstitution` via `requireActiveMember`; writes `users.institutionId` | Screen calls callable; failures if claim missing/stale even when Firestore active |
| 6. Member requests group | `groups/{gid}` pending, leaderId=uid, institutionId from member; user marked proposedLeaderForGroupId | claim still member | `createGroup` writes pending group, sets `users.proposedLeaderForGroupId`, does not set `groupMembers` | Home screen still member until approval |
| 7. Admin approves group | group status active | claim should become leader | `approveGroup` sets group active + user role/isLeader/ledGroupId + leader claim | No leader membership linkage written (`users.groupId` remains null; no `groupMembers/{uid}`) |
| 8. Member becomes leader | Should be leader and in own group | claim leader | actual writes omit `users.groupId` + `groupMembers` | Home can show leader UI via role; data screens relying on membership fail |
| 9. Leader opens manage/group-code/pending-requests | Should resolve group and allow actions | claim leader | no writes | `GroupManageScreen` first loads `groupMembers/{uid}`; missing doc -> `You are not in a group.` |

## 4) Root causes found

### RC-1: Pending user access gate is logically too permissive (security)
- **Where**: `apps/member/src/App.jsx` (`canAccessMemberApp` calculation).
- **What**: `const canAccessMemberApp = hasAllowedRole || (isActiveProfile && hasAllowedProfileRole);`
- **Why it fails**: `hasAllowedRole` can be true from claim or Firestore fallback role `member` while status is still `pending_approval`.
- **Impact**: Pending users can sometimes enter member dashboard/features before approval.

### RC-2: `setMemberInstitution` eligibility rejects valid active users with claim drift
- **Where**: `functions/src/members.js` `requireActiveMember`.
- **What**: Role check is token-claim-only (`context.auth.token.role` must be member/leader) before reading Firestore user profile.
- **Why it fails**: Active Firestore member/leader with stale/missing claim gets `permission-denied: Member account required.`
- **Impact**: Institution selection intermittently fails for valid users.

### RC-3: Leader promotion misses group membership linkage
- **Where**: `functions/src/members.js` `approveGroup`.
- **What**: Writes leader role flags (`role`, `isLeader`, `ledGroupId`) and claim, but does not create `groupMembers/{leaderUid}` or set `users.groupId`.
- **Why it fails**: Leader screens (`GroupManageScreen`, savings/group dashboards) treat `groupMembers/{uid}` as membership source.
- **Impact**: Leader sees leader UI but leader actions fail with `You are not in a group.`

### RC-4: Mixed group linkage reads across UI
- **Where**: `GroupManageScreen`/dashboards read `groupMembers`; `MyQRCodeScreen` reads `users.groupId`; join guards read `users.groupId`.
- **Why it fails**: When one linkage field is missing, behavior diverges by screen.
- **Impact**: Inconsistent runtime behavior and hard-to-debug regressions.

## 5) Minimal fix sequence (ordered, no redesign)

1. Tighten member-app access gate to active-only
- **Files**: `apps/member/src/App.jsx`
- **Change**: require profile status `active` for app access; pending always blocked regardless of role fallback.
- **Acceptance**: pending user cannot reach `/app/home` or dashboard after fresh login.

2. Make `requireActiveMember` resilient to claim lag (member/leader from profile)
- **Files**: `functions/src/members.js`
- **Change**: in `requireActiveMember`, read Firestore profile first (or alongside claims) and allow when profile role is `member/leader` and status is `active`; keep unauthenticated/permission semantics clear.
- **Acceptance**: active approved member can call `setMemberInstitution` even if claim temporarily stale.

3. Link leader to group atomically during `approveGroup`
- **Files**: `functions/src/members.js`
- **Change**: when approving group, write `users/{leaderId}.groupId = groupId` and create/merge `groupMembers/{leaderId}` with `{ userId, groupId, joinedAt, isActive }` in a transaction/batch with group/user updates.
- **Acceptance**: immediately after approval, leader can open manage group, view group code, pending requests.

4. Add guard to avoid double memberCount increment for leader bootstrap
- **Files**: `functions/src/members.js` (`approveGroup`)
- **Change**: set `group.memberCount` to at least 1 for leader bootstrap or increment only if leader membership doc newly created.
- **Acceptance**: member count consistent after repeated retries.

5. Standardize UI group lookup fallback for leader flows
- **Files**: `apps/member/src/features/Groups/GroupManageScreen.jsx`, optionally dashboards
- **Change**: if `groupMembers/{uid}` missing and profile has `ledGroupId`/`groupId`, resolve group by that value (defensive fallback); keep backend fix as primary.
- **Acceptance**: legacy leaders without immediate backfill still access group manage until data repair completes.

6. Ensure claim refresh after role transitions (operational)
- **Files**: member app auth bootstrap/service
- **Change**: keep forced token refresh on auth state; optionally trigger reauth hint after admin-side approval events.
- **Acceptance**: leader-only callables don’t fail due to long-lived stale token after promotion.

## 6) Legacy data cleanup/backfill needed

1. Leader linkage backfill
- For users where `users.role == leader` and `ledGroupId` exists:
  - ensure `users.groupId = ledGroupId`
  - ensure `groupMembers/{uid}` exists with that group
- Recompute/normalize `groups.memberCount` if needed.

2. Active member claim consistency audit
- Identify users with Firestore role/status active but missing/incorrect claims.
- Reapply claims for `member`/`leader` in admin script or one-off function.

3. Pending-access verification set
- Validate no `pending_approval` user can pass member app gate after deploy.

---

## Exact file/function references audited
- `functions/src/members.js`
  - `requireActiveMember`
  - `approveMember`
  - `setMemberInstitution`
  - `createGroup`
  - `approveGroup`
  - `joinGroup`
  - `joinGroupByInviteCode`
  - `approveJoinRequest`
- `functions/index.js`
  - `onUserCreate`
- `apps/member/src/App.jsx`
  - auth bootstrap + route gating
- `apps/member/src/features/Profile/InstitutionSelectionScreen.jsx`
- `apps/member/src/features/Groups/GroupManageScreen.jsx`
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/member/src/features/Dashboard/MemberDashboardScreen.jsx`
- `apps/member/src/features/Dashboard/SavingsDashboardScreen.jsx`
- `apps/member/src/features/Profile/MyQRCodeScreen.jsx`
