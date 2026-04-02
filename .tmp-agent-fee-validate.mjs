import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, getDocs, getFirestore, query, where } from "firebase/firestore";
import { connectFunctionsEmulator, getFunctions, httpsCallable } from "firebase/functions";
import admin from "firebase-admin";

const firebaseConfig = {
  apiKey: "demo-kirimba",
  authDomain: "kirimba-banking.firebaseapp.com",
  projectId: "kirimba-banking",
  appId: "1:demo:web:kirimba",
};

const app = initializeApp(firebaseConfig, "agent-fee-validate");
const auth = getAuth(app);
const db = getFirestore(app);
const functions = getFunctions(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFirestoreEmulator(db, "127.0.0.1", 8080);
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
if (!admin.apps.length) {
  admin.initializeApp({ projectId: "kirimba-banking" });
}
const adminDb = admin.firestore();

function fmtCurrency(value) {
  return `${Number(value || 0).toLocaleString()} BIF`;
}

async function signInAs(uid, claims) {
  const token = await admin.auth().createCustomToken(uid, claims);
  await signInWithCustomToken(auth, token);
}

async function getEntriesForTransactions(agentId, transactionIds) {
  const snap = await getDocs(query(collection(db, "agentLedgers"), where("agentId", "==", agentId)));
  return snap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((entry) => transactionIds.includes(entry.transactionId));
}

async function main() {
  await adminDb.collection("transactions").doc("seed_txn_deposit_pending").delete().catch(() => {});
  await adminDb.collection("depositBatches").doc("seed_batch_submitted").delete().catch(() => {});
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
  const pendingDeposits = await adminDb
    .collection("transactions")
    .where("userId", "==", "seed_member_active_a")
    .where("type", "==", "deposit")
    .where("status", "==", "pending_confirmation")
    .get();
  const cleanupBatch = adminDb.batch();
  pendingDeposits.docs.forEach((doc) => cleanupBatch.delete(doc.ref));
  if (!pendingDeposits.empty) {
    await cleanupBatch.commit();
  }
  const today = new Date().toISOString().slice(0, 10);
  const existingSettlements = await adminDb
    .collection("agentSettlements")
    .where("agentId", "==", "seed_agent")
    .where("periodStart", "==", today)
    .where("periodEnd", "==", today)
    .get();
  if (!existingSettlements.empty) {
    const cleanupSettlements = adminDb.batch();
    existingSettlements.docs.forEach((doc) => cleanupSettlements.delete(doc.ref));
    await cleanupSettlements.commit();
  }

  await signInAs("seed_agent", { role: "agent", institutionId: "umuco" });
  const agentId = auth.currentUser.uid;

  const recordDeposit = httpsCallable(functions, "recordDeposit");
  const recordWithdrawal = httpsCallable(functions, "recordWithdrawal");
  const requestSettlement = httpsCallable(functions, "requestSettlement");

  console.log("Calling recordDeposit...");
  const depositRes = await recordDeposit({
    userId: "seed_member_active_a",
    memberId: "M-MA-001",
    groupId: "seed_group_active",
    amount: 10000,
    channel: "agent_qr",
    source: "online",
  });

  console.log("Calling recordWithdrawal...");
  const withdrawalRes = await recordWithdrawal({
    userId: "seed_member_active_a",
    amount: 5000,
    notes: "Validation withdrawal",
  });

  const ledgerEntries = await getEntriesForTransactions(agentId, [
    depositRes.data.transactionId,
    withdrawalRes.data.transactionId,
  ]);

  const feeEntries = ledgerEntries.filter((entry) => entry.type === "fee");
  const commissionEntries = ledgerEntries.filter((entry) => entry.type === "commission");
  const feeTotal = feeEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const commissionTotal = commissionEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const kirimbaRetained = feeTotal - commissionTotal;

  const settlementRes = await requestSettlement({
    periodStart: today,
    periodEnd: today,
    notes: "Validation settlement",
  });

  await signOut(auth);
  await signInAs("seed_admin", { role: "admin" });
  const getSystemConfig = httpsCallable(functions, "getSystemConfig");
  const feesConfig = (await getSystemConfig({ configId: "fees" })).data?.data || {};
  const commissionPolicy = (await getSystemConfig({ configId: "commissionPolicy" })).data?.data || {};

  console.log(JSON.stringify({
    deposit: depositRes.data,
    withdrawal: withdrawalRes.data,
    feeEntries,
    commissionEntries,
    summary: {
      feeTotal,
      commissionTotal,
      kirimbaRetained,
      settlementCommissionTotal: settlementRes.data?.commissionTotal || 0,
    },
    feesConfig,
    commissionPolicy,
    formatted: {
      feeTotal: fmtCurrency(feeTotal),
      commissionTotal: fmtCurrency(commissionTotal),
      kirimbaRetained: fmtCurrency(kirimbaRetained),
      settlementCommissionTotal: fmtCurrency(settlementRes.data?.commissionTotal || 0),
    },
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
