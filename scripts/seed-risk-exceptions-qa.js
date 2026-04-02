#!/usr/bin/env node
"use strict";

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "kirimba-banking";
const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST) && Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const resetOnly = process.argv.includes("--reset");

if (!isEmulator) {
  console.error(
    "Safety stop: Risk & Exceptions QA fixtures are emulator-only. Set FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST."
  );
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

const BASE = {
  institutionId: "umuco",
  agentId: "seed_agent",
  memberId: "seed_member_active_a",
  leaderId: "seed_leader_active",
  groupId: "seed_group_active",
};

const IDS = {
  flaggedBatch: "risk_batch_flagged",
  flaggedBatchTxn: "risk_txn_flagged_deposit",
  defaultedLoan: "risk_loan_defaulted",
  flaggedReconciliation: "risk_reconciliation_flagged",
  manifest: "risk_exceptions_qa_manifest",
};

function daysFromNow(days) {
  return Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

async function ensureBaseline() {
  const [groupSnap, agentSnap, memberSnap, institutionSnap] = await Promise.all([
    db.collection("groups").doc(BASE.groupId).get(),
    db.collection("users").doc(BASE.agentId).get(),
    db.collection("users").doc(BASE.memberId).get(),
    db.collection("institutions").doc(BASE.institutionId).get(),
  ]);

  if (!groupSnap.exists || !agentSnap.exists || !memberSnap.exists || !institutionSnap.exists) {
    throw new Error(
      "Baseline seed is missing. Run the emulator baseline seed first: npm run seed:test-env"
    );
  }
}

async function seedFixtures() {
  await ensureBaseline();

  const now = Timestamp.now();
  const batch = db.batch();

  batch.set(
    db.collection("transactions").doc(IDS.flaggedBatchTxn),
    {
      userId: BASE.memberId,
      memberId: BASE.memberId,
      groupId: BASE.groupId,
      walletId: BASE.memberId,
      type: "deposit",
      amount: 22000,
      status: "pending_confirmation",
      channel: "agent",
      batchId: IDS.flaggedBatch,
      recordedBy: BASE.agentId,
      notes: "Risk QA fixture deposit transaction",
      createdAt: daysFromNow(-2),
      updatedAt: daysFromNow(-1),
    },
    { merge: true }
  );

  batch.set(
    db.collection("depositBatches").doc(IDS.flaggedBatch),
    {
      groupId: BASE.groupId,
      institutionId: BASE.institutionId,
      agentId: BASE.agentId,
      status: "flagged",
      totalAmount: 22000,
      memberCount: 1,
      transactionIds: [IDS.flaggedBatchTxn],
      institutionNotes: "QA fixture: flagged for deposit mismatch follow-up.",
      createdAt: daysFromNow(-2),
      updatedAt: daysFromNow(-1),
      submittedAt: daysFromNow(-2),
      flaggedAt: daysFromNow(-1),
    },
    { merge: true }
  );

  batch.set(
    db.collection("loans").doc(IDS.defaultedLoan),
    {
      userId: BASE.memberId,
      memberId: BASE.memberId,
      groupId: BASE.groupId,
      institutionId: BASE.institutionId,
      amount: 90000,
      paidAmount: 10000,
      remainingDue: 80000,
      interestAmount: 9000,
      totalDue: 99000,
      termDays: 30,
      purpose: "Risk QA fixture loan",
      status: "defaulted",
      disbursedBy: BASE.agentId,
      disbursedAt: daysFromNow(-20),
      defaultedAt: daysFromNow(-3),
      createdAt: daysFromNow(-25),
      updatedAt: daysFromNow(-3),
      dueDate: daysFromNow(-8),
    },
    { merge: true }
  );

  batch.set(
    db.collection("agentReconciliations").doc(IDS.flaggedReconciliation),
    {
      agentId: BASE.agentId,
      date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      cashExpected: 120000,
      cashCounted: 109000,
      difference: -11000,
      depositCount: 3,
      withdrawCount: 1,
      offlinePendingCount: 1,
      commissionAccrued: 4500,
      status: "flagged",
      adminNote: "QA fixture: unresolved shortage requires follow-up in mismatch lane.",
      createdAt: daysFromNow(-2),
      updatedAt: daysFromNow(-1),
      reviewedAt: daysFromNow(-1),
    },
    { merge: true }
  );

  batch.set(
    db.collection("groups").doc(BASE.groupId),
    {
      status: "suspended",
      suspendedAt: now,
      suspendedBy: "risk_qa_fixture",
      suspendReason: "QA fixture: paused for governance escalation validation.",
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(
    db.collection("users").doc(BASE.agentId),
    {
      status: "suspended",
      suspendedAt: now,
      suspendedBy: "risk_qa_fixture",
      suspendReason: "QA fixture: suspended for agent handoff validation.",
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(
    db.collection("agents").doc(BASE.agentId),
    {
      uid: BASE.agentId,
      fullName: "Demo Field Agent",
      phone: "+25766100001",
      status: "suspended",
      createdAt: daysFromNow(-30),
      updatedAt: now,
    },
    { merge: true }
  );

  batch.set(
    db.collection("config").doc(IDS.manifest),
    {
      key: IDS.manifest,
      seededAt: now,
      environment: "emulator",
      notes: [
        "Risk & Exceptions QA fixtures",
        "Uses real source collections only",
        "Safe for emulator validation only",
      ],
      createdRecords: [
        "depositBatches/risk_batch_flagged",
        "transactions/risk_txn_flagged_deposit",
        "loans/risk_loan_defaulted",
        "agentReconciliations/risk_reconciliation_flagged",
        "groups/seed_group_active (suspended)",
        "users/seed_agent (suspended)",
        "agents/seed_agent (directory mirror)",
      ],
    },
    { merge: true }
  );

  await batch.commit();
}

async function resetFixtures() {
  await ensureBaseline();

  const batch = db.batch();

  batch.delete(db.collection("transactions").doc(IDS.flaggedBatchTxn));
  batch.delete(db.collection("depositBatches").doc(IDS.flaggedBatch));
  batch.delete(db.collection("loans").doc(IDS.defaultedLoan));
  batch.delete(db.collection("agentReconciliations").doc(IDS.flaggedReconciliation));
  batch.delete(db.collection("config").doc(IDS.manifest));

  batch.set(
    db.collection("groups").doc(BASE.groupId),
    {
      status: "active",
      suspendedAt: FieldValue.delete(),
      suspendedBy: FieldValue.delete(),
      suspendReason: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  batch.set(
    db.collection("users").doc(BASE.agentId),
    {
      status: "active",
      suspendedAt: FieldValue.delete(),
      suspendedBy: FieldValue.delete(),
      suspendReason: FieldValue.delete(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  batch.set(
    db.collection("agents").doc(BASE.agentId),
    {
      uid: BASE.agentId,
      fullName: "Demo Field Agent",
      phone: "+25766100001",
      status: "active",
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await batch.commit();
}

async function main() {
  console.log("Risk & Exceptions QA fixtures target: emulator");

  if (resetOnly) {
    await resetFixtures();
    console.log("Risk QA fixture reset complete.");
    return;
  }

  await seedFixtures();
  console.log("Risk QA fixture seed complete.");
  console.log("Created coverage:");
  console.log("- flagged deposit batch");
  console.log("- defaulted loan");
  console.log("- flagged reconciliation");
  console.log("- suspended group");
  console.log("- suspended agent");
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
