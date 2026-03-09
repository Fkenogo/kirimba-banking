# APPROVALS_DIAGNOSTIC_STEP_REPORT

## Exact failing step
- **Most likely failing step:** `groupsQuery` inside `getPendingApprovals`.
- **Evidence:**
  - Historical production failures for `getPendingApprovals` are `code: 9` (`failed-precondition`) and fail during query execution.
  - `users` has a composite index for `(status, createdAt)` in `firestore.indexes.json`.
  - `groups` does **not** have the equivalent `(status, createdAt)` composite index, while `getPendingApprovals` runs:
    - `where("status", "==", GROUP_STATUS.PENDING_APPROVAL)`
    - `orderBy("createdAt", "asc")`

## Root cause
- The approvals callable is now instrumented with step-by-step diagnostics, but there has not yet been a post-deploy admin invocation captured in logs.
- Based on existing runtime evidence and index configuration, the remaining runtime failure is a Firestore precondition/index failure on the pending-groups query.

## Files changed
- `functions/src/members.js`
  - Added step-by-step diagnostic mode in `getPendingApprovals`.
  - Added structured diagnostic payload (`step`, `callerUid`, `callerRole`, query-success flags).
  - Added diagnostic logger entry for failure path.
- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx`
  - Hardened error extraction to surface callable backend message/details instead of collapsing to generic `INTERNAL`.

## Deployment / drift status
- Deployed `getPendingApprovals` only to production (`us-central1`) after diagnostics were added.
- Prior logs show failures from pre-diagnostic code path (`/workspace/src/members.js:792`).
- No post-deploy failing invocation was available in logs during this run, so exact post-deploy step text from UI could not be captured yet from a live admin call.

## Final recommended fix after diagnosis
1. Add Firestore composite index for `groups(status ASC, createdAt ASC)`.
2. Deploy indexes:
   - `firebase deploy --only firestore:indexes --project kirimba-banking`
3. Re-open `/admin/approvals` with an admin/super_admin account.
4. If still failing, capture the now-surfaced message, which will include:
   - `getPendingApprovals failed at step: <step> — <original message>`

## One-step runtime confirmation to run now
- After a single refresh of `/admin/approvals`, read either:
  - UI error banner text (now shows backend diagnostic message), or
  - `firebase functions:log --only getPendingApprovals --project kirimba-banking --lines 20`
- Expected message format (if index is still missing):
  - `failed-precondition: getPendingApprovals failed at step: groupsQuery — ... requires an index ...`
