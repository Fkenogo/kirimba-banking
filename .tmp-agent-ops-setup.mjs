import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import admin from "firebase-admin";

const firebaseConfig = {
  apiKey: "demo-kirimba",
  authDomain: "kirimba-banking.firebaseapp.com",
  projectId: "kirimba-banking",
  appId: "1:demo:web:kirimba",
};

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "kirimba-banking" });
}
const adminDb = admin.firestore();

const app = initializeApp(firebaseConfig, "agent-ops-setup");
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

async function signInAs(uid, claims) {
  const token = await admin.auth().createCustomToken(uid, claims);
  await signInWithCustomToken(auth, token);
}

async function deleteQuery(query) {
  const snap = await query.get();
  if (snap.empty) return 0;
  const batch = adminDb.batch();
  snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
  return snap.size;
}

const today = new Date().toISOString().slice(0, 10);

await Promise.all([
  deleteQuery(adminDb.collection("transactions").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("agentLedgers").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("depositBatches").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("agentSettlements").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("agentReconciliations").where("agentId", "==", "seed_agent")),
]);

await adminDb.collection("users").doc("seed_member_active_a").set(
  {
    uid: "seed_member_active_a",
    role: "member",
    status: "active",
    institutionId: "umuco",
    groupId: "seed_group_active",
    fullName: "Demo Member A",
    name: "Demo Member A",
    phone: "+25766100003",
    memberId: "M-MA-001",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  },
  { merge: true }
);

await signInAs("seed_agent", { role: "agent", institutionId: "umuco" });

const recordDeposit = httpsCallable(functions, "recordDeposit");
const recordWithdrawal = httpsCallable(functions, "recordWithdrawal");
const submitBatch = httpsCallable(functions, "submitBatch");
const requestSettlement = httpsCallable(functions, "requestSettlement");

const depositResult = await recordDeposit({
  userId: "seed_member_active_a",
  memberId: "M-MA-001",
  groupId: "seed_group_active",
  amount: 10000,
  channel: "agent_qr",
  source: "online",
});

const withdrawalResult = await recordWithdrawal({
  userId: "seed_member_active_a",
  amount: 5000,
  notes: "Operations consistency validation",
});

const batchResult = await submitBatch({
  groupId: "seed_group_active",
  transactionIds: [depositResult.data.transactionId],
  idempotencyToken: `ops_${Date.now()}`,
});

const settlementResult = await requestSettlement({
  periodStart: today,
  periodEnd: today,
  notes: "Operations consistency validation",
});

console.log(JSON.stringify({
  today,
  depositResult: depositResult.data,
  withdrawalResult: withdrawalResult.data,
  batchResult: batchResult.data,
  settlementResult: settlementResult.data,
}, null, 2));
