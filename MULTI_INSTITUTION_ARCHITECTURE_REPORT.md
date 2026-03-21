# Multi-Institution Architecture Fix Report

> **Date**: 2026-03-15
> **Version**: v3.2.0 (pending release)
> **Scope**: Complete multi-institution isolation across backend, Firestore rules, and all frontend apps

---

## Executive Summary

KIRIMBA was originally built for a single partner institution (Umuco). When DIFO was added as a second institution, the system had no data-plane isolation: DIFO member deposits appeared in Umuco's approval queue, institution names showed raw Firestore doc IDs, and all institution staff shared a hardcoded `"umuco"` role. This report documents the root causes, all files changed, the target schema, migration steps, and retest checklist.

---

## Root Cause Analysis

### Problem 1 — Deposit batches had no institution routing

`submitBatch` created `depositBatches` documents with no `institutionId` field. Umuco's batch screens queried `where("status", "==", "submitted")` with no institution filter — so every batch from every group, regardless of institution, appeared in Umuco's queue.

**Root cause**: The `depositBatches` schema never included `institutionId`. Institution identity was implicit (only Umuco existed at the time).

### Problem 2 — Member dashboard showed raw Firestore doc ID

`MemberHomeScreen` read `users/{uid}.institutionId` and displayed the raw string (e.g., `"umuco"` or `"difo-123"`) without resolving it to a human-readable name.

**Root cause**: No lookup against the `institutions` collection was performed.

### Problem 3 — Institution app was Umuco-branded

- Login page: `"KIRIMBA Umuco"` hardcoded
- Home page: `"Umuco Operations"` hardcoded
- Batch submission success message: `"Batch submitted to Umuco"` hardcoded
- Agent submit section label: `"Ready to Submit to Umuco"` hardcoded

**Root cause**: UI strings written for single-institution use, never parameterised.

### Problem 4 — Hardcoded `"umuco"` role prevents multi-institution provisioning

`provisionInstitutionUser` set `role: "umuco"` for all institution staff regardless of which institution they belonged to. The role carried no institution identity — making it impossible to distinguish Umuco staff from DIFO staff in Firestore rules.

**Root cause**: Role designed for single-institution world; institution identity only implied by role name.

### Problem 5 — No institution scope enforcement in confirmBatch / flagBatch

Any authenticated user with `role: "umuco"` could confirm or flag any batch across all institutions. No cross-institution access check existed.

**Root cause**: Single-institution assumption meant institution isolation was never needed in backend function logic.

### Problem 6 — `"umuco_branch"` channel hardcoded

Transaction channel was `"umuco_branch"` — institution-specific, not generic.

---

## Target Schema

### `users` (institution staff)
```
role: "institution_user"          // generic; replaces "umuco"
institutionId: string             // FK → institutions/{id}
```

### Firebase Auth custom claims (institution staff)
```json
{ "role": "institution_user", "institutionId": "<institutions doc ID>" }
```

### `institutions/{id}`
```
name: string                      // e.g., "Umuco Microfinance"
code: string                      // e.g., "UMUCO", "DIFO"
status: "active" | "suspended"
```

### `groups/{id}`
```
institutionId: string             // FK → institutions/{id}  ← required for routing
```

### `transactions/{id}`
```
institutionId: string             // denormalized from group at record time
channel: "agent" | "institution_branch"   // replaces "umuco_branch"
```

### `depositBatches/{id}`
```
institutionId: string             // denormalized from group.institutionId at submitBatch time
institutionRef: string | null     // replaces umucoAccountRef
institutionNotes: string | null   // replaces umucoNotes
```

---

## Files Changed (17 changes)

### Backend — `functions/`

| File | Change |
|------|--------|
| `functions/src/constants.js` | Added `INSTITUTION_USER: "institution_user"` to ROLES; kept `UMUCO: "umuco"` as legacy |
| `functions/src/agents.js` | `provisionUserWithRole` gains `extraClaims = {}` param; `provisionInstitutionUser` uses `INSTITUTION_USER` role + passes `institutionId` into custom claims |
| `functions/src/savings.js` | `recordDeposit`: adds `institution_branch` channel support + stamps `institutionId` on transactions; `submitBatch`: reads `groups/{groupId}.institutionId` + stamps it on batch doc; `confirmBatch`/`flagBatch`: institution scope check + accept `institution_user` role; `getBatchesForGroup`: allow `institution_user` |
| `functions/src/loans.js` | `recordRepayment`: adds `institution_branch` to allowed channels |
| `functions/src/superAdmin.js` | Added `migrateInstitutionUserRoles` callable — one-time migration of existing `"umuco"` users to `"institution_user"` with `institutionId` in both Firestore doc and custom claims |
| `functions/index.js` | Exports `migrateInstitutionUserRoles` |

