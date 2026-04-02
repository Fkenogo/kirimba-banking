# Institution Model Hardening — Implementation Report

**Date**: 2026-03-14
**Scope**: Harden institution data model, align backend + frontend, upgrade Institution Management to an operational console.

---

## 1. Files Changed

### Backend
| File | Change |
|------|--------|
| `functions/src/superAdmin.js` | Rewrote institution section: new `serializeInstitution` helper, expanded `createInstitution`, updated `getInstitutions`, updated `suspendInstitution`, updated `reactivateInstitution`, rewrote `backfillUmucoInstitution` as idempotent patch |
| `functions/src/agents.js` | `provisionInstitutionUser`: added required `institutionId` validation against `institutions/` collection + suspended-institution guard |

### Frontend
| File | Change |
|------|--------|
| `apps/admin/src/features/SuperAdmin/InstitutionManagementScreen.jsx` | Full rewrite — card layout, full schema display, upgraded create modal with all new fields |
| `apps/admin/src/features/Admin/CreateInstitutionUserScreen.jsx` | Replaced free-text `institutionId` input with a live dropdown loaded from `getInstitutions` |

---

## 2. Canonical Institution Schema

```typescript
// institutions/{institutionId}
{
  // ── Identity ──────────────────────────────────────────────────
  id:                        string,       // doc.id (FK used everywhere)
  name:                      string,       // required
  code:                      string,       // unique UPPER, 2–20 chars (e.g. "UMUCO")
  institutionType:           string | null, // "microfinance" | "bank" | "sacco" | "cooperative" | "other"

  // ── Contact ───────────────────────────────────────────────────
  contactName:               string | null,
  contactEmail:              string | null,
  contactPhone:              string | null,

  // ── Location ──────────────────────────────────────────────────
  country:                   string,       // ISO 2-letter, default "BI"
  currency:                  string,       // ISO 4217, default "BIF"

  // ── Capabilities ──────────────────────────────────────────────
  supportsDeposits:          boolean,      // default true
  supportsWithdrawals:       boolean,      // default true
  supportsLoans:             boolean,      // default false

  // ── Operations ────────────────────────────────────────────────
  settlementReferencePrefix: string | null, // e.g. "UMC" for UMUCO batches

  // ── Lifecycle ─────────────────────────────────────────────────
  status:                    "active" | "suspended",
  notes:                     string | null,
  createdAt:                 Timestamp,
  createdBy:                 string,       // uid
  updatedAt:                 Timestamp,
  updatedBy:                 string,       // uid
  suspendedAt:               Timestamp | null,
  suspendedBy:               string | null,
  suspendReason:             string | null,

  // ── Backfill tracking ─────────────────────────────────────────
  isBackfilled:              boolean,      // present only on backfilled docs
  backfilledAt:              Timestamp,    // present only on backfilled docs
}
```

---

## 3. Backward Compatibility Notes

- **No destructive migration.** All new fields are additive.
- Existing `institutions/umuco` document (thin, created by previous backfill) is automatically upgraded next time `backfillUmucoInstitution` is called — it patches only null/undefined fields.
- `getInstitutions` uses safe defaults when new fields are absent:
  - `supportsDeposits: d.supportsDeposits !== false` → defaults to `true` for old docs
  - `supportsWithdrawals: d.supportsWithdrawals !== false` → defaults to `true`
  - `supportsLoans: d.supportsLoans === true` → defaults to `false`
  - All string fields fall back to `null`.
- `users.institutionId` / `groups.institutionId` remain unchanged string FKs pointing to the Firestore doc ID — no migration needed.
- Umuco deposit batch flow (`confirmBatch`, `flagBatch`, etc.) does not read from `institutions/` directly, so no impact there.

---

## 4. Defaults Introduced

| Field | Default | Reason |
|-------|---------|--------|
| `country` | `"BI"` | Primary market is Burundi |
| `currency` | `"BIF"` | Burundi Franc |
| `supportsDeposits` | `true` | All current institutions handle deposits |
| `supportsWithdrawals` | `true` | All current institutions handle withdrawals |
| `supportsLoans` | `false` | Opt-in only — loan support is not universal |
| `status` | `"active"` | New institutions start active |

---

## 5. Functions Changed

### `getInstitutions`
- Added `serializeInstitution(doc)` helper that maps all fields with backward-compatible defaults
- Returns: `institutionType`, `contactName`, `contactPhone`, `country`, `currency`, `supportsDeposits`, `supportsWithdrawals`, `supportsLoans`, `settlementReferencePrefix`, `updatedAt`, `isBackfilled`

### `createInstitution`
- Now accepts and stores all new fields
- Sensible defaults applied server-side (country="BI", currency="BIF", supportsDeposits=true, etc.)
- Sets `updatedAt`/`updatedBy` equal to `createdAt`/`createdBy` on creation

### `suspendInstitution`
- Now writes `updatedAt`/`updatedBy` on every suspend

