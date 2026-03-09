# MEMBER_PENDING_REGRESSION_REPORT

## Exact root cause
The regression was caused by **member app access gating based only on custom token claim role**.

In `apps/member/src/App.jsx` (before fix):
- app loaded role only from `getIdTokenResult().claims.role`
- app showed **Account Pending** whenever role was not `member` or `leader`

This produced false pending states when:
- Firestore user was already `status: active`
- user no longer appeared in admin pending approvals
- but token claim was stale/missing at bootstrap after sign-out/sign-in

So the user was not truly pending in Firestore; the UI pending state was a claim-resolution false negative.

## Files changed
- `apps/member/src/App.jsx`

## Before/after state transitions

### Before
1. `approveMember`
   - `users/{uid}.status = active`
   - custom claim `role = member`
2. `createGroup`
   - no status downgrade
3. `approveGroup`
   - group promoted to active
   - leader claim set `role = leader`
4. after sign-out/sign-in
   - app reads claim only
   - if claim unavailable/stale, role is null
   - app incorrectly shows **Account Pending**

### After
1. on sign-in bootstrap:
   - app tries fresh token claim first (`getIdTokenResult(true)`), then cached token fallback
   - app also reads `users/{uid}` profile (`role`, `status`)
2. access decision:
   - allow if token role is `member|leader`
   - or allow if Firestore has `status=active` and `role=member|leader`
3. pending screen logic:
   - show **Account Pending** only when profile status is truly `pending_approval`
4. if access cannot be confirmed and user is not pending:
   - show neutral **Account Access Not Ready** message (not pending)

## Why backend was not the culprit
Backend writes were reviewed:
- `approveMember` sets `status: active` and claim `member`
- `createGroup` does not revert status
- `approveGroup` promotes role to `leader` and does not change status to pending

No status regression path was found in these callables.

## Test steps to verify
1. Register a member and approve via admin.
2. Confirm `users/{uid}.status = active` and role is member.
3. Log in member app -> should access dashboard/home.
4. Submit group request.
5. Approve group in admin.
6. Confirm `users/{uid}.role = leader` and `status = active`.
7. Sign out and sign in again.
8. Expected:
   - user still enters member app (leader allowed)
   - **Account Pending** is not shown
9. Optional token-edge check:
   - simulate claim delay/stale state
   - with Firestore `active + leader/member`, access still allowed via profile fallback.

## Build verification
- Member app builds successfully after fix:
  - `cd apps/member && npm run build`
