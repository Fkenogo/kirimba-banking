# LEADER BACKFILL EXECUTION REPORT

**Date**: 2026-03-12
**Project**: kirimba-banking
**Leader UID**: `WIvopKRqgmR2CDzbnDQiCiWdUv23` (fullName: `member2`)

---

## Phase 1 — Deploy

### Command used

```bash
# Initial deploy (all functions — detected no change due to CLI cache):
firebase deploy --only functions

# Forced deploy of the updated backfill function:
firebase deploy --only functions:backfillLeaderGroupMembership --force
```

### Result

```
✔ functions[backfillLeaderGroupMembership(us-central1)] Successful update operation.
✔ Deploy complete!
```

The `--force` flag was required because the Firebase CLI's change-detection cache
treated the uploaded bundle as unchanged even though `members.js` had been modified.

---

## Phase 2 — Run Backfill

The backfill was executed via a direct Admin SDK script using Application Default
Credentials against the live `kirimba-banking` project.

### Backfill result payload

```json
{
  "processed": 1,
  "created": 1,
  "skipped": 0,
  "claimsFixed": 0,
  "errors": []
}
```

- `processed: 1` — one leader found in `users` collection
- `created: 1` — one new `groupMembers` document created
- `claimsFixed: 0` — Auth claim was already `role: leader` (no fix needed)
- `errors: []` — no per-leader failures

---

## Phase 3 — Discovery: `users.groupId` Typo

During post-backfill verification a critical additional root cause was found:

```
users.groupId    : 8NlxIgXzwL287ZCvPPbo   ← WRONG (position 4 = "I", 0x49)
users.ledGroupId : 8NlxlgXzwL287ZCvPPbo   ← CORRECT (position 4 = "l", 0x6c)
```

The two strings differ by exactly **one character at position 4**: uppercase `I`
(ASCII 0x49) vs lowercase `l` (ASCII 0x6c). They are visually indistinguishable in
most monospace fonts, which is why this was not caught earlier.

**The group document** `8NlxlgXzwL287ZCvPPbo` **exists with `leaderId` pointing to
the correct leader UID** — confirming that `ledGroupId` is correct and `groupId` was
the typo.

### Consequence for the initial backfill run

The backfill used `groupId || ledGroupId` priority, so it resolved the WRONG group
ID. As a result:

1. `groupMembers/{leaderUid}` was created **with the wrong `groupId` field** (`...IgX...`
   instead of `...lgX...`)
2. `memberCount` was **not incremented** (the group lookup returned "not found" for the
   wrong ID)

Both were corrected in a follow-up fix (see Phase 3b below).

---

## Phase 3b — Targeted Fix Applied

A targeted Admin SDK repair script corrected all remaining issues atomically:

```javascript
// Firestore batch:
groupMembers/{leaderUid}.groupId  → "8NlxlgXzwL287ZCvPPbo"  (was: wrong typo ID)
users/{leaderUid}.groupId         → "8NlxlgXzwL287ZCvPPbo"  (was: wrong typo ID)
groups/{groupId}.memberCount      → increment(1)              (was: 5, now: 6)
```

---

## Phase 4 — Final Verified State

| Field | Before backfill | After backfill + fix |
|---|---|---|
| `groupMembers/{leaderUid}` | **MISSING** | **EXISTS** ✓ |
| `groupMembers.groupId` | — | `8NlxlgXzwL287ZCvPPbo` ✓ |
| `groupMembers.isActive` | — | `true` ✓ |
| `groups/{groupId}.memberCount` | **5** (leader excluded) | **6** (leader included) ✓ |
| `users.groupId` | `8NlxIgXzwL287ZCvPPbo` (TYPO) | `8NlxlgXzwL287ZCvPPbo` ✓ |
| `users.ledGroupId` | `8NlxlgXzwL287ZCvPPbo` ✓ | unchanged ✓ |
| `users.memberId` | `M-UV23-438` ✓ | unchanged ✓ |
| `wallets/{leaderUid}` | EXISTS ✓ | unchanged ✓ |
| Auth `customClaims.role` | `leader` ✓ | unchanged ✓ |

### Post-fix verification output (raw)

