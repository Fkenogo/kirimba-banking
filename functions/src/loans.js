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
const { calculateInterest, generateReceiptNo } = require("./utils");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

const MAX_GROUP_EXPOSURE_RATIO = 0.7;
const MAX_BORROWER_CONCENTRATION_RATIO = 0.4;

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
  const valid = [LOAN_TERMS.DAYS_7, LOAN_TERMS.DAYS_14, LOAN_TERMS.DAYS_30];
  if (!valid.includes(term)) {
    throw httpsError("invalid-argument", "termDays must be 7, 14, or 30.");
  }
  return term;
}

async function executeLoanDisbursement(loanId, actorUid) {
  const loanRef = db.collection("loans").doc(loanId);
  const transactionRef = db.collection("transactions").doc();
  const fundMovementRef = db.collection("fundMovements").doc();
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
      type: TRANSACTION_TYPE.LOAN_DISBURSE,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: actorUid,
      channel: "admin_console",
      batchId: null,
      notes: "Loan disbursed via operations console",
      receiptNo,
      balanceBefore: balanceBeforeDisburse,
      balanceAfter: balanceBeforeDisburse,
      ledgerImpact: 0,
      createdAt: FieldValue.serverTimestamp(),
      loanId,
    });

    tx.set(fundMovementRef, {
      type: "loan_out",
      amount,
      description: "Loan disbursement",
      loanId,
      recordedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
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
  const fundMovementRef = db.collection("fundMovements").doc();
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
    const paidAmount = Number(loan.paidAmount || 0) + amount;
    const nextRemainingDue = Math.max(0, remainingDue - amount);
    const fullyRepaid = nextRemainingDue <= 0;

    const deployedFund = Math.max(0, Number(fund.deployedFund || 0) - amount);
    const availableFund = Number(fund.availableFund || 0) + amount;

    tx.set(
      loanRef,
      {
        paidAmount,
        remainingDue: nextRemainingDue,
        status: fullyRepaid ? LOAN_STATUS.REPAID : LOAN_STATUS.ACTIVE,
        repaidAt: fullyRepaid ? FieldValue.serverTimestamp() : null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    if (fullyRepaid) {
      const principalAmount = Number(loan.amount || 0);
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
            totalLoansOutstanding: FieldValue.increment(-principalAmount),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        );
      }
    }

    tx.set(
      fundRef,
      {
        deployedFund,
        availableFund,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: actorUid,
      },
      { merge: true }
    );

    const balanceBeforeRepay = Number(wallet.balanceConfirmed || 0);

    tx.set(transactionRef, {
      memberId: loan.userId,
      userId: loan.userId,
      walletId: loan.userId,
      groupId: loan.groupId,
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

    tx.set(fundMovementRef, {
      type: "repayment_in",
      amount,
      description: "Loan repayment",
      loanId,
      recordedBy: actorUid,
      createdAt: FieldValue.serverTimestamp(),
    });

    responsePayload = {
      success: true,
      loanId,
      transactionId: transactionRef.id,
      receiptNo,
      status: fullyRepaid ? LOAN_STATUS.REPAID : LOAN_STATUS.ACTIVE,
      remainingDue: nextRemainingDue,
      paidAmount,
    };
  });

  return responsePayload;
}

async function executeLoanDefault(loanId, actorUid) {
  const loanRef = db.collection("loans").doc(loanId);

  await db.runTransaction(async (tx) => {
    const loanSnap = await tx.get(loanRef);
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
      const principalOutstanding = Number(loan.amount || loan.remainingDue || 0);
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

  const [activeLoanSnap, fundSnap, walletSnap, groupSnap, groupActiveLoansSnap] = await Promise.all([
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
  const wallet = walletSnap.data();
  const availableBalance = Number(wallet.availableBalance || 0);

  const group = groupSnap.exists ? groupSnap.data() : {};
  const groupTotalSavings = Number(group.totalSavings || 0);
  const groupLoansOutstanding = Number(group.totalLoansOutstanding || 0);
  if ((groupLoansOutstanding + amount) > (groupTotalSavings * MAX_GROUP_EXPOSURE_RATIO)) {
    throw httpsError(
      "failed-precondition",
      "Group lending limit reached. Loan exceeds group collateral coverage."
    );
  }

  // Borrower concentration check: max 40% of group members may have active/pending loans
  const memberCount = Number(group.memberCount || 0);
  const maxBorrowers = Math.floor(memberCount * MAX_BORROWER_CONCENTRATION_RATIO);
  const activeBorrowerIds = new Set(groupActiveLoansSnap.docs.map((d) => d.data().userId));
  // Exclude the requesting member (they may already have a loan counted, which will be caught by soft rejection)
  activeBorrowerIds.delete(uid);
  if (activeBorrowerIds.size >= maxBorrowers) {
    throw httpsError(
      "failed-precondition",
      "Maximum number of active borrowers reached for this group."
    );
  }

  let rejectionReason = "";
  if (amount > availableBalance) {
    rejectionReason = "Requested amount exceeds available credit.";
  } else if (!activeLoanSnap.empty) {
    rejectionReason = "Member already has an active or pending loan.";
  } else if (availableFund < amount) {
    rejectionReason = "Kirimba fund has insufficient available balance.";
  } else if (user.status !== USER_STATUS.ACTIVE) {
    rejectionReason = "Member account is not active.";
  }

  const { rate, interestAmount, totalDue } = calculateInterest(amount, termDays);
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
      interestRate: rate,
      interestAmount,
      totalDue,
      termDays,
      dueDate,
      status: LOAN_STATUS.REJECTED,
      rejectionReason,
      approvalType: "auto",
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
    interestRate: rate,
    interestAmount,
    totalDue,
    termDays,
    dueDate,
    status: LOAN_STATUS.PENDING,
    rejectionReason: null,
    approvalType: "auto",
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
    interestAmount,
    totalDue,
    dueDate,
    termDays,
  };
});

exports.disburseLoan = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }
  return executeLoanDisbursement(loanId, context.auth.uid);
});

