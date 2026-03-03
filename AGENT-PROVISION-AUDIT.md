# AGENT-PROVISION-AUDIT.md

> **Date**: 2026-03-03
> **Scope**: Backend only — `functions/` directory + `firestore.rules`
> **Purpose**: Audit how agent accounts are provisioned and what the `agents` collection requires

---

## Question 1: Is there any Cloud Function that creates an agent document in the `agents` collection?

**Answer: NO.**

No Cloud Function creates a document in `agents/{uid}`.

The full set of write paths in the backend is:

| Function | Collection Written | Document |
|---|---|---|
| `registerMember` | `users/{uid}` | role: `member`, status: `pending_approval` |
| `onUserCreate` (Auth trigger) | `users/{uid}`, `wallets/{uid}` | role: `member` |
| `approveMember` | `users/{uid}` | status: `active` |
| `rejectMember` | `users/{uid}` | status: `rejected` |
| `createGroup` | `groups/{groupId}`, `users/{uid}` | — |
| `approveGroup` | `groups/{groupId}`, `users/{uid}` | — |
| `joinGroup` | `groups/{groupId}/joinRequests/{uid}` | — |
| `approveJoinRequest` | `groupMembers/{userId}`, `users/{userId}`, `groups/{groupId}` | — |
| `resetPIN` | `users/{userId}` | pinHash only |
| `recordDeposit` | `transactions/{id}`, `groupMembers/{userId}`, `groups/{groupId}` | reads `agents/{agentId}` but never writes it |
| `submitBatch` | `depositBatches/{id}`, `transactions/{id}` | — |
| `recordWithdrawal` | `withdrawalRequests/{id}` or `transactions/{id}`, `groupMembers/{userId}`, `groups/{groupId}` | — |
| `confirmBatch` | `depositBatches/{id}`, `transactions/{id}`, `groupMembers/{userId}`, `groups/{groupId}`, `kirimbaFund/current` | — |
| `flagBatch` | `depositBatches/{id}`, `notifications/{id}` | — |
| `requestLoan` | `loans/{id}` | — |
| `disburseLoan` | `loans/{id}`, `groupMembers/{userId}`, `kirimbaFund/current`, `transactions/{id}`, `fundMovements/{id}` | — |
| `recordRepayment` | `loans/{id}`, `groupMembers/{userId}`, `kirimbaFund/current`, `transactions/{id}`, `fundMovements/{id}` | — |
| `markLoanDefaulted` | `loans/{id}`, `notifications/{id}` | — |

**The `agents` collection is never written to by any function.**

---

## Question 2: Is there any logic that assigns custom claims (`role = "agent"`) in Firebase Auth?

**Answer: NO.**

The only two call sites of `auth.setCustomUserClaims()` in the codebase are:

```
members.js:178   await auth.setCustomUserClaims(userId, { role: ROLES.MEMBER });
members.js:308   await auth.setCustomUserClaims(group.leaderId, { role: ROLES.LEADER });
```

- `approveMember` always stamps `role: "member"` regardless of what role the user should have.
- `approveGroup` stamps `role: "leader"` on the group's leader.
- There is **no code path** that calls `setCustomUserClaims` with `role: "agent"`, `role: "umuco"`, `role: "finance"`, or `role: "super_admin"`.

This means:
- Agent accounts cannot be provisioned through any existing Cloud Function.
- Agents must be granted their custom claim out-of-band (e.g., manually via Firebase Admin SDK or Firebase Console).
- The `requireRole(context, [ROLES.AGENT])` check in `recordDeposit`, `recordWithdrawal`, `submitBatch`, `disburseLoan`, and `recordRepayment` reads from the custom claim token (`request.auth.token.role`). If the claim is missing or wrong, those functions return `permission-denied`.

---

## Question 3: Is the `agents` collection documented anywhere?

**Answer: Not in the canonical project schema.**

- **CLAUDE.md**: No mention of the `agents` collection in the Database Schema section. The word "agent" appears only as a role name and a UI app description.
- **firestore.rules**: No `match /agents/{agentId}` block exists. The catch-all rule at the bottom (`match /{document=**} { allow read, write: if false; }`) means **even backend Admin SDK reads within transactions bypass Firestore rules**, but **any direct client-side read of `agents/{uid}` would be denied**.
- **firestore.indexes.json**: No index defined for the `agents` collection.
- **functions/src/constants.js**: No constant or reference to an `agents` collection.

