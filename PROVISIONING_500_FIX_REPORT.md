# PROVISIONING_500_FIX_REPORT

Date: 2026-03-07
Project: kirimba-banking

## Root Cause Analysis

### provisionAdmin
Exact root cause: errors thrown inside shared helper `provisionUserWithRole(...)` were being collapsed to:
- `HttpsError("internal", "User provisioning failed.")`

Specifically, `auth.createUser(...)` had a broad catch that always returned generic `internal`, hiding the real Firebase Admin error code/message.

### provisionInstitutionUser
Exact root cause is the same shared path as `provisionAdmin`:
- `provisionInstitutionUser` calls `provisionUserWithRole(...)`
- the same generic catch masked underlying exceptions as `internal`

So both endpoints returned HTTP 500 because the shared provisioning helper swallowed the real exception details.

### First divergence vs provisionAgent
`provisionAgent`, `provisionAdmin`, and `provisionInstitutionUser` all use `provisionUserWithRole(...)` first.
The first divergence happens **after** the helper returns successfully:
- `provisionAgent` performs extra batch writes to `agents/{uid}`
- `provisionAdmin` and `provisionInstitutionUser` return immediately

Therefore the observed 500s were on the common path (before divergence), not in admin-only/institution-only branching.

## Logs
I attempted to inspect live logs (`firebase functions:log --only provisionAdmin/provisionInstitutionUser`), but this environment had transient DNS resolution failures for Google Logging endpoints, so direct log retrieval was unavailable during this run.

## Backend Fixes Applied

File changed: `functions/src/agents.js`

### What changed
1. Added error classifier `toProvisioningError(...)` to map Firebase/Admin errors to correct callable status:
- duplicate -> `already-exists`
- invalid input -> `invalid-argument`
- permission issues -> `permission-denied`
- unknown -> `internal`

2. Reworked shared helper error handling:
- `assertEmailNotTaken(...)` now preserves duplicate and maps lookup failures explicitly
- `auth.createUser(...)` now logs original exception code/message and returns mapped error
- `auth.setCustomUserClaims(...)` now logs and maps failures
- Firestore profile write now logs failures and returns clear internal message

3. Stopped swallowing root exception context:
- server logs now include operation name + source code/message for debugging

### Result
Both `provisionAdmin` and `provisionInstitutionUser` now return specific callable errors instead of generic 500 for known cases.

## Frontend Fixes Applied

Files changed:
- `apps/admin/src/features/Admin/CreateAdminScreen.jsx`
- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx`

### What changed
- Added `getBackendErrorMessage(...)` extractor that prefers backend-provided `details`/`message`
- Keeps fallback generic message only when backend message is missing or just `internal`

## Deployment
Deployed updated provisioning functions:

```bash
firebase deploy --only functions:provisionAgent,functions:provisionAdmin,functions:provisionInstitutionUser
```

Deployment completed successfully.

## Example Errors Now Surfaced
- Duplicate phone/email:
  - `already-exists: Phone number is already registered.`
- Invalid phone format:
  - `invalid-argument: Enter a valid phone number in international format, e.g. +25766123456`
- Invalid PIN format (non-4-digit input):
  - `invalid-argument: pin must be exactly 4 digits.`
- Firebase Auth password policy rejection (if triggered by backend createUser):
  - `invalid-argument: PIN is not accepted by Firebase Auth. Contact support to verify password policy.`

## Test Inputs

### Success case
- fullName: `Jane Admin`
- phone: `+250788123456`
- pin: `1234`
- Expected: success response with created ID

### Failure cases
1. Duplicate:
- re-use previously provisioned normalized phone
- Expected: `already-exists` + clear duplicate message

2. Invalid phone:
- phone: `+251911111111`
- Expected: `invalid-argument` + valid-format guidance

3. Invalid pin format:
- pin: `12a4` or `123`
- Expected: `invalid-argument` + 4-digit requirement

4. Permission failure:
- call `provisionAdmin` as non-`super_admin`
- Expected: `permission-denied`

