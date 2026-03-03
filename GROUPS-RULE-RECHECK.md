# GROUPS-RULE-RECHECK.md

**Date**: 2026-03-03
**File**: `firestore.rules` lines 51–67
**Purpose**: Re-verify the `groups/{groupId}` read rule

---

## Rule Under Inspection

```
match /groups/{groupId} {
  allow read: if isSignedIn() && (
    isAdmin() ||
    isAgent() ||
    isUmuco() ||
    (
      exists(/databases/$(database)/documents/groupMembers/$(request.auth.uid)) &&
      get(/databases/$(database)/documents/groupMembers/$(request.auth.uid)).data.groupId == groupId
    )
  );
  allow write: if false;
  ...
}
```

---

## Checklist Results

### 1. References `groupMembers/{uid}`

**PASS**

Both the `exists()` and `get()` calls use:
```
/databases/$(database)/documents/groupMembers/$(request.auth.uid)
```
The document ID is `$(request.auth.uid)` — the authenticated user's UID — which correctly maps to the `groupMembers` collection keyed by user UID.

---

### 2. Checks `groupId` equality

**PASS**

The `get()` result's `.data.groupId` is compared against the wildcard `$(groupId)` from the match path:
```
get(...).data.groupId == groupId
```
This ensures a member can only read a group document whose `groupId` matches the group they belong to per their `groupMembers` record.

---

### 3. No reference to `memberIds`

**PASS**

No occurrence of `memberIds` anywhere in the rule block or in the entire `firestore.rules` file. The membership check is done exclusively via the `groupMembers` sub-document lookup, not via an array field on the group document.

---

## Summary

| Check | Result |
|---|---|
| References `groupMembers/{uid}` | ✅ PASS |
| Checks `groupId` equality | ✅ PASS |
| No `memberIds` reference | ✅ PASS |

The `groups` read rule is **correctly structured**. It performs a document-level existence check on `groupMembers/{request.auth.uid}` and validates that the member's recorded `groupId` matches the requested group, with no stale `memberIds` array pattern present.
