# Institution Selector Fix — Report

**Date**: 2026-03-14
**Symptom**: Member institution selector showed only Umuco. DIFO1 (`MVMICrbccp7YOljsPVG0`) was invisible.

---

## Root Causes (3 independent bugs)

### Bug 1 — Hardcoded frontend list (primary cause)
**File**: `apps/member/src/features/Profile/InstitutionSelectionScreen.jsx`

```javascript
// BEFORE — hardcoded, never loaded from Firestore
const INSTITUTIONS = [
  { id: "umuco", label: "Umuco" },
];
```

The dropdown was never populated dynamically. No backend call was made to load available institutions.

---

### Bug 2 — Static backend allowlist (would have blocked DIFO even if selected)
**File**: `functions/src/members.js`

```javascript
// BEFORE — only "umuco" ever allowed
const SUPPORTED_MEMBER_INSTITUTIONS = new Set(["umuco"]);

// Used in setMemberInstitution, createGroup, joinGroup, joinGroupByInviteCode:
if (!institutionId || !SUPPORTED_MEMBER_INSTITUTIONS.has(institutionId)) {
  throw httpsError(...)
}
```

Even if the frontend had shown DIFO1, selecting it would have thrown `"Select a supported institution."` because `"MVMICrbccp7YOljsPVG0"` was not in the Set.

---

### Bug 3 — Lossy normalization (would have silently corrupted any mixed-case doc ID)
**File**: `functions/src/members.js`

```javascript
// BEFORE — lowercased institution IDs
function normalizeInstitutionId(rawValue) {
  return String(rawValue || "").trim().toLowerCase();
}
```

`"MVMICrbccp7YOljsPVG0"` → lowercased → `"mvmicrbccp7yoljspvg0"` → stored in `users.institutionId`.
This would have caused every subsequent Firestore doc lookup to fail silently (doc not found).

`"umuco"` was unaffected because its doc ID is already lowercase — this is why the bug was invisible for Umuco users.

---

## Files Changed

### Backend
| File | Change |
|------|--------|
| `functions/src/members.js` | Removed `SUPPORTED_MEMBER_INSTITUTIONS` Set; fixed `normalizeInstitutionId` (trim only, no lowercase); added `requireActiveInstitution()` helper; updated `setMemberInstitution`, `createGroup`, `joinGroup`, `joinGroupByInviteCode`; added new `getActiveInstitutions` function |
| `functions/index.js` | Exported `getActiveInstitutions` |

### Frontend
| File | Change |
|------|--------|
| `apps/member/src/features/Profile/InstitutionSelectionScreen.jsx` | Removed hardcoded `INSTITUTIONS` list; calls `getActiveInstitutions` on mount; shows `{name} ({code})` in dropdown; stores raw doc ID without lowercasing |

---

## Exact Logic Changes

### `normalizeInstitutionId` (members.js)
```javascript
// BEFORE
function normalizeInstitutionId(rawValue) {
  return String(rawValue || "").trim().toLowerCase();  // ← broke mixed-case IDs
}

// AFTER
function normalizeInstitutionId(rawValue) {
  return String(rawValue || "").trim();  // trim only — IDs are case-sensitive
}
```

### `SUPPORTED_MEMBER_INSTITUTIONS` → `requireActiveInstitution()` (members.js)
```javascript
// BEFORE
const SUPPORTED_MEMBER_INSTITUTIONS = new Set(["umuco"]);
// ...
if (!institutionId || !SUPPORTED_MEMBER_INSTITUTIONS.has(institutionId)) {
  throw httpsError("invalid-argument", "Select a supported institution.");
}

// AFTER
async function requireActiveInstitution(institutionId) {
  if (!institutionId) throw httpsError("invalid-argument", "institutionId is required.");
  const snap = await db.collection("institutions").doc(institutionId).get();
  if (!snap.exists) throw httpsError("not-found", `Institution "${institutionId}" not found.`);
  if (snap.data().status !== "active") throw httpsError("failed-precondition", `Institution is not active.`);
}
// Used in: setMemberInstitution, createGroup, joinGroup, joinGroupByInviteCode
```

