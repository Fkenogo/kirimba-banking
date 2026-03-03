# SECURITY-VERIFICATION.md

> **Date**: 2026-03-03
> **Scope**: Phase 0 security hardening items
> **Mode**: Verification only — no fixes applied

---

## Checklist

| # | Item | Status | File(s) |
|---|------|--------|---------|
| 1a | bcrypt used for PIN hashing (not SHA-256) | ✅ PASS | `functions/src/utils.js:3,14-17` |
| 1b | bcrypt `hashPIN` awaited in `registerMember` | ❌ FAIL | `functions/src/members.js:118` |
| 1c | bcrypt `hashPIN` awaited in `resetPIN` | ❌ FAIL | `functions/src/members.js:492` |
| 1d | PIN lockout functions defined (`checkPINLockout`, `incrementPINAttempts`) | ✅ PASS | `functions/src/utils.js:35-73` |
| 1e | PIN lockout functions wired to an auth flow | ❌ FAIL | _nowhere in codebase_ |
| 2a | PII (UID, phone) removed from `functions.logger` in `recordDeposit` | ✅ PASS | `functions/src/savings.js:147-150` |
| 2b | No phone/name/PIN values in `console.log` statements | ✅ PASS | `functions/index.js:61,77,82,84,87` |
| 3  | Agent-group authorization enforced in `recordDeposit` | ✅ PASS | `functions/src/savings.js:129-154` |
| 4a | `idempotencyToken` accepted from client in `submitBatch` | ✅ PASS | `functions/src/savings.js:210` |
| 4b | Duplicate-batch check before creation | ✅ PASS | `functions/src/savings.js:222-237` |
| 4c | Token stored on batch document | ✅ PASS | `functions/src/savings.js:284` |
| 4d | Fallback token is truly idempotent on retry | ❌ FAIL | `functions/src/savings.js:211` |
| 5a | `confirmBatch` uses Batch API (`db.batch()`) | ✅ PASS | `functions/src/savings.js:500` |
| 5b | All reads done outside the write batch | ✅ PASS | `functions/src/savings.js:447-497` |
| 5c | Member updates use `FieldValue.increment()` (no member reads) | ✅ PASS | `functions/src/savings.js:520-531` |
| 5d | Fund update uses `FieldValue.increment()` (no cross-group reads) | ✅ PASS | `functions/src/savings.js:541-550` |
| 6a | `transactions` read restricted to owner / agent / admin / umuco | ✅ PASS | `firestore.rules:71-79` |
| 6b | `loans` read restricted to owner / agent / admin / umuco | ✅ PASS | `firestore.rules:81-89` |
| 6c | `groups` member self-read rule uses valid field | ❌ FAIL | `firestore.rules:56` |
| 7a | `expiresAt` on `flagBatch` notifications | ✅ PASS | `functions/src/savings.js:597` |
| 7b | `expiresAt` on `joinGroup` / approval notifications | ✅ PASS | `functions/src/members.js:213,368,476` |
| 7c | `expiresAt` on `loan_defaulted` notifications | ❌ FAIL | `functions/src/loans.js:498-507` |
| 7d | Daily cleanup function defined and exported | ✅ PASS | `functions/src/scheduledFunctions.js:12-52`, `functions/index.js:116` |
| 7e | Cleanup queries `expiresAt < now` with 500-doc batching | ✅ PASS | `functions/src/scheduledFunctions.js:21-43` |
| 7f | `notifications.expiresAt ASC` index present | ✅ PASS | `firestore.indexes.json:71-76` |

---

## Detailed Findings

---

### 1. bcrypt PIN Hashing + PIN Lockout

#### 1b–1c ❌ FAIL — `hashPIN` not awaited (P0)

`hashPIN` is declared `async` and returns `Promise<string>`, but both call sites omit `await`:

```js
// members.js:118 (registerMember)
const pinHash = hashPIN(pin);           // pinHash is Promise, not string

// members.js:492 (resetPIN)
const pinHash = hashPIN(newPIN);        // same problem
```

**Impact**: `pinHash` resolves to a Promise object. When passed to `auth.createUser({ password: pinHash })`, Firebase Auth receives `[object Promise]` as the password string. The Firestore field `pinHash` also stores this non-hash string. This means:
- Stored hashes are invalid — bcrypt verification will always fail.
- Firebase Auth password is set to the literal string `"[object Promise]"`.
- `verifyPIN` (which correctly calls `bcrypt.compare`) will never match.

#### 1e ❌ FAIL — Lockout functions are dead code (P0)

`checkPINLockout` and `incrementPINAttempts` are exported from `utils.js` but **never imported or called** anywhere in the codebase. There is no Cloud Function that intercepts failed PIN attempts (Firebase Auth handles login directly via the SDK). Without a custom login endpoint that calls these functions, the lockout mechanism provides no protection.

---

### 2. PII Removed from Logs

#### ✅ PASS

The redaction in `recordDeposit` is correct — `agentId` and `userId` are replaced with the string `'[REDACTED]'`, not the actual variable values:

```js
// savings.js:146-151
functions.logger.error('Cross-group deposit attempt blocked', {
  agentId: '[REDACTED]',    // literal string, not the variable
  userId: '[REDACTED]',
  memberGroupId,             // group ID (non-PII)
  allowedGroups,             // group IDs (non-PII)
});
```

