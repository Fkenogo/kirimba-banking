# PHONE_AUTH_ALIGNMENT_REPORT

## Summary
Kirimba auth has been aligned so normal users authenticate with **phone number + 6-digit PIN**. Internal Firebase Auth identifier remains phone-derived email (`phoneToAuthEmail(phone)`), but this is now hidden from normal user login flows.

## Roles Affected

Updated to phone + PIN login:
- member
- leader (same member app/login path)
- agent
- admin
- institution user (`umuco`)

Exception retained:
- super_admin remains email + PIN (explicit fallback mode in admin login)

## Old vs New Auth Model

Old:
- Normal user login screens asked for email + PIN.
- Member signup flow used direct email/password style creation in frontend.

New:
- Normal user login screens ask for phone number + PIN.
- Member registration asks for phone + PIN + confirm PIN, with optional email profile field.
- Internal auth lookup converts phone to generated auth email format.

## Internal Auth Identifier Format

Internal identifier used for Firebase Auth:
- `<normalizedPhone>@kirimba.app`
- Example: `+25766123456@kirimba.app`

This mapping is now explicit in helpers:
- backend: `phoneToAuthEmail(...)` in validators
- frontend: `phoneToAuthEmail(...)` in phone auth utils

## Files Changed

### Backend
- `functions/src/validators.js`
  - Added `phoneToAuthEmail(phone)` helper export.
- `functions/src/agents.js`
  - Provisioning now uses shared `phoneToAuthEmail(...)` helper.
- `functions/src/members.js`
  - Member registration phone validation aligned to supported regional rules (`+257`, `+250`, `+256`).
  - Member auth email now uses shared `phoneToAuthEmail(...)`.
  - Optional profile `email` accepted and stored.

### Member app
- `apps/member/src/pages/LoginPage.jsx`
  - Login switched to phone + PIN.
  - Registration switched to fullName + phone + PIN + confirm PIN (+ optional email).
- `apps/member/src/services/auth.js`
  - Added `registerMemberAccount(...)` (calls callable `registerMember`).
  - Added `signInWithPhonePIN(...)`.
- `apps/member/src/utils/phoneAuth.js` (new)
  - Phone normalization/validation + `phoneToAuthEmail`.

### Agent app
- `apps/agent/src/pages/LoginPage.jsx`
  - Login switched to phone + PIN.
- `apps/agent/src/services/auth.js`
  - Added `signInWithPhonePIN(...)`.
- `apps/agent/src/utils/phoneAuth.js` (new)
  - Phone normalization/validation + `phoneToAuthEmail`.

### Admin app
- `apps/admin/src/pages/LoginPage.jsx`
  - Default login switched to phone + PIN for normal users.
  - Added super_admin fallback mode for email + PIN.
- `apps/admin/src/services/auth.js`
  - Added `signInWithPhonePIN(...)` and `signInWithEmailPIN(...)`.
- `apps/admin/src/utils/phone.js`
  - Added `phoneToAuthEmail(...)`.

### Umuco app
- `apps/umuco/src/pages/LoginPage.jsx`
  - Login switched to phone + PIN.
- `apps/umuco/src/services/auth.js`
  - Added `signInWithPhonePIN(...)`.
- `apps/umuco/src/utils/phoneAuth.js` (new)
  - Phone normalization/validation + `phoneToAuthEmail`.

## Profile Model Alignment

Current alignment implemented:
- Phone: required in registration/provisioning and login for normal users.
- Name: required profile field (registration/provisioning), not used for auth.
- Email: optional profile data for members (`registerMember` now accepts optional email).

## Migration Notes

1. Existing users can continue authenticating if their stored internal auth email already follows phone mapping.
2. Normal-role users no longer need to know internal auth emails.
3. super_admin stays on email + PIN via explicit login mode to avoid migration breakage.
4. Member registration now uses callable `registerMember` rather than direct frontend Firebase signup.

## Validation Rules Used

Phone (all normal login/register/provisioning entry points):
- `+257` + 8 digits
- `+250` + 9 digits
- `+256` + 9 digits

PIN:
- exactly 6 digits

## Test Flows To Verify

1. Member registration
- Input: fullName + `+257...`/`+250...`/`+256...` + 6-digit PIN + confirm PIN (+ optional email)
- Expected: account created, pending approval message.

2. Member login
- Input: phone + 6-digit PIN
- Expected: successful sign-in using internal mapped auth identifier.

3. Agent login
- Input: phone + 6-digit PIN
- Expected: successful sign-in.

4. Admin login (normal)
- Input: phone + 6-digit PIN
- Expected: successful sign-in.

5. Institution user login
- Input: phone + 6-digit PIN
- Expected: successful sign-in.

6. Super admin login exception
- Switch to super admin mode in admin login screen.
- Input: email + 6-digit PIN
- Expected: successful sign-in.

7. Invalid phone
- Input malformed phone on any normal login.
- Expected: consistent international format validation error.

8. Invalid PIN length
- Input 4/5 digits.
- Expected: `PIN must be exactly 6 digits.`
