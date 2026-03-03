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

exports.requestLoan = functions.https.onCall(async (data, context) => {
  const { uid, user, groupMember, groupId } = await requireActiveMember(context);

  const amount = parseAmount(data?.amount);
  const termDays = requireValidLoanTerm(data?.termDays);
  const purpose = String(data?.purpose || "").trim();

  if (!purpose) {
    throw httpsError("invalid-argument", "purpose is required.");
  }

  const [activeLoanSnap, fundSnap] = await Promise.all([
    db
      .collection("loans")
      .where("userId", "==", uid)
      .where("status", "in", [LOAN_STATUS.PENDING, LOAN_STATUS.ACTIVE])
      .limit(1)
      .get(),
    db.collection("kirimbaFund").doc("current").get(),
  ]);

  const fund = fundSnap.exists ? fundSnap.data() : { availableFund: 0 };
  const availableFund = Number(fund.availableFund || 0);
  const availableCredit = Number(groupMember.availableCredit || 0);

  let rejectionReason = "";
  if (amount > availableCredit) {
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

    const gmRef = db.collection("groupMembers").doc(loan.userId);
    const fundRef = db.collection("kirimbaFund").doc("current");
    const [gmSnap, fundSnap] = await Promise.all([tx.get(gmRef), tx.get(fundRef)]);
    if (!gmSnap.exists) {
      throw httpsError("failed-precondition", "Group member record missing.");
    }
    if (!fundSnap.exists) {
      throw httpsError("failed-precondition", "kirimbaFund/current is missing.");
    }

    const amount = Number(loan.amount || 0);
    const gm = gmSnap.data();
    const fund = fundSnap.data();
    const availableFund = Number(fund.availableFund || 0);
    if (availableFund < amount) {
      throw httpsError("failed-precondition", "Insufficient available fund for disbursement.");
    }

    const lockedSavings = Number(gm.lockedSavings || 0) + amount;
    const creditLimit = Number(gm.creditLimit || 0);
    const availableCredit = Math.max(0, creditLimit - lockedSavings);
    const deployedFund = Number(fund.deployedFund || 0) + amount;

    tx.set(
      loanRef,
      {
        status: LOAN_STATUS.ACTIVE,
        disbursedBy: context.auth.uid,
        disbursedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      gmRef,
      {
        lockedSavings,
        availableCredit,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      fundRef,
      {
        deployedFund,
        availableFund: availableFund - amount,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: context.auth.uid,
      },
      { merge: true }
    );

    tx.set(transactionRef, {
      memberId: loan.userId,
      userId: loan.userId,
      groupId: loan.groupId,
      type: TRANSACTION_TYPE.LOAN_DISBURSE,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: context.auth.uid,
      channel: "agent",
      batchId: null,
      notes: "Loan disbursed by agent",
      receiptNo,
      balanceBefore: Number(gm.personalSavings || 0),
      balanceAfter: Number(gm.personalSavings || 0),
      createdAt: FieldValue.serverTimestamp(),
      loanId,
    });

    tx.set(fundMovementRef, {
      type: "loan_out",
      amount,
      description: "Loan disbursement",
      loanId,
      recordedBy: context.auth.uid,
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

    const gmRef = db.collection("groupMembers").doc(loan.userId);
    const fundRef = db.collection("kirimbaFund").doc("current");
    const [gmSnap, fundSnap] = await Promise.all([tx.get(gmRef), tx.get(fundRef)]);
    if (!gmSnap.exists || !fundSnap.exists) {
      throw httpsError("failed-precondition", "Required financial records are missing.");
    }

    const gm = gmSnap.data();
    const fund = fundSnap.data();
    const paidAmount = Number(loan.paidAmount || 0) + amount;
    const nextRemainingDue = Math.max(0, remainingDue - amount);
    const fullyRepaid = nextRemainingDue <= 0;

    const currentLocked = Number(gm.lockedSavings || 0);
    const nextLocked = fullyRepaid
      ? Math.max(0, currentLocked - Number(loan.amount || 0))
      : currentLocked;
    const creditLimit = Number(gm.creditLimit || 0);
    const nextAvailableCredit = Math.max(0, creditLimit - nextLocked);

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

    tx.set(
      gmRef,
      {
        lockedSavings: nextLocked,
        availableCredit: nextAvailableCredit,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      fundRef,
      {
        deployedFund,
        availableFund,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: context.auth.uid,
      },
      { merge: true }
    );

    tx.set(transactionRef, {
      memberId: loan.userId,
      userId: loan.userId,
      groupId: loan.groupId,
      type: TRANSACTION_TYPE.LOAN_REPAY,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: context.auth.uid,
      channel,
      batchId: null,
      notes: "Loan repayment recorded",
      receiptNo,
      balanceBefore: Number(gm.personalSavings || 0),
      balanceAfter: Number(gm.personalSavings || 0),
      createdAt: FieldValue.serverTimestamp(),
      loanId,
    });

    tx.set(fundMovementRef, {
      type: "repayment_in",
      amount,
      description: "Loan repayment",
      loanId,
      recordedBy: context.auth.uid,
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
    overdue.forEach((loanDoc) => {
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
        userId: loanDoc.data().userId || null,
        groupId: loanDoc.data().groupId || null,
        severity: "high",
        status: "unread",
        createdAt: FieldValue.serverTimestamp(),
      });
    });

    await batch.commit();
    return null;
  });

exports.getMemberLoans = functions.https.onCall(async (data, context) => {
  const role = await requireRole(context, [
    ROLES.MEMBER,
    ROLES.LEADER,
    ROLES.AGENT,
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
