import admin from "firebase-admin";

process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "kirimba-banking" });
}

const db = admin.firestore();
const snap = await db.collection("depositBatches").where("institutionId", "==", "seed_inst_a").get();
console.log(JSON.stringify(
  snap.docs.map((docSnap) => ({
    id: docSnap.id,
    status: docSnap.data().status,
    institutionRef: docSnap.data().institutionRef || null,
    institutionNotes: docSnap.data().institutionNotes || null,
  })),
  null,
  2
));
process.exit(0);