### New `getActiveInstitutions` function (members.js)
```javascript
exports.getActiveInstitutions = functions.https.onCall(async (data, context) => {
  await requireActiveMember(context);  // any active member may call this

  const snap = await db.collection("institutions").where("status", "==", "active").get();
  return {
    institutions: snap.docs.map((doc) => ({
      id: doc.id,           // Firestore doc ID — the canonical FK
      name: doc.data().name || doc.id,
      code: doc.data().code || null,
    }))
  };
});
```

### `InstitutionSelectionScreen.jsx` — key changes
```javascript
// BEFORE: hardcoded list, no API call, forced lowercase
const INSTITUTIONS = [{ id: "umuco", label: "Umuco" }];
const profileInstitutionId = String(snap.data().institutionId || "").trim().toLowerCase();

// AFTER: dynamic load, raw doc ID
useEffect(() => {
  httpsCallable(functions, "getActiveInstitutions")({})
    .then((res) => setInstitutions(res.data?.institutions || []))
    ...
}, []);

// Profile load — raw stored value, no lowercase
const stored = String(snap.data().institutionId || "").trim();
```

---

## Migration — Is Any Needed?

**Existing Umuco users: no migration needed.**

- All existing `users.institutionId` values are `"umuco"` (lowercase string)
- `institutions/umuco` Firestore doc ID is `"umuco"` (lowercase)
- The old `normalizeInstitutionId` was `.toLowerCase()` — harmless for an already-lowercase string
- After fix: `normalizeInstitutionId` returns `"umuco"` (trim only, same result)
- All group documents have `institutionId: "umuco"` — still valid

**DIFO institution users: not yet created, so no migration needed.**

No Firestore document rewriting is required.

---

## Deploy Commands

```bash
# 1. Deploy backend (new getActiveInstitutions + fixed validation)
firebase deploy --only functions

# 2. Deploy member app (dynamic institution selector)
firebase deploy --only hosting:member

# Or both at once:
firebase deploy --only functions,hosting:member
```

---

## Retest Checklist

### Member Institution Selector
- [ ] Log in as a member
- [ ] Navigate to Select Institution
- [ ] Confirm dropdown shows **both** Umuco (UMUCO) and DIFO1 (DIFO)
- [ ] Select DIFO1, click "Save Institution"
- [ ] Confirm success message appears
- [ ] Check `users/{uid}.institutionId` in Firestore — must equal `"MVMICrbccp7YOljsPVG0"` (exact case, not lowercased)
- [ ] Reload the screen — confirm DIFO1 is pre-selected (stored value loaded correctly)

### Umuco member (regression)
- [ ] Log in as an existing Umuco member
- [ ] Confirm Umuco is pre-selected in the dropdown
- [ ] Save without changing — no error
- [ ] Confirm `users/{uid}.institutionId` still equals `"umuco"`

### Group creation with DIFO institution
- [ ] Member with `institutionId = "MVMICrbccp7YOljsPVG0"` creates a group
- [ ] Confirm group is created, `groups/{groupId}.institutionId = "MVMICrbccp7YOljsPVG0"`
- [ ] Confirm no "Select your institution" error

### Group join cross-institution rejection (regression)
- [ ] Umuco member attempts to join a DIFO group (different institutionId)
- [ ] Confirm rejection: "Your institution does not match this group's institution."

### Suspended institution guard
- [ ] Suspend DIFO institution in Admin → Institution Management
- [ ] Attempt to `setMemberInstitution` with DIFO's doc ID
- [ ] Confirm rejection: "Institution is not currently active."

### `getActiveInstitutions` access control
- [ ] Call `getActiveInstitutions` as an unauthenticated request → confirm rejection
- [ ] Call as a non-member role (e.g. agent) → confirm rejection
- [ ] Call as an active member → returns institutions list