The collection is mentioned only in auxiliary analysis/planning documents:

| File | Nature | Detail |
|---|---|---|
| `DATA-MODEL-REVIEW.md` | Analysis doc | Lists `agents/` in proposed data model, describes `assignedGroups` field |
| `REVISED_IMPLEMENTATION_PLAN.md` | Planning doc | Shows proposed `agents` schema with `assignedGroups` array |
| `SECURITY-REPORT.md` | Security analysis | References the read at `savings.js:130` |
| `SECURITY-VERIFICATION.md` | Verification doc | Explicitly flags this as a **P1 residual risk**: "The `agents` collection is undocumented in the project schema (CLAUDE.md). Every `recordDeposit` call will fail with `"Agent profile not found"` until each agent user has a corresponding document in `agents/{uid}` with an `assignedGroups` array." |

---

## Question 4: What happens if `recordDeposit` runs and `agents/{uid}` does not exist?

**Answer: The function throws `not-found` and aborts immediately. No data is written.**

The relevant code in `functions/src/savings.js`, lines 128–154:

```javascript
await db.runTransaction(async (tx) => {
  // CRITICAL: Verify agent has access to member's group
  const agentDoc = await tx.get(db.collection('agents').doc(agentId));
  if (!agentDoc.exists) {
    throw httpsError('not-found', 'Agent profile not found');   // ← aborts here
  }

  const agentData = agentDoc.data();
  const allowedGroups = agentData.assignedGroups || [];

  if (allowedGroups.length === 0) {
    throw httpsError('permission-denied', 'Agent not assigned to any groups');
  }

  if (!allowedGroups.includes(memberGroupId)) {
    throw httpsError('permission-denied', 'Agent cannot record deposits for this member');
  }

  // ... writes only happen if all checks pass
  tx.set(transactionRef, { ... });
  tx.set(groupMemberRef, { ... });
  tx.set(groupRef, { ... });
});
```

**Execution path when `agents/{uid}` is missing:**

1. Agent calls `recordDeposit` with valid `userId`, `amount`, `channel`.
2. `requireRole` passes (assuming agent has the `agent` custom claim set manually).
3. `getActiveMemberAndGroup` passes (member exists and is active).
4. Transaction starts. First read: `tx.get(db.collection('agents').doc(agentId))`.
5. Document does not exist → `agentDoc.exists` is `false`.
6. `throw httpsError('not-found', 'Agent profile not found')` is raised.
7. Firestore transaction aborts — **no writes occur**.
8. The callable function returns a `not-found` error to the client.

**Consequence**: Since no function creates `agents/{uid}` documents and no admin UI exists to create them, **`recordDeposit` is currently broken for all agents**. This is a production-blocking defect.

---

## Summary

| Question | Finding | Severity |
|---|---|---|
| Cloud Function creates `agents/{uid}`? | **None exists** | P0 — deposit flow is entirely broken |
| Custom claim `role="agent"` assignment? | **No function does this** — must be done manually out-of-band | P0 — agents cannot authenticate as agents |
| `agents` collection in canonical schema? | **Not documented in CLAUDE.md or firestore.rules** | P1 — schema drift, no Firestore rule coverage |
| `recordDeposit` when `agents/{uid}` missing? | **Throws `not-found`, transaction aborts, zero writes** | P0 — every deposit attempt fails |

### What is needed to unblock agents

1. **A `createAgent` (or `provisionAgent`) Cloud Function** callable by `super_admin` that:
   - Creates the Firebase Auth user with the correct email pattern
   - Calls `auth.setCustomUserClaims(uid, { role: "agent" })`
   - Creates `agents/{uid}` with at minimum `{ assignedGroups: [] }` and `{ status: "active" }`
   - Sets `users/{uid}.role = "agent"` and `users/{uid}.status = "active"`

2. **A `assignAgentToGroup` function** callable by `super_admin` that pushes a `groupId` into `agents/{uid}.assignedGroups`.

3. **A `match /agents/{agentId}` rule** in `firestore.rules` (read-only for admin and the agent themselves).

4. **Schema documentation** for the `agents` collection in CLAUDE.md.
