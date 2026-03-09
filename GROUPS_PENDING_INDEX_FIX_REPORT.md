# GROUPS_PENDING_INDEX_FIX_REPORT

## Exact query requiring the index
From `functions/src/members.js` (`getPendingApprovals`):

```js
const groupsSnap = await db
  .collection("groups")
  .where("status", "==", GROUP_STATUS.PENDING_APPROVAL)
  .orderBy("createdAt", "asc")
  .get();
```

This query shape requires a composite index on `groups(status, createdAt)`.

## Exact index added
Added to `firestore.indexes.json`:

```json
{
  "collectionGroup": "groups",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "status", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "ASCENDING" }
  ]
}
```

## Deploy command used
```bash
firebase deploy --only firestore:indexes --project kirimba-banking
```

Deployment completed successfully for Firestore indexes.

## Notes during deployment
- Initial deploy attempt failed because an existing, unrelated composite entry for `notifications(expiresAt)` is invalid as a composite (single-field config only).
- That invalid composite entry was removed from `firestore.indexes.json`, then deploy was re-run successfully.

## How to verify approvals screen now works
1. Open Admin app and navigate to `/admin/approvals`.
2. Click **Refresh**.
3. Expected result:
   - No `FAILED_PRECONDITION ... query requires an index` error.
   - Pending members and/or pending groups load normally (or empty-state lists render cleanly).
4. Optional backend verification:
   - Run:
     ```bash
     firebase functions:log --only getPendingApprovals --project kirimba-banking --lines 20
     ```
   - Confirm there are no new `groupsQuery` failed-precondition index errors.

## File changed
- `firestore.indexes.json`
