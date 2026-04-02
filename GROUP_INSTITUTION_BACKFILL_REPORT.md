# Group Institution ID Backfill Report

> **Date**: 2026-03-15
> **Scope**: Legacy groups missing `institutionId`; `approveGroup` validation fix; downstream collection analysis

---

## Root Cause Summary

When groups were originally created in KIRIMBA (pre-multi-institution), `institutionId` was not enforced on the `groups` document. `createGroup` was later updated to require it, but:

1. **Pre-existing groups** (e.g. `8NlxIgXzwL287ZCvPPbo`) were never backfilled — their `institutionId` is `null` or absent.
2. **`approveGroup` did not repair missing `institutionId`** — it only stamped `status: "active"` and set up the leader, leaving the institution link broken.
3. **`submitBatch` reads `group.institutionId`** to stamp it on new `depositBatches`. If the group has `null`, the batch gets `institutionId: null` — invisible to both institutions' queues.

This means any agent submitting a batch for a legacy group produces an institutionally orphaned batch that appears in neither Umuco's nor DIFO's pending queue.

---

## Files Changed

| File | Change |
|------|--------|
| `functions/src/superAdmin.js` | Added `backfillGroupInstitutionIds` callable (idempotent, supports dry run, writes audit log) |
| `functions/src/members.js` | `approveGroup`: reads leader's user doc in Phase 1; stamps `institutionId` on group in Phase 2 if missing |
| `functions/index.js` | Exports `backfillGroupInstitutionIds` |

---

## Change Details

### `backfillGroupInstitutionIds` (superAdmin.js)

Callable by `super_admin` only. Algorithm:

```
For every group where institutionId is null/missing/empty:
  1. Read users/{leaderId}.institutionId
     → if found: use it (inferMethod = "leader")
  2. If still missing: query groupMembers where groupId==X AND isActive==true
     → fetch users/{uid}.institutionId for each active member
     → if all agree on exactly one value: use it (inferMethod = "members")
     → if multiple different values: skip, add to conflicts[]
     → if zero values: skip, add to notInferable[]
  3. Never write to a group that already has institutionId set
  4. Supports dryRun=true — previews without writing
  5. Writes audit log on successful real run
```

**Returns:**
```json
{
  "processed": 3,
  "updated": 2,
  "skipped": 1,
  "conflicts": [],
  "notInferable": [{ "groupId": "abc", "groupName": "...", "reason": "..." }],
  "updatedGroups": [
    { "groupId": "8NlxIgX...", "groupName": "Group A", "institutionId": "umuco", "inferMethod": "leader" }
  ],
  "dryRun": false,
  "message": "Updated 2 group(s). Skipped 1 (0 conflicts, 1 not inferable)."
}
```

### `approveGroup` validation fix (members.js)

In Phase 1 reads (before any writes), now also fetches:
```javascript
[leaderGroupMemberSnap, leaderUserSnap] = await Promise.all([
  tx.get(db.collection("groupMembers").doc(leaderId)),
  tx.get(db.collection("users").doc(leaderId)),    // ← NEW
]);
```

In Phase 2 writes, before activating the group:
```javascript
const existingInstId = group.institutionId || null;
const leaderInstId = leaderUserSnap?.exists
  ? (leaderUserSnap.data().institutionId || null)
  : null;
const groupActivatePayload = {
  status: GROUP_STATUS.ACTIVE,
  approvedAt: FieldValue.serverTimestamp(),
};
if (!existingInstId && leaderInstId) {
  groupActivatePayload.institutionId = leaderInstId;  // ← NEW: patch missing institutionId
}
tx.set(groupRef, groupActivatePayload, { merge: true });
```

This means going forward, every newly approved group will have `institutionId` set at approval time — it can never be left null as long as the leader has their `institutionId` set.

---

## Should depositBatches and transactions be backfilled?

### `depositBatches` — YES, for historical queries to work correctly

The umuco/DIFO institution dashboards filter batches by `where("institutionId", "==", institutionId)`. Batches created before the multi-institution fix (or from groups that still had `null` institutionId) have `institutionId: null` and will never appear in either institution's history screen.

**Impact**: Historical batch data will be invisible in institution dashboards. Not a safety issue (the actual deposit confirmations happened), but creates gaps in audit views.