### Security Rules — `firestore.rules`

| Change |
|--------|
| Added `isInstitutionUser()` helper (matches both `"institution_user"` and legacy `"umuco"`) |
| Updated `isUmuco()` to call `isInstitutionUser()` (legacy alias) |
| `depositBatches` read rule: migrated users filtered by `resource.data.institutionId == request.auth.token.institutionId`; legacy `"umuco"` role retains full access until migration runs |

### Indexes — `firestore.indexes.json`

| Index |
|-------|
| `depositBatches`: `(institutionId ASC, status ASC, submittedAt DESC)` |
| `depositBatches`: `(institutionId ASC, status ASC, flaggedAt DESC)` |

### Frontend — `apps/umuco/`

| File | Change |
|------|--------|
| `apps/umuco/src/pages/LoginPage.jsx` | `"KIRIMBA Umuco"` → `"KIRIMBA Institution Staff"` |
| `apps/umuco/src/App.jsx` | Extracts `institutionId` from custom claims; role gate covers both `"institution_user"` and `"umuco"`; passes `institutionId` to all batch screens |
| `apps/umuco/src/pages/HomePage.jsx` | Loads institution name from `institutions/{institutionId}`; shows `"[Name] Operations"` dynamically; all batch queries filter by `institutionId` |
| `apps/umuco/src/features/Batches/PendingBatchesScreen.jsx` | Accepts `institutionId` prop; query adds `where("institutionId", "==", institutionId)` |
| `apps/umuco/src/features/Batches/BatchHistoryScreen.jsx` | Same; notes display reads `institutionNotes \|\| umucoNotes` for backward compat |
| `apps/umuco/src/features/Batches/FlaggedBatchesScreen.jsx` | Same; notes display reads `institutionNotes \|\| umucoNotes` |
| `apps/umuco/src/features/Batches/BatchDetailScreen.jsx` | Confirm call uses `institutionRef`; display reads `institutionRef \|\| umucoAccountRef` and `institutionNotes \|\| umucoNotes` |

### Frontend — `apps/member/`

| File | Change |
|------|--------|
| `apps/member/src/features/Home/MemberHomeScreen.jsx` | Reads `institutions/{institutionId}` to resolve name; displays institution name instead of raw doc ID |

### Frontend — `apps/agent/`

| File | Change |
|------|--------|
| `apps/agent/src/features/Deposits/AgentDailySummaryScreen.jsx` | `"Batch submitted to Umuco"` → `"Batch submitted to institution"`; section label `"Ready to Submit to Umuco"` → `"Ready to Submit"`; flag note reads `institutionNotes \|\| umucoNotes` |

---

## Backward Compatibility

All display code reads both old and new field names:

| Old field | New field | Read pattern |
|-----------|-----------|--------------|
| `umucoAccountRef` | `institutionRef` | `institutionRef \|\| umucoAccountRef` |
| `umucoNotes` | `institutionNotes` | `institutionNotes \|\| umucoNotes` |
| `"umuco_branch"` channel | `"institution_branch"` | both accepted in backend |
| `role: "umuco"` | `role: "institution_user"` | Firestore rules accept both; migration callable available |

No destructive backfill of existing documents is required for the system to function. Old documents will still display correctly.

---

## Migration / Backfill Required

### Required before DIFO goes live

**Step 1 — Ensure all groups have `institutionId` set**

Every `groups` document must have `institutionId` populated with the correct Firestore doc ID from the `institutions` collection. Without this, `submitBatch` will stamp `null` on new batches and institution filtering will not work.

```
// Firestore update needed for each group:
groups/{groupId}.institutionId = "umuco"   // or "difo-xxx"
```

This can be done via the Firebase Console or a one-time admin script.

**Step 2 — Run `migrateInstitutionUserRoles` (Super Admin callable)**

Migrates all existing `users` documents with `role: "umuco"` to `role: "institution_user"` and updates their Firebase Auth custom claims to include `institutionId`. Safe to call multiple times.

```javascript
// Call from Super Admin UI or Firebase Functions shell:
const migrate = httpsCallable(functions, "migrateInstitutionUserRoles");
await migrate({});
// Returns: { migrated: number, skipped: number }
```

