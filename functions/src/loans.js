"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  ROLES,
  USER_STATUS,
  GROUP_STATUS,
  LOAN_STATUS,
  LOAN_TERMS,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
} = require("./constants");
const { calculateContractedLoanPricing, generateReceiptNo } = require("./utils");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MAX_GROUP_EXPOSURE_RATIO = 0.7;
const MAX_BORROWER_CONCENTRATION_RATIO = 0.4;
const GROUP_INCENTIVE_SHARE_PCT = 0.1;
const SUPPORTED_LOAN_TERMS = [
  LOAN_TERMS.DAYS_7,
  LOAN_TERMS.DAYS_14,
  LOAN_TERMS.DAYS_21,
  LOAN_TERMS.DAYS_30,
];
const DEFAULT_LOAN_POLICY = {
  autoApproval: true,
  maxLoanMultiplier: 1.5,
  minLoanAmount: 1000,
  maxLoanAmount: 5000000,
  defaultTermDays: LOAN_TERMS.DAYS_14,
  earlySettlementRebateEnabled: false,
  groupIncentiveSharePct: GROUP_INCENTIVE_SHARE_PCT,
  termPricing: [
    { durationDays: LOAN_TERMS.DAYS_7, contractedFeePct: 0.025, minimumFeeFloor: 0, rebateBands: [], active: true },
    { durationDays: LOAN_TERMS.DAYS_14, contractedFeePct: 0.04, minimumFeeFloor: 0, rebateBands: [], active: true },
    { durationDays: LOAN_TERMS.DAYS_21, contractedFeePct: 0.055, minimumFeeFloor: 0, rebateBands: [], active: true },
    { durationDays: LOAN_TERMS.DAYS_30, contractedFeePct: 0.07, minimumFeeFloor: 0, rebateBands: [], active: true },
  ],
};

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpsError("invalid-argument", "amount must be a positive number.");
  }
  return Math.round(amount);
}

function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}

async function writeAuditLog(actorUid, actorRole, action, targetType, targetId, meta = {}) {
  try {
    await db.collection("auditLog").add({
      actorId: actorUid,
      actorRole,
      action,
      targetType,
      targetId: targetId || null,
      meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[auditLog] Failed to write audit log:", err.message, { action, targetType, targetId });
  }
}

async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (role !== ROLES.MEMBER && role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }

  const uid = context.auth.uid;
  const userRef = db.collection("users").doc(uid);
  const groupMemberRef = db.collection("groupMembers").doc(uid);
  const [userSnap, gmSnap] = await Promise.all([userRef.get(), groupMemberRef.get()]);

  if (!userSnap.exists) {
    throw httpsError("not-found", "User profile not found.");
  }
  if (!gmSnap.exists) {
    throw httpsError("failed-precondition", "Member is not linked to a group.");
  }

  const user = userSnap.data();
  const groupMember = gmSnap.data();
  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  const groupId = groupMember.groupId || user.groupId;
  if (!groupId) {
    throw httpsError("failed-precondition", "Member group missing.");
  }

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Group not found.");
  }
  if (groupSnap.data().status !== GROUP_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Group must be active.");
  }

  return { uid, user, groupMember, groupId };
}

function requireValidLoanTerm(termDays) {
  const term = Number(termDays);
  if (!SUPPORTED_LOAN_TERMS.includes(term)) {
    throw httpsError("invalid-argument", "termDays must be 7, 14, 21, or 30.");
  }
  return term;
}

function normalizeRebateBands(rawBands) {
  if (!Array.isArray(rawBands)) return [];
  return rawBands
    .map((band) => ({
      milestoneDay: Number(band?.milestoneDay),
      rebatePct: Number(band?.rebatePct),
      label: String(band?.label || "").trim() || null,
    }))
    .filter((band) =>
      Number.isFinite(band.milestoneDay) &&
      band.milestoneDay > 0 &&
      Number.isFinite(band.rebatePct) &&
      band.rebatePct >= 0 &&
      band.rebatePct <= 1
    )
    .sort((a, b) => a.milestoneDay - b.milestoneDay);
}

