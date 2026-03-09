# APPROVALS_RUNTIME_DIAGNOSIS_REPORT

## Diagnosis Summary

The remaining issue was not in response parsing shape anymore; it was in **runtime error observability**.

`getPendingApprovals` still had a path where unknown backend exceptions were converted to a generic internal message, and frontend fallback logic could still collapse this into:
- `Failed to load pending approvals.`

This prevented seeing the true backend failure source (query/index/permission/deployment mismatch, etc.).

## Exact Failing Line/Path

Primary failure path:
- `functions/src/members.js` in `getPendingApprovals` query block:
  - users query: `.where("status", "==", USER_STATUS.PENDING_APPROVAL).orderBy("createdAt", "asc").get()`
  - groups query: `.where("status", "==", GROUP_STATUS.PENDING_APPROVAL).orderBy("createdAt", "asc").get()`
- Any thrown non-`HttpsError` from this section previously ended at generic internal/fallback UI text.

Secondary masking path:
- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx` error helper fallback behavior could still hide useful callable metadata.

## Deployment Drift Status

- **Not fully verifiable from this environment** due blocked outbound DNS/network to Google APIs (`cloudfunctions.googleapis.com`, `cloudresourcemanager.googleapis.com`), so runtime deployed code could not be listed/logged directly.
- Result: deployment drift is **possible but unconfirmed**.

## Files Changed

- `functions/src/members.js`
  - In `getPendingApprovals` catch block:
    - Added stronger code normalization (`String(error.code)` style handling).
    - Preserved `failed-precondition` for index errors (including message text detection like "requires an index").
    - Preserved `permission-denied` / `invalid-argument` paths.
    - For true unexpected errors, now returns:
      - `internal: Internal error loading pending approvals: <original message>`
    - Added structured logging with code/message/stack.

- `apps/admin/src/features/Approvals/ApprovalsScreen.jsx`
  - Updated `getBackendErrorMessage(...)` to prefer backend details/message and include callable code context instead of collapsing to generic fallback whenever possible.

## Why This Fix

The objective now is to reveal the exact runtime failure so it can be conclusively fixed (index/permissions/deployment drift) rather than repeatedly masked as generic INTERNAL.

## Exact Test To Verify Success

1. Open `/admin/approvals` as admin/super_admin.
2. Trigger `getPendingApprovals` via page load or Refresh.
3. Expected outcomes:
   - Success path: pending members/groups render.
   - Failure path: UI shows specific backend error text (for example index-related `failed-precondition` message), not just generic `Failed to load pending approvals.`
4. If message indicates Firestore index requirement, create the suggested index and retry.
5. If message indicates permission, verify callable auth role claims for current admin token.
