# GROUP_APPROVAL_ALIGNMENT_REPORT

## Root cause: `umucoAccountNo` error on group approval
Primary cause: **live deployment drift**.

- Current source `approveGroup` accepts only `groupId`.
- Live function had older contract still requiring `umucoAccountNo`, which caused:
  - `invalid-argument: groupId and umucoAccountNo are required`

This mismatch happened because admin UI was already updated to the new member-driven institution flow, but backend callable was still stale in production.

## Root cause: pending groups showing `Created —`
Two contributing causes were addressed:

1. Existing pending group docs can lack `createdAt` (legacy/stale create path).
2. Admin UI date formatter did not parse serialized Firestore timestamp object shapes (`seconds/_seconds`), so valid values could still render as missing.

## Files changed
- `functions/src/members.js`
  - `getPendingApprovals` now returns:
    - `createdAt: data.createdAt || snap.createTime || null`
    - for both pending members and pending groups
- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx`
  - `toValidDate` now supports serialized timestamp objects:
    - `{ seconds, nanoseconds }`
    - `{ _seconds, _nanoseconds }`

## Deploy command used
```bash
firebase deploy --only functions:approveGroup,functions:createGroup,functions:getPendingApprovals --project kirimba-banking
```

Deployment result:
- `approveGroup(us-central1)` updated successfully
- `createGroup(us-central1)` updated successfully
- `getPendingApprovals(us-central1)` updated successfully

## Phase checks
1. `approveGroup` source contract:
- Confirmed: only `groupId` required in current source.

2. Live deployment staleness:
- Confirmed by runtime behavior before deploy (`umucoAccountNo` validation error).
- Resolved by function update deploy above.

3. `createGroup` writes `createdAt`:
- Confirmed source writes `createdAt: FieldValue.serverTimestamp()`.

4. Approvals UI group date field:
- Uses `group.createdAt` and now correctly parses timestamp object variants.

## Final expected group approval flow
1. Member selects institution (member-side flow).
2. Member requests group creation.
3. Group is created in pending state with `createdAt` set.
4. Admin approves group by sending **only `groupId`**.
5. No admin-side institution account assignment is required.
6. Pending groups list shows real created date when available, and `Created —` only when truly unavailable.
