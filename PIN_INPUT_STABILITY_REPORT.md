# PIN_INPUT_STABILITY_REPORT

## Root Cause Found

Primary cause was frontend PIN field implementation in admin provisioning screens:

1. PIN was treated as a normal password field (`type="password"`) with no input sanitization.
2. Raw `onChange` values were stored directly in state, so non-digit/hidden autofill characters could enter state.
3. Submit validation relied on that raw state, producing inconsistent outcomes when browser/password manager behavior changed the underlying value.

This created symptoms where the user-visible PIN entry and the validated value could diverge, leading to unstable "PIN must be exactly 6 digits" behavior.

## Files Changed

- `apps/admin/src/features/Admin/CreateAgentScreen.jsx`
- `apps/admin/src/features/Admin/CreateAdminScreen.jsx`
- `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx`

## Fixes Implemented

Across all three screens:

1. PIN input switched to numeric-style input handling (not password-manager style):
   - `type="text"`
   - `inputMode="numeric"`
   - `pattern="\\d*"`
   - `autoComplete="off"`
   - `autoCorrect="off"`
   - `autoCapitalize="off"`
   - `spellCheck={false}`
   - `data-lpignore="true"`
   - `data-1p-ignore="true"`

2. Sanitization on every change:
   - trim outer whitespace
   - remove non-digits
   - clamp to 6 chars
   - store only sanitized digits in state

3. Submit validation now uses sanitized current value only:
   - sanitize before submit
   - reject when length < 6
   - submit sanitized 6-digit PIN only

4. Live helper added:
   - `PIN length: X / 6`

5. Length error behavior stabilized:
   - if current sanitized length < 6: show `PIN must be exactly 6 digits.`
   - if current sanitized length == 6: no length error

6. No 4-digit messaging remains in these admin provisioning PIN flows.

## Autofill / Password Manager Involvement

Yes, this was a likely contributor.

- Original fields were classic password inputs, which are common targets for password manager/autofill injection.
- The fix reduces this by changing field semantics and adding anti-autofill hints, while also making behavior deterministic through sanitization.

## Verification Steps

1. Open each screen:
   - `/admin/agents/new`
   - `/admin/admins/new`
   - `/admin/institutions/new`

2. Type mixed input (e.g. `12ab 34-56`):
   - Field should normalize to `123456`.
   - Helper should show `PIN length: 6 / 6`.

3. Enter fewer than 6 digits (e.g. `1234`):
   - Helper should show `PIN length: 4 / 6`.
   - Length error should show: `PIN must be exactly 6 digits.`

4. Enter exactly 6 digits (e.g. `123456`):
   - Helper should show `PIN length: 6 / 6`.
   - No length error should appear.

5. Attempt submit with short PIN:
   - Submit blocked, length error shown.

6. Attempt submit with 6-digit PIN:
   - Request sent with sanitized 6-digit value only.

7. Refresh browser and retest with/without password manager enabled:
   - Behavior should remain stable and non-contradictory.

