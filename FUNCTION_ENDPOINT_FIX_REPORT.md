# FUNCTION_ENDPOINT_FIX_REPORT

Date: 2026-03-07
Project: `kirimba-banking`

## Root Cause
The frontend callable names were correct, and backend exports/implementations existed locally, but `provisionAdmin` and `provisionInstitutionUser` had not been deployed to Cloud Functions (1st gen) in the target project/region.

This is consistent with:
- Admin UI showing `404` for only those two endpoints.
- `provisionAgent` working (already deployed earlier).
- Deploy logs in this session showing **create operations** for both missing functions.

## Phase 1 Audit Results

### 1) `functions/index.js` export audit
Confirmed exported names:
- `exports.provisionAdmin = agents.provisionAdmin`
- `exports.provisionInstitutionUser = agents.provisionInstitutionUser`

File: `functions/index.js`

### 2) Backend implementation audit
Confirmed both functions exist and use v1 callable pattern (`functions.https.onCall`), same style as existing callables:
- `provisionAdmin`
- `provisionInstitutionUser`

File: `functions/src/agents.js`

### 3) Frontend callable name/config audit
Confirmed exact name match in admin UI:
- `httpsCallable(functions, "provisionAdmin")`
- `httpsCallable(functions, "provisionInstitutionUser")`

Files:
- `apps/admin/src/features/Admin/CreateAdminScreen.jsx`
- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx`

Confirmed same Firebase Functions client setup as working `provisionAgent`:
- `getFunctions(app)` (default region)
- same project config (`VITE_FIREBASE_PROJECT_ID=kirimba-banking`)
- same callable client object used by all three screens

Files:
- `apps/admin/src/services/firebase.js`
- `apps/admin/src/features/Admin/CreateAgentScreen.jsx`

### 4) Deployment status audit
Executed deploy command for only missing endpoints. Deployment output shows:
- `functions[provisionAdmin(us-central1)] Successful create operation.`
- `functions[provisionInstitutionUser(us-central1)] Successful create operation.`

This confirms missing-endpoint root cause (not naming mismatch).

## Phase 2 Fix Applied
No source code change required for naming/pattern/region.

Applied operational fix:
- Deployed missing functions only:

```bash
firebase deploy --only functions:provisionAdmin,functions:provisionInstitutionUser
```

## Callable Names Now Available
- `provisionAdmin`
- `provisionInstitutionUser`

Both in region: `us-central1`

## Commands to Deploy Only Missing Functions

```bash
cd /Users/theo/kirimba-banking
firebase deploy --only functions:provisionAdmin,functions:provisionInstitutionUser
```

If needed, redeploy all admin-provisioning functions together:

```bash
firebase deploy --only functions:provisionAgent,functions:provisionAdmin,functions:provisionInstitutionUser
```

## Quick Verification Steps
1. Open Admin app and login as `super_admin`.
2. Create Admin screen: submit valid `fullName`, `phone` (`+257XXXXXXXX`), `pin` (4 digits).
3. Expect success response with `adminId` (no 404).
4. Create Institution User screen: submit same valid fields (+ optional `institutionId`).
5. Expect success response with `institutionUserId` (no 404).

Optional direct endpoint smoke (callable protocol):
- POST to:
  - `https://us-central1-kirimba-banking.cloudfunctions.net/provisionAdmin`
  - `https://us-central1-kirimba-banking.cloudfunctions.net/provisionInstitutionUser`

## Why `provisionAgent` Can Return 400 (Separate from 404)
`400` on callable generally means request reached the function but failed validation/business checks. For `provisionAgent`, common causes from backend logic:
- `fullName` length not in `3..100`
- invalid phone format (must be `+257XXXXXXXX`)
- PIN not exactly 4 digits
- duplicate phone/email already exists

Validation source: `functions/src/agents.js` (`provisionUserWithRole`, `assertEmailNotTaken`).

So:
- `404` => endpoint missing/not deployed
- `400` => endpoint exists but input/business validation failed
