# Role Final Verification

> **Date**: 2026-03-03
> **Scope**: `functions/src/` — all five source files
> **Purpose**: Confirm custom claims are the sole authority for role-based authorization
> **Method**: Exhaustive grep across four patterns + full manual review of all Firestore reads
> **Code modified**: None

---

## Search Results

### Pattern 1 — `.data().role`
```
Result: 0 matches across entire functions/ directory
```
No code path reads a role value from a Firestore document snapshot using `.data().role`.

---

### Pattern 2 — `user.role`
```
Result: 0 matches across entire functions/ directory
```
No code path accesses a role field via a `user` object derived from Firestore.

---

### Pattern 3 — `role ===`

```
functions/src/loans.js:519  if ((role === ROLES.MEMBER || role === ROLES.LEADER) && targetUserId !== context.auth.uid)
functions/src/loans.js:549  if (role === ROLES.LEADER) {
```

Two matches, both in `loans.js`. Both require tracing the `role` variable to its origin.

**`getMemberLoans` (line 503)**:
```javascript
const role = await requireRole(context, [
  ROLES.MEMBER, ROLES.LEADER, ROLES.AGENT, ROLES.SUPER_ADMIN, ROLES.FINANCE,
]);
// ...
if ((role === ROLES.MEMBER || role === ROLES.LEADER) && targetUserId !== context.auth.uid) { ... }
```

**`getLoansByGroup` (line 536)**:
```javascript
const role = await requireRole(context, [
  ROLES.LEADER, ROLES.AGENT, ROLES.SUPER_ADMIN, ROLES.FINANCE,
]);
// ...
if (role === ROLES.LEADER) {
  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists || groupSnap.data().leaderId !== context.auth.uid) { ... }
}
```

In both cases `role` is the **return value of `requireRole`**. After hardening, `requireRole` is:

```javascript
function requireRole(context, allowedRoles) {
  // ...
  const role = context.auth.token?.role;   // ← token claim only
  // ...
  return role;
}
```

`role` at line 519 and line 549 is the token claim value, not a Firestore-derived value. These comparisons are downstream scope-narrowing decisions (restrict members to own data, restrict leaders to own group) that use the already-verified token claim. **Classification: token-derived. Not a Firestore role read.**

---

### Pattern 4 — `getUserRole` / `token.role` / `auth.token`

Every occurrence where `auth.token` is accessed:

| File | Line | Expression | Context |
|---|---|---|---|
| `members.js` | 37 | `context.auth.token?.role` | `requireRole` — gate |
| `members.js` | 50 | `context.auth.token?.role` | `requireActiveMember` — gate |
| `savings.js` | 33 | `context.auth.token?.role` | `requireRole` — gate |
| `loans.js` | 40 | `context.auth.token?.role` | `requireRole` — gate |
| `loans.js` | 53 | `context.auth.token?.role` | `requireActiveMember` — gate |
| `agents.js` | 26 | `context.auth.token?.role` | `requireSuperAdmin` — gate |

`getUserRole` — **0 matches**. Fully eliminated from all three files where it previously existed.

---

## Edge Case: `agentData.role` in `agents.js:154`

```javascript
// agents.js — assignAgentToGroup
const agentData = agentSnap.data();          // agents/{agentId} — the SUBJECT
if (agentData.role !== ROLES.AGENT) {
  throw httpsError("failed-precondition", "User is not an agent.");
}
```

This reads `agents/{agentId}.role` from the `agents` collection. It is the only remaining instance where a Firestore `role` field is read. It requires careful classification.

**Why this is NOT caller authorization:**
- The `caller` is a `super_admin`. Their authorization was verified by `requireSuperAdmin(context)` at line 131, which reads `context.auth.token?.role` exclusively.
- `agentId` is an input parameter — it refers to a **third-party document** being operated on, not the calling user.
- The check answers: "Is the record we are about to assign actually typed as an agent?" This is **data integrity validation on the subject**, not access control on the caller.
- The error code is `failed-precondition`, not `permission-denied` — consistent with a pre-condition check, not an authorization failure.
- Removing this check would not change who can call the function; it would only allow a `super_admin` to assign a non-agent UID to a group, producing corrupt data.

**Classification: subject data integrity check. Not caller role authorization.**

---

## Full Firestore Read Inventory

Every `.get()` call in the backend, with its purpose classified:

### `members.js`

| Location | Collection | Field(s) read | Purpose | Role-related? |
|---|---|---|---|---|
| `requireActiveMember:55` | `users/{uid}` | `status` | Caller status gate | Status only, role from token |
| `approveMember:152` | `users/{userId}` | `groupCodeToJoin`, existence | Business data | No |
| `approveMember:173` | `groups` query | `id`, group doc | Join request processing | No |
| `approveGroup:280` | `groups/{groupId}` | existence, `leaderId` | Business data | No |
| `joinGroup:319` | `groups` query | `status`, `leaderId` | Group lookup | No |
| `joinGroup:361` | `users/{leaderId}` | `fullName` | Display name | No |
| `approveJoinRequest:383` | `groups` query | scoped by `leaderId == uid` | Ownership check by UID | No |
| `approveJoinRequest:396` | `joinRequests/{id}` | `userId` | Request lookup | No |
| `getPendingApprovals:495/500` | `users`, `groups` | `status` | Status queries | No |

### `savings.js`

