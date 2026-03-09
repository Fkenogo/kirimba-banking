# AGENT_PROVISION_400_REPORT

## Root Cause Found

### 1) Token 400
Primary cause is a stale/invalid admin auth session not being handled explicitly in UI.

- Before fix, `CreateAgentScreen` called `provisionAgent` directly without forcing token refresh.
- If refresh token/session was stale, browser showed token endpoint `400`, then callable failed with an opaque error.
- `App` also read claims via `getIdTokenResult()` without forced refresh, so stale claim/session states were not surfaced early.

### 2) provisionAgent 400
The backend already returns structured callable errors (`invalid-argument`, `already-exists`, `unauthenticated`, `permission-denied`), but the UI previously collapsed this to generic `err.message` with no code distinction.

- This made all 400 responses look similar in the browser.
- Typical backend 400 causes in current code:
  - `invalid-argument`: full name length invalid, phone invalid, PIN not 6 digits
  - `already-exists`: phone/email already registered
  - `unauthenticated`: no valid auth context
  - `permission-denied`: caller role is not `admin`/`super_admin`

### 3) Old bundle/cache check
Not root cause in current source/build.

- Current source and current built bundle both contain 6-digit PIN validation and `provisionAgent` call path.
- This confirms the running codebase is aligned to 6-digit policy; stale browser cache can still happen per-client, but repository build is correct.

## Files Changed

- `apps/admin/src/features/Admin/CreateAgentScreen.jsx`
  - Added explicit callable error classification by Firebase Functions error code.
  - Added pre-call session checks:
    - verify `auth.currentUser`
    - force `getIdToken(true)` refresh
    - sign out + prompt re-login if refresh fails
  - Error messages now explicitly distinguish:
    - `invalid-argument`
    - `already-exists`
    - `unauthenticated`
    - `permission-denied`

- `apps/admin/src/App.jsx`
  - Changed auth bootstrap to `getIdTokenResult(true)` (forced refresh).
  - If token refresh fails, signs user out and clears role state.

## Backend Validation/Failure Map (provisionAgent)

`provisionAgent` (`functions/src/agents.js`) returns:

- `invalid-argument`
  - `fullName must be between 3 and 100 characters.`
  - `Enter a valid phone number in international format, e.g. +25766123456`
  - `PIN must be exactly 6 digits.`
- `already-exists`
  - `Phone number is already registered.`
- `unauthenticated`
  - `Authentication required.`
- `permission-denied`
  - `Insufficient permissions.`

## Exact Backend Message Now Shown

Create Agent screen now displays backend-classified messages, e.g.:

- `invalid-argument: PIN must be exactly 6 digits.`
- `already-exists: Phone number is already registered.`
- `unauthenticated: Authentication required.` (or session-expired prompt on token refresh failure)
- `permission-denied: Insufficient permissions.`

## Exact Test Input That Should Succeed

Use an authenticated admin/super_admin session, then submit:

- `fullName`: `Jean Pierre Ndayizeye`
- `phone`: `+25766124567` (must be unused)
- `pin`: `123456`

Expected result:
- Callable succeeds
- UI shows `Agent Created`
- Returns `agentId`

## Quick Verify Steps

1. Sign in again to admin app (fresh session).
2. Open `/admin/agents/new`.
3. Submit success payload above.
4. Retry with same phone; expect `already-exists` message.
5. Submit with `pin=1234`; expect `invalid-argument` message.
6. Use non-admin account; expect `permission-denied` message.

