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
  LEDGER_TYPE,
  LEDGER_STATUS,
} = require("./constants");
const { generateReceiptNo } = require("./utils");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const MIN_WITHDRAWAL_REMAINING_BALANCE = 5000;
const WITHDRAWAL_APPROVAL_THRESHOLD = 50000;

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
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

  const userData = userSnap.data();
  const memberData = memberSnap.exists ? memberSnap.data() : null;

  if (userData.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  const groupId = memberData?.groupId || userData.groupId || userData.ledGroupId;
  if (!groupId) {
    throw httpsError("failed-precondition", "User is not linked to a group.");
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

/**
 * Reads fee/commission config from systemConfig/fees (canonical source).
 * Falls back to zero values if the document has not been seeded yet.
 */
async function getFeesConfig(tx) {
  const snap = await tx.get(db.collection("systemConfig").doc("fees"));
  if (!snap.exists) {
    return {
      depositFeeFlat: 0,
      withdrawFeeFlat: 0,
      agentCommissionDepositFlat: 0,
      agentCommissionWithdrawFlat: 0,
    };
  }
  const d = snap.data();
  return {
    depositFeeFlat: Math.round(Number(d.depositFeeFlat || 0)),
    withdrawFeeFlat: Math.round(Number(d.withdrawFeeFlat || 0)),
    agentCommissionDepositFlat: Math.round(Number(d.agentCommissionDepositFlat || d.agentCommissionRate || 0)),
    agentCommissionWithdrawFlat: Math.round(Number(d.agentCommissionWithdrawFlat || 0)),
  };
}

/**
 * Idempotently writes fee and commission ledger entries inside an existing Firestore
 * transaction. Uses deterministic doc IDs (transactionId_fee / transactionId_commission)
 * so retries do not create duplicate entries.
 *
 * Must be called AFTER all transaction reads are done (Firestore read-before-write rule).
 */
async function readLedgerRefs(tx, transactionId) {
  const feeRef = db.collection("agentLedgers").doc(`${transactionId}_fee`);
  const commissionRef = db.collection("agentLedgers").doc(`${transactionId}_commission`);
  const [feeSnap, commissionSnap] = await Promise.all([
    tx.get(feeRef),
    tx.get(commissionRef),
  ]);
  return { feeRef, feeSnap, commissionRef, commissionSnap };
}

function writeLedgerEntries(tx, { feeRef, feeSnap, commissionRef, commissionSnap, agentId, transactionId, memberId, groupId, source, txType, feesConfig }) {
  const feeAmount = txType === TRANSACTION_TYPE.DEPOSIT
    ? feesConfig.depositFeeFlat
    : feesConfig.withdrawFeeFlat;
  const commissionAmount = txType === TRANSACTION_TYPE.DEPOSIT
    ? feesConfig.agentCommissionDepositFlat
    : feesConfig.agentCommissionWithdrawFlat;

  if (feeAmount > 0 && !feeSnap.exists) {
    tx.set(feeRef, {
      type: LEDGER_TYPE.FEE,
      agentId,
      transactionId,
      memberId,
      groupId,
      amount: feeAmount,
      currency: "BIF",
      status: LEDGER_STATUS.ACCRUED,
      source,
      createdAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });
  }

  if (commissionAmount > 0 && !commissionSnap.exists) {
    tx.set(commissionRef, {
      type: LEDGER_TYPE.COMMISSION,
      agentId,
      transactionId,
      memberId,
      groupId,
      amount: commissionAmount,
      currency: "BIF",
      status: LEDGER_STATUS.ACCRUED,
      source,
      createdAt: FieldValue.serverTimestamp(),
      settledAt: null,
    });
  }
}

exports.recordDeposit = functions.https.onCall(async (data, context) => {
  console.log("RECORD_DEPOSIT_VERSION=flex-agent-v2");
  await requireRole(context, [ROLES.AGENT]);

  const agentId = context.auth.uid;
  const userId = String(data?.userId || "").trim();
  const memberId = String(data?.memberId || "").trim();
  const clientGroupId = String(data?.groupId || "").trim();
  const notes = String(data?.notes || "").trim();
  const channel = String(data?.channel || "").trim();
  const source = String(data?.source || "online").trim();
  const amount = parseAmount(data?.amount);

  if (!userId) {
    throw httpsError("invalid-argument", "userId is required.");
  }

  const allowedChannels = ["agent", "institution_branch", "agent_qr"];
  if (!allowedChannels.includes(channel)) {
    throw httpsError("invalid-argument", "channel must be 'agent', 'institution_branch', or 'agent_qr'.");
  }

  const allowedSources = ["online", "offline"];
  if (!allowedSources.includes(source)) {
    throw httpsError("invalid-argument", "source must be 'online' or 'offline'.");
  }

  const memberState = await getActiveMemberAndGroup(userId);

  // Derive institutionId from the member's group (canonical FK source)
  let groupInstitutionId = null;
  if (memberState.groupId) {
    const groupSnap = await db.collection("groups").doc(memberState.groupId).get();
    if (groupSnap.exists) {
      groupInstitutionId = groupSnap.data().institutionId || null;
    }
  }

  const pendingDepositSnap = await db.collection("transactions")
    .where("userId", "==", userId)
    .where("type", "==", TRANSACTION_TYPE.DEPOSIT)
    .where("status", "==", TRANSACTION_STATUS.PENDING_CONFIRMATION)
    .limit(1)
    .get();

  if (!pendingDepositSnap.empty) {
    throw httpsError(
      "failed-precondition",
      "You already have a pending deposit awaiting confirmation."
    );
  }

  const transactionRef = db.collection("transactions").doc();
  const receiptNo = await generateReceiptNo(db, "TXN");
  const walletRef = db.collection("wallets").doc(userId);

  await db.runTransaction(async (tx) => {
    const agentDoc = await tx.get(db.collection("agents").doc(agentId));
    if (!agentDoc.exists) {
      throw httpsError("not-found", "Agent profile not found.");
    }

    const agentData = agentDoc.data();
    if (agentData.role !== ROLES.AGENT) {
      throw httpsError("failed-precondition", "User is not an agent.");
    }
    if (agentData.status !== USER_STATUS.ACTIVE) {
      throw httpsError("failed-precondition", "Agent account must be active.");
    }

    // Read phase: wallet, fee config, and ledger idempotency docs
    const [walletSnap, feesConfig, ledgerRefs] = await Promise.all([
      tx.get(walletRef),
      getFeesConfig(tx),
      readLedgerRefs(tx, transactionRef.id),
    ]);

    if (!walletSnap.exists) {
      throw httpsError("not-found", "Wallet not found for this member.");
    }

    if (clientGroupId && clientGroupId !== memberState.groupId) {
      throw httpsError("failed-precondition", "Provided groupId does not match the member's group.");
    }

    const balanceBeforeDeposit = Number(walletSnap.data().balanceConfirmed || 0);

    // Write phase
    tx.set(transactionRef, {
      type: TRANSACTION_TYPE.DEPOSIT,
      status: TRANSACTION_STATUS.PENDING_CONFIRMATION,
      memberId: memberId || userId,
      userId,
      walletId: userId,
      groupId: memberState.groupId,
      institutionId: groupInstitutionId,
      agentId,
      amount,
      source,
      batchId: null,
      recordedBy: agentId,
      channel,
      notes,
      receiptNo,
      balanceBefore: balanceBeforeDeposit,
      balanceAfter: balanceBeforeDeposit,
      ledgerImpact: amount,
      createdAt: FieldValue.serverTimestamp(),
    });

    tx.update(walletRef, {
      balancePending: FieldValue.increment(amount),
      updatedAt: FieldValue.serverTimestamp(),
    });

    writeLedgerEntries(tx, {
      ...ledgerRefs,
      agentId,
      transactionId: transactionRef.id,
      memberId: memberId || userId,
      groupId: memberState.groupId,
      source,
      txType: TRANSACTION_TYPE.DEPOSIT,
      feesConfig,
    });
  });

  return {
    success: true,
    transactionId: transactionRef.id,
    receiptNo,
    groupId: memberState.groupId,
    amount,
    status: TRANSACTION_STATUS.PENDING_CONFIRMATION,
  };
});

exports.adminApproveDeposits = functions.https.onCall(async (data, context) => {
  // Deposit confirmation is exclusively handled by institution (Umuco) staff via confirmBatch.
  // Admin approval of deposits is not permitted.
  throw httpsError(
    "permission-denied",
    "Deposit confirmation is not permitted for admin. Only institution staff can confirm deposits via batch confirmation."
  );

  const adminId = context.auth.uid;
  const incomingIds = Array.isArray(data?.transactionIds) ? data.transactionIds : [];
  const transactionIds = [...new Set(incomingIds.map((id) => String(id || "").trim()).filter(Boolean))];

  if (!transactionIds.length) {
    throw httpsError("invalid-argument", "transactionIds must contain at least one id.");
  }

  // Read all transactions outside the batch
  const txRefs = transactionIds.map((id) => db.collection("transactions").doc(id));
  const txSnaps = await Promise.all(txRefs.map((ref) => ref.get()));

  // Validate + aggregate per member
  const memberUpdates = new Map(); // userId → { amount, groupId }

  for (const snap of txSnaps) {
    if (!snap.exists) {
      throw httpsError("not-found", `Transaction ${snap.id} not found.`);
    }
    const d = snap.data();
    if (d.type !== TRANSACTION_TYPE.DEPOSIT) {
      throw httpsError("failed-precondition", `Transaction ${snap.id} is not a deposit.`);
    }
    if (d.status !== TRANSACTION_STATUS.PENDING_CONFIRMATION) {
      throw httpsError("failed-precondition", `Transaction ${snap.id} is not pending confirmation.`);
    }

    const uid = d.userId;
    const gid = d.groupId;
    const amt = Number(d.amount || 0);

    if (!memberUpdates.has(uid)) {
      memberUpdates.set(uid, { amount: 0, groupId: gid });
    }
    memberUpdates.get(uid).amount += amt;
  }

  // Read wallets for all affected members
  const memberUserIds = [...memberUpdates.keys()];
  const walletSnaps = await Promise.all(
    memberUserIds.map((uid) => db.collection("wallets").doc(uid).get())
  );
  const walletsByUser = new Map();
  walletSnaps.forEach((snap, i) => {
    if (!snap.exists) {
      throw httpsError("not-found", `Wallet not found for member ${memberUserIds[i]}.`);
    }
    walletsByUser.set(memberUserIds[i], snap.data());
  });

  // Aggregate group totals
  const groupTotals = new Map(); // groupId → amount
  for (const [, update] of memberUpdates) {
    const { groupId, amount } = update;
    groupTotals.set(groupId, (groupTotals.get(groupId) || 0) + amount);
  }
  const totalApproved = [...memberUpdates.values()].reduce((s, u) => s + u.amount, 0);

  // Atomic batch write
  const batch = db.batch();

  // 1. Approve each transaction
  for (const snap of txSnaps) {
    batch.update(snap.ref, {
      status: TRANSACTION_STATUS.CONFIRMED,
      approvedBy: adminId,
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // 2. Update wallets (balanceConfirmed, balancePending, availableBalance)
  for (const [uid, update] of memberUpdates) {
    const wallet = walletsByUser.get(uid);
    const newConfirmed = Number(wallet.balanceConfirmed || 0) + update.amount;
    const newPending = Math.max(0, Number(wallet.balancePending || 0) - update.amount);
    const locked = Number(wallet.balanceLocked || 0);
    batch.update(db.collection("wallets").doc(uid), {
      balanceConfirmed: newConfirmed,
      balancePending: newPending,
      availableBalance: newConfirmed - locked,
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  // 3. Update group savings totals
  for (const [groupId, amount] of groupTotals) {
    batch.set(
      db.collection("groups").doc(groupId),
      {
        totalSavings: FieldValue.increment(amount),
        pendingSavings: FieldValue.increment(-amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  }

  // 4. Update kirimbaFund collateral
  batch.set(
    db.collection("kirimbaFund").doc("current"),
    {
      totalCollateral: FieldValue.increment(totalApproved),
      lastUpdated: FieldValue.serverTimestamp(),
      updatedBy: adminId,
    },
    { merge: true }
  );

  await batch.commit();

  return {
    success: true,
    approvedCount: txSnaps.length,
    totalApproved,
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
    const groupRef = db.collection("groups").doc(groupId);
    const [txSnaps, groupSnap] = await Promise.all([
      Promise.all(txRefs.map((ref) => tx.get(ref))),
      tx.get(groupRef),
    ]);

    const batchInstitutionId = groupSnap.exists ? (groupSnap.data().institutionId || null) : null;

    txSnaps.forEach((snap, index) => {
      if (!snap.exists) {
        throw httpsError("not-found", `Transaction ${transactionIds[index]} was not found.`);
      }

      const item = snap.data();
      if (item.type !== TRANSACTION_TYPE.DEPOSIT) {
        throw httpsError("failed-precondition", `Transaction ${snap.id} is not a deposit.`);
      }

      if (item.status !== TRANSACTION_STATUS.PENDING_CONFIRMATION) {
        throw httpsError("failed-precondition", `Transaction ${snap.id} is not pending confirmation.`);
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
      institutionId: batchInstitutionId,
      agentId: context.auth.uid,
      transactionIds,
      totalAmount,
      memberCount: memberIds.size,
      status: DEPOSIT_BATCH_STATUS.SUBMITTED,
      idempotencyToken,
      submittedAt: FieldValue.serverTimestamp(),
      confirmedBy: null,
      confirmedAt: null,
      institutionNotes: null,
      institutionRef: null,
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
  const walletSnap = await db.collection("wallets").doc(userId).get();
  if (!walletSnap.exists) {
    throw httpsError("not-found", "Wallet not found for this member.");
  }

  const walletData = walletSnap.data();
  const availableToWithdraw = Number(walletData.availableBalance || 0);

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
  const walletRef = db.collection("wallets").doc(userId);

  await db.runTransaction(async (tx) => {
    const [freshWalletSnap, groupSnap, feesConfig, ledgerRefs] = await Promise.all([
      tx.get(walletRef),
      tx.get(db.collection("groups").doc(memberState.groupId)),
      getFeesConfig(tx),
      readLedgerRefs(tx, transactionRef.id),
    ]);

    if (!freshWalletSnap.exists) {
      throw httpsError("not-found", "Wallet not found for this member.");
    }
    if (!groupSnap.exists) {
      throw httpsError("failed-precondition", "Group record missing.");
    }

    const wallet = freshWalletSnap.data();
    const balanceConfirmed = Number(wallet.balanceConfirmed || 0);
    const balanceLocked = Number(wallet.balanceLocked || 0);
    const newBalanceConfirmed = balanceConfirmed - amount;

    if ((newBalanceConfirmed - balanceLocked) < MIN_WITHDRAWAL_REMAINING_BALANCE) {
      throw httpsError(
        "failed-precondition",
        `Withdrawal would violate minimum balance of ${MIN_WITHDRAWAL_REMAINING_BALANCE} BIF.`
      );
    }

    tx.update(walletRef, {
      balanceConfirmed: newBalanceConfirmed,
      availableBalance: newBalanceConfirmed - balanceLocked,
      updatedAt: FieldValue.serverTimestamp(),
    });

    tx.set(
      db.collection("groups").doc(memberState.groupId),
      {
        totalSavings: Math.max(0, Number(groupSnap.data().totalSavings || 0) - amount),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(transactionRef, {
      memberId: userId,
      userId,
      walletId: userId,
      groupId: memberState.groupId,
      type: TRANSACTION_TYPE.WITHDRAWAL,
      amount,
      status: TRANSACTION_STATUS.CONFIRMED,
      recordedBy: context.auth.uid,
      channel: "agent",
      batchId: null,
      notes,
      receiptNo,
      balanceBefore: balanceConfirmed,
      balanceAfter: newBalanceConfirmed,
      ledgerImpact: -amount,
      createdAt: FieldValue.serverTimestamp(),
    });

    writeLedgerEntries(tx, {
      ...ledgerRefs,
      agentId: context.auth.uid,
      transactionId: transactionRef.id,
      memberId: userId,
      groupId: memberState.groupId,
      source: "online",
      txType: TRANSACTION_TYPE.WITHDRAWAL,
      feesConfig,
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

/**
 * Member-initiated withdrawal request.
 * Creates a pending request that an agent must process via recordWithdrawal.
 * Does NOT move money — this is a pre-declaration only.
 */
exports.memberRequestWithdrawal = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = context.auth.token?.role;
  if (role !== ROLES.MEMBER && role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }

  const uid = context.auth.uid;
  const amount = parseAmount(data?.amount);
  const notes = String(data?.notes || "").trim();

  const walletSnap = await db.collection("wallets").doc(uid).get();
  if (!walletSnap.exists) {
    throw httpsError("not-found", "Wallet not found.");
  }

  const wallet = walletSnap.data();
  const availableBalance = Number(wallet.availableBalance || 0);
  const maxWithdrawal = availableBalance - MIN_WITHDRAWAL_REMAINING_BALANCE;

  if (maxWithdrawal <= 0) {
    throw httpsError(
      "failed-precondition",
      `Insufficient balance. Minimum balance of ${MIN_WITHDRAWAL_REMAINING_BALANCE} BIF must remain.`
    );
  }

  if (amount > maxWithdrawal) {
    throw httpsError(
      "failed-precondition",
      `Maximum withdrawal is ${maxWithdrawal} BIF (minimum balance of ${MIN_WITHDRAWAL_REMAINING_BALANCE} BIF must remain).`
    );
  }

  const requestRef = db.collection("withdrawalRequests").doc();
  await requestRef.set({
    userId: uid,
    amount,
    notes: notes || null,
    status: "pending_agent",
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, requestId: requestRef.id, amount, status: "pending_agent" };
});

exports.confirmBatch = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.INSTITUTION_USER]);

  const batchId = String(data?.batchId || "").trim();
  // Accept both new name (institutionRef) and old name (umucoAccountRef) for backward compatibility
  const institutionRef = String(data?.institutionRef || data?.umucoAccountRef || "").trim();
  const notes = String(data?.notes || "").trim();

  if (!batchId || !institutionRef) {
    throw httpsError("invalid-argument", "batchId and institutionRef are required.");
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

  // Institution scope check: migrated institution_user can only confirm their own institution's batches
  const callerRole = context.auth.token?.role;
  const callerInstitutionId = context.auth.token?.institutionId || null;
  if (callerRole === ROLES.INSTITUTION_USER && callerInstitutionId) {
    if (batchData.institutionId && batchData.institutionId !== callerInstitutionId) {
      throw httpsError("permission-denied", "You can only confirm batches for your own institution.");
    }
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

    if (txn.type !== TRANSACTION_TYPE.DEPOSIT || txn.status !== TRANSACTION_STATUS.PENDING_CONFIRMATION) {
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

  // Fetch wallets for all members being updated
  const memberUserIds = [...memberUpdates.keys()];
  const walletSnaps = await Promise.all(
    memberUserIds.map((uid) => db.collection("wallets").doc(uid).get())
  );

  const walletsByUserId = new Map();
  walletSnaps.forEach((snap, i) => {
    if (!snap.exists) {
      throw httpsError("not-found", `Wallet not found for member ${memberUserIds[i]}.`);
    }
    walletsByUserId.set(memberUserIds[i], snap.data());
  });

  // Use Batch API (500-op limit instead of 25)
  const batch = db.batch();

  // Update batch status
  batch.update(batchRef, {
    status: DEPOSIT_BATCH_STATUS.CONFIRMED,
    confirmedBy: context.auth.uid,
    confirmedAt: FieldValue.serverTimestamp(),
    institutionNotes: notes || null,
    institutionRef,
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update transactions
  txSnaps.forEach((txnSnap) => {
    batch.update(txnSnap.ref, {
      status: TRANSACTION_STATUS.CONFIRMED,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // Update wallets
  memberUpdates.forEach((update, userId) => {
    const wallet = walletsByUserId.get(userId);
    const newBalanceConfirmed = Number(wallet.balanceConfirmed || 0) + update.amount;
    const newBalancePending = Math.max(0, Number(wallet.balancePending || 0) - update.amount);
    const balanceLocked = Number(wallet.balanceLocked || 0);
    const newAvailableBalance = newBalanceConfirmed - balanceLocked;

    batch.update(db.collection("wallets").doc(userId), {
      balanceConfirmed: newBalanceConfirmed,
      balancePending: newBalancePending,
      availableBalance: newAvailableBalance,
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  // Update group totals
  batch.update(db.collection("groups").doc(batchData.groupId), {
    totalSavings: FieldValue.increment(totalConfirmed),
    pendingSavings: FieldValue.increment(-totalConfirmed),
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Update fund
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
  await requireRole(context, [ROLES.INSTITUTION_USER]);

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

  // Institution scope check: migrated institution_user can only flag their own institution's batches
  const callerRoleFlag = context.auth.token?.role;
  const callerInstitutionIdFlag = context.auth.token?.institutionId || null;
  if (callerRoleFlag === ROLES.INSTITUTION_USER && callerInstitutionIdFlag) {
    const batchDataFlag = batchSnap.data();
    if (batchDataFlag.institutionId && batchDataFlag.institutionId !== callerInstitutionIdFlag) {
      throw httpsError("permission-denied", "You can only flag batches for your own institution.");
    }
  }

  await batchRef.set(
    {
      status: DEPOSIT_BATCH_STATUS.FLAGGED,
      institutionNotes: notes,
      flaggedBy: context.auth.uid,
      flaggedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const batchData = batchSnap.data();
  await db.collection("notifications").add({
    type: "batch_flagged",
    batchId,
    groupId: batchData.groupId || null,
    recipientId: batchData.agentId || null,
    status: "unread",
    severity: "high",
    message: notes,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: context.auth.uid,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
  });

  return { success: true };
});

exports.getAgentLedger = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const callerRole = context.auth.token?.role;
  const isAdmin = callerRole === ROLES.SUPER_ADMIN || callerRole === ROLES.ADMIN || callerRole === ROLES.FINANCE;
  const isAgent = callerRole === ROLES.AGENT;

  if (!isAdmin && !isAgent) {
    throw httpsError("permission-denied", "Requires agent or admin role.");
  }

  // Agents can only read their own ledger; admins can query any agent
  let targetAgentId;
  if (isAdmin && data?.agentId) {
    targetAgentId = String(data.agentId).trim();
  } else {
    targetAgentId = context.auth.uid;
  }

  if (!targetAgentId) {
    throw httpsError("invalid-argument", "agentId is required.");
  }

  const status = String(data?.status || "").trim();
  const txType = String(data?.type || "").trim();

  let query = db.collection("agentLedgers").where("agentId", "==", targetAgentId);

  if (status) {
    query = query.where("status", "==", status);
  }
  if (txType) {
    query = query.where("type", "==", txType);
  }

  query = query.orderBy("createdAt", "desc").limit(100);

  const snap = await query.get();
  return {
    success: true,
    agentId: targetAgentId,
    entries: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});

exports.getPendingWithdrawalRequests = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const snap = await db
    .collection("withdrawalRequests")
    .where("status", "==", "pending_approval")
    .orderBy("createdAt", "desc")
    .limit(200)
    .get();

  const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  const userIds = [...new Set(rows.map((r) => r.userId).filter(Boolean))];
  const groupIds = [...new Set(rows.map((r) => r.groupId).filter(Boolean))];

  const [userDocs, groupDocs] = await Promise.all([
    userIds.length > 0
      ? Promise.all(userIds.map((uid) => db.collection("users").doc(uid).get()))
      : Promise.resolve([]),
    groupIds.length > 0
      ? Promise.all(groupIds.map((gid) => db.collection("groups").doc(gid).get()))
      : Promise.resolve([]),
  ]);

  const userNames = Object.fromEntries(
    userDocs.map((snap) => [snap.id, snap.exists ? (snap.data().fullName || snap.data().name || snap.id) : snap.id])
  );
  const groupNames = Object.fromEntries(
    groupDocs.map((snap) => [snap.id, snap.exists ? (snap.data().name || snap.id) : snap.id])
  );

  return {
    success: true,
    requests: rows.map((r) => ({
      ...r,
      memberName: r.userId ? (userNames[r.userId] || r.userId) : null,
      groupName: r.groupId ? (groupNames[r.groupId] || r.groupId) : null,
    })),
  };
});

exports.getBatchesForGroup = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT, ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE, ROLES.INSTITUTION_USER]);

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
