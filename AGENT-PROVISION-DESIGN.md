# Agent Provisioning — Minimal Secure Architecture Design

> **Status**: Design only — not implemented
> **Date**: 2026-03-03
> **Scope**: Two new callable Cloud Functions (`provisionAgent`, `assignAgentToGroup`) plus one new Firestore collection (`agents`) and one Firestore rules addition

---

## 1. Overview

Agents are field staff provisioned directly by a `super_admin`. Unlike members, agents do not self-register; their accounts are fully created in a single admin-initiated operation. A second operation assigns an agent to a specific active group for operational duty.

---

## 2. New File

### `functions/src/agents.js`

One new source file. No existing files are modified except:

- `functions/index.js` — two new export lines appended (no existing lines changed)
- `firestore.rules` — one new `match` block appended before the catch-all rule

---

## 3. Function: `provisionAgent`

### Purpose
Create a Firebase Auth account, `users/{uid}` profile, and `agents/{uid}` record for a new field-staff agent, and stamp the `role="agent"` custom claim.

### Caller
`super_admin` only (enforced via inline role guard — see §6).

### Input Schema
```typescript
{
  fullName: string,   // 3–100 characters
  phone: string,      // +257XXXXXXXX format
  pin: string         // exactly 4 digits
}
```

### Returns
```typescript
{ success: true, agentId: string }
```

### Step-by-Step Logic

1. **Auth guard** — require `super_admin` role (inline, see §6).
2. **Validate inputs** — `fullName` non-empty, `phone` matches `/^\+257\d{8}$/`, `pin` is `/^\d{4}$/`.
3. **Duplicate check** — call `auth.getUserByEmail(`${phone}@kirimba.app`)`. If the account already exists, throw `already-exists / "Phone number is already registered."`.
4. **Hash PIN** — `await hashPIN(pin)` (bcrypt, imported from `utils.js`).
5. **Create Firebase Auth user** — `auth.createUser({ email: "${phone}@kirimba.app", password: pinHash, displayName: fullName })`. Capture resulting `uid`.
6. **Set custom claim immediately** — `await auth.setCustomUserClaims(uid, { role: "agent" })`. Done before any Firestore writes so that if subsequent writes fail the claim can be corrected on retry.
7. **Atomic Firestore write** — use `db.batch()` to write both documents in a single round-trip:
   - `users/{uid}` — `set(..., { merge: true })`:
     ```
     uid, fullName, phone, role: "agent",
     status: "active",
     groupId: null, isLeader: false, ledGroupId: null,
     nationalId: null, pinHash,
     createdAt: serverTimestamp(), approvedAt: serverTimestamp(),
     updatedAt: null, createdBy: callerUid
     ```
   - `agents/{uid}` — `set(...)` (new doc, fail if exists):
     ```
     uid, fullName, phone, role: "agent",
     status: "active",
     assignedGroupId: null,
     createdAt: serverTimestamp(),
     createdBy: callerUid,
     updatedAt: null
     ```
8. **Commit batch** — `await batch.commit()`.
9. **Return** `{ success: true, agentId: uid }`.

### Duplicate-Provision Guard

The `onUserCreate` Auth trigger in `index.js` is already idempotent: it only writes `users/{uid}` if the document does not exist. Because step 7 above writes `users/{uid}` with `merge: true` right after Auth user creation, either ordering resolves correctly:

| Race scenario | Outcome |
|---|---|
| `provisionAgent` writes first | Trigger sees doc exists → skips → final `role: "agent"` ✓ |
| Trigger fires first (writes `role: "member"`) | `provisionAgent` merges `role: "agent"` over it → final `role: "agent"` ✓ |

Additionally, the `agents/{uid}` document is written with plain `set()` (no merge). If a concurrent second call somehow passed the email duplicate check, the batch commit for the second call would still overwrite — which is acceptable since the first call already set the correct state. The email check at step 3 is the primary idempotency gate.

### Error Codes
| Condition | Code | Message |
|---|---|---|
| Not authenticated | `unauthenticated` | Authentication required. |
| Not super_admin | `permission-denied` | Insufficient permissions. |
| Missing/invalid input | `invalid-argument` | (field-specific message) |
| Phone already registered | `already-exists` | Phone number is already registered. |
| Internal Firestore/Auth failure | `internal` | Agent provisioning failed. |

---

## 4. Function: `assignAgentToGroup`

### Purpose
Assign a provisioned agent to an active group. Validates both the agent and the group exist and are active. Prevents re-assignment if agent is already assigned.

### Caller
`super_admin` only.

### Input Schema
```typescript
{
  agentId: string,   // uid of an existing active agent
  groupId: string    // id of an existing active group
}
```

### Returns
```typescript
{ success: true }
```

### Step-by-Step Logic

1. **Auth guard** — require `super_admin` role.
2. **Validate inputs** — both `agentId` and `groupId` must be non-empty strings.
3. **Load documents in parallel** — `await Promise.all([agentRef.get(), groupRef.get()])`.
4. **Validate agent** —
   - Doc must exist; if not → `not-found / "Agent not found."`
   - `agents/{agentId}.role` must equal `"agent"`; if not → `failed-precondition / "User is not an agent."`
   - `agents/{agentId}.status` must equal `"active"`; if not → `failed-precondition / "Agent is not active."`
