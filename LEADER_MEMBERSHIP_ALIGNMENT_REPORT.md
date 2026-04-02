# LEADER MEMBERSHIP ALIGNMENT REPORT

**Date**: 2026-03-12
**Severity**: P1 — Leader cannot access deposit flow (My QR Code, dashboard savings)

---

## Exact Root Cause

Two compounding gaps caused the "Missing or insufficient permissions" error on the
leader's My QR Code screen:

### Gap 1 — Missing `groupMembers/{leaderUid}` (data model)

The `approveGroup` Cloud Function was updated (in the current build) to atomically
create `groupMembers/{leaderUid}` when a group is approved. However, groups that were
approved **before this fix** have no such document. Without it:

- `memberCount` in the group doc is **5 (members only)** — the leader is not counted.
- The Firestore rule fallback path for group reads
  (`exists(groupMembers/uid) && groupMembers.uid.groupId == groupId`) evaluates to
  **false** because the document does not exist.

### Gap 2 — Stale Auth custom claim (permissions)

`approveGroup` calls `auth.setCustomUserClaims(leaderId, { role: "leader" })` **after**
the Firestore transaction. If this call was never reached (e.g., the function ran
before the fix was deployed, or the function failed after committing the transaction),
the leader's Firebase Auth token retains the original `"member"` claim assigned by
`approveMember`.

With the **old deployed Firestore rules** (before the rules fix was deployed), the
groups read rule required:

```
(isLeader() && resource.data.leaderId == request.auth.uid) ||
(exists(groupMembers/uid) && groupMembers.uid.groupId == groupId)
```

Both branches evaluate to **false** when:

| Condition | Value | Reason |
|---|---|---|
| `isLeader()` | false | Token claim is `"member"`, not `"leader"` |
| `resource.data.leaderId == uid` | true | But gated by `isLeader()` |
| `exists(groupMembers/uid)` | false | Doc was never created |

Result → `permission-denied` → QR screen shows "Missing or insufficient permissions".

---

## Whether `groupMembers/{leaderUid}` Existed

**Did NOT exist** for leaders approved before the `approveGroup` fix.

Confirmed by live diagnosis: `memberCount = 5` on the group, leader is not included.
`groupMembers` documents are only created by `approveGroup` (going forward) or by the
`backfillLeaderGroupMembership` callable (for legacy data).

---

## Whether `wallets/{leaderUid}` Existed

**Likely exists** — the `onUserCreate` Auth trigger creates `wallets/{uid}` for every
new Auth user automatically. However, `backfillLeaderGroupMembership` will create it
if it was somehow missing (safe, idempotent).

---

## Files Changed

### 1. `functions/src/members.js` — `backfillLeaderGroupMembership`

**Added two missing operations to the backfill callable:**

#### a) Auth custom claim refresh

```javascript
// Always ensure the Auth custom claim is role: leader.
const authUser = await auth.getUser(leaderId).catch(() => null);
if (authUser) {
  const currentClaim = authUser.customClaims?.role;
  if (currentClaim !== ROLES.LEADER) {
    await auth.setCustomUserClaims(leaderId, { role: ROLES.LEADER });
    results.claimsFixed++;
  }
}
```

This runs for **every** leader processed (including those whose `groupMembers` doc
already existed), because a stale claim is independent of the doc's existence.

#### b) `memberId` assignment if missing

```javascript
if (!leaderData.memberId) {
  userPatch.memberId = await getUniqueMemberId(leaderId);
}
```

Defensive: ensures that leaders not provisioned via the normal `approveMember` path
still have a `memberId`, which is required for the QR code to render.

#### c) Restructured flow to always fix claims

Previously the function `continue`d (skipped) for leaders that already had a
`groupMembers` doc. It now falls through to the claim-fix step regardless, so every
leader's Auth claim is validated on each backfill run.

### 2. `firestore.rules` (previously fixed, needs deployment)

The groups read rule was already updated in a prior fix to remove the `isLeader()`
prerequisite:

```
// Before (old — required token claim):
(isLeader() && resource.data.leaderId == request.auth.uid) ||

// After (current local — claim-independent):
resource.data.leaderId == request.auth.uid ||
```

