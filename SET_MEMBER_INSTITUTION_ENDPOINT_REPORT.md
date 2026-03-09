# SET_MEMBER_INSTITUTION_ENDPOINT_REPORT

## Root cause
`setMemberInstitution` was implemented in source and correctly wired in frontend, but the callable endpoint was **not yet deployed** in Firebase.

Result:
- Browser callable request returned `404` for `setMemberInstitution`
- Preflight/call failed because the target function URL did not exist in the deployed backend set

## Endpoint audit results
1. Implementation exists:
- `functions/src/members.js` exports `setMemberInstitution`

2. Export exists with exact same name:
- `functions/index.js` has `exports.setMemberInstitution = members.setMemberInstitution;`

3. Frontend callable name matches exactly:
- `apps/member/src/features/Profile/InstitutionSelectionScreen.jsx` calls `httpsCallable(functions, "setMemberInstitution")`

4. Region/project config alignment:
- Member app uses default `getFunctions(app)` (same pattern as other working callables, default `us-central1`)
- Project config points to `kirimba-banking`

5. Deployment status before fix:
- Function was missing from deployed endpoint set (inferred from 404 and successful create operation during deploy)

## Files changed
- No code changes were required for endpoint naming/config in this task.
- Deployment-only fix applied.

## Deploy command used
```bash
firebase deploy --only functions:setMemberInstitution --project kirimba-banking
```

## Deploy outcome
- Successful create operation:
  - `functions[setMemberInstitution(us-central1)] Successful create operation.`
- Function is now active with URL:
  - `https://us-central1-kirimba-banking.cloudfunctions.net/setMemberInstitution`

## Endpoint classification
- **Missing endpoint** (not deployed)
- Not misnamed
- Not frontend callable-name mismatch
- Not region mismatch in client setup

## Test result after deploy
- Backend deployment result: ✅ endpoint now exists and is active.
- End-to-end browser write verification (`users/{uid}.institutionId`) could not be executed directly from this CLI session.
- Required runtime check now:
  1. Refresh member app
  2. Open Institution Selection
  3. Save `Umuco`
  4. Confirm `users/{uid}.institutionId = "umuco"`
