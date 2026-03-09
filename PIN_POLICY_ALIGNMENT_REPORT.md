# PIN_POLICY_ALIGNMENT_REPORT

## Summary
Kirimba PIN policy has been aligned from **4-digit** to **6-digit numeric** across backend validation/auth flows and frontend login/provisioning forms.

## Old vs New PIN Rule
- Old rule: `^\d{4}$` (exactly 4 digits)
- New rule: `^\d{6}$` (exactly 6 digits)

## Files Changed

### Backend
- `functions/src/validators.js`
  - Updated `isValidPin` from 4-digit to 6-digit regex.
- `functions/src/utils.js`
  - Updated PIN normalization in `hashPIN`/`verifyPIN` from `padStart(4, "0")` to `padStart(6, "0")`.
  - Updated inline comment from 4-digit PIN to 6-digit PIN.
- `functions/src/agents.js`
  - Updated provisioning validation message to: `PIN must be exactly 6 digits.`
- `functions/src/members.js`
  - Updated member registration validation message to 6 digits.
  - Updated `resetPIN` invalid-argument message to require valid 6-digit PIN.

### Frontend
- `apps/admin/src/features/Admin/CreateAgentScreen.jsx`
  - Enforced 6-digit PIN validation before submit.
  - Updated PIN input constraints and helper text (`maxLength=6`, `6-digit PIN`).
- `apps/admin/src/features/Admin/CreateAdminScreen.jsx`
  - Enforced 6-digit PIN validation before submit.
  - Updated PIN input constraints and helper text (`maxLength=6`, `6-digit PIN`).
- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx`
  - Enforced 6-digit PIN validation before submit.
  - Updated PIN input constraints and helper text (`maxLength=6`, `6-digit PIN`).
- `apps/admin/src/pages/LoginPage.jsx`
  - Switched login password handling to PIN semantics.
  - Enforced numeric 6-digit PIN (`pattern`, `minLength=6`, `maxLength=6`) and helper text.
- `apps/agent/src/pages/LoginPage.jsx`
  - Switched login password handling to PIN semantics.
  - Enforced numeric 6-digit PIN (`pattern`, `minLength=6`, `maxLength=6`) and helper text.
- `apps/umuco/src/pages/LoginPage.jsx`
  - Switched login password handling to PIN semantics.
  - Enforced numeric 6-digit PIN (`pattern`, `minLength=6`, `maxLength=6`) and helper text.
- `apps/member/src/pages/LoginPage.jsx`
  - Switched login/signup password handling to PIN semantics.
  - Enforced numeric 6-digit PIN on signup/login and confirm PIN.
  - Updated validation messages to 6-digit PIN language.

## Affected Screens / Functions

### Backend functions
- `registerMember`
- `provisionAgent`
- `provisionAdmin` (through shared `isValidPin` path)
- `provisionInstitutionUser` (through shared `isValidPin` path)
- `resetPIN`
- Shared helpers: `isValidPin`, `hashPIN`, `verifyPIN`

### Frontend screens
- Admin: Create Agent, Create Admin, Create Institution User, Admin Login
- Agent: Login
- Umuco: Login
- Member: Login / Create Account form

## Auth/Storage Behavior (unchanged by design)
- Firestore continues to store `pinHash` using bcrypt.
- Firebase Auth password continues to use the raw PIN string.
- Only PIN length/policy changed to 6 digits.

## Validation and Build Checks Run
- Backend syntax checks:
  - `node --check functions/src/validators.js`
  - `node --check functions/src/utils.js`
  - `node --check functions/src/agents.js`
  - `node --check functions/src/members.js`
- Frontend builds:
  - `npm run build:admin`
  - `npm run build:member`
  - `npm run build:agent`
  - `npm run build:umuco`

## Test Flows to Verify
1. Member registration via `registerMember` with `pin=123456` succeeds.
2. Member registration with `pin=1234` fails with 6-digit validation error.
3. New member can log in with phone-derived email + 6-digit PIN.
4. Admin provisions agent with 6-digit PIN; agent can log in.
5. Super admin provisions admin with 6-digit PIN; admin can log in.
6. Admin/super admin provisions institution user with 6-digit PIN; user can log in to Umuco app.
7. `resetPIN` to a new 6-digit PIN updates both Firebase Auth password and Firestore `pinHash`; login works with new PIN.
8. Provisioning/login forms reject non-numeric or non-6-digit PIN input client-side.

## Remaining Assumptions / Notes
- Legacy historical docs in the repo may still mention 4-digit PIN as past behavior; operational code paths and active UI validations are now aligned to 6-digit PIN.
