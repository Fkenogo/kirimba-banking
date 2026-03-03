# P0 Re-Check Report
**Date**: 2026-03-03

---

## Issue 1 — `hashPIN` awaited at all call sites

**Status: PASS ✅**

`hashPIN` is an `async` function (returns `Promise<string>`). Both call sites in `functions/src/members.js` correctly await it:

| Call site | Line | Code |
|-----------|------|------|
| `registerMember` | 118 | `const pinHash = await hashPIN(pin);` |
| `resetPIN` | 492 | `const pinHash = await hashPIN(newPIN);` |

No unawaited call sites found.

---

## Issue 2 — `groups` Firestore rule references `groupMembers` correctly

**Status: FAIL ❌ — ID format mismatch**

### Rule in `firestore.rules` (line 56)

```
exists(/databases/$(database)/documents/groupMembers/$(groupId)_$(request.auth.uid))
```

The rule assumes the `groupMembers` document ID is in the format `{groupId}_{userId}`.

### Actual document ID format used by backend

Every function that reads or writes to `groupMembers` uses **`userId` alone** as the document ID:

| File | Line | Code |
|------|------|------|
| `members.js` | 422 | `db.collection("groupMembers").doc(userId)` |
| `savings.js` | 66 | `db.collection("groupMembers").doc(userId)` |
| `savings.js` | 173 | `db.collection("groupMembers").doc(userId)` |
| `savings.js` | 388 | `db.collection("groupMembers").doc(userId)` |
| `savings.js` | 522 | `db.collection("groupMembers").doc(userId)` |
| `loans.js` | 68 | `db.collection("groupMembers").doc(uid)` |
| `loans.js` | 239 | `db.collection("groupMembers").doc(loan.userId)` |
| `loans.js` | 370 | `db.collection("groupMembers").doc(loan.userId)` |

### Impact

The `exists()` check in the `groups` read rule will **always evaluate to `false`** for members, because no document named `{groupId}_{userId}` will ever exist. Regular members (role `"member"`, `"leader"`) are silently denied read access to their own group document. Only `isAdmin()`, `isAgent()`, and `isUmuco()` bypass the check and can read groups.

### Required fix

Change line 56 of `firestore.rules` from:

```
exists(/databases/$(database)/documents/groupMembers/$(groupId)_$(request.auth.uid))
```

to:

```
exists(/databases/$(database)/documents/groupMembers/$(request.auth.uid))
```

Additionally, the `groupMembers` read rule (line 67) allows `isLeader()` to read any member doc, but a leader should only read members of their own group. This is a separate lower-severity concern and is not a P0.

---

## Summary

| # | Issue | Status |
|---|-------|--------|
| 1 | `hashPIN` awaited at both call sites | **PASS ✅** |
| 2 | `groups` rule `exists()` ID matches backend doc ID | **FAIL ❌** |