function normalizeLoanPolicyConfig(rawPolicy = {}) {
  const base = {
    ...DEFAULT_LOAN_POLICY,
    ...rawPolicy,
  };

  const termPricing = Array.isArray(rawPolicy?.termPricing)
    ? rawPolicy.termPricing
    : Array.isArray(rawPolicy?.terms)
    ? rawPolicy.terms
    : [];

  const normalizedTermPricing = termPricing
    .map((term) => ({
      durationDays: Number(term?.durationDays),
      contractedFeePct: Number(term?.contractedFeePct),
      minimumFeeFloor: Math.max(0, Number(term?.minimumFeeFloor || 0)),
      rebateBands: normalizeRebateBands(term?.rebateBands),
      active: term?.active !== false,
    }))
    .filter((term) =>
      SUPPORTED_LOAN_TERMS.includes(term.durationDays) &&
      Number.isFinite(term.contractedFeePct) &&
      term.contractedFeePct >= 0 &&
      term.contractedFeePct <= 1
    )
    .sort((a, b) => a.durationDays - b.durationDays);

  const effectiveTermPricing =
    normalizedTermPricing.length === SUPPORTED_LOAN_TERMS.length
      ? normalizedTermPricing
      : DEFAULT_LOAN_POLICY.termPricing;

  return {
    autoApproval: base.autoApproval !== false,
    maxLoanMultiplier: Number.isFinite(Number(base.maxLoanMultiplier)) ? Number(base.maxLoanMultiplier) : DEFAULT_LOAN_POLICY.maxLoanMultiplier,
    minLoanAmount: Number.isFinite(Number(base.minLoanAmount)) ? Number(base.minLoanAmount) : DEFAULT_LOAN_POLICY.minLoanAmount,
    maxLoanAmount: Number.isFinite(Number(base.maxLoanAmount)) ? Number(base.maxLoanAmount) : DEFAULT_LOAN_POLICY.maxLoanAmount,
    defaultTermDays: SUPPORTED_LOAN_TERMS.includes(Number(base.defaultTermDays)) ? Number(base.defaultTermDays) : DEFAULT_LOAN_POLICY.defaultTermDays,
    earlySettlementRebateEnabled: base.earlySettlementRebateEnabled === true,
    groupIncentiveSharePct: Number.isFinite(Number(base.groupIncentiveSharePct))
      ? Math.max(0, Math.min(1, Number(base.groupIncentiveSharePct)))
      : DEFAULT_LOAN_POLICY.groupIncentiveSharePct,
    termPricing: effectiveTermPricing,
  };
}

async function getLoanPolicyConfig() {
  const snap = await db.collection("systemConfig").doc("loanPolicy").get();
  const policy = normalizeLoanPolicyConfig(snap.exists ? (snap.data() || {}) : {});
  return {
    ...policy,
    source: snap.exists ? "systemConfig" : "default_fallback",
  };
}

function getTermPricingConfig(policy, termDays) {
  const term = policy.termPricing.find((item) => item.durationDays === termDays && item.active !== false);
  if (!term) {
    throw httpsError("failed-precondition", `Loan term ${termDays} days is not active in the pricing policy.`);
  }
  return term;
}