**Minor note**: `index.js:87` logs `error.message` from Firebase Admin SDK errors. Firebase Auth error messages can occasionally embed the email address (which encodes the phone number as `+257XXXXXXXX@kirimba.app`). This is low-risk but worth noting.

---

### 3. Agent-Group Authorization in `recordDeposit`

#### ✅ PASS

Authorization runs inside the transaction at `savings.js:129-154`:
1. Reads `agents/{agentId}` doc; throws `not-found` if missing.
2. Reads `agentData.assignedGroups`; throws `permission-denied` if empty.
3. Compares `memberState.groupId` against `allowedGroups`; throws `permission-denied` on mismatch.

**Residual risk (P1)**: The `agents` collection is undocumented in the project schema (CLAUDE.md). Every `recordDeposit` call will fail with `"Agent profile not found"` until each agent user has a corresponding document in `agents/{uid}` with an `assignedGroups` array. There is no function to create or manage this document, and no Firestore rule covers the collection.

---

### 4. Idempotency Token in `submitBatch`

#### 4a–4c ✅ PASS

The token is accepted, checked against existing batches, and stored correctly.

#### 4d ❌ FAIL — Fallback token is not idempotent (P1)

```js
// savings.js:210-211
const idempotencyToken = data.idempotencyToken ||
  `${agentId}_${groupId}_${Date.now()}`;
```

If the client does not supply `idempotencyToken`, the fallback includes `Date.now()`, producing a unique token on every call. A network-retry scenario where the client omits the token will create duplicate batches. The protection only works when the **client explicitly supplies a stable token**.

---

### 5. `confirmBatch` — Batch API, Op-Limit, No Cross-Group Reads

#### ✅ PASS (with caveat)

| Sub-check | Evidence |
|-----------|----------|
| Uses `db.batch()` (500-op limit) | `savings.js:500` |
| Reads outside the batch | `savings.js:447-497` |
| Member increments (no reads) | `savings.js:520-531` |
| Fund increment (no reads) | `savings.js:541-550` |

**Residual risk (P1 — data consistency)**: `creditLimit` and `availableCredit` in `groupMembers` are **not updated** during `confirmBatch`. A comment at `savings.js:530-531` acknowledges this as an intentional trade-off. Until the member triggers another operation (e.g., loan request), their available credit will reflect stale data. Loan eligibility checks in `requestLoan` read `groupMember.availableCredit` directly, so a member's credit limit will appear lower than it actually is until the fields are recalculated.

---

### 6. Firestore Rules — Group / Transaction / Loan Reads

#### 6c ❌ FAIL — `groups` member rule uses non-existent field (P0)

```
# firestore.rules:51-57
match /groups/{groupId} {
  allow read: if isSignedIn() && (
    isAdmin() || isAgent() || isUmuco() ||
    get(...groups/$(groupId)).data.memberIds.hasAny([request.auth.uid])
  );
```

The `groups` document schema contains no `memberIds` array (members are stored in the separate `groupMembers` collection). `memberIds` will always be `null` / missing, causing the `hasAny()` call to error or return false. **Members and leaders cannot read their own group document via the client SDK.**

Additionally, `isLeader()` has no explicit read access to `transactions` or `loans` for members of their group. If leaders need to view group-level financial data via direct Firestore queries (outside Cloud Functions), those reads will be denied.

#### 6a–6b ✅ PASS

`transactions` and `loans` correctly allow owner self-read via `resource.data.userId == request.auth.uid`.

---

### 7. Notifications — `expiresAt`, Cleanup, Index

#### 7c ❌ FAIL — `loan_defaulted` notifications missing `expiresAt` (P1)

```js
// loans.js:498-507
batch.set(notificationRef, {
  type: "loan_defaulted",
  loanId: loanDoc.id,
  userId: loanDoc.data().userId || null,
  groupId: loanDoc.data().groupId || null,
  severity: "high",
  status: "unread",
  createdAt: FieldValue.serverTimestamp(),
  // ← no expiresAt field
});
```

Defaulted-loan notifications will never be cleaned up by `deleteExpiredNotifications` (which queries `expiresAt < now`). These are the highest-severity notifications and will accumulate indefinitely.

#### 7d–7f ✅ PASS

The scheduled cleanup is correctly implemented, exported, and indexed.

---

## Risk Summary

| Priority | Finding | Location |
|----------|---------|----------|
| **P0** | `hashPIN` not awaited — bcrypt hashes never stored | `members.js:118,492` |
| **P0** | PIN lockout logic dead code — never called | `utils.js:35-73` (unused) |
| **P0** | `groups` rule uses `memberIds` (non-existent field) — members locked out | `firestore.rules:56` |
| **P1** | `agents` collection undocumented; missing docs break all deposits | `savings.js:130` |
| **P1** | Idempotency fallback uses `Date.now()` — not retry-safe | `savings.js:211` |
| **P1** | `confirmBatch` skips `creditLimit`/`availableCredit` update | `savings.js:530-531` |
| **P1** | `loan_defaulted` notifications missing `expiresAt` — won't be purged | `loans.js:498-507` |

---

_Verification only — no code was modified._