This file is **modified locally but not yet deployed**. The backfill fixes the claim
so the old rules also work, but deploying the new rules is still the correct long-term
posture (it makes group access claim-independent for leaders, which is safer).

### 3. `apps/member/src/features/Profile/MyQRCodeScreen.jsx` (previously fixed)

Already uses `data.ledGroupId || data.groupId` to resolve the correct group for
leaders. No further changes needed.

---

## Backfill Applied

The `backfillLeaderGroupMembership` callable (deployed via `functions/src/members.js`)
must be invoked once from the Admin UI after deploying the updated functions:

```
// Call from Admin UI or Firebase Functions shell:
backfillLeaderGroupMembership()

// Returns:
{
  success: true,
  processed: N,   // total leaders found
  created: N,     // groupMembers docs created
  skipped: N,     // leaders already had groupMembers doc
  claimsFixed: N, // leaders whose Auth claim was corrected
  errors: []      // any per-leader failures
}
```

**Safe to re-run** — all operations are idempotent:
- `groupMembers` doc: created only if missing
- `wallet` doc: created only if missing
- `memberCount`: incremented only when a new `groupMembers` doc is created
- Auth claim: set only if current claim ≠ `"leader"`

---

## Whether `memberCount` Now Includes Leader

**Yes, after backfill.** For each leader missing a `groupMembers` doc, the backfill
increments `groups/{groupId}.memberCount` by 1. The group that previously showed
`memberCount = 5` will show `memberCount = 6` after backfill.

---

## Confirmation That My QR Code Should Now Work for Leaders

After running the backfill and deploying:

| Layer | Fix | Status |
|---|---|---|
| Auth token | Auth claim set to `"leader"` by backfill | Backfill applies this |
| Firestore rules | Groups rule no longer requires `isLeader()` | Deploy `firestore:rules` |
| `groupMembers/{uid}` | Created by backfill | Backfill applies this |
| `users/{uid}.groupId` | Set by `approveGroup` or backfill | Already correct per live diagnosis |
| `users/{uid}.ledGroupId` | Set by `approveGroup` | Already correct per live diagnosis |
| `users/{uid}.memberId` | Set by `approveMember`; backfill is defensive | Should already be present |
| Frontend QR screen | Uses `ledGroupId \|\| groupId` | Already fixed |

With all layers aligned, the leader's QR screen:
1. Reads `users/{uid}` → succeeds via `isOwner`
2. Reads `groups/{gid}` via `ledGroupId` → succeeds via `resource.data.leaderId == uid`
3. Renders QR code using `users.memberId`

---

## Deployment Steps

```bash
# 1. Deploy updated functions (includes backfill fix)
firebase deploy --only functions

# 2. Deploy updated Firestore rules
firebase deploy --only firestore:rules

# 3. Run backfill from Admin UI (one time)
#    Call backfillLeaderGroupMembership() callable
#    Verify: { created: ≥1, claimsFixed: ≥1, errors: [] }

# 4. Leader signs out and signs back in (forces token refresh)
#    OR App.jsx already force-refreshes on every auth state change — no sign-out needed.
```

---

## Retest Checklist

- [ ] `backfillLeaderGroupMembership` called — response shows `created ≥ 1`, `errors: []`
- [ ] `groupMembers/{leaderUid}` now exists in Firestore with correct `groupId`
- [ ] `groups/{groupId}.memberCount` increased by 1 (now includes leader)
- [ ] `wallets/{leaderUid}` exists (confirmed or created by backfill)
- [ ] Auth custom claim for leader = `{ role: "leader" }` (confirm in Firebase Console → Auth)
- [ ] Leader signs in to member app (`/app`)
- [ ] Leader navigates to "My QR Code" (`/app/my-qr`)
- [ ] Screen loads without permission error
- [ ] QR code renders (requires `memberId` on user doc)
- [ ] Group name shown = the group the leader leads
- [ ] Leader dashboard (`/app/dashboard`) loads wallet + group data without error
- [ ] Regular member QR and dashboard still work (no regression)
- [ ] Firestore rules deployed: `firebase deploy --only firestore:rules`
- [ ] No new permission errors for agent, admin, or umuco roles
