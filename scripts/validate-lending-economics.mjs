#!/usr/bin/env node

import admin from "firebase-admin";
import { createRequire } from "module";

const PROJECT_ID = process.env.GCLOUD_PROJECT || "kirimba-banking";
const require = createRequire(import.meta.url);
const loanFunctions = require("../functions/src/loans");

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error("This validation script must run against the Firestore emulator.");
  process.exit(1);
}

const MEMBER_UID = "seed_member_active_a";
const ADMIN_UID = "seed_admin";
const GROUP_ID = "seed_group_active";
const PRINCIPAL = 28000;
const TERMS = [7, 14, 21, 30];
const DEFAULT_LOAN_POLICY = {
  autoApproval: true,
  maxLoanMultiplier: 1.5,
  minLoanAmount: 1000,
  maxLoanAmount: 5000000,
  defaultTermDays: 14,
  earlySettlementRebateEnabled: false,
  rebateMode: "deferred",
  groupIncentiveSharePct: 0.1,
  termPricing: [
    { durationDays: 7, contractedFeePct: 0.025, minimumFeeFloor: 0, rebateBands: [], active: true },
    { durationDays: 14, contractedFeePct: 0.04, minimumFeeFloor: 0, rebateBands: [], active: true },
    { durationDays: 21, contractedFeePct: 0.055, minimumFeeFloor: 0, rebateBands: [], active: true },
    { durationDays: 30, contractedFeePct: 0.07, minimumFeeFloor: 0, rebateBands: [], active: true },
  ],
};

function logStep(message) {
  console.error(`[validate-lending] ${message}`);
}

if (!admin.apps.length) {
  admin.initializeApp({ projectId: PROJECT_ID });
}

const db = admin.firestore();
const memberContext = {
  auth: {
    uid: MEMBER_UID,
    token: {
      role: "member",
      institutionId: "umuco",
    },
  },
};
const adminContext = {
  auth: {
    uid: ADMIN_UID,
    token: {
      role: "admin",
    },
  },
};

function timestampToIso(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (typeof value.toMillis === "function") return new Date(value.toMillis()).toISOString();
  return null;
}

