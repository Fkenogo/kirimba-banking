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

  const agentId = context.auth.uid;
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
    // CRITICAL: Verify agent has access to member's group
    const agentDoc = await tx.get(db.collection('agents').doc(agentId));
    if (!agentDoc.exists) {
      throw httpsError('not-found', 'Agent profile not found');
    }

    const agentData = agentDoc.data();
    const allowedGroups = agentData.assignedGroups || [];

    if (allowedGroups.length === 0) {
      throw httpsError('permission-denied', 'Agent not assigned to any groups');
    }

    const memberGroupId = memberState.groupId;

    // Verify agent has access to this member's group
    if (!allowedGroups.includes(memberGroupId)) {
      functions.logger.error('Cross-group deposit attempt blocked', {
        agentId: '[REDACTED]',
        userId: '[REDACTED]',
        memberGroupId,
        allowedGroups,
      });

      throw httpsError('permission-denied', 'Agent cannot record deposits for this member');
    }
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

  const agentId = context.auth.uid;
  const groupId = String(data?.groupId || "").trim();
  const incomingIds = Array.isArray(data?.transactionIds) ? data.transactionIds : [];
  const transactionIds = [...new Set(incomingIds.map((value) => String(value || "").trim()).filter(Boolean))];

  const { idempotencyToken } = data;
  if (!idempotencyToken) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'idempotencyToken is required'
    );
  }

  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  if (!transactionIds.length) {
    throw httpsError("invalid-argument", "transactionIds must contain at least one id.");
  }

  // Check if batch already exists with this idempotency token
  const existingBatchSnap = await db.collection('depositBatches')
    .where('idempotencyToken', '==', idempotencyToken)
    .limit(1)
    .get();

  if (!existingBatchSnap.empty) {
    const existingBatch = existingBatchSnap.docs[0];
    const batchData = existingBatch.data();
    return {
      success: true,
      batchId: existingBatch.id,
      totalAmount: batchData.totalAmount,
      transactionCount: batchData.transactionIds?.length || 0,
      alreadyExists: true,
    };
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
      idempotencyToken, // Store for idempotency
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

  // Read batch OUTSIDE transaction (Batch API doesn't need transaction for reads)
  const batchDoc = await batchRef.get();
  if (!batchDoc.exists) {
    throw httpsError("not-found", "Batch not found.");
  }

  const batchData = batchDoc.data();
  if (batchData.status !== DEPOSIT_BATCH_STATUS.SUBMITTED) {
    throw httpsError("failed-precondition", `Batch already ${batchData.status}.`);
  }

  const txIds = Array.isArray(batchData.transactionIds) ? batchData.transactionIds : [];
  if (!txIds.length) {
    throw httpsError("failed-precondition", "Batch has no transactions.");
  }

  // Read all transactions OUTSIDE transaction
  const txRefs = txIds.map((id) => db.collection("transactions").doc(id));
  const txSnaps = await Promise.all(txRefs.map((ref) => ref.get()));

  // Validate all transactions and calculate totals IN-MEMORY
  let totalConfirmed = 0;
  const memberUpdates = new Map(); // userId -> { amount, newSavings, newPending }

  for (const txnSnap of txSnaps) {
    if (!txnSnap.exists) {
      throw httpsError("not-found", "A batch transaction is missing.");
    }

    const txn = txnSnap.data();

    if (txn.type !== TRANSACTION_TYPE.DEPOSIT || txn.status !== TRANSACTION_STATUS.PENDING_UMUCO) {
      throw httpsError("failed-precondition", `Transaction ${txnSnap.id} is not confirmable.`);
    }

    if (txn.groupId !== batchData.groupId) {
      throw httpsError("failed-precondition", `Transaction ${txnSnap.id} group mismatch.`);
    }

    const amount = Number(txn.amount || 0);
    totalConfirmed += amount;

    // Aggregate per member (handle multiple deposits for same member)
    const userId = txn.userId;
    if (!memberUpdates.has(userId)) {
      memberUpdates.set(userId, { amount: 0, txnIds: [] });
    }
    const memberUpdate = memberUpdates.get(userId);
    memberUpdate.amount += amount;
    memberUpdate.txnIds.push(txnSnap.id);
  }

  // Use Batch API (500-op limit instead of 25)
  const batch = db.batch();

  // Update batch status
  batch.update(batchRef, {
    status: DEPOSIT_BATCH_STATUS.CONFIRMED,
    confirmedBy: context.auth.uid,
    confirmedAt: FieldValue.serverTimestamp(),
    umucoNotes: notes || null,
    umucoAccountRef,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update transactions
  txSnaps.forEach((txnSnap) => {
    batch.update(txnSnap.ref, {
      status: TRANSACTION_STATUS.CONFIRMED,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // Update members using increments (no need to read first)
  memberUpdates.forEach((update, userId) => {
    const memberRef = db.collection("groupMembers").doc(userId);

    batch.update(memberRef, {
      personalSavings: FieldValue.increment(update.amount),
      pendingSavings: FieldValue.increment(-update.amount),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // Note: creditLimit and availableCredit will be recalculated on next read
    // This is acceptable trade-off to avoid reading members in transaction
  });

  // Update group totals using increments
  batch.update(db.collection("groups").doc(batchData.groupId), {
    totalSavings: FieldValue.increment(totalConfirmed),
    pendingSavings: FieldValue.increment(-totalConfirmed),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update fund using increment (NO need to read all groups!)
  batch.set(
    db.collection("kirimbaFund").doc("current"),
    {
      totalCollateral: FieldValue.increment(totalConfirmed),
      lastUpdated: FieldValue.serverTimestamp(),
      updatedBy: context.auth.uid,
    },
    { merge: true }
  );

  // Commit batch (atomic, up to 500 operations)
  await batch.commit();

  return {
    success: true,
    totalConfirmed,
    transactionCount: txSnaps.length,
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
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
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
