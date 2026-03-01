"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const {
  ROLES,
  USER_STATUS,
  GROUP_STATUS,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
  DEPOSIT_BATCH_STATUS,
} = require("./constants");
const { calculateCreditLimit, generateReceiptNo } = require("./utils");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MIN_WITHDRAWAL_REMAINING_BALANCE = 5000;
const WITHDRAWAL_APPROVAL_THRESHOLD = 50000;

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

async function getUserRole(uid, token) {
  if (token && token.role) {
    return token.role;
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }

  return userSnap.data().role || null;
}

async function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = await getUserRole(context.auth.uid, context.auth.token);
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
}

function parseAmount(rawAmount) {
  const amount = Number(rawAmount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpsError("invalid-argument", "amount must be a positive number.");
  }

  return Math.round(amount);
}

async function getActiveMemberAndGroup(userId) {
  const [userSnap, memberSnap] = await Promise.all([
    db.collection("users").doc(userId).get(),
    db.collection("groupMembers").doc(userId).get(),
  ]);

  if (!userSnap.exists) {
    throw httpsError("not-found", "Member user profile was not found.");
  }

  if (!memberSnap.exists) {
    throw httpsError("failed-precondition", "User is not linked to a group.");
  }

  const userData = userSnap.data();
  const memberData = memberSnap.data();

  if (userData.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  const groupId = memberData.groupId || userData.groupId;
  if (!groupId) {
    throw httpsError("failed-precondition", "Member has no group.");
  }

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Member group was not found.");
  }

  if (groupSnap.data().status !== GROUP_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Group must be active.");
  }

  return {
    userData,
    memberData,
    groupData: groupSnap.data(),
    groupId,
  };
}

