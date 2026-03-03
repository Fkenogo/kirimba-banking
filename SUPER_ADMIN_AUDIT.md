# SUPER_ADMIN Role Assignment Audit

> **Date**: 2026-03-03
> **Scope**: Backend only — `functions/index.js`, `functions/src/members.js`, `functions/src/constants.js`, `firestore.rules`

---

## 1. Is there any function that assigns role="super_admin" as a custom claim?

**No. Nowhere in the codebase does `setCustomUserClaims` ever set `role: "super_admin"`.**

`setCustomUserClaims` is called in exactly two places:

| File | Line | Claim set | Triggered by |
|------|------|-----------|--------------|
| `functions/src/members.js` | 178 | `{ role: "member" }` | `approveMember` — called by existing super_admin |
| `functions/src/members.js` | 308 | `{ role: "leader" }` | `approveGroup` — called by existing super_admin |

Neither path ever assigns `super_admin`. There is no `promoteSuperAdmin`, `createSuperAdmin`, or equivalent callable function.

---

## 2. Does any existing user in the codebase automatically get super_admin?

**No. Every code path that creates or approves a user hardcodes a non-admin role.**

### `onUserCreate` trigger (`functions/index.js:43`)
```js
role: "member",           // hardcoded for every new Auth user
status: "pending_approval",
```
All Auth-triggered user documents are created as `member / pending_approval`. No special-casing for any email, phone, or UID.

### `registerMember` callable (`functions/src/members.js:132`)
```js
role: ROLES.MEMBER,       // hardcoded
status: USER_STATUS.PENDING_APPROVAL,
```
Same result via the public registration path.

### `approveMember` callable (`functions/src/members.js:178`)
```js
await auth.setCustomUserClaims(userId, { role: ROLES.MEMBER });
```
Approval always downgrades/confirms as `member`, never as `super_admin`.

**Conclusion**: There is no automatic, conditional, or seed-based mechanism that grants `super_admin` to anyone. The role exists in `constants.js` and is checked by `requireRole`, but it is never assigned through any callable or trigger.

---

## 3. What is the safest way to bootstrap the first super_admin?

Because no callable function can create or escalate to `super_admin`, bootstrapping must be done **out-of-band using the Firebase Admin SDK with a service account** — never through the public API.

### Recommended approach: one-time Node.js bootstrap script

Run once, locally, against production (or emulator for testing), then delete the script.

```js
// scripts/bootstrap-super-admin.js
// Run with: node scripts/bootstrap-super-admin.js
// Requires GOOGLE_APPLICATION_CREDENTIALS or explicit serviceAccountKey.json

const admin = require("firebase-admin");
// const serviceAccount = require("./serviceAccountKey.json"); // if not using ADC

admin.initializeApp({
  // credential: admin.credential.cert(serviceAccount), // uncomment if using key file
  credential: admin.credential.applicationDefault(),
  databaseURL: "https://<PROJECT_ID>.firebaseio.com",
});

const db = admin.firestore();
const auth = admin.auth();

async function bootstrap() {
  const phone = "+257XXXXXXXX";                  // real phone number
  const email = `${phone}@kirimba.app`;
  const pin = "XXXX";                            // strong temporary PIN
  const fullName = "Super Admin";

  // 1. Create or look up the Auth user
  let userRecord;
  try {
    userRecord = await auth.getUserByEmail(email);
    console.log("Auth user already exists:", userRecord.uid);
  } catch {
    userRecord = await auth.createUser({
      email,
      password: pin,
      displayName: fullName,
    });
    console.log("Auth user created:", userRecord.uid);
  }

  const uid = userRecord.uid;

  // 2. Set the custom claim
  await auth.setCustomUserClaims(uid, { role: "super_admin" });
  console.log("Custom claim set: role=super_admin");

  // 3. Write / overwrite the Firestore user document
  await db.collection("users").doc(uid).set(
    {
      uid,
      fullName,
      phone,
      role: "super_admin",
      status: "active",
      groupId: null,
      isLeader: false,
      ledGroupId: null,
      nationalId: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  console.log("Firestore user document written.");

  // 4. Force token refresh on next login (claims don't refresh automatically)
  //    Nothing to do here — the user must sign out and sign back in, or
  //    the frontend must call user.getIdToken(true) to force a refresh.

  console.log("Bootstrap complete. UID:", uid);
  process.exit(0);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

### Alternative: Firebase Console (no code)

1. **Firebase Console → Authentication → Add user** — provide `+257XXXXXXXX@kirimba.app` and a temporary PIN.
2. Copy the generated UID.
3. **Firestore Console → `users/{uid}`** — create the document manually with `role: "super_admin"`, `status: "active"`.
4. **Custom claims cannot be set from the Console UI** — use the Firebase CLI:
   ```bash
   # Requires firebase-admin installed globally or in a temp script
   node -e "
     const admin = require('firebase-admin');
     admin.initializeApp();
     admin.auth().setCustomUserClaims('<UID>', { role: 'super_admin' })
       .then(() => { console.log('done'); process.exit(0); });
   "
   ```

### Alternative: Firebase Auth Emulator (local dev only)

In the emulator UI (`http://localhost:4000/auth`), create a user and manually assign custom claims via the "Edit user" dialog.

---

## Security Notes

| Risk | Mitigation |
|------|------------|
| No callable path to grant `super_admin` | Good — privilege escalation via API is impossible by design |
| Bootstrap script must use a service account key | Store key in a secrets manager; never commit to git |
| `requireRole` falls back to reading `users/{uid}.role` from Firestore if token has no claim | The Firestore document must also have `role: "super_admin"` for consistency (script above does this) |
| Custom claims persist until explicitly changed | After bootstrap, revoke the service account key and delete the script |
| PIN set during bootstrap should be changed immediately | Have the super_admin reset their PIN via `resetPIN` after first login |

---

## Summary

| Question | Answer |
|----------|--------|
| Any function assigns `super_admin` claim? | **No** — `setCustomUserClaims` only ever sets `member` or `leader` |
| Any user automatically gets `super_admin`? | **No** — all code paths hardcode `role: "member"` |
| Safe bootstrap path? | **Admin SDK one-time script** (service account, run locally, delete after) |