exports.recordRepayment = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const loanId = String(data?.loanId || "").trim();
  const amount = parseAmount(data?.amount);
  const channel = String(data?.channel || "").trim();

  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }
  if (channel !== "agent" && channel !== "umuco_branch") {
    throw httpsError("invalid-argument", "channel must be 'agent' or 'umuco_branch'.");
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

  const pendingLoans = rows.filter((l) => l.status === LOAN_STATUS.PENDING);
  const activeLoans = rows.filter((l) => l.status === LOAN_STATUS.ACTIVE);
  const overdueLoans = rows.filter((l) => l.isOverdue);
  const defaultedLoans = rows.filter((l) => l.status === LOAN_STATUS.DEFAULTED);

  return {
    success: true,
    summary: {
      pendingCount: pendingLoans.length,
      activeCount: activeLoans.length,
      overdueCount: overdueLoans.length,
      defaultedCount: defaultedLoans.length,
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

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  const loanRef = db.collection("loans").doc(loanId);
  const loanSnap = await loanRef.get();
  if (!loanSnap.exists) {
    throw httpsError("not-found", "Loan not found.");
  }

  const loan = loanSnap.data() || {};
  if (loan.status !== LOAN_STATUS.PENDING) {
    throw httpsError("failed-precondition", "Only pending loans can be approved.");
  }

  await loanRef.set(
    {
      approvedAt: FieldValue.serverTimestamp(),
      approvedBy: context.auth.uid,
      approvalStatus: "approved",
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, loanId, status: LOAN_STATUS.PENDING, approvalStatus: "approved" };
});

exports.adminDisburseLoan = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  return executeLoanDisbursement(loanId, context.auth.uid);
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
  await requireRole(context, [ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.FINANCE]);

  const loanId = String(data?.loanId || "").trim();
  if (!loanId) {
    throw httpsError("invalid-argument", "loanId is required.");
  }

  return executeLoanDefault(loanId, context.auth.uid);
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
      // Exposure accounting uses principal-based logic (same as disburse + full-repay flow).
      const principalOutstanding = Number(loan.amount || loan.remainingDue || 0);

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