**Step 3 — Deploy Firestore indexes and wait for build**

New composite indexes on `depositBatches` must finish building before institution-scoped queries will work. After deploy, check Firebase Console → Firestore → Indexes. Allow 2–5 minutes.

### Optional (after migration completes)

- Remove the legacy `role() == "umuco"` branch from the `depositBatches` Firestore rule once all users are migrated.
- Backfill `institutionId` onto historical `depositBatches` documents for complete query coverage of old data in history screens.

---

## Safe Deploy Order

```
1. firebase deploy --only firestore:rules,firestore:indexes
   └── Wait for indexes to build (2-5 min)

2. firebase deploy --only functions
   └── Deploys all backend changes including migrateInstitutionUserRoles

3. Manually update groups/{groupId}.institutionId in Firestore for all groups
   └── Required before new batches will route correctly

4. Call migrateInstitutionUserRoles from Super Admin console
   └── Migrates existing umuco staff role + adds institutionId to claims
   └── Umuco staff must sign out and sign back in to receive new claims

5. firebase deploy --only hosting
   └── Deploys all frontend changes (umuco, member, agent apps)
```

> **Important**: Umuco/DIFO staff must sign out and sign back in after step 4 for their updated JWT claims (`institutionId`) to take effect. Until they do, the `umuco` legacy rule in Firestore still grants full access.

---

## Retest Checklist

### Scenario 1 — DIFO deposits do not appear in Umuco queue

- [ ] Record 2 deposits for a DIFO group (agent app)
- [ ] Submit batch for that group
- [ ] Log in to umuco app as Umuco staff → Pending Batches should show **0** batches
- [ ] Log in as DIFO staff → Pending Batches should show the new batch

### Scenario 2 — Umuco staff can only confirm Umuco batches

- [ ] As DIFO staff, attempt to call `confirmBatch` with a Umuco batch ID → expect `permission-denied`
- [ ] As Umuco staff, confirm a Umuco batch → succeeds
- [ ] As Umuco staff, attempt to confirm a DIFO batch → expect `permission-denied`

### Scenario 3 — Member dashboard shows institution name, not raw ID

- [ ] Log in as a member with `institutionId: "umuco"` → dashboard shows "Umuco Microfinance" (or whatever `institutions/umuco.name` is)
- [ ] Log in as a member with `institutionId: "difo-xxx"` → dashboard shows DIFO's name
- [ ] Log in as a member with no `institutionId` → dashboard shows "Not selected"

### Scenario 4 — Institution app login is generic

- [ ] Open umuco app login → page title shows "KIRIMBA Institution Staff" (not "KIRIMBA Umuco")
- [ ] After login, home page shows "[Institution Name] Operations"

### Scenario 5 — Agent submit flow uses generic strings

- [ ] Agent records deposits for a group, pending batch appears
- [ ] Submit section header reads "Ready to Submit" (not "Ready to Submit to Umuco")
- [ ] After submitting, success toast reads "Batch submitted to institution. Batch ID: ..."

### Scenario 6 — Flagged batch notes display correctly for both old and new data

- [ ] Flag a new batch (writes `institutionNotes`) → agent daily summary shows the note
- [ ] View a historically flagged batch (has `umucoNotes`) → umuco BatchDetailScreen still shows the note

### Scenario 7 — Provisioning a new DIFO institution user

- [ ] Super admin calls `provisionInstitutionUser` with DIFO's `institutionId`
- [ ] Resulting user doc has `role: "institution_user"` and `institutionId: "<difo-id>"`
- [ ] Firebase Auth custom claims have `{ role: "institution_user", institutionId: "<difo-id>" }`
- [ ] New DIFO staff can log in to umuco app
- [ ] DIFO staff sees only DIFO batches in all screens
- [ ] DIFO staff cannot confirm Umuco batches

---

## Appendix — Institution Scope Check (Backend Pattern)

Applied in both `confirmBatch` and `flagBatch`:

```javascript
const callerRole = context.auth.token?.role;
const callerInstitutionId = context.auth.token?.institutionId || null;

if (callerRole === ROLES.INSTITUTION_USER && callerInstitutionId) {
  if (batchData.institutionId && batchData.institutionId !== callerInstitutionId) {
    throw httpsError(
      "permission-denied",
      "You can only confirm batches for your own institution."
    );
  }
}
```

Legacy `"umuco"` role bypasses this check (full access) until migration completes.

---

*Report generated: 2026-03-15*
