# PENDING_APPROVALS_FIX_REPORT

## Exact Root Cause

`getPendingApprovals` was returning generic `INTERNAL` in practice because backend errors from Firestore queries were not normalized into `HttpsError` codes.

- The callable executed raw Firestore query/mapping logic without a protective `try/catch` that preserves actionable error codes.
- When a non-`HttpsError` exception occurs in callable execution, client often receives a generic internal error.
- On frontend, this showed as `INTERNAL` and blocked approval list rendering.

A second instability was present in frontend:
- `ApprovalsScreen` performed additional client-side leader profile fetches after callable response.
- Any failure in that extra fetch path could also fail the load path even when callable data was otherwise valid.

## Files Changed

- `functions/src/members.js`
  - Hardened `getPendingApprovals`:
    - Added guarded `try/catch` with error-code preservation (`permission-denied`, `invalid-argument`, `failed-precondition`).
    - Returns stable arrays even when empty.
    - Added tolerant field fallbacks for missing optional fields.
    - Added stable response keys: `pendingMembers`, `pendingGroups`.
    - Kept compatibility keys: `users`, `groups`.

- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx`
  - Parses new stable keys with fallback to old keys.
  - Removed fragile extra Firestore leader lookup dependency.
  - Uses backend error details/message when available instead of generic `INTERNAL`.

## Actual Member Doc Shape Found (Self-Registration)

From current `registerMember` write path, a pending member user doc includes:
- `uid`
- `fullName`
- `phone`
- `email` (optional, nullable)
- `nationalId` (optional)
- `role` (`member`)
- `status` (`pending_approval`)
- `groupId`
- `isLeader`
- `ledGroupId`
- `pinHash`
- `groupCodeToJoin` (optional)
- `createdAt`
- `approvedAt`

## Expected Callable Response Shape

`getPendingApprovals` now returns a stable shape:

```json
{
  "success": true,
  "pendingMembers": [],
  "pendingGroups": [],
  "users": [],
  "groups": []
}
```

Field fallbacks now prevent throws from partial docs:
- Member name: `fullName -> name -> email -> uid`
- Member phone: fallback `""`
- Member createdAt: fallback `null`
- Group name: `name -> groupName -> "Group <id>"`
- Group leaderName: optional/fallback to leaderId
- Group createdAt: fallback `null`

## Verification Steps

1. Create a new member via self-registration (pending state).
2. Login as admin/super_admin and open `/admin/approvals`.
3. Confirm screen loads without `INTERNAL` and shows pending member list.
4. Confirm empty-state behavior:
   - with no pending users/groups, UI shows "No pending members/groups" (not error).
5. Approve member:
   - member is removed from pending list.
6. Reject member:
   - member is removed from pending list.
7. Approve group with `umucoAccountNo`:
   - group is removed from pending list.
8. Force an intentional backend error (e.g., insufficient role):
   - UI shows backend message/details rather than generic `INTERNAL`.
