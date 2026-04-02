# DEPOSIT PIPELINE ALIGNMENT REPORT
**Date**: 2026-03-11
**Scope**: Leader membership, batch visibility for Umuco, Agent Today's Deposits index

---

## 1. Why Ordinary Member Deposits Work

The `recordDeposit` callable in `functions/src/savings.js`:
1. Authenticates the caller as an agent
2. Calls `getActiveMemberAndGroup(userId)` — reads `users/{userId}` and `groupMembers/{userId}`, falls back to `userData.groupId` if no groupMembers entry
3. Checks for a pre-existing pending deposit (one-at-a-time rule)
4. Creates the transaction inside a Firestore transaction that also verifies `agents/{agentId}` and `wallets/{userId}`

For ordinary members:
- `users.status = active` ✓
- `users.groupId` or `groupMembers.groupId` is set ✓
- `wallets/{uid}` exists (created by `onUserCreate` auth trigger) ✓
- `memberId` field present (set by `approveMember`) ✓

Result: `status: "pending_confirmation"`, `batchId: null`, transaction created successfully.

---

## 2. Why Leader Deposit Was Failing

### Root cause A — missing `users.groupId` for legacy leaders

`ScanDepositScreen.jsx` looks up the member by `memberId` from the `users` collection and returns the `groupId` field from there. If a leader was approved via `approveGroup` in an older version that didn't write `users.groupId`, the scan returns `groupId: null`. `getActiveMemberAndGroup` then finds no `groupMembers` entry (see below) and has nothing to fall back to → throws `"User is not linked to a group."`.

### Root cause B — leader not in `groupMembers` (legacy data)

`approveGroup` was updated at some point to create the `groupMembers/{leaderId}` entry, but leaders approved before that update have no entry. Without it:
- The agent member-lookup UI may not surface the leader in group-based queries
- `getActiveMemberAndGroup` falls back to `userData.groupId`, but if that too is missing (Root cause A), deposit fails

### What `approveGroup` was missing

The leader's `groupMembers` entry was created without the savings balance fields (`personalSavings`, `pendingSavings`, `lockedSavings`, `creditLimit`, `availableCredit`). These are required by the schema and used by loan eligibility checks.

---

## 3. Leader Fixes Applied

### `functions/src/members.js` — `approveGroup`

Added balance fields when creating a new `groupMembers` entry for the leader:

```js
// Initialise balance fields only on new entries — never overwrite real balances.
if (!leaderGroupMemberSnap.exists) {
  leaderGmPayload.personalSavings = 0;
  leaderGmPayload.pendingSavings = 0;
  leaderGmPayload.lockedSavings = 0;
  leaderGmPayload.creditLimit = 0;
  leaderGmPayload.availableCredit = 0;
}
```

`users.groupId` was already being set in the same transaction. `users.ledGroupId` is also set and preserved.

### `functions/src/members.js` — new `backfillLeaderGroupMembership` callable

New callable (super_admin / admin only). For each user with `role: "leader"`:
1. Skips leaders who already have a `groupMembers` entry
2. Patches entries missing `groupId` field
3. Creates the full `groupMembers` entry (all balance fields initialised to 0)
4. Patches `users.groupId` if null
5. Creates `wallets/{uid}` if missing
6. Increments `groups.memberCount`

Returns `{ processed, created, skipped, errors }`.

**Usage** (call once from admin console after deploy):
```js
const backfill = httpsCallable(functions, "backfillLeaderGroupMembership");
await backfill({});
```

---

## 4. Why Umuco Sees No Pending Deposits

### Root cause — `submitBatch` was never called from the agent UI

The complete pipeline in the backend:
```
recordDeposit → pending transaction (batchId: null)
submitBatch   → depositBatch (status: submitted) + transactions.batchId set
confirmBatch  → transactions confirmed, wallets updated
```

`submitBatch` callable exists and is fully implemented in `functions/src/savings.js`. However, the agent app (`apps/agent`) had **no UI to call it**. The agent home page only had:
- Scan Deposit
- Today's Deposits
- Business Dashboard
- Close Day