5. **Duplicate assignment check** — if `agents/{agentId}.assignedGroupId` is non-null → throw `already-exists / "Agent is already assigned to a group."` (prevents silent re-assignment).
6. **Validate group** —
   - Doc must exist; if not → `not-found / "Group not found."`
   - `groups/{groupId}.status` must equal `"active"`; if not → `failed-precondition / "Group is not active."`
7. **Atomic Firestore write** — use `db.batch()`:
   - `agents/{agentId}` — `update({ assignedGroupId: groupId, updatedAt: serverTimestamp() })`
   - `users/{agentId}` — `set({ assignedGroupId: groupId, updatedAt: serverTimestamp() }, { merge: true })`
8. **Commit batch**.
9. **Return** `{ success: true }`.

> **Note on `users/{uid}.assignedGroupId`**: Agents use `assignedGroupId` on their user profile, which is distinct from the member-facing `groupId` field. This prevents semantic collision with group membership logic.

### Error Codes
| Condition | Code | Message |
|---|---|---|
| Not authenticated | `unauthenticated` | Authentication required. |
| Not super_admin | `permission-denied` | Insufficient permissions. |
| Missing input | `invalid-argument` | agentId and groupId are required. |
| Agent doc missing | `not-found` | Agent not found. |
| User is not an agent | `failed-precondition` | User is not an agent. |
| Agent not active | `failed-precondition` | Agent is not active. |
| Already assigned | `already-exists` | Agent is already assigned to a group. |
| Group doc missing | `not-found` | Group not found. |
| Group not active | `failed-precondition` | Group is not active. |

---

## 5. New Firestore Collection: `agents/{uid}`

### Document Schema
```typescript
{
  uid: string,                // Same as document ID and Firebase Auth UID
  fullName: string,
  phone: string,              // +257XXXXXXXX
  role: "agent",              // Always "agent"
  status: "active" | "suspended",
  assignedGroupId: string | null,
  createdAt: Timestamp,
  createdBy: string,          // super_admin UID who provisioned
  updatedAt: Timestamp | null
}
```

### Firestore Rules Addition

Append inside the top-level `match /databases/{database}/documents` block, immediately before the catch-all `match /{document=**}` rule:

```
match /agents/{agentId} {
  allow read: if isAdmin() || isOwner(agentId) || isAgent();
  allow write: if false;
}
```

`isAdmin()`, `isOwner()`, and `isAgent()` are existing helpers already defined in `firestore.rules`. No new helpers are needed.

---

## 6. Authorization Guard (Inline in `agents.js`)

`requireRole` is an unexported private function in `members.js`. To satisfy the constraint of not modifying existing logic, `agents.js` defines its own equivalent guard locally:

```javascript
// Local to agents.js — mirrors the pattern in members.js
async function requireSuperAdmin(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }
  const role = context.auth.token?.role
    ?? (await db.collection("users").doc(context.auth.uid).get()).data()?.role;
  if (role !== ROLES.SUPER_ADMIN) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }
}
```

Both `provisionAgent` and `assignAgentToGroup` call `await requireSuperAdmin(context)` as their first statement.

---

## 7. `functions/index.js` Changes

Two lines appended after the existing exports, touching no existing lines:

```javascript
const agents = require("./src/agents");
exports.provisionAgent    = agents.provisionAgent;
exports.assignAgentToGroup = agents.assignAgentToGroup;
```

---

## 8. What Is Explicitly Not Changed

| File | Status |
|---|---|
| `functions/src/members.js` | Unchanged |
| `functions/src/savings.js` | Unchanged |
| `functions/src/loans.js` | Unchanged |
| `functions/src/utils.js` | Unchanged |
| `functions/src/validators.js` | Unchanged |
| `functions/src/constants.js` | Unchanged |
| `functions/src/scheduledFunctions.js` | Unchanged |
| `firestore.indexes.json` | Unchanged (no new composite queries) |
| All frontend apps | Unchanged |

---

## 9. Constraint Compliance Matrix

| Constraint | How Satisfied |
|---|---|
| Only `super_admin` can call | `requireSuperAdmin(context)` as first statement in both functions |
| Set `role="agent"` custom claim | `auth.setCustomUserClaims(uid, { role: "agent" })` in `provisionAgent` step 6 |
| Create `agents/{uid}` document | `db.batch()` in `provisionAgent` step 7 |
| Update `users/{uid}` `role="agent"` | `set(..., { merge: true })` with `role: "agent"` in `provisionAgent` step 7 |
| `status` field present | Both `agents/{uid}` and `users/{uid}` include `status: "active"` |
| Prevent duplicate provisioning | Email existence check via `auth.getUserByEmail()` in `provisionAgent` step 3 |
| Validate group existence before assignment | `groupRef.get()` + status check in `assignAgentToGroup` steps 3 and 6 |
| Must not modify any other logic | New file only; `index.js` and `firestore.rules` receive append-only additions |
