# Security Role Consistency Audit

> **Date**: 2026-03-03
> **Scope**: `functions/src/` — all role and privilege enforcement logic
> **Trigger**: Hardening of `requireSuperAdmin` in `agents.js` to remove Firestore fallback
> **Status**: Findings only — no code modified

---

## 1. Summary

The backend contains **two distinct patterns** for resolving the caller's role at function entry:

| Pattern | How role is resolved | Files |
|---|---|---|
| **Token-primary with Firestore fallback** | Checks `token.role` first; falls back to `users/{uid}.role` in Firestore if token claim is absent or falsy | `members.js`, `savings.js`, `loans.js` |
| **Firestore-only** | Reads `users/{uid}` document; ignores token entirely | `members.js`, `loans.js` |
| **Token-strict (no fallback)** | Checks `token.role` only; rejects if claim absent | `agents.js` (post-hardening) |

The `agents.js` guard is the **only** guard in the codebase that requires the custom claim strictly. All other callable guards accept the Firestore document as a valid credential source.

---

## 2. Pattern A — Token-Primary with Firestore Fallback

### Implementation (identical copy in three files)

**`members.js:32–56`** | **`savings.js:28–52`** | **`loans.js:35–59`**

```javascript
// members.js:32 / savings.js:28 / loans.js:35  (identical in all three)
async function getUserRole(uid, token) {
  if (token && token.role) {       // ← truthy check; falsy token.role triggers fallback
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

The fallback fires whenever `token.role` is absent, `null`, `undefined`, or any other falsy value. A user whose custom claim has been cleared or was never set can still pass the guard if `users/{uid}.role` contains an accepted value.

### Affected functions and roles

| Function | File | Allowed roles | Includes SUPER_ADMIN |
|---|---|---|---|
| `approveMember` | members.js | `[SUPER_ADMIN]` | **Yes** |
| `rejectMember` | members.js | `[SUPER_ADMIN]` | **Yes** |
| `approveGroup` | members.js | `[SUPER_ADMIN]` | **Yes** |
| `resetPIN` | members.js | `[SUPER_ADMIN, AGENT]` | **Yes** |
| `getPendingApprovals` | members.js | `[SUPER_ADMIN]` | **Yes** |
| `approveJoinRequest` | members.js | `[LEADER]` | No |
| `recordDeposit` | savings.js | `[AGENT]` | No |
| `submitBatch` | savings.js | `[AGENT]` | No |
| `recordWithdrawal` | savings.js | `[AGENT]` | No |
| `confirmBatch` | savings.js | `[UMUCO]` | No |
| `flagBatch` | savings.js | `[UMUCO]` | No |
| `getBatchesForGroup` | savings.js | `[AGENT, SUPER_ADMIN, FINANCE, UMUCO]` | **Yes** |
| `disburseLoan` | loans.js | `[AGENT]` | No |
| `recordRepayment` | loans.js | `[AGENT]` | No |
| `getMemberLoans` | loans.js | `[MEMBER, LEADER, AGENT, SUPER_ADMIN, FINANCE]` | **Yes** |
| `getLoansByGroup` | loans.js | `[LEADER, AGENT, SUPER_ADMIN, FINANCE]` | **Yes** |

---

## 3. Answer to Question 1 — `requireRole` in `members.js`

**Yes, it allows access when only the Firestore role field is set.**

`getUserRole` checks `if (token && token.role)`. If `token.role` is falsy (absent, null, undefined, or empty string), execution falls through to `db.collection("users").doc(uid).get()`. If `users/{uid}.role` equals an allowed role value, `requireRole` passes.

This applies identically in `savings.js` and `loans.js` — the function body is a verbatim copy in all three files.

---

## 4. Answer to Question 2 — Other `super_admin` Checks

There are **no additional `super_admin` checks** outside of `requireRole`. All `super_admin`-only callable functions (`approveMember`, `rejectMember`, `approveGroup`, `getPendingApprovals`) and the mixed `super_admin` checks (`resetPIN`, `getBatchesForGroup`, `getMemberLoans`, `getLoansByGroup`) pass through the same `getUserRole → requireRole` path in their respective files. No function performs a direct `token.role === "super_admin"` comparison outside `agents.js:requireSuperAdmin`.

---

## 5. Answer to Question 3 — Privilege Checks That Rely Only on the Firestore Role Field

### Pattern B — `requireActiveMember`: Firestore-Only, Token Not Consulted

Two functions bypass the token entirely:

**`members.js:58–78`** — used by `createGroup`, `joinGroup`

```javascript
async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const userSnap = await db.collection("users").doc(context.auth.uid).get();
  // ...
  const user = userSnap.data();
  if (user.role !== ROLES.MEMBER && user.role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }
  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }
  // ...
}
```

**`loans.js:61–102`** — used by `requestLoan`

```javascript
async function requireActiveMember(context) {
  // ...
  const [userSnap, gmSnap] = await Promise.all([userRef.get(), groupMemberRef.get()]);
  // ...
  const user = userSnap.data();
  const role = user.role;                                  // ← from Firestore document
  if (role !== ROLES.MEMBER && role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }
  // ...
}
```

Neither implementation reads `context.auth.token.role` at any point. Role is resolved exclusively from the Firestore document. A user with no custom claim set — or one whose claim has been revoked — can call `createGroup`, `joinGroup`, and `requestLoan` as long as `users/{uid}.role` is `"member"` or `"leader"` and `status` is `"active"`.

---

## 6. Risk Assessment

### Threat model context

- `users/{uid}` has `allow write: if false` in Firestore rules. Clients cannot write to it directly.
- Only Cloud Functions running with Admin SDK privileges can write `users/{uid}.role`.
- There is no public function that accepts a caller-supplied role value and writes it to Firestore.
- Custom claims are set by `auth.setCustomUserClaims()`, a separate, narrow operation.

### Findings by severity

#### FINDING-01 — HIGH
**`super_admin` access gates in `members.js` and downstream accept Firestore role as credential**

Functions: `approveMember`, `rejectMember`, `approveGroup`, `getPendingApprovals`, `resetPIN` (partial)

`super_admin` is the root of trust: it provisions agents, approves members, activates groups, and resets PINs. Any code path that allows the Firestore document to substitute for the custom claim widens the privilege escalation surface for the most sensitive operations. Revoking a `super_admin` custom claim alone is insufficient — `users/{uid}.role` must also be updated for revocation to take effect.

This is inconsistent with `agents.js:requireSuperAdmin`, which was hardened to reject on missing claim.

#### FINDING-02 — HIGH
**`getUserRole` is copy-pasted verbatim into three independent files**

`members.js:32`, `savings.js:28`, `loans.js:35` all define the same function body. A fix applied to one file does not propagate. The `agents.js` hardening is an example of this: the correct pattern now exists only in `agents.js` while the three legacy copies are unchanged.

#### FINDING-03 — MEDIUM
**`requireActiveMember` (two copies) resolves role exclusively from Firestore**

Functions: `createGroup`, `joinGroup`, `requestLoan`

The token is not consulted at all. This is lower severity than FINDING-01 because the protected operations are member-level (not administrative), and because the `status: "active"` check provides a secondary gate — a user cannot reach these functions without having been approved by a `super_admin`. However, the role source is still inconsistent with the rest of the authorization model.

#### FINDING-04 — LOW
**`getBatchesForGroup`, `getMemberLoans`, `getLoansByGroup` include `super_admin` in their allowed roles via the Firestore-fallback path**

These are read-only queries. The impact of unauthorized access is information disclosure rather than state mutation. Risk is lower but the inconsistency remains.

---

## 7. Inconsistency Matrix

| Guard | Token checked | Firestore fallback | Applies to SUPER_ADMIN | Status |
|---|---|---|---|---|
| `agents.js:requireSuperAdmin` | ✓ strict | ✗ none | ✓ | **Hardened** |
| `members.js:requireRole` | ✓ primary | ✓ fallback | ✓ | Inconsistent |
| `savings.js:requireRole` | ✓ primary | ✓ fallback | ✓ (via getBatchesForGroup) | Inconsistent |
| `loans.js:requireRole` | ✓ primary | ✓ fallback | ✓ | Inconsistent |
| `members.js:requireActiveMember` | ✗ none | ✓ only | ✗ | Inconsistent |
| `loans.js:requireActiveMember` | ✗ none | ✓ only | ✗ | Inconsistent |
| Firestore rules (`firestore.rules`) | ✓ token only | ✗ none | ✓ | Consistent |

The Firestore security rules exclusively use `request.auth.token.role`. The backend Cloud Functions use a mixed model. These two layers answer the question "is this user a super_admin?" using different sources of truth.

---

## 8. Recommended Actions (not implemented)

| Priority | Action | Files affected |
|---|---|---|
| P0 | Consolidate `getUserRole`/`requireRole` into a single shared module (`functions/src/auth.js` or `functions/src/guards.js`) to eliminate the three-copy divergence | members.js, savings.js, loans.js |
| P1 | Remove Firestore fallback from the shared `requireRole` for `SUPER_ADMIN`-only paths, mirroring the `agents.js` hardening | members.js (via shared module) |
| P2 | Evaluate whether the Firestore fallback is still needed for lower-privilege roles (AGENT, UMUCO, LEADER) — it may have been a bootstrap convenience that is no longer necessary | savings.js, loans.js (via shared module) |
| P3 | Decide whether `requireActiveMember` should add a token-role check as a fast path before the Firestore read, for consistency | members.js, loans.js |
| P3 | Document the bootstrap requirement: any `super_admin` account must have `setCustomUserClaims({ role: "super_admin" })` called at provisioning time, not just a Firestore write | Ops runbook |
