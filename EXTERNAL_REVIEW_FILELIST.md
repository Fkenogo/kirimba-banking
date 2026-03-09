# EXTERNAL_REVIEW_FILELIST

## A) Backend Auth / Provisioning

- `functions/src/agents.js`  
  Primary provisioning callables (`provisionAgent`, `provisionAdmin`, `provisionInstitutionUser`) and shared provisioning validation/error mapping.

- `functions/src/members.js`  
  Member registration and `resetPIN`; useful to compare PIN policy consistency outside admin provisioning.

- `functions/src/constants.js`  
  Role constants used by callable guards and role checks.

## B) Frontend Admin Provisioning Screens

- `apps/admin/src/features/Admin/CreateAgentScreen.jsx`  
  Agent provisioning payload construction, token refresh behavior, error surfacing, PIN input sanitization/validation.

- `apps/admin/src/features/Admin/CreateAdminScreen.jsx`  
  Admin provisioning UI validation and payload behavior.

- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx`  
  Institution user provisioning UI validation and payload behavior.

- `apps/admin/src/App.jsx`  
  Admin auth bootstrap and claim retrieval (`getIdTokenResult`), relevant for stale session/token behavior.

## C) Shared Validators / Helpers

- `functions/src/validators.js`  
  Canonical backend phone and PIN validation (`isValidPin`, phone normalization/format checks).

- `functions/src/utils.js`  
  PIN hashing/verification helpers (`hashPIN`, `verifyPIN`) and PIN normalization behavior.

- `apps/admin/src/utils/phone.js`  
  Frontend phone normalization/validation used before provisioning calls.

## D) Firebase Config / Exports

- `functions/index.js`  
  Cloud Functions exports; confirms callable names and what is actually deployed from source.

- `apps/admin/src/services/firebase.js`  
  Firebase app/functions initialization, emulator toggles, and function endpoint target selection.

- `apps/admin/src/services/auth.js`  
  Firebase Auth sign-in wrapper and auth error normalization (helps trace token/session failures).

## E) Relevant Reports Already Generated

- `ROLE_ALIGNMENT_REPORT.md`  
  Role and permission alignment audit context.

- `FUNCTION_ENDPOINT_FIX_REPORT.md`  
  Callable endpoint missing/export/deploy diagnosis history.

- `PHONE_VALIDATION_FIX_REPORT.md`  
  Phone normalization and validation standardization details.

- `PROVISIONING_500_FIX_REPORT.md`  
  Backend exception/500 root-cause and error surfacing improvements.

- `PIN_POLICY_ALIGNMENT_REPORT.md`  
  4-digit to 6-digit PIN policy code alignment summary.

- `AGENT_PROVISION_400_REPORT.md`  
  Current 400/token/provisionAgent diagnostics and prior fixes.

- `PIN_INPUT_STABILITY_REPORT.md`  
  Frontend PIN input sanitization/autofill stability hardening details.

- `KIRIMBA_AUDIT_REPORT.md`  
  Broader system audit context helpful for cross-checking intended flows.