There was no "Submit Batch" or "Send to Umuco" action. Every deposit recorded sat forever as `pending_confirmation` with `batchId: null`. The `PendingBatchesScreen` in the Umuco app calls `getBatchesForGroup` which only returns documents in the `depositBatches` collection — of which there were none.

### Fix — batch submission UI added to `AgentDailySummaryScreen`

`apps/agent/src/features/Deposits/AgentDailySummaryScreen.jsx` now:
1. Identifies today's deposits with `batchId === null` and `status === "pending_confirmation"`
2. Groups them by `groupId`
3. Renders a "Ready to Submit to Umuco" section with one submit button per group
4. On click, calls `submitBatch({ groupId, transactionIds, idempotencyToken })` and reloads

The Umuco `PendingBatchesScreen` was already correctly wired — it reads `depositBatches` with `status: "submitted"`. No changes needed there.

---

## 5. Agent Today's Deposits — Index Added

### Query in `AgentDailySummaryScreen.jsx`

```js
query(
  collection(db, "transactions"),
  where("agentId", "==", user.uid),    // equality
  where("type", "==", "deposit"),       // equality
  where("createdAt", ">=", startOfToday())  // range
)
```

Firestore requires a composite index whenever a range filter is combined with equality filters on other fields. The existing transactions index (`groupId + createdAt`) does not cover this query.

### Index added to `firestore.indexes.json`

```json
{
  "collectionGroup": "transactions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "agentId", "order": "ASCENDING" },
    { "fieldPath": "type", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "ASCENDING" }
  ]
}
```

**Note**: The `createdAt` order is ASCENDING to match the range filter `>=`. Results are sorted newest-first client-side, which is already the existing behaviour.

---

## 6. Files Changed

| File | Change |
|------|--------|
| `functions/src/members.js` | `approveGroup`: add balance fields to leader groupMembers entry; add `backfillLeaderGroupMembership` callable |
| `functions/index.js` | Export `backfillLeaderGroupMembership` |
| `firestore.indexes.json` | Add `transactions: agentId + type + createdAt` composite index |
| `apps/agent/src/features/Deposits/AgentDailySummaryScreen.jsx` | Add batch submission UI + import `httpsCallable` and `functions` |

---

## 7. Deploy Commands Used

```bash
# Index deployed
firebase deploy --only firestore:indexes

# Functions deployed (approveGroup update + new backfillLeaderGroupMembership)
firebase deploy --only functions:approveGroup,functions:backfillLeaderGroupMembership
```

---

## 8. Retest Checklist

### Leader membership
- [ ] Call `backfillLeaderGroupMembership({})` from admin context and verify `{ created: N, errors: [] }` in response
- [ ] In Firestore, confirm `groupMembers/{leaderId}` exists with `groupId`, `personalSavings: 0`, `isActive: true`
- [ ] In Firestore, confirm `users/{leaderId}.groupId` is set
- [ ] Have agent scan leader QR / enter leader memberId — confirm member loads
- [ ] Record a deposit for the leader — confirm transaction created with correct `groupId`

### Batch pipeline
- [ ] Agent records deposits for at least one member in a group
- [ ] Open "Today's Deposits" screen — confirm "Ready to Submit to Umuco" section appears
- [ ] Click "Submit Batch" — confirm success banner with batchId
- [ ] In Firestore, confirm `depositBatches/{batchId}` has `status: "submitted"` and `transactionIds` populated
- [ ] In Firestore, confirm transactions have `batchId` set (no longer null)
- [ ] Log in as Umuco user — open Submitted Deposit Batches — confirm batch appears
- [ ] Click Open Batch — confirm batch detail screen loads
- [ ] Confirm batch — confirm `status: "confirmed"` in Firestore and wallets updated

### Agent Today's Deposits index
- [ ] Open "Today's Deposits" screen — confirm no "index required" error in console
- [ ] Verify deposits load for the current day

### Forward regression
- [ ] New `approveGroup` flow: approve a new group and verify leader's `groupMembers` entry has all 5 balance fields
- [ ] Ordinary member deposit — confirm not broken by any of the above changes
