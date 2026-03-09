# PHONE_VALIDATION_FIX_REPORT

Date: 2026-03-07

## Files Changed
- `functions/src/validators.js`
- `functions/src/agents.js`
- `apps/admin/src/utils/phone.js` (new)
- `apps/admin/src/features/Admin/CreateAgentScreen.jsx`
- `apps/admin/src/features/Admin/CreateAdminScreen.jsx`
- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx`

## Normalization Rules
Shared normalization now does the following:
1. Trim outer whitespace
2. Remove internal spaces and dashes
3. Preserve leading `+` when present
4. If `+` is missing, prefix it
5. Return E.164-style compact string (no spaces/dashes)

Examples:
- `+257 66 123456` -> `+25766123456`
- `+250 788 123456` -> `+250788123456`
- `+256-788-123456` -> `+256788123456`

## Validation Rules
Accepted formats are explicitly limited to:
- Burundi: `+257` + 8 digits
- Rwanda: `+250` + 9 digits
- Uganda: `+256` + 9 digits

Pattern used (frontend):
- `^(\+257\d{8}|\+250\d{9}|\+256\d{9})$`

Backend enforces the same country set via explicit regex list in shared validator.

## Backend Changes Applied
Provisioning flows now use the new shared validation helper and normalized phone for duplicate checks:
- `provisionAgent`
- `provisionAdmin`
- `provisionInstitutionUser`

Invalid phone message is now consistent:
- `Enter a valid phone number in international format, e.g. +25766123456`

Duplicate checks are now normalization-safe because all provisioning flows call `normalizePhone(...)` before constructing auth email, so variants like:
- `+257 66 123456`
- `+25766123456`
map to the same canonical value.

## Frontend Changes Applied
All three admin provisioning forms now:
1. Normalize phone before submit
2. Validate locally before submit using shared helper
3. Show consistent guidance/examples

Updated screens:
- Create Agent
- Create Admin
- Create Institution User

Examples shown in UI:
- Burundi: `+25766123456`
- Rwanda: `+250788123456`
- Uganda: `+256788123456`

## Supported Examples
- `+25766123456` ✅
- `+250788123456` ✅
- `+256788123456` ✅
- `+257 66 123456` ✅ (normalized)
- `+250 788 123456` ✅ (normalized)
- `+256-788-123456` ✅ (normalized)

## Remaining Assumptions / Limitations
- Validation is intentionally constrained to `+257`, `+250`, `+256` only (as requested).
- No other country codes are accepted.
- This task changed provisioning flows only; member registration keeps its existing Burundi-only validation behavior.
