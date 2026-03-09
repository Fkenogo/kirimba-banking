const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId: "kirimba-banking",
});

const db = admin.firestore();
const auth = admin.auth();

async function main() {
  const email = "fredkenogo@gmail.com";

  const userRecord = await auth.getUserByEmail(email);
  const uid = userRecord.uid;
  const customClaims = userRecord.customClaims || {};

  const userSnap = await db.collection("users").doc(uid).get();
  const userData = userSnap.exists ? userSnap.data() : null;

  console.log("uid:          ", uid);
  console.log("customClaims: ", JSON.stringify(customClaims, null, 2));
  console.log("role:         ", userData?.role ?? "(not found)");
  console.log("status:       ", userData?.status ?? "(not found)");
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
