# LEADER_PERMISSIONS_FIX_REPORT

## Files changed
- `firestore.rules`
- `apps/member/src/features/Groups/GroupManageScreen.jsx`

## Exact rule change made
File: `firestore.rules`

In `match /groups/{groupId}` read rule, added a minimal leader-owned-group condition while preserving existing access paths:

```rules
(
  isLeader() &&
  resource.data.leaderId == request.auth.uid
)
```

Final groups read logic now allows read when signed-in user is:
- admin, or
- agent, or
- umuco, or
- leader of that group (`resource.data.leaderId == request.auth.uid`), or
- linked via `groupMembers/{uid}.groupId == groupId`.

No broad rule loosening was added.

## GroupManageScreen claim-alignment hardening
File: `apps/member/src/features/Groups/GroupManageScreen.jsx`

Implemented minimal claim sync guard:
1. Added `ensureLeaderClaim()` which refreshes ID token once via `user.getIdTokenResult(true)` and caches result.
2. Before leader-only reads/callables:
   - `getGroupMembers`
   - pending join requests loading
   - `approveJoinRequest`
   - `initiateGroupSplit`
   the screen now verifies leader claim first.
3. Leader-only pending-request section now renders only when claim is checked and confirmed leader.
4. Existing fallback group resolution (`groupMembers` -> `users.groupId/ledGroupId`) was kept unchanged.

## Backfill status (leader linkage)
Backfill script used: `scripts/backfill-leader-group-links.js`

Attempted runs:
1. `node scripts/backfill-leader-group-links.js`
   - Failed: project ID not detected in environment.
2. `GOOGLE_CLOUD_PROJECT=kirimba-banking node scripts/backfill-leader-group-links.js`
   - Failed: default credentials unavailable in current shell (`Could not load the default credentials`).

What this means:
- Backfill script is ready and unchanged.
- It could not be executed in this environment because Admin SDK ADC credentials are missing.

Run command once credentials are available:
```bash
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/service-account.json \
GOOGLE_CLOUD_PROJECT=kirimba-banking \
node scripts/backfill-leader-group-links.js --apply
```

## Deploy commands used
1. Firestore rules deploy:
```bash
firebase deploy --only firestore:rules --project kirimba-banking
```
Result: success (`cloud.firestore` rules released).

2. Member app build:
```bash
cd apps/member && npm run build
```
Result: success.

3. Functions deploy:
- Not required for this task (no backend function code changed).

## Verification steps
1. Sign in as leader account and open `/app/group/manage`.
2. Confirm group page loads without `Missing or insufficient permissions` on group read.
3. Confirm pending join requests section appears only after claim-confirmed leader state.
4. Trigger leader actions:
   - Approve join request
   - Split group
   and confirm they no longer fail due to stale non-leader claim in-session.
5. Run leader linkage backfill with valid ADC credentials, then retest legacy leaders lacking `groupMembers/{uid}`.
