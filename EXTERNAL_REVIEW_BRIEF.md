# EXTERNAL_REVIEW_BRIEF

## A) Project Context

Kirimba is a microfinance workflow platform covering member savings, deposits, loan lifecycle, and institution confirmation flows.

Core roles in current model:
- `super_admin`
- `admin`
- `member`
- `leader`
- `agent`
- `umuco` (institution user)

Current auth/provisioning model:
- Firebase Auth Email/Password is used.
- Phone is normalized and converted to email-like identifier where applicable (`<phone>@kirimba.app`) for provisioning/login.
- PIN-based login is used in product UX.
- Raw PIN is used as Firebase Auth password.
- bcrypt `pinHash` is also stored in Firestore for server-side PIN verification paths.

## B) Problem Statement

Observed contradiction:
- Frontend provisioning forms enforce 6-digit PIN and show:
  - `PIN length: X / 6`
  - `PIN must be exactly 6 digits.`
- Backend provisioning responses still sometimes return:
  - `invalid-argument: pin must be exactly 4 digits.`

What has already changed:
- Role/callable alignment work was performed.
- Missing callable endpoints were added/exported/deployed.
- Phone normalization/validation was standardized.
- Provisioning error visibility was improved in UI.
- PIN policy was changed from 4 digits to 6 digits in current source.
- Admin PIN input handling was stabilized/sanitized.

What is still failing:
- In live behavior, provisioning can still report a 4-digit backend validation error despite 6-digit frontend enforcement.

Why this suggests hidden drift:
- Current repository code shows 6-digit validators.
- Contradictory backend message indicates likely backend/runtime drift (stale deployment, alternate path, or unexpected function target) rather than simple form input issue.

## C) Timeline Of Fixes Already Attempted

1. Role alignment and permission consistency review
- Role hierarchy and route/callable alignment work documented and implemented.

2. Callable endpoint availability
- `provisionAdmin` and `provisionInstitutionUser` export/endpoint gaps were fixed and deployment steps documented.

3. Phone normalization and validation
- Shared normalization/validation introduced for +257/+250/+256 formats.
- Duplicate checks aligned to normalized phone.

4. Provisioning 500 diagnostics and error handling
- Backend exception mapping improved.
- Frontend error display improved to surface backend messages.

5. PIN policy alignment (4 -> 6)
- Validators/helpers/forms updated to 6-digit PIN rule.

6. PIN input stability hardening in admin forms
- Numeric sanitization on change.
- Live length indicator.
- Autofill/password-manager interference reduced.

## D) Current Symptoms

- Admin provisioning UI currently shows 6-digit rule and live length meter.
- Backend in some provisioning attempts still returns 4-digit invalid-argument text in `provisionAgent` path.

Relevant artifacts (filename references):
- `AGENT_PROVISION_400_REPORT.md`
- `PIN_POLICY_ALIGNMENT_REPORT.md`
- `PIN_INPUT_STABILITY_REPORT.md`
- `PROVISIONING_500_FIX_REPORT.md`
- `FUNCTION_ENDPOINT_FIX_REPORT.md`
- `PHONE_VALIDATION_FIX_REPORT.md`
- `ROLE_ALIGNMENT_REPORT.md`
- `KIRIMBA_AUDIT_REPORT.md`

## E) Suspected Root-Cause Categories

1. Stale deployed Cloud Function version
- Live function instance still running old 4-digit validator.

2. Alternate validator/helper path
- Another helper path (not current `validators.js`) still enforces 4 digits.

3. Multiple provisioning code paths
- `provisionAgent` may diverge from `provisionAdmin`/`provisionInstitutionUser` in deployed runtime.

4. Frontend calling unexpected target
- Wrong project/region/environment or outdated function target.

5. Mixed deployments across environments
- Partial deployments leaving different revisions active.

6. Shared helper mismatch or duplication
- Duplicate util/validator definitions drifting between files or versions.

## F) Exact Questions For External Review

1. Where exactly is the 4-digit validation text being produced at runtime?
2. Is there a stale/undeployed Cloud Functions revision still serving traffic?
3. Is `provisionAgent` using a different deployed code path than `provisionAdmin`/`provisionInstitutionUser`?
4. Are there duplicated validator/helper layers causing backend drift?
5. Is frontend calling the intended Firebase project/region/function instance?
6. Do Cloud Logs for failing calls show function revision/version identifiers that differ from current source?
7. Are emulator/local/prod configs crossing in any environment where issue is reproduced?

## G) Definition Of Done

Done means all of the following are true:
- All provisioning flows consistently enforce 6-digit PIN (`provisionAgent`, `provisionAdmin`, `provisionInstitutionUser`, and reset/provision-adjacent paths).
- Frontend and backend validation messages match for the same input.
- Fresh valid inputs succeed for agent/admin/institution user creation.
- No runtime response returns 4-digit PIN validation text.
