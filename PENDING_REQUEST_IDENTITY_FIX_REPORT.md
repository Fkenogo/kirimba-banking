# PENDING_REQUEST_IDENTITY_FIX_REPORT

## Root Cause
The remaining UID row is caused by **missing identity fields on that specific pending join-request document** combined with Firestore rule constraints:

- `GroupPendingRequestsScreen` first reads identity from join-request doc fields (`fullName`, `name`, `phone`, `memberId`).
- For legacy rows with those fields missing, it attempts fallback profile read from `/users/{uid}`.
- Current Firestore rules do **not** allow leaders to read arbitrary `/users/{uid}` docs (`users` reads are owner/admin/agent only), so fallback profile reads can fail.
- Result: the row can degrade to UID fallback when request doc identity is absent.

This indicates the affected row is legacy data (created before identity fields were persisted) or was created by an older deployed function version.

## Live Request Doc Inspection
Direct server-side Firestore inspection from this shell was blocked because Application Default Credentials were unavailable (`Could not load the default credentials`).

Given the above rule behavior and UI code path, a visible raw UID row implies the request doc did not provide usable identity fields at render time.

## Deployment Verification
Deployed latest callable implementations that persist identity fields on join-request creation:

- `joinGroup`
- `joinGroupByInviteCode`

Deploy command used:

```bash
firebase deploy --only functions:joinGroup,functions:joinGroupByInviteCode --project kirimba-banking
```

Deployment logs confirm successful update operations on both functions in `us-central1`.

## Files Changed
- `apps/member/src/features/Groups/GroupPendingRequestsScreen.jsx`

No backend source change was needed in this task for field mapping; backend writes were already present and were deployed.

## UI Hardening Applied
To eliminate raw UID leakage in the leader UI even for legacy rows:

- Primary label now falls back to `Pending member` instead of raw UID.
- Secondary fallback uses a **masked UID** form (`UID: abcd…wxyz`) only when no better identity exists.

Identity resolution order remains:
1. `fullName`
2. `name`
3. `phone`
4. `memberId`
5. fallback placeholder/masked UID metadata

## Final Expected Display Behavior
- New join requests (from current deployed functions) should display readable member identity from the request doc.
- Legacy requests missing identity fields will no longer show raw UID as the primary label.
- If a legacy request has no profile data available to leader due rules, it will display `Pending member` with masked UID metadata.