exports.recordDeposit = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const userId = String(data?.userId || "").trim();
  const notes = String(data?.notes || "").trim();
  const channel = String(data?.channel || "").trim();
  const amount = parseAmount(data?.amount);

  if (!userId) {
    throw httpsError("invalid-argument", "userId is required.");
  }

  if (channel !== "agent" && channel !== "umuco_branch") {
    throw httpsError("invalid-argument", "channel must be 'agent' or 'umuco_branch'.");
  }

  const memberState = await getActiveMemberAndGroup(userId);
  const transactionRef = db.collection("transactions").doc();
  const receiptNo = await generateReceiptNo(db, "TXN");
  const balanceBefore = Number(memberState.memberData.personalSavings || 0);

  await db.runTransaction(async (tx) => {
    tx.set(transactionRef, {
      memberId: userId,
      userId,
      groupId: memberState.groupId,
      type: TRANSACTION_TYPE.DEPOSIT,
      amount,
      status: TRANSACTION_STATUS.PENDING_UMUCO,
      recordedBy: context.auth.uid,
      channel,
      batchId: null,
      notes,
      receiptNo,
      balanceBefore,
      balanceAfter: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      db.collection("groupMembers").doc(userId),
      {
        pendingSavings: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      db.collection("groups").doc(memberState.groupId),
      {
        pendingSavings: FieldValue.increment(amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  return {
    success: true,
    transactionId: transactionRef.id,
    receiptNo,
    groupId: memberState.groupId,
    amount,
    status: TRANSACTION_STATUS.PENDING_UMUCO,
  };
});

exports.submitBatch = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const groupId = String(data?.groupId || "").trim();
  const incomingIds = Array.isArray(data?.transactionIds) ? data.transactionIds : [];
  const transactionIds = [...new Set(incomingIds.map((value) => String(value || "").trim()).filter(Boolean))];

  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  if (!transactionIds.length) {
    throw httpsError("invalid-argument", "transactionIds must contain at least one id.");
  }

  const batchRef = db.collection("depositBatches").doc();
  let totalAmount = 0;
  const memberIds = new Set();

  await db.runTransaction(async (tx) => {
    const txRefs = transactionIds.map((id) => db.collection("transactions").doc(id));
    const txSnaps = await Promise.all(txRefs.map((ref) => tx.get(ref)));

    txSnaps.forEach((snap, index) => {
      if (!snap.exists) {
        throw httpsError("not-found", `Transaction ${transactionIds[index]} was not found.`);
      }

      const item = snap.data();
      if (item.type !== TRANSACTION_TYPE.DEPOSIT) {
        throw httpsError("failed-precondition", `Transaction ${snap.id} is not a deposit.`);
      }

      if (item.status !== TRANSACTION_STATUS.PENDING_UMUCO) {
        throw httpsError("failed-precondition", `Transaction ${snap.id} is not pending Umuco.`);
      }

      if (item.groupId !== groupId) {
        throw httpsError("failed-precondition", `Transaction ${snap.id} does not belong to group ${groupId}.`);
      }

      if (item.batchId) {
        throw httpsError("failed-precondition", `Transaction ${snap.id} is already in a batch.`);
      }

      if (item.recordedBy !== context.auth.uid) {
        throw httpsError("permission-denied", `Transaction ${snap.id} belongs to a different agent.`);
      }

      totalAmount += Number(item.amount || 0);
      memberIds.add(item.userId);
    });

    tx.set(batchRef, {
      groupId,
      agentId: context.auth.uid,
      transactionIds,
      totalAmount,
      memberCount: memberIds.size,
      status: DEPOSIT_BATCH_STATUS.SUBMITTED,
      submittedAt: FieldValue.serverTimestamp(),
      confirmedBy: null,
      confirmedAt: null,
      umucoNotes: null,
      umucoAccountRef: null,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    txRefs.forEach((ref) => {
      tx.set(
        ref,
        {
          batchId: batchRef.id,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
  });

  return {
    success: true,
    batchId: batchRef.id,
    totalAmount,
    memberCount: memberIds.size,
  };
});

exports.recordWithdrawal = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const userId = String(data?.userId || "").trim();
  const notes = String(data?.notes || "").trim();
  const amount = parseAmount(data?.amount);

  if (!userId) {
    throw httpsError("invalid-argument", "userId is required.");
  }

  const memberState = await getActiveMemberAndGroup(userId);
  const availableToWithdraw = Number(memberState.memberData.personalSavings || 0) -
    Number(memberState.memberData.lockedSavings || 0);

  if ((availableToWithdraw - amount) < MIN_WITHDRAWAL_REMAINING_BALANCE) {
    throw httpsError(
      "failed-precondition",
      `Withdrawal would violate minimum balance of ${MIN_WITHDRAWAL_REMAINING_BALANCE} BIF.`
    );
  }

  if (amount > WITHDRAWAL_APPROVAL_THRESHOLD) {
    const requestRef = db.collection("withdrawalRequests").doc();
    await requestRef.set({
      userId,
      groupId: memberState.groupId,
      amount,
      notes,
      status: "pending_approval",
      requestedBy: context.auth.uid,
      createdAt: FieldValue.serverTimestamp(),
      minRequiredBalance: MIN_WITHDRAWAL_REMAINING_BALANCE,
    });

    return {
      success: true,
      status: "pending_approval",
      requestId: requestRef.id,
      amount,
    };
  }

  const receiptNo = await generateReceiptNo(db, "TXN");
  const transactionRef = db.collection("transactions").doc();

  await db.runTransaction(async (tx) => {
    const [gmSnap, groupSnap] = await Promise.all([
      tx.get(db.collection("groupMembers").doc(userId)),
      tx.get(db.collection("groups").doc(memberState.groupId)),
    ]);

    if (!gmSnap.exists || !groupSnap.exists) {
      throw httpsError("failed-precondition", "Group member or group missing.");
    }

    const gmData = gmSnap.data();
    const groupData = groupSnap.data();
    const personalSavings = Number(gmData.personalSavings || 0);
    const lockedSavings = Number(gmData.lockedSavings || 0);
    const newPersonalSavings = personalSavings - amount;

    if ((newPersonalSavings - lockedSavings) < MIN_WITHDRAWAL_REMAINING_BALANCE) {
      throw httpsError(
        "failed-precondition",
        `Withdrawal would violate minimum balance of ${MIN_WITHDRAWAL_REMAINING_BALANCE} BIF.`
      );
    }

    const creditLimit = calculateCreditLimit(newPersonalSavings);
    const availableCredit = Math.max(0, creditLimit - lockedSavings);
    const groupTotalSavings = Number(groupData.totalSavings || 0);

    tx.set(
      db.collection("groupMembers").doc(userId),
      {
        personalSavings: newPersonalSavings,
        creditLimit,
        availableCredit,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      db.collection("groups").doc(memberState.groupId),
      {
        totalSavings: Math.max(0, groupTotalSavings - amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(transactionRef, {
      memberId: userId,
      userId,
      groupId: memberState.groupId,
      type: TRANSACTION_TYPE.WITHDRAWAL,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: context.auth.uid,
      channel: "agent",
      batchId: null,
      notes,
      receiptNo,
      balanceBefore: personalSavings,
      balanceAfter: newPersonalSavings,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return {
    success: true,
    status: TRANSACTION_STATUS.CONFIRMED,
    transactionId: transactionRef.id,
    receiptNo,
    amount,
  };
});

exports.confirmBatch = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.UMUCO]);

  const batchId = String(data?.batchId || "").trim();
  const umucoAccountRef = String(data?.umucoAccountRef || "").trim();
  const notes = String(data?.notes || "").trim();

  if (!batchId || !umucoAccountRef) {
    throw httpsError("invalid-argument", "batchId and umucoAccountRef are required.");
  }

  const batchRef = db.collection("depositBatches").doc(batchId);
  let totalConfirmed = 0;

  await db.runTransaction(async (tx) => {
    let localTotalConfirmed = 0;

    const batchSnap = await tx.get(batchRef);
    if (!batchSnap.exists) {
      throw httpsError("not-found", "Batch not found.");
    }

    const batch = batchSnap.data();
    if (batch.status !== DEPOSIT_BATCH_STATUS.SUBMITTED) {
      throw httpsError("failed-precondition", "Batch is not in submitted status.");
    }

    const txIds = Array.isArray(batch.transactionIds) ? batch.transactionIds : [];
    if (!txIds.length) {
      throw httpsError("failed-precondition", "Batch has no transactions.");
    }

    const txRefs = txIds.map((id) => db.collection("transactions").doc(id));
    const txSnaps = await Promise.all(txRefs.map((ref) => tx.get(ref)));
    const groupMemberCache = new Map();
    const groupMemberNext = new Map();

    for (const txnSnap of txSnaps) {
      if (!txnSnap.exists) {
        throw httpsError("not-found", "A batch transaction is missing.");
      }
      const txn = txnSnap.data();
      const gmId = txn.userId;
      if (!groupMemberCache.has(gmId)) {
        const gmRef = db.collection("groupMembers").doc(gmId);
        const gmSnap = await tx.get(gmRef);
        if (!gmSnap.exists) {
          throw httpsError("failed-precondition", `Group member ${gmId} missing.`);
        }
        groupMemberCache.set(gmId, gmSnap);
      }
    }

    const groupsQuerySnap = await tx.get(db.collection("groups"));
    let totalCollateral = 0;
    groupsQuerySnap.forEach((groupDoc) => {
      totalCollateral += Number(groupDoc.data().totalSavings || 0);
    });

    for (const txnSnap of txSnaps) {
      const txn = txnSnap.data();
      if (txn.type !== TRANSACTION_TYPE.DEPOSIT || txn.status !== TRANSACTION_STATUS.PENDING_UMUCO) {
        throw httpsError("failed-precondition", `Transaction ${txnSnap.id} is not confirmable.`);
      }

      if (txn.groupId !== batch.groupId) {
        throw httpsError("failed-precondition", `Transaction ${txnSnap.id} group mismatch.`);
      }

      const amount = Number(txn.amount || 0);
      localTotalConfirmed += amount;

      const gmId = txn.userId;
      const groupMemberRef = db.collection("groupMembers").doc(gmId);
      const current = groupMemberNext.get(gmId) || groupMemberCache.get(gmId).data();

      const personalSavings = Number(current.personalSavings || 0) + amount;
      const pendingSavings = Math.max(0, Number(current.pendingSavings || 0) - amount);
      const lockedSavings = Number(current.lockedSavings || 0);
      const creditLimit = calculateCreditLimit(personalSavings);
      const availableCredit = Math.max(0, creditLimit - lockedSavings);

      groupMemberNext.set(gmId, {
        personalSavings,
        pendingSavings,
        lockedSavings,
      });

      tx.set(
        groupMemberRef,
        {
          personalSavings,
          pendingSavings,
          creditLimit,
          availableCredit,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      tx.set(
        txnSnap.ref,
        {
          status: TRANSACTION_STATUS.CONFIRMED,
          balanceAfter: personalSavings,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    totalCollateral += localTotalConfirmed;

    tx.set(
      db.collection("groups").doc(batch.groupId),
      {
        totalSavings: FieldValue.increment(localTotalConfirmed),
        pendingSavings: FieldValue.increment(-localTotalConfirmed),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      db.collection("kirimbaFund").doc("current"),
      {
        totalCollateral,
        lastUpdated: FieldValue.serverTimestamp(),
        updatedBy: context.auth.uid,
      },
      { merge: true }
    );

    tx.set(
      batchRef,
      {
        status: DEPOSIT_BATCH_STATUS.CONFIRMED,
        confirmedBy: context.auth.uid,
        confirmedAt: FieldValue.serverTimestamp(),
        umucoNotes: notes || null,
        umucoAccountRef,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    totalConfirmed = localTotalConfirmed;
  });

  return {
    success: true,
    totalConfirmed,
  };
});

exports.flagBatch = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.UMUCO]);

  const batchId = String(data?.batchId || "").trim();
  const notes = String(data?.notes || "").trim();
  if (!batchId || !notes) {
    throw httpsError("invalid-argument", "batchId and notes are required.");
  }

  const batchRef = db.collection("depositBatches").doc(batchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) {
    throw httpsError("not-found", "Batch not found.");
  }

  await batchRef.set(
    {
      status: DEPOSIT_BATCH_STATUS.FLAGGED,
      umucoNotes: notes,
      flaggedBy: context.auth.uid,
      flaggedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await db.collection("notifications").add({
    type: "batch_flagged",
    batchId,
    groupId: batchSnap.data().groupId || null,
    status: "unread",
    severity: "high",
    message: notes,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: context.auth.uid,
  });

  return { success: true };
});

exports.getBatchesForGroup = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT, ROLES.SUPER_ADMIN, ROLES.FINANCE, ROLES.UMUCO]);

  const groupId = String(data?.groupId || "").trim();
  const status = String(data?.status || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  let query = db.collection("depositBatches").where("groupId", "==", groupId);
  if (status) {
    query = query.where("status", "==", status);
  }

  const snap = await query.orderBy("submittedAt", "desc").get();
  return {
    success: true,
    batches: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});
