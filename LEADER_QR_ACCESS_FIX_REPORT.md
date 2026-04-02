# LEADER QR ACCESS FIX REPORT

**Date**: 2026-03-11
**Severity**: P1 – Leader cannot use core deposit flow

---

## Failing Screen / Path

- **Screen**: `apps/member/src/features/Profile/MyQRCodeScreen.jsx`
- **Route**: `/app/my-qr`
- **Error displayed**: `Error: Missing or insufficient permissions.`

---

## Root Cause

### Data model mismatch in the QR screen

`MyQRCodeScreen.jsx` (line 23) read the group reference with:

```javascript
const gid = data.groupId;
```

`groupId` on a user document is the group the user **joined as a member**. A leader may have:

| Field | Value |
|---|---|
| `users/{uid}.groupId` | Group they joined (as a regular member — could be a *different* group) |
| `users/{uid}.ledGroupId` | Group they **lead** |

If a leader's `groupId` pointed to a group whose `leaderId` was someone else, the groups Firestore rule had no matching condition:

```
// Rule: groups/{groupId}
isLeader() && resource.data.leaderId == request.auth.uid   // ← fails: leaderId ≠ uid
exists(groupMembers/uid) && groupMembers.groupId == groupId // ← fails: gm doc has a different groupId
```

Both branches failed → `permission-denied`.

### Secondary defence gap in Firestore rules

Even when a leader reads their own group (correct `leaderId == uid`), the rule wrapped this behind `isLeader()` (token claim check). If the leader's custom claim was stale — e.g. they had just been provisioned and the token had not yet been force-refreshed — `isLeader()` returned `false` and the first branch silently fell through.

---

## What Was NOT the Cause

- Frontend routing: the `/app/my-qr` route is guarded only by authentication, not role.
- App.jsx role gate: `hasAllowedRole = role === "member" || role === "leader"` already covers leaders.
- `users/{uid}` read: `isOwner(userId)` always passes for an authenticated user reading their own profile.
- Missing `groupMembers` document: `approveGroup` now creates it atomically.

---

## Files Changed

### 1. `apps/member/src/features/Profile/MyQRCodeScreen.jsx` (line 23)

**Before:**
```javascript
const gid = data.groupId;
```

**After:**
```javascript
// Leaders have ledGroupId → use that first so they read the group they lead.
// Regular members only have groupId.
const gid = data.ledGroupId || data.groupId;
```

This ensures a leader loads the name of the group they *lead*, not a group they happen to be a member of (which might be governed by a different leader).

### 2. `firestore.rules` — groups rule

**Before:**
```
(
  isLeader() &&
  resource.data.leaderId == request.auth.uid
) ||
```

**After:**
```
// The documented group leader can always read their group regardless of token-claim state.
resource.data.leaderId == request.auth.uid ||
```

Removes the `isLeader()` token-claim prerequisite. The check is now: **if the document itself names you as the leader, you can read it.** This is safe because:
- `allow write: if false` — no client can forge `leaderId`
- The condition is a document-data check, not a client-provided claim
- It grants no broader access to non-leaders (they would not appear as `leaderId`)

---

## Why Leaders Must Have Access

A group leader is also a depositing member. They accumulate personal savings, hold a `memberId`, and are deposit-eligible in exactly the same way as regular members. The "My QR Code" screen exists precisely for this: showing their `memberId` QR so an agent can record a deposit. Blocking leaders from this screen breaks their deposit flow entirely.

---

## Retest Checklist

- [ ] Leader signs in to member app (`/app`)
- [ ] Leader navigates to "My QR Code" (`/app/my-qr`)
- [ ] Screen loads without error
- [ ] QR code is rendered (or "Member ID not assigned yet" if `memberId` missing — not a permission error)
- [ ] Group name shown is the group **they lead** (not another group)
- [ ] Regular member (non-leader) QR screen still works correctly
- [ ] Leader with only `groupId` set (no `ledGroupId`) still loads correctly (falls back to `groupId`)
- [ ] Firestore rules deployed: `firebase deploy --only firestore:rules`
- [ ] No unrelated permission regressions — admin, agent, umuco roles unaffected

---

## Deployment Steps

```bash
# Deploy updated Firestore rules
firebase deploy --only firestore:rules

# Frontend change is included in the next member-app build/deploy
firebase deploy --only hosting:member
```
