# Agent Array Model Diff

> **Date**: 2026-03-03
> **File changed**: `functions/src/agents.js` only
> **Root cause**: `agents.js` wrote scalar `assignedGroupId`; `savings.js:recordDeposit` reads array `assignedGroups`. Any provisioned agent would always fail `recordDeposit` with `permission-denied: Agent not assigned to any groups`.
> **Resolution**: Align `agents.js` to the array model already in use by `savings.js`.
> **Commits**: None

---

## Root Cause Detail

`savings.js:recordDeposit` (unchanged, pre-existing) reads:

```javascript
const allowedGroups = agentData.assignedGroups || [];   // expects array

if (allowedGroups.length === 0)
  throw permission-denied "Agent not assigned to any groups"

if (!allowedGroups.includes(memberGroupId))
  throw permission-denied "Agent cannot record deposits for this member"
```

`agents.js` (as previously written) produced documents with:
```javascript
// agents/{uid} after provisionAgent
{ assignedGroupId: null }          // field name wrong, type wrong

// agents/{uid} after assignAgentToGroup
{ assignedGroupId: "groupId123" }  // still wrong field name
```

`agentData.assignedGroups` was always `undefined`, so `agentData.assignedGroups || []` always evaluated to `[]`, and `allowedGroups.length === 0` always threw. The deposit flow was entirely broken for all provisioned agents.

---

## Diff — `functions/src/agents.js`

### Change 1 — `provisionAgent`: initial `agents/{uid}` document (line 118)

```diff
   batch.set(agentRef, {
     uid,
     fullName: fullName.trim(),
     phone: normalizedPhone,
     role: ROLES.AGENT,
     status: "active",
-    assignedGroupId: null,
+    assignedGroups: [],
     createdAt: FieldValue.serverTimestamp(),
     createdBy: callerUid,
     updatedAt: null,
   });
```

New agents are initialised with an empty array. `savings.js` reads `agentData.assignedGroups || []` — an empty array satisfies this read safely and correctly triggers `"Agent not assigned to any groups"` until a group is assigned.

---

### Change 2 — `assignAgentToGroup`: duplicate-assignment guard (line 160)

```diff
-  if (agentData.assignedGroupId != null) {
-    throw httpsError("already-exists", "Agent is already assigned to a group.");
-  }
+  if ((agentData.assignedGroups || []).includes(groupId)) {
+    throw httpsError("already-exists", "Agent is already assigned to this group.");
+  }
```

**Semantic change**: the old scalar check prevented any second assignment at all. The new check prevents duplicate assignment of the **same group** — an agent can now be assigned to multiple distinct groups, matching the array model. Attempting to assign the same `groupId` twice still throws `already-exists`.

The `|| []` guard handles legacy documents that may have been written without the `assignedGroups` field.

---

### Change 3 — `assignAgentToGroup`: batch writes (lines 174, 177)

```diff
   const batch = db.batch();
   batch.update(agentRef, {
-    assignedGroupId: groupId,
+    assignedGroups: FieldValue.arrayUnion(groupId),
     updatedAt: FieldValue.serverTimestamp(),
   });
   batch.set(
     db.collection("users").doc(agentId),
-    { assignedGroupId: groupId, updatedAt: FieldValue.serverTimestamp() },
+    { assignedGroups: FieldValue.arrayUnion(groupId), updatedAt: FieldValue.serverTimestamp() },
     { merge: true }
   );
```

`FieldValue.arrayUnion(groupId)` is atomic and idempotent: if `groupId` is already present in the array it is not added again, producing no duplicate entries. This is the correct Firestore primitive for additive array membership.

Both the `agents/{uid}` document and the `users/{uid}` mirror are updated with the same field name for consistency. The `users/{uid}` write is informational — `recordDeposit` reads only from `agents/{uid}`.

---

## End-to-End Flow After Fix

| Step | Operation | Field written | Field read |
|---|---|---|---|
| 1 | `provisionAgent` | `agents/{uid}.assignedGroups = []` | — |
| 2 | `assignAgentToGroup("agentUid", "groupA")` | `agents/{uid}.assignedGroups = ["groupA"]` | — |
| 3 | `assignAgentToGroup("agentUid", "groupA")` again | throws `already-exists` | — |
| 4 | `assignAgentToGroup("agentUid", "groupB")` | `agents/{uid}.assignedGroups = ["groupA", "groupB"]` | — |
| 5 | `recordDeposit` for member in groupA | — | `agentData.assignedGroups = ["groupA", "groupB"]` → `includes("groupA")` → passes |
| 6 | `recordDeposit` for member in groupC | — | `agentData.assignedGroups = ["groupA", "groupB"]` → `includes("groupC")` → `permission-denied` |

---

## What Was Not Changed

| Item | Status |
|---|---|
| `savings.js` | Untouched — `assignedGroups` field name and array logic already correct |
| `requireSuperAdmin` guard | Untouched |
| `provisionAgent` auth, validation, PIN hashing, Auth user creation, claim setting, `users/{uid}` write | Untouched |
| `assignAgentToGroup` auth, input validation, agent existence/role/status checks, group existence/status checks | Untouched |
| All other backend files | Untouched |
| `firestore.rules`, `functions/index.js` | Untouched |

---

## Summary

| Location | Before | After |
|---|---|---|
| `agents/{uid}` initial field | `assignedGroupId: null` | `assignedGroups: []` |
| `agents/{uid}` assignment write | `{ assignedGroupId: groupId }` | `{ assignedGroups: arrayUnion(groupId) }` |
| `users/{uid}` assignment mirror | `{ assignedGroupId: groupId }` | `{ assignedGroups: arrayUnion(groupId) }` |
| Duplicate guard | `assignedGroupId != null` (any group) | `assignedGroups.includes(groupId)` (same group) |
| Multi-group support | No | Yes |
| `savings.js` compatibility | Broken | Resolved |