**Recommended**: Run the group backfill first (which repairs the source of truth). Then run a one-time script to patch `depositBatches` where `institutionId == null` by looking up the group's (now-repaired) `institutionId`.

> This script is **not implemented** in this PR — it requires a separate `backfillBatchInstitutionIds` callable. Defer until group backfill is verified complete and correct.

### `transactions` — LOW PRIORITY

Transactions have `institutionId` set by `recordDeposit` at write time (from `group.institutionId`). If the group had `null`, the transaction also has `null`. However:

- Transaction queries in the current UI filter by `userId`, `groupId`, or `agentId` — **not** `institutionId`
- No institution-scoped transaction query currently exists
- The raw transaction data (amount, member, receipt) is correct

**Recommended**: Skip for now. If institution-scoped transaction reports are added later, a similar backfill can be run at that time.

---

## Exact Deploy Commands

```bash
# 1. Deploy functions only (no rule/index changes needed)
firebase deploy --only functions

# Verify deployment succeeds — check for errors:
firebase functions:log --only backfillGroupInstitutionIds
```

---

## Exact Backfill Run Steps

### Step 1 — Dry run (preview, no writes)

From the Firebase Functions shell or from any Super Admin UI that can call callables:

```javascript
// Firebase Admin SDK / Functions shell:
const result = await firebase.functions().httpsCallable('backfillGroupInstitutionIds')({ dryRun: true });
console.log(JSON.stringify(result.data, null, 2));
```

Or from the browser console (logged in as super_admin):
```javascript
const { getFunctions, httpsCallable } = await import('https://www.gstatic.com/firebasejs/10.x.x/firebase-functions.js');
const fn = httpsCallable(getFunctions(), 'backfillGroupInstitutionIds');
const r = await fn({ dryRun: true });
console.log(r.data);
```

**Review the output:**
- `processed` — how many groups need backfilling
- `updatedGroups` — groups that would be updated and their inferred `institutionId`
- `conflicts` — groups with members from multiple institutions (require manual resolution)
- `notInferable` — groups with no leader or member institution data (require manual fix)

### Step 2 — Resolve conflicts and notInferable manually (if any)

For each entry in `conflicts` or `notInferable`, set `institutionId` directly in Firestore Console:
```
Firestore → groups → {groupId} → Edit → institutionId: "umuco" (or correct value)
```

### Step 3 — Run for real

```javascript
const fn = httpsCallable(functions, 'backfillGroupInstitutionIds');
const r = await fn({ dryRun: false });
console.log(r.data);
// Expected: updated: N, skipped: 0, conflicts: [], notInferable: []
```

### Step 4 — Verify in Firestore

```
Firestore → groups → filter where institutionId == null → should return 0 results
```

Also manually verify the known group from the issue:
```
Firestore → groups → 8NlxIgXzwL287ZCvPPbo → institutionId should now be "umuco"
```

---

## Retest Checklist

### Backfill verification

- [ ] Dry run returns `updatedGroups` containing `8NlxIgXzwL287ZCvPPbo` with `institutionId: "umuco"`
- [ ] Dry run shows `group3` (with `institutionId: "MVMICrbccp7YOljsPVG0"`) is **not** in `updatedGroups` (already has institutionId)
- [ ] Real run returns `updated ≥ 1`, `conflicts: []` (or resolved)
- [ ] After run: Firestore `groups/8NlxIgXzwL287ZCvPPbo.institutionId == "umuco"`
- [ ] Audit log entry written to `auditLog` collection with `action: "group_institution_backfill"`

### approveGroup forward-fix verification

- [ ] Create a new group as a member who has `institutionId: "umuco"` set
- [ ] Approve the group via Super Admin
- [ ] Verify `groups/{newGroupId}.institutionId == "umuco"` is set at approval time
- [ ] Verify this works even if `createGroup` had written `institutionId: null` (old path)

### End-to-end batch routing after backfill

- [ ] Agent submits a batch for the previously-broken group (`8NlxIgXzwL287ZCvPPbo`)
- [ ] New `depositBatches` doc has `institutionId: "umuco"`
- [ ] Batch appears in Umuco's Pending Batches screen
- [ ] Batch does **not** appear in DIFO's Pending Batches screen

### Idempotency

- [ ] Run `backfillGroupInstitutionIds({ dryRun: false })` twice — second run returns `updated: 0` (nothing to update)
