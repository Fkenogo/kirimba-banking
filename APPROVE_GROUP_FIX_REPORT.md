# `approveGroup` Production Crash Fix — Report

**Date**: 2026-03-15
**Symptom**: Clicking "Approve" on any group in Admin → Pending Approvals failed with:
`internal: Failed to approve group`

---

## Root Cause

**File**: `functions/src/members.js`
**Exact failing line**: `tx.get(leaderGroupMemberRef)` at line 392

```
Unhandled error Error: Firestore transactions require all reads to be executed before all writes.
    at Transaction.get (/workspace/node_modules/@google-cloud/firestore/build/src/transaction.js:97:19)
    at /workspace/src/members.js:392:44
```

The Firestore Admin SDK enforces a strict rule: **all `transaction.get()` calls must come before any `transaction.set()`, `transaction.update()`, or `transaction.create()` calls.**

The old `approveGroup` transaction violated this rule. The sequence was:

```javascript
// OLD — BROKEN
const groupSnap = await tx.get(groupRef);              // ✓ read
const leaderId = groupSnap.data().leaderId;

tx.set(groupRef, { status: "active", ... }, ...);      // ✗ WRITE — too early!

// ...later...
const leaderGroupMemberSnap = await tx.get(             // ✗ READ after write → CRASH
  db.collection("groupMembers").doc(leaderId)
);
```

This crash affected **every group with a `leaderId`** — which is every real group. The bug predated institution changes; it surfaced during DIFO testing but was not institution-specific.

---

## Fix

Restructured the transaction into two explicit phases:

```javascript
// NEW — FIXED
await db.runTransaction(async (tx) => {
  // ── Phase 1: ALL reads ────────────────────────────────────────────────────
  const groupSnap = await tx.get(groupRef);
  const leaderId = groupSnap.data()?.leaderId || null;

  let leaderGroupMemberSnap = null;
  if (leaderId) {
    leaderGroupMemberSnap = await tx.get(
      db.collection("groupMembers").doc(leaderId)
    );
  }

  // ── Phase 2: ALL writes ───────────────────────────────────────────────────
  tx.set(groupRef, { status: "active", approvedAt: FieldValue.serverTimestamp() }, { merge: true });
  // ... remaining writes using data from Phase 1 reads
});
```

Additional hardening:
- Wrapped `auth.setCustomUserClaims(leaderId, ...)` (called outside the transaction) in `try/catch` so a claim failure logs an error but does not crash the function — the group is still approved.
- Added `console.warn` when a group has no `leaderId` (activates the group without leader setup rather than crashing silently).

---

## Files Changed

| File | Change |
|------|--------|
| `functions/src/members.js` | Restructured `approveGroup` transaction into explicit Phase 1 (all reads) and Phase 2 (all writes); wrapped `setCustomUserClaims` in try/catch |

No frontend changes. No Firestore rule changes. No index changes.

---

## Data Migration

**None required.**

This is a pure code bug fix. No Firestore documents were written incorrectly — the function was crashing before any writes committed. Existing group documents remain in `pending_approval` status and can be approved normally after the fix is deployed.

---

## Deploy Commands

```bash
# Deploy backend only (this fix is functions-only)
firebase deploy --only functions

# Or combined with pending frontend changes:
firebase deploy --only functions,hosting:member,hosting:admin
```

---

## Retest Checklist

- [ ] Log in as `super_admin`
- [ ] Navigate to Admin Dashboard → Pending Approvals
- [ ] Approve a group with a leader
- [ ] Confirm success — no "internal: Failed to approve group" error
- [ ] Verify in Firestore: `groups/{groupId}.status = "active"`, `approvedAt` is set
- [ ] Verify leader user: `users/{leaderId}.role = "leader"`, `isLeader = true`, `groupId` is set
- [ ] Verify `groupMembers/{leaderId}` document exists with zero balances
- [ ] Log out and log in as the leader — confirm `leader` role claim is active
- [ ] Approve a group **without** a leader (if any exist) — confirm it activates without error

---

## Why This Was Hard to Catch

The Firestore **client SDK** (used in frontend apps) allows reads and writes to interleave freely in transactions. Only the **Admin SDK** (used in Cloud Functions) enforces the strict reads-before-writes ordering. The function appeared correct to anyone familiar with client-side Firestore patterns.
