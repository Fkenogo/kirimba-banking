# Role Hardening Diff

> **Date**: 2026-03-03
> **Mode**: Security Hardening — System-Wide Role Consistency
> **Scope**: `functions/src/members.js`, `functions/src/savings.js`, `functions/src/loans.js`
> **Basis**: Findings from `SECURITY-ROLE-CONSISTENCY-AUDIT.md`
> **Commits**: None — changes are unstaged

---

## Principle Applied

Firebase custom claims (`context.auth.token.role`) are now the **sole authority** for role checks in every callable function. The Firestore `users/{uid}.role` field is no longer consulted for authorization decisions. Firestore is still read where business data is required (status checks, group membership, savings balances) — only the role resolution path changes.

---

## 1. `functions/src/members.js`

### 1a. `getUserRole` + `requireRole` (lines 32–56 → 32–43)

**Before:**
```javascript
async function getUserRole(uid, token) {
  if (token && token.role) {
    return token.role;
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }

  return userSnap.data().role || null;
}

async function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = await getUserRole(context.auth.uid, context.auth.token);
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}
```

**After:**
```javascript
function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}
```

**Changes:**
- `getUserRole` removed entirely (13 lines deleted).
- `requireRole` is now a plain synchronous function (no `async`, no `await`). All call sites used `await requireRole(...)` — awaiting a synchronous function is a no-op in JavaScript; no call-site changes required.
- Role is read from `context.auth.token?.role` directly. No Firestore read.
- Return type and value are identical for a valid caller.

---

### 1b. `requireActiveMember` (lines 58–78)

**Before:**
```javascript
async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const userSnap = await db.collection("users").doc(context.auth.uid).get();
  if (!userSnap.exists) {
    throw httpsError("not-found", "User profile not found.");
  }

  const user = userSnap.data();
  if (user.role !== ROLES.MEMBER && user.role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }

  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  return { uid: context.auth.uid, user };
}
```

**After:**
```javascript
async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (role !== ROLES.MEMBER && role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }

  const userSnap = await db.collection("users").doc(context.auth.uid).get();
  if (!userSnap.exists) {
    throw httpsError("not-found", "User profile not found.");
  }

  const user = userSnap.data();
  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  return { uid: context.auth.uid, user };
}
```

**Changes:**
- Role check moves **before** the Firestore read, using `context.auth.token?.role`.
- `user.role` is no longer read or consulted.
- The Firestore read (`users/{uid}`) is retained — `user.status` still requires it, and callers (`joinGroup`) access `user.groupId` from the returned object.
- Return value `{ uid, user }` is identical; `user` is still the full Firestore document snapshot data.
- Execution order for a valid member: token check (sync) → Firestore read → status check → return. An invalid token role now fails **before** the Firestore round-trip, improving both security and latency.

---

## 2. `functions/src/savings.js`

### `getUserRole` + `requireRole` (lines 28–52 → 28–39)

**Before:**
```javascript
async function getUserRole(uid, token) {
  if (token && token.role) {
    return token.role;
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }

  return userSnap.data().role || null;
}

async function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = await getUserRole(context.auth.uid, context.auth.token);
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}
```

**After:**
```javascript
function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}
```

**Changes:**
- `getUserRole` removed (13 lines deleted).
- `requireRole` made synchronous; Firestore fallback removed.
- Identical to `members.js` change. No `requireActiveMember` exists in this file; no further changes needed.

---

## 3. `functions/src/loans.js`

### 3a. `getUserRole` + `requireRole` (lines 35–59 → 35–46)

**Before:**
```javascript
async function getUserRole(uid, token) {
  if (token && token.role) {
    return token.role;
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }

  return userSnap.data().role || null;
}

async function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = await getUserRole(context.auth.uid, context.auth.token);
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}
```

**After:**
```javascript
function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}
```

**Changes:** Same as `members.js` and `savings.js`. `getUserRole` removed; `requireRole` made synchronous.

---

### 3b. `requireActiveMember` (lines 61–102)