| Location | Collection | Field(s) read | Purpose | Role-related? |
|---|---|---|---|---|
| `getActiveMemberAndGroup:52` | `users/{userId}` | `status`, `groupId` | Subject status | No |
| `getActiveMemberAndGroup:53` | `groupMembers/{userId}` | balances, `groupId` | Financial data | No |
| `getActiveMemberAndGroup:76` | `groups/{groupId}` | `status` | Group status | No |
| `recordDeposit (tx):130` | `agents/{agentId}` | `assignedGroups` | Operational scope gate | No — group assignment, not role |
| `submitBatch:216` | `depositBatches` query | idempotency | Duplicate check | No |
| `confirmBatch:439` | `depositBatches/{id}` | `status`, `transactionIds` | Business data | No |
| `confirmBatch:456` | `transactions` (batch) | `type`, `status`, `amount` | Validation | No |
| `flagBatch:563` | `depositBatches/{id}` | existence | Existence check | No |
| `getBatchesForGroup:608` | `depositBatches` query | results | Data retrieval | No |

### `loans.js`

| Location | Collection | Field(s) read | Purpose | Role-related? |
|---|---|---|---|---|
| `requireActiveMember:61` | `users/{uid}` | `status`, `groupId` | Caller status gate | Status only, role from token |
| `requireActiveMember:61` | `groupMembers/{uid}` | `groupId`, balances | Group linkage | No |
| `requireActiveMember:81` | `groups/{groupId}` | `status` | Group status | No |
| `requestLoan:118` | `loans` query | active loan check | Business rule | No |
| `requestLoan:119` | `kirimbaFund/current` | `availableFund` | Financial data | No |
| `disburseLoan (tx)` | `loans`, `groupMembers`, `kirimbaFund` | financial fields | Transaction data | No |
| `recordRepayment (tx)` | `loans`, `groupMembers`, `kirimbaFund` | financial fields | Transaction data | No |
| `markLoanDefaulted:463` | `loans` query | `status`, `dueDate` | Scheduled job, no auth | No |
| `getMemberLoans:528` | `loans` query | loan records | Data retrieval | No |
| `getLoansByGroup:550` | `groups/{groupId}` | `leaderId` | UID ownership check | No — compares UID, not role |
| `getLoansByGroup:561` | `loans` query | loan records | Data retrieval | No |

### `agents.js`

| Location | Collection | Field(s) read | Purpose | Role-related? |
|---|---|---|---|---|
| `assignAgentToGroup:147` | `agents/{agentId}` | `role`, `status`, `assignedGroupId` | Subject integrity check | `role` read on subject, not caller — see Edge Case section |
| `assignAgentToGroup:147` | `groups/{groupId}` | `status` | Group status | No |

### `scheduledFunctions.js`

| Location | Collection | Field(s) read | Purpose | Role-related? |
|---|---|---|---|---|
| `deleteExpiredNotifications:25` | `notifications` query | `expiresAt` | TTL cleanup, no auth | No |

---

## Answers to the Three Questions

### 1. No authorization decision is based on the Firestore role field

**CONFIRMED.**

Zero instances of `.data().role` or `user.role` remain in the codebase. The only remaining Firestore role field read (`agentData.role` in `agents.js:154`) is a data integrity check on a third-party subject document, not a caller authorization decision. The caller's access in that function was already gated exclusively by token claim. No function grants or denies access to a **caller** based on a Firestore document role field.

---

### 2. Only custom claims are used for role gating

**CONFIRMED.**

All four authorization guards in the codebase read role exclusively from `context.auth.token?.role`:

| Guard | File | Expression |
|---|---|---|
| `requireRole` | members.js:37 | `context.auth.token?.role` |
| `requireActiveMember` | members.js:50 | `context.auth.token?.role` |
| `requireRole` | savings.js:33 | `context.auth.token?.role` |
| `requireRole` | loans.js:40 | `context.auth.token?.role` |
| `requireActiveMember` | loans.js:53 | `context.auth.token?.role` |
| `requireSuperAdmin` | agents.js:26 | `context.auth.token?.role` |

The token is signed by Google's Firebase Auth service and cannot be forged or modified by clients. Custom claims can only be written by `auth.setCustomUserClaims()` via the Admin SDK — a deliberate, privileged, server-side operation. This is now the single source of truth for role resolution across all callers.

---

### 3. Firestore role field is now informational only

**CONFIRMED, with one qualified exception.**

The `users/{uid}.role` field is **written** during provisioning (`registerMember`, `approveMember`, `approveGroup`, `provisionAgent`) and is **never read** for authorization purposes by any callable function. It exists as a readable record of the user's intended role, consistent with what was stamped into the custom claim at the same time.

The qualified exception is `agents/{agentId}.role` in `assignAgentToGroup`. This field is read, but as a data integrity constraint on the assignment target, not as caller authorization. Its classification is: **subject pre-condition data**, not caller credential.

The Firestore rules (`firestore.rules`) have always used only `request.auth.token.role` for access control. The backend callable functions now match this model exactly. The authorization layer is consistent end-to-end.

---

## Consistency Matrix — Final State

| Guard | Token used | Firestore role fallback | Status |
|---|---|---|---|
| `members.js:requireRole` | ✓ | ✗ | Clean |
| `members.js:requireActiveMember` | ✓ | ✗ | Clean |
| `savings.js:requireRole` | ✓ | ✗ | Clean |
| `loans.js:requireRole` | ✓ | ✗ | Clean |
| `loans.js:requireActiveMember` | ✓ | ✗ | Clean |
| `agents.js:requireSuperAdmin` | ✓ | ✗ | Clean |
| `firestore.rules` (all match blocks) | ✓ | ✗ | Clean |
