const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const auth = admin.auth();

async function upgrade() {
  const email = "fredkenogo@gmail.com";

  const user = await auth.getUserByEmail(email);
  const uid = user.uid;

  console.log("Found user:", uid);

  await auth.setCustomUserClaims(uid, { role: "super_admin" });
  console.log("Custom claim set to super_admin");

  await db.collection("users").doc(uid).set(
    {
      role: "super_admin",
      status: "active",
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log("Firestore updated");
  console.log("Upgrade complete");
  process.exit(0);
}

upgrade().catch((err) => {
  console.error(err);
  process.exit(1);
});