### `reactivateInstitution`
- Now writes `updatedAt`/`updatedBy` on every reactivation

### `backfillUmucoInstitution` (CRITICAL CHANGE)
**Before**: threw `already-exists` if doc existed.
**After**: idempotent patch — safe to run multiple times.
- If doc **does not exist**: creates it with full Umuco defaults
- If doc **exists**: reads current data, patches only fields that are `null` or `undefined`, never overwrites non-null values
- Always writes `updatedAt`/`updatedBy`
- Returns `{ action: "created" | "patched", patchedFields: string[] }`

### `provisionInstitutionUser` (`agents.js`)
- `institutionId` is now **required** (was optional)
- Validates the institution document exists in `institutions/` collection
- Validates the institution is not `suspended`
- Clear error messages: "Institution not found" / "Institution is suspended"

---

## 6. UI Screens Changed

### `InstitutionManagementScreen.jsx` (full rewrite)
**Layout**: Card-per-institution (replaces table — more readable with expanded schema)
Each card shows:
- Name + code badge + type badge + backfilled badge (if applicable)
- Status badge (active/suspended)
- Contact: name, email, phone
- Location: country (full name), currency
- Capabilities: Deposits / Withdrawals / Loans (green = supported, strikethrough = not)
- Settlement reference prefix
- Notes
- Created date, updated date
- Suspended date + reason (if suspended)

**Create modal**: Full schema form organized into fieldsets:
- Basic Info: name, code, institution type, settlement ref prefix
- Contact: contactName, contactEmail, contactPhone
- Location: country dropdown (BI/RW/UG/TZ/KE), currency dropdown
- Capabilities: three checkboxes (deposits=✓, withdrawals=✓, loans=☐ by default)
- Notes

**"Repair Umuco" button** (replaces "Backfill Umuco"):
- Idempotent — safe to click even if the doc already exists
- Shows patch result (action + list of patched fields) as dismissible green banner
- Confirm dialog before execution

**Empty state**: Explains how to use "Repair Umuco" when no institutions exist

### `CreateInstitutionUserScreen.jsx`
- Free-text `institutionId` input replaced with `<select>` dropdown
- Loads active institutions from `getInstitutions` on mount
- Auto-selects if only one active institution exists
- Disabled + "Loading institutions…" placeholder while loading
- `required` — cannot submit without selecting

---

## 7. Deploy Commands

```bash
# 1. Deploy updated backend functions
firebase deploy --only functions

# 2. Deploy updated admin frontend
firebase deploy --only hosting:admin

# Or deploy both at once:
firebase deploy --only functions,hosting:admin
```

---

## 8. Post-Deploy One-Time Action

**You need to click "Repair Umuco" once after deploy.**

Since `institutions/umuco` already exists (created by the earlier backfill) but is missing the new fields (`institutionType`, `country`, `currency`, `supportsDeposits`, `supportsWithdrawals`, `supportsLoans`, `settlementReferencePrefix`, `contactName`, `contactPhone`, `updatedAt`, `updatedBy`), the repair function will patch all of these with sensible defaults.

Steps:
1. Log in as `super_admin`
2. Navigate to **Admin Dashboard → Business Oversight → Institution Management**
3. Click **"Repair Umuco"** button
4. Confirm the dialog
5. Verify the green success banner shows `action: "patched"` with the list of new fields
6. Verify the Umuco card now shows country (Burundi), currency (BIF), capabilities (Deposits ✓, Withdrawals ✓, Loans ✗), type (microfinance)

The button is safe to click again at any time — it is fully idempotent.

---

## 9. Retest Checklist

### Institution Management
- [ ] Navigate to Admin Dashboard → Institution Management
- [ ] Confirm Umuco appears as a card (not "No institutions found")
- [ ] Click "Repair Umuco" → confirm dialog → green success banner appears with patched fields list
- [ ] Refresh page — Umuco card shows: type=microfinance, country=Burundi, currency=BIF, Deposits ✓, Withdrawals ✓, Loans ✗, settlementReferencePrefix=UMC
- [ ] Click "Repair Umuco" again — green banner shows `action: "patched"` with empty `patchedFields` (idempotent)
- [ ] Click "+ Create Institution" — full form opens with all fields
- [ ] Fill in all fields and create → new institution card appears in list
- [ ] Suspend an institution → card shows red status badge + suspended date
- [ ] Reactivate institution → card shows green active badge again

### Create Institution User
- [ ] Navigate to Admin Dashboard → Create Institution User
- [ ] Institution dropdown loads and shows "Umuco (UMUCO)"
- [ ] If only one institution, it is auto-selected
- [ ] Cannot submit without selecting an institution
- [ ] Create a test user → confirm success screen

### Deposit batch flow (regression)
- [ ] Agent records deposits and submits batch — no errors
- [ ] Umuco confirms/flags batch — no errors
- [ ] Verify `institutionId: "umuco"` FK references are still intact on user documents