async function executeLoanDisbursement(loanId, actorUid, channel = "admin_console") {
  const loanRef = db.collection("loans").doc(loanId);
  const transactionRef = db.collection("transactions").doc();
  const receiptNo = await generateReceiptNo(db, "TXN");

  let responsePayload = null;
  await db.runTransaction(async (tx) => {
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists) {
      throw httpsError("not-found", "Loan not found.");
    }

    const loan = loanSnap.data();
    if (loan.status !== LOAN_STATUS.PENDING) {
      throw httpsError("failed-precondition", "Loan is not pending disbursement.");
    }

    const walletRef = db.collection("wallets").doc(loan.userId);
    const fundRef = db.collection("kirimbaFund").doc("current");
    const groupRef = loan.groupId ? db.collection("groups").doc(loan.groupId) : null;
    const [walletSnap, fundSnap] = await Promise.all([tx.get(walletRef), tx.get(fundRef)]);
    if (!walletSnap.exists) {
      throw httpsError("failed-precondition", "Wallet not found for this member.");
    }
    if (!fundSnap.exists) {
      throw httpsError("failed-precondition", "kirimbaFund/current is missing.");
    }

    const amount = Number(loan.amount || 0);
    const wallet = walletSnap.data();
    const fund = fundSnap.data();
    const availableFund = Number(fund.availableFund || 0);
    if (availableFund < amount) {
      throw httpsError("failed-precondition", "Insufficient available fund for disbursement.");
    }

    const newBalanceLocked = Number(wallet.balanceLocked || 0) + amount;
    const newAvailableBalance = Number(wallet.balanceConfirmed || 0) - newBalanceLocked;
    const deployedFund = Number(fund.deployedFund || 0) + amount;

    tx.set(
      loanRef,
      {
        status: LOAN_STATUS.ACTIVE,
        disbursedBy: actorUid,
        disbursedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.update(walletRef, {
      balanceLocked: newBalanceLocked,
      availableBalance: newAvailableBalance,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      fundRef,
      {
        deployedFund,
        availableFund: availableFund - amount,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      },
      { merge: true }
    );

    const disburseLedgerRef = db.collection("fundLedger").doc();
    tx.set(disburseLedgerRef, {
      type: "loan_out",
      amount,
      beforeBalance: availableFund,
      afterBalance: availableFund - amount,
      notes: `Loan disbursed: ${loanId}`,
      actorId: actorUid,
      actorRole: null,
      loanId,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (groupRef) {
      tx.set(
        groupRef,
        {
          totalLoansOutstanding: FieldValue.increment(amount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    const balanceBeforeDisburse = Number(wallet.balanceConfirmed || 0);

    tx.set(transactionRef, {
      memberId: loan.userId,
      userId: loan.userId,
      walletId: loan.userId,
      groupId: loan.groupId,
      agentId: channel === "agent" ? actorUid : null,
      type: TRANSACTION_TYPE.LOAN_DISBURSE,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: actorUid,
      channel,
      batchId: null,
      notes: "Loan disbursed via operations console",
      receiptNo,
      balanceBefore: balanceBeforeDisburse,
      balanceAfter: balanceBeforeDisburse,
      ledgerImpact: 0,
      createdAt: FieldValue.serverTimestamp(),
      loanId,
    });

    responsePayload = {
      success: true,
      loanId,
      transactionId: transactionRef.id,
      receiptNo,
      amount,
      status: LOAN_STATUS.ACTIVE,
    };
  });

  return responsePayload;
}

async function executeLoanRepayment(loanId, amount, actorUid, channel) {
  const loanRef = db.collection("loans").doc(loanId);
  const transactionRef = db.collection("transactions").doc();
  const receiptNo = await generateReceiptNo(db, "TXN");

  let responsePayload = null;
  await db.runTransaction(async (tx) => {
    const loanSnap = await tx.get(loanRef);
    if (!loanSnap.exists) {
      throw httpsError("not-found", "Loan not found.");
    }

    const loan = loanSnap.data();
    if (loan.status !== LOAN_STATUS.ACTIVE) {
      throw httpsError("failed-precondition", "Loan is not active.");
    }

    const remainingDue = Number(loan.remainingDue || 0);
    if (amount > remainingDue) {
      throw httpsError("failed-precondition", "Repayment amount exceeds remaining due.");
    }

    const walletRef = db.collection("wallets").doc(loan.userId);
    const fundRef = db.collection("kirimbaFund").doc("current");
    const groupRef = loan.groupId ? db.collection("groups").doc(loan.groupId) : null;
    const [walletSnap, fundSnap] = await Promise.all([tx.get(walletRef), tx.get(fundRef)]);
    if (!walletSnap.exists) {
      throw httpsError("failed-precondition", "Wallet not found for this member.");
    }
    if (!fundSnap.exists) {
      throw httpsError("failed-precondition", "Required financial records are missing.");
    }

    const wallet = walletSnap.data();
    const fund = fundSnap.data();
    const previousPaidAmount = Number(loan.paidAmount || 0);
    const paidAmount = previousPaidAmount + amount;
    const nextRemainingDue = Math.max(0, remainingDue - amount);
    const fullyRepaid = nextRemainingDue <= 0;

    const contractedFeeAmount = Math.max(
      0,
      Number(
        loan.contractedFeeAmount ??
          loan.interestAmount ??
          Math.max(0, Number(loan.totalDue || 0) - Number(loan.amount || 0))
      )
    );
    const principalAmount = Math.max(0, Number(loan.amount || 0));
    const principalRepaidBefore = Math.min(Number(loan.principalRepaidAmount || previousPaidAmount || 0), principalAmount);
    const principalOutstandingBefore = Math.max(
      0,
      Number(loan.principalOutstandingAmount ?? (principalAmount - principalRepaidBefore))
    );
    const principalPayment = Math.min(amount, principalOutstandingBefore);
    const feePayment = Math.max(0, amount - principalPayment);
    const principalRepaidAmount = principalRepaidBefore + principalPayment;
    const principalOutstandingAmount = Math.max(0, principalOutstandingBefore - principalPayment);
    const feeCollectedBefore = Math.max(0, Number(loan.feeCollectedAmount || Math.max(0, previousPaidAmount - principalAmount)));
    const feeCollectedAmount = feeCollectedBefore + feePayment;
    const groupIncentiveSharePct = Number.isFinite(Number(loan.groupIncentiveSharePct))
      ? Number(loan.groupIncentiveSharePct)
      : GROUP_INCENTIVE_SHARE_PCT;
    const incentiveAccruedThisPayment = Math.round(feePayment * groupIncentiveSharePct);
    const netFeeIncomeThisPayment = Math.max(0, feePayment - incentiveAccruedThisPayment);
    const deployedFund = Math.max(0, Number(fund.deployedFund || 0) - principalPayment);
    const availableFund = Number(fund.availableFund || 0) + principalPayment + netFeeIncomeThisPayment;

    tx.set(
      loanRef,
      {
        paidAmount,
        remainingDue: nextRemainingDue,
        principalRepaidAmount,
        principalOutstandingAmount,
        feeCollectedAmount,
        groupIncentiveAccruedAmount: FieldValue.increment(incentiveAccruedThisPayment),
        status: fullyRepaid ? LOAN_STATUS.REPAID : LOAN_STATUS.ACTIVE,
        repaidAt: fullyRepaid ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (fullyRepaid) {
      const newBalanceLocked = Math.max(0, Number(wallet.balanceLocked || 0) - principalAmount);
      const newAvailableBalance = Number(wallet.balanceConfirmed || 0) - newBalanceLocked;
      tx.update(walletRef, {
        balanceLocked: newBalanceLocked,
        availableBalance: newAvailableBalance,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (groupRef && principalAmount > 0) {
        tx.set(
          groupRef,
          {
            totalLoansOutstanding: FieldValue.increment(-principalPayment),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    } else if (groupRef && principalPayment > 0) {
      tx.set(
        groupRef,
        {
          totalLoansOutstanding: FieldValue.increment(-principalPayment),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    tx.set(
      fundRef,
      {
        deployedFund,
        availableFund,
        repaidReturned: FieldValue.increment(principalPayment),
        feeIncomeCollected: FieldValue.increment(feePayment),
        retainedFeeIncome: FieldValue.increment(netFeeIncomeThisPayment),
        groupIncentiveAccrued: FieldValue.increment(incentiveAccruedThisPayment),
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      },
      { merge: true }
    );

    const repayLedgerRef = db.collection("fundLedger").doc();
    tx.set(repayLedgerRef, {
      type: "repayment_return",
      amount,
      beforeBalance: Number(fund.availableFund || 0),
      afterBalance: availableFund,
      notes: `Loan repayment: ${loanId}`,
      actorId: actorUid,
      actorRole: null,
      loanId,
      createdAt: FieldValue.serverTimestamp(),
    });

    if (feePayment > 0) {
      const feeLedgerRef = db.collection("fundLedger").doc();
      tx.set(feeLedgerRef, {
        type: "lending_fee_income",
        amount: feePayment,
        beforeBalance: Number(fund.availableFund || 0) + principalPayment,
        afterBalance: availableFund,
        notes: `Loan fee collected: ${loanId}`,
        actorId: actorUid,
        actorRole: null,
        loanId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    if (incentiveAccruedThisPayment > 0 && loan.groupId) {
      const groupIncentiveLedgerRef = db.collection("groupIncentiveLedger").doc();
      tx.set(groupIncentiveLedgerRef, {
        type: "loan_fee_share_accrual",
        groupId: loan.groupId,
        loanId,
        borrowerId: loan.userId,
        amount: incentiveAccruedThisPayment,
        sourceFeeAmount: feePayment,
        sharePct: groupIncentiveSharePct,
        distributionStatus: "accrued",
        createdAt: FieldValue.serverTimestamp(),
        actorId: actorUid,
      });
      if (groupRef) {
        tx.set(
          groupRef,
          {
            incentivePoolAccrued: FieldValue.increment(incentiveAccruedThisPayment),
            incentivePoolUndistributed: FieldValue.increment(incentiveAccruedThisPayment),
            lastIncentiveAccruedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    const balanceBeforeRepay = Number(wallet.balanceConfirmed || 0);

    tx.set(transactionRef, {
      memberId: loan.userId,
      userId: loan.userId,
      walletId: loan.userId,
      groupId: loan.groupId,
      agentId: channel === "agent" ? actorUid : null,
      type: TRANSACTION_TYPE.LOAN_REPAY,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: actorUid,
      channel,
      batchId: null,
      notes: "Loan repayment recorded",
      receiptNo,
      balanceBefore: balanceBeforeRepay,
      balanceAfter: balanceBeforeRepay,
      ledgerImpact: 0,
      createdAt: FieldValue.serverTimestamp(),
      loanId,
    });

    responsePayload = {
      success: true,
      loanId,
      transactionId: transactionRef.id,
      receiptNo,
      status: fullyRepaid ? LOAN_STATUS.REPAID : LOAN_STATUS.ACTIVE,
      remainingDue: nextRemainingDue,
      paidAmount,
      principalPayment,
      feePayment,
      incentiveAccruedThisPayment,
    };
  });

  return responsePayload;
}

async function executeLoanDefault(loanId, actorUid) {
  const loanRef = db.collection("loans").doc(loanId);
  const fundRef = db.collection("kirimbaFund").doc("current");

  await db.runTransaction(async (tx) => {
    const [loanSnap, fundSnap] = await Promise.all([tx.get(loanRef), tx.get(fundRef)]);
    if (!loanSnap.exists) {
      throw httpsError("not-found", "Loan not found.");
    }

    const loan = loanSnap.data();
    if (loan.status !== LOAN_STATUS.ACTIVE && loan.status !== LOAN_STATUS.PENDING) {
      throw httpsError("failed-precondition", "Only active or pending loans can be defaulted.");
    }

    tx.set(
      loanRef,
      {
        status: LOAN_STATUS.DEFAULTED,
        defaultedAt: FieldValue.serverTimestamp(),
        defaultedBy: actorUid,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (loan.groupId) {
      const principalOutstanding = Math.max(
        0,
        Number(
          loan.principalOutstandingAmount ??
            Math.max(0, Number(loan.amount || 0) - Number(loan.principalRepaidAmount || loan.paidAmount || 0))
        )
      );
      if (principalOutstanding > 0) {
        tx.set(
          db.collection("groups").doc(loan.groupId),
          {
            totalLoansOutstanding: FieldValue.increment(-principalOutstanding),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    // Move defaulted amount from deployedFund → defaultedExposure
    const defaultAmount = Math.max(
      0,
      Number(
        loan.principalOutstandingAmount ??
          Math.max(0, Number(loan.amount || 0) - Number(loan.principalRepaidAmount || loan.paidAmount || 0))
      )
    );
    if (defaultAmount > 0 && fundSnap.exists) {
      const fund = fundSnap.data();
      tx.set(
        fundRef,
        {
          deployedFund: Math.max(0, Number(fund.deployedFund || 0) - defaultAmount),
          defaultedExposure: FieldValue.increment(defaultAmount),
          lastUpdated: FieldValue.serverTimestamp(),
          updatedBy: actorUid,
        },
        { merge: true }
      );

      const defaultLedgerRef = db.collection("fundLedger").doc();
      tx.set(defaultLedgerRef, {
        type: "default_loss",
        amount: defaultAmount,
        beforeBalance: Number(fund.availableFund || 0),
        afterBalance: Number(fund.availableFund || 0),
        notes: `Loan defaulted: ${loanId}`,
        actorId: actorUid,
        actorRole: null,
        loanId,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    const notificationRef = db.collection("notifications").doc();
    tx.set(notificationRef, {
      type: "loan_defaulted",
      loanId,
      userId: loan.userId || null,
      groupId: loan.groupId || null,
      severity: "high",
      status: "unread",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: actorUid,
    });
  });

  return { success: true, loanId, status: LOAN_STATUS.DEFAULTED };
}

exports.requestLoan = functions.https.onCall(async (data, context) => {
  const { uid, user, groupMember, groupId } = await requireActiveMember(context);

  const amount = parseAmount(data?.amount);
  const termDays = requireValidLoanTerm(data?.termDays);
  const purpose = String(data?.purpose || "").trim();

  if (!purpose) {
    throw httpsError("invalid-argument", "purpose is required.");
  }

  const [activeLoanSnap, fundSnap, walletSnap, groupSnap, groupActiveLoansSnap, loanPolicy] = await Promise.all([
    db
      .collection("loans")
      .where("userId", "==", uid)
      .where("status", "in", [LOAN_STATUS.PENDING, LOAN_STATUS.ACTIVE])
      .limit(1)
      .get(),
    db.collection("kirimbaFund").doc("current").get(),
    db.collection("wallets").doc(uid).get(),
    db.collection("groups").doc(groupId).get(),
    db
      .collection("loans")
      .where("groupId", "==", groupId)
      .where("status", "in", [LOAN_STATUS.PENDING, LOAN_STATUS.ACTIVE])
      .get(),
    getLoanPolicyConfig(),
  ]);

  if (!walletSnap.exists) {
    throw httpsError("not-found", "Wallet not found for this member.");
  }

  // ── Admin-set explicit pause ──────────────────────────────────────────────
  // An admin may manually pause borrowing for a group via adminSetGroupBorrowPause.
  // Checked before all other eligibility rules; no loan document is created.
  if (groupSnap.exists && groupSnap.data().borrowingPaused === true) {
    throw httpsError(
      "failed-precondition",
      "Group borrowing is temporarily paused."
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Group Pause rule ──────────────────────────────────────────────────────
  // If any active loan in the group is past due, block all new borrowing.
  // Uses the already-fetched groupActiveLoansSnap (status IN [pending, active])
  // so no additional query or composite index is required.
  const nowMs = Date.now();
  const hasPastDueLoan = groupActiveLoansSnap.docs.some((doc) => {
    const loan = doc.data();
    return (
      loan.status === LOAN_STATUS.ACTIVE &&
      loan.dueDate?.toMillis?.() < nowMs &&
      Number(loan.remainingDue ?? loan.totalDue ?? 1) > 0
    );
  });

  if (hasPastDueLoan) {
    throw httpsError(
      "failed-precondition",
      "Group borrowing paused: overdue loan(s) must be cleared first."
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  const fund = fundSnap.exists ? fundSnap.data() : { availableFund: 0 };
  const availableFund = Number(fund.availableFund || 0);

  // ── System-wide lending pause ─────────────────────────────────────────────
  if (fund.lendingPaused === true) {
    throw httpsError(
      "failed-precondition",
      "Lending is temporarily paused system-wide. Please try again later."
    );
  }
  // ─────────────────────────────────────────────────────────────────────────

  const wallet = walletSnap.data();
  const minLoanAmount = Math.max(0, Number(loanPolicy.minLoanAmount || 0));
  const maxLoanAmount = Math.max(minLoanAmount, Number(loanPolicy.maxLoanAmount || 0));
  if (amount < minLoanAmount) {
    throw httpsError("failed-precondition", `Minimum loan amount is ${minLoanAmount} BIF.`);
  }
  if (maxLoanAmount > 0 && amount > maxLoanAmount) {
    throw httpsError("failed-precondition", `Maximum loan amount is ${maxLoanAmount} BIF.`);
  }

  const group = groupSnap.exists ? groupSnap.data() : {};
  const groupTotalSavings = Number(group.totalSavings || 0);
  const groupLoansOutstanding = Number(group.totalLoansOutstanding || 0);
  if ((groupLoansOutstanding + amount) > (groupTotalSavings * MAX_GROUP_EXPOSURE_RATIO)) {
    throw httpsError(
      "failed-precondition",
      "Group lending limit reached. Loan exceeds group collateral coverage."
    );
  }

  // Borrower concentration check: max 40% of group members may have active/pending loans.
  // Only enforced when the group is large enough that the ratio yields at least 1 allowed borrower
  // (i.e. memberCount >= 3). Below that threshold the rule cannot be meaningfully applied.
  const memberCount = Number(group.memberCount || 0);
  const maxBorrowers = Math.floor(memberCount * MAX_BORROWER_CONCENTRATION_RATIO);
  if (maxBorrowers > 0) {
    const activeBorrowerIds = new Set(groupActiveLoansSnap.docs.map((d) => d.data().userId));
    // Exclude the requesting member (their existing loan is caught below by the active-loan check)
    activeBorrowerIds.delete(uid);
    if (activeBorrowerIds.size >= maxBorrowers) {
      throw httpsError(
        "failed-precondition",
        "Maximum number of active borrowers reached for this group."
      );
    }
  }

  // Credit limit = 1.5 × confirmed savings − locked collateral.
  // This is the member's true borrowing capacity, distinct from liquid available balance.
  const balanceConfirmed = Number(wallet.balanceConfirmed || 0);
  const balanceLocked = Number(wallet.balanceLocked || 0);
  const memberCreditLimit = Math.max(0, balanceConfirmed * Number(loanPolicy.maxLoanMultiplier || 1.5) - balanceLocked);

  let rejectionReason = "";
  if (amount > memberCreditLimit) {
    rejectionReason = `Requested amount exceeds your credit limit of ${memberCreditLimit} BIF (1.5× your confirmed savings of ${balanceConfirmed} BIF minus locked collateral of ${balanceLocked} BIF).`;
  } else if (!activeLoanSnap.empty) {
    rejectionReason = "Member already has an active or pending loan.";
  } else if (availableFund < amount) {
    rejectionReason = "Kirimba fund has insufficient available balance.";
  } else if (user.status !== USER_STATUS.ACTIVE) {
    rejectionReason = "Member account is not active.";
  }

  const termPricing = getTermPricingConfig(loanPolicy, termDays);
  const { contractedFeePct, contractedFeeAmount, totalDue } = calculateContractedLoanPricing(amount, termPricing);
  const dueDate = Timestamp.fromDate(
    new Date(Date.now() + termDays * 24 * 60 * 60 * 1000)
  );

  const loanRef = db.collection("loans").doc();
  if (rejectionReason) {
    await loanRef.set({
      memberId: uid,
      userId: uid,
      groupId,
      amount,
      contractedFeePct,
      contractedFeeAmount,
      interestRate: contractedFeePct,
      interestAmount: contractedFeeAmount,
      totalDue,
      termDays,
      pricingSource: loanPolicy.source,
      pricingModel: "contracted_term_fee",
      rebatePolicyEnabled: loanPolicy.earlySettlementRebateEnabled === true,
      rebateBands: termPricing.rebateBands || [],
      principalOutstandingAmount: amount,
      principalRepaidAmount: 0,
      feeCollectedAmount: 0,
      groupIncentiveSharePct: Number(loanPolicy.groupIncentiveSharePct || GROUP_INCENTIVE_SHARE_PCT),
      groupIncentiveAccruedAmount: 0,
      dueDate,
      status: LOAN_STATUS.REJECTED,
      rejectionReason,
      approvalMode: "auto_policy",
      approvalStatus: "not_required",
      disbursedBy: null,
      disbursedAt: null,
      paidAmount: 0,
      remainingDue: totalDue,
      purpose,
      fundSource: "kirimba_fund",
      fundingSource: "kirimba_capital",
      createdAt: FieldValue.serverTimestamp(),
    });

    return { approved: false, reason: rejectionReason, loanId: loanRef.id };
  }

  await loanRef.set({
    memberId: uid,
    userId: uid,
    groupId,
    amount,
    contractedFeePct,
    contractedFeeAmount,
    interestRate: contractedFeePct,
    interestAmount: contractedFeeAmount,
    totalDue,
    termDays,
    pricingSource: loanPolicy.source,
    pricingModel: "contracted_term_fee",
    rebatePolicyEnabled: loanPolicy.earlySettlementRebateEnabled === true,
    rebateBands: termPricing.rebateBands || [],
    principalOutstandingAmount: amount,
    principalRepaidAmount: 0,
    feeCollectedAmount: 0,
    groupIncentiveSharePct: Number(loanPolicy.groupIncentiveSharePct || GROUP_INCENTIVE_SHARE_PCT),
    groupIncentiveAccruedAmount: 0,
    dueDate,
    status: LOAN_STATUS.PENDING,
    rejectionReason: null,
    approvalMode: "auto_policy",
    approvalStatus: "not_required",
    disbursedBy: null,
    disbursedAt: null,
    paidAmount: 0,
    remainingDue: totalDue,
    purpose,
    fundSource: "kirimba_fund",
    createdAt: FieldValue.serverTimestamp(),
  });

  return {
    approved: true,
    loanId: loanRef.id,
    amount,
    interestAmount: contractedFeeAmount,
    contractedFeeAmount,
    totalDue,
    dueDate,
    termDays,
  };
});

exports.disburseLoan = functions.https.onCall(async (data, context) => {
  const actorRole = await requireRole(context, [ROLES.AGENT]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }
  const result = await executeLoanDisbursement(loanId, context.auth.uid, "agent");
  await writeAuditLog(context.auth.uid, actorRole, "loan_disbursed", "loan", loanId, { amount: result.amount, receiptNo: result.receiptNo });
  return result;
});

exports.recordRepayment = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const loanId = String(data?.loanId || "").trim();
  const amount = parseAmount(data?.amount);
  const channel = String(data?.channel || "").trim();

  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }
  if (channel !== "agent" && channel !== "institution_branch") {
    throw httpsError("invalid-argument", "channel must be 'agent' or 'institution_branch'.");
  }
  return executeLoanRepayment(loanId, amount, context.auth.uid, channel);
});

exports.getLoansDashboard = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loansSnap = await db.collection("loans").orderBy("createdAt", "desc").limit(500).get();
  const nowMs = Date.now();

  const rows = loansSnap.docs.map((doc) => {
    const loan = doc.data() || {};
    const dueMs = loan.dueDate?.toMillis?.() || null;
    const overdue = loan.status === LOAN_STATUS.ACTIVE && dueMs && dueMs < nowMs && Number(loan.remainingDue || 0) > 0;
    return { id: doc.id, ...loan, isOverdue: Boolean(overdue) };
  });

  // Batch-fetch unique users and groups for name resolution
  const uniqueUserIds = [...new Set(rows.map((l) => l.userId).filter(Boolean))];
  const uniqueGroupIds = [...new Set(rows.map((l) => l.groupId).filter(Boolean))];

  const [userDocs, groupDocs] = await Promise.all([
    uniqueUserIds.length > 0
      ? Promise.all(uniqueUserIds.map((uid) => db.collection("users").doc(uid).get()))
      : Promise.resolve([]),
    uniqueGroupIds.length > 0
      ? Promise.all(uniqueGroupIds.map((gid) => db.collection("groups").doc(gid).get()))
      : Promise.resolve([]),
  ]);

  const userNames = Object.fromEntries(
    userDocs.map((snap) => [snap.id, snap.exists ? (snap.data().fullName || snap.data().name || snap.id) : snap.id])
  );
  const groupNames = Object.fromEntries(
    groupDocs.map((snap) => [snap.id, snap.exists ? (snap.data().name || snap.id) : snap.id])
  );

  const enriched = rows.map((l) => ({
    ...l,
    memberName: l.userId ? (userNames[l.userId] || l.userId) : null,
    groupName: l.groupId ? (groupNames[l.groupId] || l.groupId) : null,
  }));

  const pendingLoans = enriched.filter((l) => l.status === LOAN_STATUS.PENDING);
  const activeLoans = enriched.filter((l) => l.status === LOAN_STATUS.ACTIVE);
  const overdueLoans = enriched.filter((l) => l.isOverdue);
  const defaultedLoans = enriched.filter((l) => l.status === LOAN_STATUS.DEFAULTED);

  const sumActive = activeLoans.reduce((s, l) => s + Number(l.remainingDue || 0), 0);

  return {
    success: true,
    summary: {
      pendingCount: pendingLoans.length,
      activeCount: activeLoans.length,
      overdueCount: overdueLoans.length,
      defaultedCount: defaultedLoans.length,
      activeOutstandingBIF: sumActive,
    },
    pendingLoans,
    activeLoans,
    overdueLoans,
    defaultedLoans,
  };
});

exports.getLoanDetails = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  const loanSnap = await db.collection("loans").doc(loanId).get();
  if (!loanSnap.exists) {
    throw httpsError("not-found", "Loan not found.");
  }

  const loan = { id: loanSnap.id, ...(loanSnap.data() || {}) };
  const [userSnap, groupSnap, repaymentsSnap] = await Promise.all([
    loan.userId ? db.collection("users").doc(loan.userId).get() : Promise.resolve(null),
    loan.groupId ? db.collection("groups").doc(loan.groupId).get() : Promise.resolve(null),
    db.collection("transactions").where("loanId", "==", loanId).where("type", "==", TRANSACTION_TYPE.LOAN_REPAY).get(),
  ]);

  const member = userSnap?.exists
    ? { id: userSnap.id, ...(userSnap.data() || {}) }
    : null;
  const group = groupSnap?.exists
    ? { id: groupSnap.id, ...(groupSnap.data() || {}) }
    : null;

  const repaymentHistory = repaymentsSnap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .sort((a, b) => {
      const aMs = a.createdAt?.toMillis?.() || 0;
      const bMs = b.createdAt?.toMillis?.() || 0;
      return aMs - bMs;
    });
  const groupTotalSavings = Number(group?.totalSavings || 0);
  const groupTotalLoansOutstanding = Number(group?.totalLoansOutstanding || 0);
  const exposureRatio = groupTotalSavings > 0 ? groupTotalLoansOutstanding / groupTotalSavings : null;

  return {
    success: true,
    loan,
    member,
    group,
    repaymentHistory,
    collateralExposure: {
      groupTotalSavings,
      groupTotalLoansOutstanding,
      exposureRatio,
      maxExposureRatio: MAX_GROUP_EXPOSURE_RATIO,
    },
  };
});

exports.approveLoan = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);
  throw httpsError("failed-precondition", "Manual loan approval is retired. Eligible loans are created as auto-approved by policy.");
});

exports.adminDisburseLoan = functions.https.onCall(async (data, context) => {
  const actorRole = await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  const result = await executeLoanDisbursement(loanId, context.auth.uid, "admin_console");
  await writeAuditLog(context.auth.uid, actorRole, "loan_disbursed_admin", "loan", loanId, { amount: result.amount, receiptNo: result.receiptNo });
  return result;
});

exports.adminMarkRepayment = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loanId = String(data?.loanId || "").trim();
  const amount = parseAmount(data?.amount);
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  return executeLoanRepayment(loanId, amount, context.auth.uid, "admin_console");
});

exports.adminMarkLoanDefault = functions.https.onCall(async (data, context) => {
  const actorRole = await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  const result = await executeLoanDefault(loanId, context.auth.uid);
  await writeAuditLog(context.auth.uid, actorRole, "loan_defaulted_manual", "loan", loanId, {});
  return result;
});

exports.markLoanDefaulted = functions.pubsub
  .schedule("0 6 * * *")
  .timeZone("Africa/Bujumbura")
  .onRun(async () => {
    const now = admin.firestore.Timestamp.now();
    const activeLoansSnap = await db
      .collection("loans")
      .where("status", "==", LOAN_STATUS.ACTIVE)
      .get();

    const overdue = activeLoansSnap.docs.filter((doc) => {
      const dueDate = doc.data().dueDate;
      return dueDate && dueDate.toMillis() < now.toMillis();
    });

    if (!overdue.length) {
      return null;
    }

    const batch = db.batch();
    const decrementByGroup = new Map();
    overdue.forEach((loanDoc) => {
      const loan = loanDoc.data();
      const groupId = loan.groupId || null;
      const principalOutstanding = Math.max(
        0,
        Number(
          loan.principalOutstandingAmount ??
            Math.max(0, Number(loan.amount || 0) - Number(loan.principalRepaidAmount || loan.paidAmount || 0))
        )
      );

      batch.set(
        loanDoc.ref,
        {
          status: LOAN_STATUS.DEFAULTED,
          defaultedAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      const notificationRef = db.collection("notifications").doc();
      batch.set(notificationRef, {
        type: "loan_defaulted",
        loanId: loanDoc.id,
        userId: loan.userId || null,
        groupId,
        severity: "high",
        status: "unread",
        createdAt: FieldValue.serverTimestamp(),
      });

      if (groupId && principalOutstanding > 0) {
        decrementByGroup.set(groupId, (decrementByGroup.get(groupId) || 0) + principalOutstanding);
      }
    });

    decrementByGroup.forEach((amount, groupId) => {
      batch.set(
        db.collection("groups").doc(groupId),
        {
          totalLoansOutstanding: FieldValue.increment(-amount),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    // Update kirimbaFund: move total defaulted principal from deployedFund → defaultedExposure
    const totalDefaultedAmount = overdue.reduce((sum, doc) => {
      const loan = doc.data() || {};
      const principalOutstanding = Math.max(
        0,
        Number(
          loan.principalOutstandingAmount ??
            Math.max(0, Number(loan.amount || 0) - Number(loan.principalRepaidAmount || loan.paidAmount || 0))
        )
      );
      return sum + principalOutstanding;
    }, 0);
    if (totalDefaultedAmount > 0) {
      batch.set(
        db.collection("kirimbaFund").doc("current"),
        {
          deployedFund: FieldValue.increment(-totalDefaultedAmount),
          defaultedExposure: FieldValue.increment(totalDefaultedAmount),
          lastUpdated: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      const scheduledDefaultLedgerRef = db.collection("fundLedger").doc();
      batch.set(scheduledDefaultLedgerRef, {
        type: "default_loss",
        amount: totalDefaultedAmount,
        beforeBalance: null,
        afterBalance: null,
        notes: `Scheduled daily default run: ${overdue.length} loan(s) defaulted`,
        actorId: "system",
        actorRole: "system",
        loanId: null,
        createdAt: FieldValue.serverTimestamp(),
      });
    }

    await batch.commit();
    return null;
  });

exports.getMemberLoans = functions.https.onCall(async (data, context) => {
  const role = await requireRole(context, [
    ROLES.MEMBER,
    ROLES.LEADER,
    ROLES.AGENT,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.FINANCE,
  ]);

  const inputUserId = String(data?.userId || "").trim();
  const status = String(data?.status || "").trim();
  const targetUserId = inputUserId || context.auth.uid;

  if (!targetUserId) {
    throw httpsError("invalid-argument", "userId is required.");
  }

  if ((role === ROLES.MEMBER || role === ROLES.LEADER) && targetUserId !== context.auth.uid) {
    throw httpsError("permission-denied", "Members can only view their own loans.");
  }

  let query = db.collection("loans").where("userId", "==", targetUserId);
  if (status) {
    query = query.where("status", "==", status);
  }

  const snap = await query.orderBy("createdAt", "desc").get();
  return {
    success: true,
    loans: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});

exports.getLoansByGroup = functions.https.onCall(async (data, context) => {
  const role = await requireRole(context, [
    ROLES.LEADER,
    ROLES.AGENT,
    ROLES.ADMIN,
    ROLES.SUPER_ADMIN,
    ROLES.FINANCE,
  ]);

  const groupId = String(data?.groupId || "").trim();
  const status = String(data?.status || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  if (role === ROLES.LEADER) {
    const groupSnap = await db.collection("groups").doc(groupId).get();
    if (!groupSnap.exists || groupSnap.data().leaderId !== context.auth.uid) {
      throw httpsError("permission-denied", "Leader can only view loans for own group.");
    }
  }

  let query = db.collection("loans").where("groupId", "==", groupId);
  if (status) {
    query = query.where("status", "==", status);
  }

  const snap = await query.orderBy("createdAt", "desc").get();
  return {
    success: true,
    loans: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});