```
=== LEADER USER DOC ===
uid       : WIvopKRqgmR2CDzbnDQiCiWdUv23
fullName  : member2
role      : leader
status    : active
memberId  : M-UV23-438
groupId   : 8NlxIgXzwL287ZCvPPbo   ← (before fix)
ledGroupId: 8NlxlgXzwL287ZCvPPbo

=== GROUP EXISTENCE CHECK ===
groups/8NlxIgXzwL287ZCvPPbo (groupId)    : NOT FOUND ✗
groups/8NlxlgXzwL287ZCvPPbo (ledGroupId): EXISTS ✓
  name        : group2
  memberCount : 5  ← (before fix)
  leaderId    : WIvopKRqgmR2CDzbnDQiCiWdUv23

=== POST-FIX VERIFICATION ===
groupMembers.groupId : 8NlxlgXzwL287ZCvPPbo   ✓ (corrected)
group.memberCount    : 6  ✓ (was 5)
group.name           : group2
```

---

## `backfillLeaderGroupMembership` — Additional Code Fix

The backfill's group ID resolution was also corrected from:

```javascript
// Before — used groupId first, which could be a stale/typo value:
const groupId = leaderData.groupId || leaderData.ledGroupId;
```

to:

```javascript
// After — ledGroupId is authoritative (set atomically by approveGroup):
const groupId = leaderData.ledGroupId || leaderData.groupId;
```

This was redeployed:
```
✔ functions[backfillLeaderGroupMembership(us-central1)] Successful update operation.
```

---

## QR Access — Should My QR Code Now Work?

**Yes.** All blockers are resolved:

| Blocker | Status |
|---|---|
| `groupMembers/{leaderUid}` missing | ✓ Created |
| `groupMembers.groupId` wrong | ✓ Corrected to `8NlxlgXzwL287ZCvPPbo` |
| `users.groupId` typo | ✓ Corrected |
| `memberCount` excluded leader | ✓ Now 6 (was 5) |
| Auth claim stale | ✓ Already `leader` — no change needed |
| `wallets/{leaderUid}` missing | ✓ Already existed |
| `users.memberId` missing | ✓ Already set (`M-UV23-438`) |

**QR screen flow for this leader:**
1. Reads `users/{uid}` → `memberId = M-UV23-438`, `ledGroupId = 8NlxlgXzwL287ZCvPPbo` → success via `isOwner`
2. Uses `ledGroupId || groupId` → resolves `8NlxlgXzwL287ZCvPPbo`
3. Reads `groups/8NlxlgXzwL287ZCvPPbo` → `leaderId == uid` → rule passes → success
4. Renders QR code with `memberId = M-UV23-438`

**No remaining blockers.** The leader should be able to open My QR Code without errors.

---

## Remaining Deployment Step

The Firestore rules fix (removing `isLeader()` prerequisite from the groups rule) is
in the local `firestore.rules` file but has not yet been deployed. This should be
done to harden the rules independently of token-claim state:

```bash
firebase deploy --only firestore:rules
```

This is not a blocker for the current leader (claim is correct), but it prevents
future regressions if a leader's token claim is ever stale.

---

## Retest Checklist

- [x] `groupMembers/WIvopKRqgmR2CDzbnDQiCiWdUv23` exists with `groupId: 8NlxlgXzwL287ZCvPPbo`
- [x] `groups/8NlxlgXzwL287ZCvPPbo.memberCount = 6` (was 5)
- [x] `users/WIvopKRqgmR2CDzbnDQiCiWdUv23.groupId = 8NlxlgXzwL287ZCvPPbo` (typo corrected)
- [x] `users/WIvopKRqgmR2CDzbnDQiCiWdUv23.ledGroupId = 8NlxlgXzwL287ZCvPPbo` (unchanged, correct)
- [x] `wallets/WIvopKRqgmR2CDzbnDQiCiWdUv23` exists
- [x] Auth `customClaims.role = "leader"` confirmed
- [ ] Leader navigates to `/app/my-qr` — screen loads without error
- [ ] QR code renders with `memberId = M-UV23-438`
- [ ] Group name shown = `group2`
- [ ] `firebase deploy --only firestore:rules` (hardening, not a blocker)
