# RECORD_DEPOSIT_LIVE_DEPLOY_REPORT

**Date**: 2026-03-11

---

## Root Cause

Live deployed drift. The production function was running an older revision that still contained:

1. Strict member-group resolution that did NOT fall back to `users.ledGroupId`, causing leaders (who have `ledGroupId` but no `groupId`) to get `"User is not linked to a group."`
2. An `assignedGroups` gate on the agent that blocked all deposits with `"Agent not assigned to any groups."`

The current source in `functions/src/savings.js` had already fixed both issues but the fix was never deployed to production.

---

## Source Logic Confirmed (savings.js)

### Member group resolution (`getActiveMemberAndGroup`, line 69)
```js
const groupId = memberData?.groupId || userData.groupId || userData.ledGroupId;
```
Resolution order:
1. `groupMembers/{uid}.groupId`
2. `users/{uid}.groupId`
3. `users/{uid}.ledGroupId`

This correctly handles leaders (who have `ledGroupId` populated but no `groupId`).

### Agent validation (lines 219–230)
```js
const agentDoc = await tx.get(db.collection("agents").doc(agentId));
if (!agentDoc.exists) { throw ... "Agent profile not found." }
if (agentData.role !== ROLES.AGENT) { throw ... }
if (agentData.status !== USER_STATUS.ACTIVE) { throw ... }
```
No `assignedGroups` check exists anywhere in `recordDeposit`. Any active agent can record a deposit for any active member.

---

## Deploy Command

```
firebase deploy --only functions:recordDeposit --project kirimba-banking
```

## Deploy Result

```
✔  functions[recordDeposit(us-central1)] Successful update operation.
✔  Deploy complete!
```

---

## Temporary Version Marker

Added to the top of `recordDeposit` to confirm the new revision is live in function logs:

```js
console.log("RECORD_DEPOSIT_VERSION=flex-agent-v2");
```

To verify the new revision is running, check Firebase Functions logs for `RECORD_DEPOSIT_VERSION=flex-agent-v2` after the next deposit call. Once confirmed, remove this log line and redeploy.

---

## Was Live Drift the Root Cause?

**Yes.** Both observed errors match the behaviour of the old implementation exactly:

| Observed Error | Old Logic |
|---|---|
| `"User is not linked to a group."` for a leader with `ledGroupId` | Old resolver only checked `groupMembers` + `users.groupId`, ignored `ledGroupId` |
| `"Agent not assigned to any groups."` for a normal member | Old code had an `assignedGroups` array gate on the agent document |

The source had already removed both. The live function had not been redeployed after those fixes were committed.

---

## Retest Steps

1. As an agent (active, no `assignedGroups` required), call `recordDeposit` for:
   - A **normal member** (has `users.groupId`) — should return `{ success: true, transactionId, receiptNo }`
   - A **leader** (has `users.ledGroupId` only) — should return `{ success: true, transactionId, receiptNo }`
2. Check Firebase Functions logs for `RECORD_DEPOSIT_VERSION=flex-agent-v2` to confirm new revision is serving.
3. Once both cases pass, remove the `console.log` version marker from `savings.js` and redeploy.