**Before:**
```javascript
async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const uid = context.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const groupMemberRef = db.collection("groupMembers").doc(uid);
  const [userSnap, gmSnap] = await Promise.all([userRef.get(), groupMemberRef.get()]);

  if (!userSnap.exists) {
    throw httpsError("not-found", "User profile not found.");
  }
  if (!gmSnap.exists) {
    throw httpsError("failed-precondition", "Member is not linked to a group.");
  }

  const user = userSnap.data();
  const groupMember = gmSnap.data();
  const role = user.role;
  if (role !== ROLES.MEMBER && role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  const groupId = groupMember.groupId || user.groupId;
  ...
  return { uid, user, groupMember, groupId };
}
```

**After:**
```javascript
async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (role !== ROLES.MEMBER && role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }

  const uid = context.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const groupMemberRef = db.collection("groupMembers").doc(uid);
  const [userSnap, gmSnap] = await Promise.all([userRef.get(), groupMemberRef.get()]);

  if (!userSnap.exists) {
    throw httpsError("not-found", "User profile not found.");
  }
  if (!gmSnap.exists) {
    throw httpsError("failed-precondition", "Member is not linked to a group.");
  }

  const user = userSnap.data();
  const groupMember = gmSnap.data();
  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  const groupId = groupMember.groupId || user.groupId;
  ...
  return { uid, user, groupMember, groupId };
}
```

**Changes:**
- Token role check added as the first operation after the auth presence check (2 lines added).
- `const role = user.role;` removed (1 line deleted). Role check now references the token-derived `role` variable.
- Both `users/{uid}` and `groupMembers/{uid}` Firestore reads are retained in parallel — `user.status`, `groupMember.groupId`, `groupMember.personalSavings` etc. are all still needed by `requestLoan` and the group validation that follows.
- Return value `{ uid, user, groupMember, groupId }` is unchanged.

---

## Summary Table

| File | Guard | Change type | Lines before | Lines after | Net |
|---|---|---|---|---|---|
| members.js | `getUserRole` | Deleted | 13 | 0 | −13 |
| members.js | `requireRole` | Rewritten | 11 | 11 | 0 |
| members.js | `requireActiveMember` | Role source changed | 21 | 21 | 0 |
| savings.js | `getUserRole` | Deleted | 13 | 0 | −13 |
| savings.js | `requireRole` | Rewritten | 11 | 11 | 0 |
| loans.js | `getUserRole` | Deleted | 13 | 0 | −13 |
| loans.js | `requireRole` | Rewritten | 11 | 11 | 0 |
| loans.js | `requireActiveMember` | Role source changed | 42 | 42 | 0 |
| **Total** | | | | | **−39 lines** |

---

## Behaviour Unchanged For Valid Users

| Scenario | Before | After |
|---|---|---|
| Caller has correct `token.role` claim | Passes (token branch taken) | Passes (token read directly) |
| Caller has wrong `token.role` claim | Rejected | Rejected |
| Caller has no role claim, `users/{uid}.role` correct | **Passes via fallback** | **Rejected** |
| Caller has no role claim, `users/{uid}.role` incorrect | Rejected | Rejected |
| Caller has no auth at all | `unauthenticated` | `unauthenticated` |
| Active member, correct token | Passes, Firestore status checked | Passes, Firestore status checked |
| Active member, suspended in Firestore | Rejected at status check | Rejected at status check |
| Active member, wrong token role | Rejected at role check | Rejected at role check (earlier, before Firestore read) |

The only changed outcome is row 3: a caller whose custom claim was never set or has been cleared will now be rejected. This is the intended new behaviour. All provisioning paths (`approveMember`, `provisionAgent`) set custom claims before or alongside Firestore writes, so no legitimately provisioned user is affected.

---

## What Was Not Changed

| Item | Reason |
|---|---|
| All business logic in every function | Out of scope |
| Firestore reads for `status`, `groupId`, `savings` | Still required for business data |
| `agents.js:requireSuperAdmin` | Already hardened in previous session |
| `firestore.rules` | Already token-only; no change needed |
| `scheduledFunctions.js` | No auth context; no role checks present |
| `index.js` | No role logic |
| `validators.js`, `utils.js`, `constants.js` | No role logic |