async function deleteCollection(collectionName, filters = []) {
  let query = db.collection(collectionName);
  for (const [field, op, value] of filters) {
    query = query.where(field, op, value);
  }
  const snap = await query.get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function resetValidationState() {
  logStep("resetting validation state");
  await deleteCollection("loans");
  await deleteCollection("fundLedger");
  await deleteCollection("groupIncentiveLedger");
  await deleteCollection("transactions", [["type", "in", ["loan_disburse", "loan_repay"]]]);
  await deleteCollection("auditLog", [["targetType", "==", "loan"]]);

  await db.collection("kirimbaFund").doc("current").set({
    totalCapital: 2500000,
    availableFund: 2500000,
    deployedFund: 0,
    totalCollateral: 0,
    defaultedExposure: 0,
    repaidReturned: 0,
    feeIncomeCollected: 0,
    retainedFeeIncome: 0,
    groupIncentiveAccrued: 0,
    lendingPaused: false,
    lendingPausedReason: null,
    updatedBy: ADMIN_UID,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection("systemConfig").doc("loanPolicy").set({
    ...DEFAULT_LOAN_POLICY,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: ADMIN_UID,
  }, { merge: true });

  await db.collection("groups").doc(GROUP_ID).set({
    totalLoansOutstanding: 0,
    incentivePoolAccrued: 0,
    incentivePoolUndistributed: 0,
    borrowingPaused: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  await db.collection("wallets").doc(MEMBER_UID).set({
    balanceConfirmed: 120000,
    balancePending: 0,
    balanceLocked: 0,
    availableBalance: 120000,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function getLoanArtifacts(loanId) {
  logStep(`loading artifacts for ${loanId}`);
  const [loanSnap, fundSnap, groupSnap, fundLedgerSnap, incentiveSnap] = await Promise.all([
    db.collection("loans").doc(loanId).get(),
    db.collection("kirimbaFund").doc("current").get(),
    db.collection("groups").doc(GROUP_ID).get(),
    db.collection("fundLedger").where("loanId", "==", loanId).get(),
    db.collection("groupIncentiveLedger").where("loanId", "==", loanId).get(),
  ]);

  const loan = { id: loanSnap.id, ...(loanSnap.data() || {}) };
  const fund = fundSnap.data() || {};
  const group = groupSnap.data() || {};
  const fundLedger = fundLedgerSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const incentiveEntries = incentiveSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  return { loan, fund, group, fundLedger, incentiveEntries };
}

async function main() {
  logStep("starting validation");
  await resetValidationState();
  logStep("state reset complete");
  const beforeFund = (await db.collection("kirimbaFund").doc("current").get()).data() || {};
  const results = [];

  for (const termDays of TERMS) {
    logStep(`requesting ${termDays}-day loan`);
    const request = await loanFunctions.requestLoan.run({
      amount: PRINCIPAL,
      termDays,
      purpose: `Validation term ${termDays}`,
    }, memberContext);
    if (!request.approved || !request.loanId) {
      throw new Error(`Loan request for ${termDays} days failed: ${JSON.stringify(request)}`);
    }

    const expectedFee = Number(request.contractedFeeAmount || request.interestAmount || 0);
    const totalDue = Number(request.totalDue || 0);

    logStep(`disbursing ${request.loanId}`);
    await loanFunctions.adminDisburseLoan.run({ loanId: request.loanId }, adminContext);
    logStep(`repaying ${request.loanId}`);
    const repayment = await loanFunctions.adminMarkRepayment.run({ loanId: request.loanId, amount: totalDue }, adminContext);
    const { loan, fund, group, fundLedger, incentiveEntries } = await getLoanArtifacts(request.loanId);

    results.push({
      termDays,
      principal: PRINCIPAL,
      contractedFeePct: Number(loan.contractedFeePct || 0),
      expectedFee,
      totalDue,
      repaymentSplit: {
        principalPayment: Number(repayment.principalPayment || 0),
        feePayment: Number(repayment.feePayment || 0),
      },
      resultingLoan: {
        status: loan.status,
        feeCollectedAmount: Number(loan.feeCollectedAmount || 0),
        groupIncentiveAccruedAmount: Number(loan.groupIncentiveAccruedAmount || 0),
        principalOutstandingAmount: Number(loan.principalOutstandingAmount || 0),
        principalRepaidAmount: Number(loan.principalRepaidAmount || 0),
      },
      fundTotals: {
        feeIncomeCollected: Number(fund.feeIncomeCollected || 0),
        retainedFeeIncome: Number(fund.retainedFeeIncome || 0),
        groupIncentiveAccrued: Number(fund.groupIncentiveAccrued || 0),
        repaidReturned: Number(fund.repaidReturned || 0),
        availableFund: Number(fund.availableFund || 0),
      },
      groupTotals: {
        incentivePoolAccrued: Number(group.incentivePoolAccrued || 0),
        incentivePoolUndistributed: Number(group.incentivePoolUndistributed || 0),
      },
      ledger: fundLedger
        .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0))
        .map((entry) => ({
          type: entry.type,
          amount: Number(entry.amount || 0),
          beforeBalance: entry.beforeBalance == null ? null : Number(entry.beforeBalance),
          afterBalance: entry.afterBalance == null ? null : Number(entry.afterBalance),
          createdAt: timestampToIso(entry.createdAt),
        })),
      incentiveLedger: incentiveEntries.map((entry) => ({
        type: entry.type,
        amount: Number(entry.amount || 0),
        sourceFeeAmount: Number(entry.sourceFeeAmount || 0),
        sharePct: Number(entry.sharePct || 0),
        distributionStatus: entry.distributionStatus || null,
        createdAt: timestampToIso(entry.createdAt),
      })),
    });
  }

  const afterFund = (await db.collection("kirimbaFund").doc("current").get()).data() || {};
  logStep("validation complete");

  console.log(JSON.stringify({
    policy: DEFAULT_LOAN_POLICY,
    fundBefore: {
      availableFund: Number(beforeFund.availableFund || 0),
      repaidReturned: Number(beforeFund.repaidReturned || 0),
      feeIncomeCollected: Number(beforeFund.feeIncomeCollected || 0),
      retainedFeeIncome: Number(beforeFund.retainedFeeIncome || 0),
      groupIncentiveAccrued: Number(beforeFund.groupIncentiveAccrued || 0),
    },
    fundAfter: {
      availableFund: Number(afterFund.availableFund || 0),
      repaidReturned: Number(afterFund.repaidReturned || 0),
      feeIncomeCollected: Number(afterFund.feeIncomeCollected || 0),
      retainedFeeIncome: Number(afterFund.retainedFeeIncome || 0),
      groupIncentiveAccrued: Number(afterFund.groupIncentiveAccrued || 0),
    },
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
}).finally(async () => {
  try {
    await admin.app().delete();
  } catch {}
});
