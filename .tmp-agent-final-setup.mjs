import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithCustomToken } from "firebase/auth";
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
const app = initializeApp(firebaseConfig, "agent-final-setup");
const auth = getAuth(app);
const functions = getFunctions(app);

connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFunctionsEmulator(functions, "127.0.0.1", 5001);

async function signInAs(uid, claims) {
  const token = await admin.auth().createCustomToken(uid, claims);
  await signInWithCustomToken(auth, token);
}

async function deleteQuery(query) {
  const snap = await query.get();
  if (snap.empty) return;
  const batch = adminDb.batch();
  snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
}

const today = new Date().toISOString().slice(0, 10);
const dueDate = admin.firestore.Timestamp.fromDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));

await Promise.all([
  deleteQuery(adminDb.collection("transactions").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("agentLedgers").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("depositBatches").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("agentSettlements").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("agentReconciliations").where("agentId", "==", "seed_agent")),
  deleteQuery(adminDb.collection("notifications").where("recipientId", "==", "seed_agent")),
]);

await Promise.all([
  adminDb.collection("users").doc("seed_agent").set({
    uid: "seed_agent",
    role: "agent",
    status: "active",
    institutionId: "umuco",
    fullName: "Seed Agent",
    name: "Seed Agent",
    phone: "+25766100001",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  adminDb.collection("agents").doc("seed_agent").set({
    userId: "seed_agent",
    status: "active",
    institutionId: "umuco",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  adminDb.collection("users").doc("seed_member_active_a").set({
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
  }, { merge: true }),
  adminDb.collection("groupMembers").doc("seed_member_active_a").set({
    userId: "seed_member_active_a",
    groupId: "seed_group_active",
    status: "active",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  adminDb.collection("groups").doc("seed_group_active").set({
    name: "Seed Active Group",
    status: "active",
    institutionId: "umuco",
    totalLoansOutstanding: 8000,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  adminDb.collection("wallets").doc("seed_member_active_a").set({
    userId: "seed_member_active_a",
    balanceConfirmed: 50000,
    balancePending: 0,
    balanceLocked: 8000,
    availableBalance: 42000,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  adminDb.collection("kirimbaFund").doc("current").set({
    availableFund: 1000000,
    deployedFund: 8000,
    repaidReturned: 0,
    feeIncomeCollected: 0,
    retainedFeeIncome: 0,
    groupIncentiveAccrued: 0,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
  adminDb.collection("loans").doc("seed_active_loan").set({
    userId: "seed_member_active_a",
    groupId: "seed_group_active",
    amount: 8000,
    contractedFeeAmount: 800,
    totalDue: 8800,
    paidAmount: 0,
    remainingDue: 8800,
    principalOutstandingAmount: 8000,
    principalRepaidAmount: 0,
    feeCollectedAmount: 0,
    groupIncentiveSharePct: 0,
    status: "active",
    dueDate,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true }),
]);

await signInAs("seed_agent", { role: "agent", institutionId: "umuco" });

const recordDeposit = httpsCallable(functions, "recordDeposit");
const recordWithdrawal = httpsCallable(functions, "recordWithdrawal");
const recordRepayment = httpsCallable(functions, "recordRepayment");
const submitBatch = httpsCallable(functions, "submitBatch");
const requestSettlement = httpsCallable(functions, "requestSettlement");
const approveSettlement = httpsCallable(functions, "approveSettlement");
const markSettlementPaid = httpsCallable(functions, "markSettlementPaid");

const deposit1 = await recordDeposit({
  userId: "seed_member_active_a",
  memberId: "M-MA-001",
  groupId: "seed_group_active",
  amount: 10000,
  channel: "agent_qr",
  source: "online",
});

const withdrawal1 = await recordWithdrawal({
  userId: "seed_member_active_a",
  amount: 5000,
  notes: "Final agent pass validation",
});

const repayment1 = await recordRepayment({
  loanId: "seed_active_loan",
  amount: 2000,
  channel: "agent",
});

const batch1 = await submitBatch({
  groupId: "seed_group_active",
  transactionIds: [deposit1.data.transactionId],
  idempotencyToken: `final_batch_${Date.now()}`,
});

const settlement1 = await requestSettlement({
  periodStart: today,
  periodEnd: today,
  notes: "First commission request for paid validation",
});

await signInAs("seed_finance", { role: "finance" });
await approveSettlement({
  settlementId: settlement1.data.settlementId,
  approvedAmount: settlement1.data.commissionTotal,
  notes: "Approved during final agent validation",
});
await markSettlementPaid({
  settlementId: settlement1.data.settlementId,
  paidAmount: settlement1.data.commissionTotal,
  reference: "SETTLE-PAID-001",
  notes: "Paid during final agent validation",
});

await signInAs("seed_agent", { role: "agent", institutionId: "umuco" });

const deposit2 = await recordDeposit({
  userId: "seed_member_active_a",
  memberId: "M-MA-001",
  groupId: "seed_group_active",
  amount: 12000,
  channel: "agent",
  source: "online",
});

const settlement2 = await requestSettlement({
  periodStart: today,
  periodEnd: today,
  notes: "Open commission request for visibility",
});

await signInAs("seed_finance", { role: "finance" });
await approveSettlement({
  settlementId: settlement2.data.settlementId,
  approvedAmount: settlement2.data.commissionTotal,
  notes: "Approved and waiting for payout",
});

const notificationSnap = await adminDb
  .collection("notifications")
  .where("recipientId", "==", "seed_agent")
  .get();

console.log(JSON.stringify({
  today,
  deposit1: deposit1.data,
  withdrawal1: withdrawal1.data,
  repayment1: repayment1.data,
  batch1: batch1.data,
  settlement1: settlement1.data,
  deposit2: deposit2.data,
  settlement2: settlement2.data,
  notifications: notificationSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })),
}, null, 2));
