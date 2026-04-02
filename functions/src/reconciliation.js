"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const {
  ROLES,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
  LEDGER_TYPE,
  SETTLEMENT_STATUS,
} = require("./constants");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

function requireRole(context, allowedRoles) {
  if (!context.auth?.uid) {
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
  } catch (error) {
    console.error("[reconciliationAudit] Failed to write audit log", error.message, {
      action,
      targetType,
      targetId,
    });
  }
}

async function createAgentNotification({
  recipientId,
  type,
  title,
  message,
  settlementId = null,
  amount = null,
  createdBy = null,
}) {
  if (!recipientId) return;
  try {
    await db.collection("notifications").add({
      recipientId,
      type,
      title,
      message,
      settlementId,
      amount,
      status: "unread",
      severity: "normal",
      createdBy,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[agentNotification] Failed to write notification", error.message, {
      recipientId,
      type,
      settlementId,
    });
  }
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesQuery(values, queryText) {
  const query = normalizeText(queryText);
  if (!query) return true;
  return values.some((value) => normalizeText(value).includes(query));
}

function toDateRangeStartMs(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function toDateRangeEndMs(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function summarizeVariance(diff) {
  const amount = Number(diff || 0);
  if (amount < 0) return { state: "shortage", amount: Math.abs(amount) };
  if (amount > 0) return { state: "overage", amount };
  return { state: "balanced", amount: 0 };
}

function settlementDisplayAmount(row) {
  return Number(row?.approvedAmount ?? row?.paidAmount ?? row?.amount ?? row?.commissionTotal ?? 0);
}

function isWithinMsRange(entry, startMs, endMs) {
  const ms = entry.createdAt?.toMillis?.() ?? 0;
  return ms >= startMs && ms < endMs;
}

function getEligibleCommissionEntries(entries, startMs, endMs) {
  return entries.filter((entry) => (
    entry.type === LEDGER_TYPE.COMMISSION &&
    isWithinMsRange(entry, startMs, endMs) &&
    !entry.settlementId &&
    !entry.settledAt
  ));
}

function buildConsoleSummary(rows) {
  const summary = {
    pendingReconciliations: 0,
    approvedReconciliations: 0,
    unreconciledSubmissions: 0,
    shortages: 0,
    overages: 0,
    pendingSettlements: 0,
    approvedNotPaidSettlements: 0,
    paidSettlements: 0,
    totalCommissionInScope: 0,
    oldestUnreconciledAgeMs: null,
  };

  const nowMs = Date.now();
  for (const row of rows) {
    if (row.kind === "reconciliation") {
      const variance = summarizeVariance(row.difference);
      if (row.reconciliationStatus === "submitted") summary.pendingReconciliations += 1;
      if (row.reconciliationStatus === "reviewed") summary.approvedReconciliations += 1;
      if (row.reconciliationStatus === "submitted" || row.reconciliationStatus === "flagged") {
        summary.unreconciledSubmissions += 1;
        const ageMs = row.sortAtMs ? Math.max(0, nowMs - row.sortAtMs) : null;
        if (ageMs != null) {
          summary.oldestUnreconciledAgeMs =
            summary.oldestUnreconciledAgeMs == null
              ? ageMs
              : Math.max(summary.oldestUnreconciledAgeMs, ageMs);
        }
      }
      if (variance.state === "shortage") summary.shortages += 1;
      if (variance.state === "overage") summary.overages += 1;
      summary.totalCommissionInScope += Number(row.commissionAmount || 0);
    }

    if (row.kind === "settlement") {
      if (row.settlementStatus === SETTLEMENT_STATUS.REQUESTED) summary.pendingSettlements += 1;
      if (row.settlementStatus === SETTLEMENT_STATUS.APPROVED) summary.approvedNotPaidSettlements += 1;
      if (row.settlementStatus === SETTLEMENT_STATUS.PAID) summary.paidSettlements += 1;
      summary.totalCommissionInScope += Number(row.commissionAmount || 0);
    }
  }

  return summary;
}

/**
 * closeAgentDay({ dateYYYYMMDD, cashCounted, notes, offlinePendingCount })
 *
 * Agent submits their end-of-day cash reconciliation for a given date.
 * Calculates cash movement from Firestore transactions and fee / commission
 * reference data from agentLedgers. Stores result in
 * agentReconciliations/{agentId}_{date}.
 *
 * Idempotent: re-submission is allowed unless the record has been reviewed.
 * The date is interpreted in Africa/Bujumbura timezone (UTC+2).
 */
/**
 * adminUpdateReconciliation({ docId, status, adminNote })
 *
 * Allows super_admin or finance to mark a reconciliation as reviewed or
 * flagged, and to attach an internal note. Only writes the four permitted
 * fields; all financial figures are immutable after submission.
 */
exports.adminUpdateReconciliation = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }
  const role = context.auth.token?.role;
  if (role !== ROLES.SUPER_ADMIN && role !== ROLES.ADMIN && role !== ROLES.FINANCE) {
    throw httpsError("permission-denied", "Requires super_admin, admin, or finance role.");
  }

  const docId = String(data?.docId || "").trim();
  if (!docId) {
    throw httpsError("invalid-argument", "docId is required.");
  }

  // Accept each field only when explicitly provided (null/undefined = omit)
  const hasStatus = data?.status != null;
  const hasNote = data?.adminNote != null;

  if (!hasStatus && !hasNote) {
    throw httpsError("invalid-argument", "Provide at least one of: status, adminNote.");
  }

  const status = hasStatus ? String(data.status).trim() : undefined;
  const adminNote = hasNote ? String(data.adminNote).trim() : undefined;

  const validStatuses = ["reviewed", "flagged"];
  if (status !== undefined && !validStatuses.includes(status)) {
    throw httpsError(
      "invalid-argument",
      `status must be one of: ${validStatuses.join(", ")}.`
    );
  }

  const reconcRef = db.collection("agentReconciliations").doc(docId);
  const snap = await reconcRef.get();
  if (!snap.exists) {
    throw httpsError("not-found", "Reconciliation record not found.");
  }
  const before = snap.data() || {};

  const updates = {
    reviewedBy: context.auth.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status !== undefined) updates.status = status;
  if (adminNote !== undefined) updates.adminNote = adminNote || null;

  await reconcRef.update(updates);
  await writeAuditLog(context.auth.uid, role, "reconciliation.update", "agentReconciliation", docId, {
    before: {
      status: before.status || null,
      adminNote: before.adminNote || null,
    },
    after: {
      status: status !== undefined ? status : before.status || null,
      adminNote: adminNote !== undefined ? (adminNote || null) : before.adminNote || null,
    },
  });

  return { success: true, docId };
});

exports.closeAgentDay = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.AGENT]);

  const agentId = context.auth.uid;
  const dateStr = String(data?.dateYYYYMMDD || "").trim();
  const notes = String(data?.notes || "").trim();
  const offlinePendingCount = Math.max(
    0,
    Math.round(Number(data?.offlinePendingCount || 0))
  );

  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw httpsError(
      "invalid-argument",
      "dateYYYYMMDD must be in YYYY-MM-DD format (e.g. 2026-03-05)."
    );
  }

  const rawCash = Number(data?.cashCounted);
  if (!Number.isFinite(rawCash) || rawCash < 0) {
    throw httpsError(
      "invalid-argument",
      "cashCounted must be a non-negative number."
    );
  }
  const cashCounted = Math.round(rawCash);

  // Block re-submission only if an admin has already reviewed this record
  const reconcId = `${agentId}_${dateStr}`;
  const reconcRef = db.collection("agentReconciliations").doc(reconcId);
  const existingSnap = await reconcRef.get();

  if (existingSnap.exists && existingSnap.data().status === "reviewed") {
    throw httpsError(
      "failed-precondition",
      "This day has already been reviewed and cannot be re-submitted."
    );
  }

  // Day boundaries: interpret dateStr as Bujumbura local date (UTC+2).
  // Midnight in Bujumbura (UTC+2) = 22:00 UTC on the previous calendar day.
  const [year, month, day] = dateStr.split("-").map(Number);
  const startMs = Date.UTC(year, month - 1, day) - 2 * 3600 * 1000;
  const endMs = startMs + 24 * 60 * 60 * 1000;

  // Single-field where clause on each collection — no composite index needed.
  // Date filtering is done in-memory after fetch.
  const [txSnap, ledgerSnap] = await Promise.all([
    db.collection("transactions").where("agentId", "==", agentId).get(),
    db.collection("agentLedgers").where("agentId", "==", agentId).get(),
  ]);

  const dayTxns = txSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => {
      const ms = d.createdAt?.toMillis?.() ?? 0;
      return ms >= startMs && ms < endMs;
    });

  // Deposits: agent physically received cash for both pending and confirmed.
  const deposits = dayTxns.filter(
    (d) =>
      d.type === TRANSACTION_TYPE.DEPOSIT &&
      (d.status === TRANSACTION_STATUS.PENDING_CONFIRMATION ||
        d.status === TRANSACTION_STATUS.CONFIRMED)
  );

  // Withdrawals: agent paid out cash only for confirmed withdrawals.
  const withdrawals = dayTxns.filter(
    (d) =>
      d.type === TRANSACTION_TYPE.WITHDRAWAL &&
      d.status === TRANSACTION_STATUS.CONFIRMED
  );

  const totalDeposits = deposits.reduce((s, d) => s + Number(d.amount || 0), 0);
  const totalWithdrawals = withdrawals.reduce((s, d) => s + Number(d.amount || 0), 0);

  const dayLedger = ledgerSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => isWithinMsRange(d, startMs, endMs));

  const customerFeesCollected = dayLedger
    .filter((e) => e.type === LEDGER_TYPE.FEE)
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const commissionAccrued = dayLedger
    .filter((e) => e.type === LEDGER_TYPE.COMMISSION)
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const kirimbaRetainedFees = Math.max(0, customerFeesCollected - commissionAccrued);
  const cashExpected = totalDeposits - totalWithdrawals;
  const remittanceDue = cashExpected;
  const difference = cashCounted - cashExpected;

  await reconcRef.set({
    agentId,
    date: dateStr,
    cashExpected,
    expectedCashOnHand: cashExpected,
    remittanceDue,
    cashCounted,
    difference,
    depositCount: deposits.length,
    withdrawCount: withdrawals.length,
    totalDeposits,
    totalWithdrawals,
    customerFeesCollected,
    commissionAccrued,
    kirimbaRetainedFees,
    offlinePendingCount,
    status: "submitted",
    notes: notes || null,
    createdAt: existingSnap.exists
      ? existingSnap.data().createdAt
      : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    success: true,
    reconciliationId: reconcId,
    cashExpected,
    expectedCashOnHand: cashExpected,
    remittanceDue,
    cashCounted,
    difference,
    depositCount: deposits.length,
    withdrawCount: withdrawals.length,
    totalDeposits,
    totalWithdrawals,
    customerFeesCollected,
    commissionAccrued,
    kirimbaRetainedFees,
  };
});

// ─── Settlement functions ────────────────────────────────────────────────────

/**
 * Validates a date string and returns its UTC millisecond timestamp for the
 * START of that calendar day in Bujumbura (UTC+2).
 */
function parseDateBIF(label, value) {
  const str = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    throw httpsError(
      "invalid-argument",
      `${label} must be in YYYY-MM-DD format (e.g. 2026-03-05).`
    );
  }
  const [y, m, d] = str.split("-").map(Number);
  return { str, ms: Date.UTC(y, m - 1, d) - 2 * 3600 * 1000 };
}

/**
 * requestSettlement({ periodStart, periodEnd })
 *
 * Agent requests a commission payout for a date range. Computes
 * commissionTotal from unsettled agentLedgers and creates a settlement record.
 * Blocks a second open request while one is already in review.
 */
exports.requestSettlement = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.AGENT]);

  const agentId = context.auth.uid;
  const { str: periodStart, ms: startMs } = parseDateBIF("periodStart", data?.periodStart);
  const { str: periodEnd, ms: endMs0 } = parseDateBIF("periodEnd", data?.periodEnd);
  const notes = String(data?.notes || "").trim();

  if (startMs > endMs0) {
    throw httpsError("invalid-argument", "periodStart must not be after periodEnd.");
  }

  // End of the final day (exclusive upper bound)
  const endMs = endMs0 + 24 * 60 * 60 * 1000;

  // Prevent a second open request while one is already in review.
  const existingSnap = await db
    .collection("agentSettlements")
    .where("agentId", "==", agentId)
    .get();

  const openSettlement = existingSnap.docs.find((d) => {
    const s = d.data();
    return (
      (s.status === SETTLEMENT_STATUS.REQUESTED || s.status === SETTLEMENT_STATUS.APPROVED)
    );
  });

  if (openSettlement) {
    throw httpsError(
      "failed-precondition",
      `An open settlement request is already in review (${openSettlement.id}).`
    );
  }

  // Sum commission entries in the period (single-field query, filter in-memory)
  const ledgerSnap = await db
    .collection("agentLedgers")
    .where("agentId", "==", agentId)
    .get();

  const eligibleEntries = getEligibleCommissionEntries(
    ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    startMs,
    endMs
  );
  const commissionTotal = eligibleEntries
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  if (commissionTotal <= 0) {
    throw httpsError(
      "failed-precondition",
      "No accrued unpaid commission is available for the selected period."
    );
  }

  const settlementRef = db.collection("agentSettlements").doc();

  const batch = db.batch();
  batch.set(settlementRef, {
    agentId,
    periodStart,
    periodEnd,
    commissionTotal,
    commissionEntryCount: eligibleEntries.length,
    status: SETTLEMENT_STATUS.REQUESTED,
    notes: notes || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    approvedAt: null,
    approvedBy: null,
    paidAt: null,
    paidBy: null,
    reference: null,
  });
  eligibleEntries.forEach((entry) => {
    batch.update(db.collection("agentLedgers").doc(entry.id), {
      settlementId: settlementRef.id,
      settlementRequestedAt: FieldValue.serverTimestamp(),
    });
  });
  await batch.commit();

  return {
    success: true,
    settlementId: settlementRef.id,
    commissionTotal,
  };
});

/**
 * approveSettlement({ settlementId })
 *
 * Admin marks a requested settlement as approved.
 */
exports.approveSettlement = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw httpsError("unauthenticated", "Authentication required.");
  const role = context.auth.token?.role;
  if (role !== ROLES.SUPER_ADMIN && role !== ROLES.ADMIN && role !== ROLES.FINANCE) {
    throw httpsError("permission-denied", "Requires super_admin, admin, or finance role.");
  }

  const settlementId = String(data?.settlementId || "").trim();
  if (!settlementId) throw httpsError("invalid-argument", "settlementId is required.");

  const ref = db.collection("agentSettlements").doc(settlementId);
  const snap = await ref.get();
  if (!snap.exists) throw httpsError("not-found", "Settlement not found.");

  const settlement = snap.data() || {};
  const { status } = settlement;
  if (status !== SETTLEMENT_STATUS.REQUESTED) {
    throw httpsError(
      "failed-precondition",
      `Settlement is '${status}', expected 'requested'.`
    );
  }

  const requestedAmount = settlementDisplayAmount(settlement);
  const approvedAmountRaw = data?.approvedAmount;
  const approvedAmount =
    approvedAmountRaw == null || approvedAmountRaw === ""
      ? requestedAmount
      : Math.round(Number(approvedAmountRaw));
  if (!Number.isFinite(approvedAmount) || approvedAmount < 0) {
    throw httpsError("invalid-argument", "approvedAmount must be a non-negative number.");
  }
  const notes = String(data?.notes || "").trim();

  await ref.update({
    status: SETTLEMENT_STATUS.APPROVED,
    approvedAmount,
    approvalNotes: notes || null,
    approvedBy: context.auth.uid,
    approvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  await writeAuditLog(context.auth.uid, role, "settlement.approve", "agentSettlement", settlementId, {
    before: {
      status: settlement.status || null,
      approvedAmount: settlement.approvedAmount ?? null,
      approvalNotes: settlement.approvalNotes || null,
    },
    after: {
      status: SETTLEMENT_STATUS.APPROVED,
      approvedAmount,
      approvalNotes: notes || null,
    },
  });
  await createAgentNotification({
    recipientId: settlement.agentId || null,
    type: "settlement_approved",
    title: "Settlement approved",
    message: `Your commission payout of ${approvedAmount} BIF was approved and is waiting for payment.`,
    settlementId,
    amount: approvedAmount,
    createdBy: context.auth.uid,
  });

  return { success: true, settlementId, approvedAmount };
});

/**
 * markSettlementPaid({ settlementId, reference })
 *
 * Admin confirms physical payment. No money movement — audit only.
 */
exports.markSettlementPaid = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) throw httpsError("unauthenticated", "Authentication required.");
  const role = context.auth.token?.role;
  if (role !== ROLES.SUPER_ADMIN && role !== ROLES.ADMIN && role !== ROLES.FINANCE) {
    throw httpsError("permission-denied", "Requires super_admin, admin, or finance role.");
  }

  const settlementId = String(data?.settlementId || "").trim();
  const reference = String(data?.reference || data?.paymentReference || "").trim();
  if (!settlementId) throw httpsError("invalid-argument", "settlementId is required.");
  if (!reference) throw httpsError("invalid-argument", "reference is required.");

  const ref = db.collection("agentSettlements").doc(settlementId);
  const snap = await ref.get();
  if (!snap.exists) throw httpsError("not-found", "Settlement not found.");

  const settlement = snap.data() || {};
  const { status } = settlement;
  if (status !== SETTLEMENT_STATUS.APPROVED) {
    throw httpsError(
      "failed-precondition",
      `Settlement is '${status}', expected 'approved'.`
    );
  }

  const paidAmountRaw = data?.paidAmount;
  const paidAmount =
    paidAmountRaw == null || paidAmountRaw === ""
      ? settlementDisplayAmount(settlement)
      : Math.round(Number(paidAmountRaw));
  if (!Number.isFinite(paidAmount) || paidAmount < 0) {
    throw httpsError("invalid-argument", "paidAmount must be a non-negative number.");
  }
  const notes = String(data?.notes || "").trim();

  const { str: periodStart, ms: startMs } = parseDateBIF("periodStart", settlement.periodStart);
  const { str: periodEnd, ms: endMs0 } = parseDateBIF("periodEnd", settlement.periodEnd);
  const endMs = endMs0 + 24 * 60 * 60 * 1000;

  const ledgerSnap = await db
    .collection("agentLedgers")
    .where("agentId", "==", settlement.agentId)
    .get();
  const eligibleEntries = ledgerSnap.docs
    .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
    .filter((entry) => (
      entry.type === LEDGER_TYPE.COMMISSION &&
      isWithinMsRange(entry, startMs, endMs) &&
      (entry.settlementId === settlementId || (!entry.settlementId && !entry.settledAt))
    ));

  const batch = db.batch();
  batch.update(ref, {
    status: SETTLEMENT_STATUS.PAID,
    reference,
    paymentReference: reference,
    paidAmount,
    paymentNotes: notes || null,
    paidBy: context.auth.uid,
    paidAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  eligibleEntries.forEach((entry) => {
    batch.update(db.collection("agentLedgers").doc(entry.id), {
      settlementId,
      settledAt: FieldValue.serverTimestamp(),
      settlementStatus: SETTLEMENT_STATUS.PAID,
      settlementReference: reference,
    });
  });
  await batch.commit();
  await writeAuditLog(context.auth.uid, role, "settlement.mark_paid", "agentSettlement", settlementId, {
    before: {
      status: settlement.status || null,
      paidAmount: settlement.paidAmount ?? null,
      paymentReference: settlement.paymentReference || settlement.reference || null,
      paymentNotes: settlement.paymentNotes || null,
    },
    after: {
      status: SETTLEMENT_STATUS.PAID,
      paidAmount,
      paymentReference: reference,
      paymentNotes: notes || null,
    },
  });
  await createAgentNotification({
    recipientId: settlement.agentId || null,
    type: "settlement_paid",
    title: "Settlement paid",
    message: `Your commission payout of ${paidAmount} BIF was marked as paid. Reference: ${reference}.`,
    settlementId,
    amount: paidAmount,
    createdBy: context.auth.uid,
  });

  return { success: true, settlementId, paidAmount };
});

exports.getReconciliationSettlementsConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);
  const filters = {
    dateFrom: String(data?.dateFrom || "").trim(),
    dateTo: String(data?.dateTo || "").trim(),
    agentQuery: String(data?.agentQuery || "").trim(),
    institutionId: String(data?.institutionId || "").trim(),
    reconciliationStatus: String(data?.reconciliationStatus || "").trim(),
    settlementStatus: String(data?.settlementStatus || "").trim(),
    exceptionOnly: data?.exceptionOnly === true,
    reference: String(data?.reference || "").trim(),
  };

  const [reconciliationSnap, settlementSnap, userSnap, institutionSnap] = await Promise.all([
    db.collection("agentReconciliations").get(),
    db.collection("agentSettlements").get(),
    db.collection("users").get(),
    db.collection("institutions").get(),
  ]);

  const userMap = new Map(userSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }]));
  const institutionMap = new Map(
    institutionSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
  );
  const dateFromMs = toDateRangeStartMs(filters.dateFrom);
  const dateToMs = toDateRangeEndMs(filters.dateTo);

  const reconciliationRows = reconciliationSnap.docs.map((doc) => {
    const row = doc.data() || {};
    const agent = row.agentId ? userMap.get(row.agentId) : null;
    const institution = agent?.institutionId ? institutionMap.get(agent.institutionId) : null;
    const variance = summarizeVariance(row.difference);
    const sortAtMs =
      timestampToMillis(row.reviewedAt) ||
      timestampToMillis(row.updatedAt) ||
      timestampToMillis(row.createdAt) ||
      toDateRangeStartMs(row.date);
    return {
      id: doc.id,
      kind: "reconciliation",
      reference: doc.id,
      operationalDate: row.date || null,
      agentId: row.agentId || null,
      agentName: agent?.fullName || agent?.name || row.agentId || "Unknown agent",
      institutionId: agent?.institutionId || null,
      institutionName: institution?.name || "Unlinked",
      expectedCash: Number(row.cashExpected || 0),
      declaredCash: Number(row.cashCounted || 0),
      difference: Number(row.difference || 0),
      varianceState: variance.state,
      mismatch: variance.state !== "balanced" || Number(row.offlinePendingCount || 0) > 0 || row.status === "flagged",
      reconciliationStatus: row.status || "submitted",
      settlementStatus: null,
      commissionAmount: Number(row.commissionAccrued || 0),
      offlinePendingCount: Number(row.offlinePendingCount || 0),
      depositCount: Number(row.depositCount || 0),
      withdrawCount: Number(row.withdrawCount || 0),
      sortAtMs,
      createdAtMs: timestampToMillis(row.createdAt),
      updatedAtMs: timestampToMillis(row.updatedAt),
      reviewedAtMs: timestampToMillis(row.reviewedAt),
      statusHistoryHint: row.reviewedAt ? 2 : 1,
    };
  });

  const settlementRows = settlementSnap.docs.map((doc) => {
    const row = doc.data() || {};
    const agent = row.agentId ? userMap.get(row.agentId) : null;
    const institution = agent?.institutionId ? institutionMap.get(agent.institutionId) : null;
    const sortAtMs =
      timestampToMillis(row.paidAt) ||
      timestampToMillis(row.approvedAt) ||
      timestampToMillis(row.createdAt) ||
      toDateRangeStartMs(row.periodEnd || row.periodStart);
    return {
      id: doc.id,
      kind: "settlement",
      reference: doc.id,
      operationalDate: row.periodEnd || row.periodStart || null,
      periodStart: row.periodStart || null,
      periodEnd: row.periodEnd || null,
      agentId: row.agentId || null,
      agentName: agent?.fullName || agent?.name || row.agentId || "Unknown agent",
      institutionId: agent?.institutionId || null,
      institutionName: institution?.name || "Unlinked",
      expectedCash: null,
      declaredCash: null,
      difference: null,
      varianceState: "not_applicable",
      mismatch: false,
      reconciliationStatus: null,
      settlementStatus: row.status || SETTLEMENT_STATUS.REQUESTED,
      commissionAmount: settlementDisplayAmount(row),
      requestedCommissionAmount: Number(row.commissionTotal || 0),
      paidAmount: Number(row.paidAmount || 0),
      approvedAmount: Number(row.approvedAmount || 0),
      sortAtMs,
      createdAtMs: timestampToMillis(row.createdAt),
      approvedAtMs: timestampToMillis(row.approvedAt),
      paidAtMs: timestampToMillis(row.paidAt),
      paymentReference: row.paymentReference || row.reference || null,
      statusHistoryHint: row.paidAt ? 3 : row.approvedAt ? 2 : 1,
    };
  });

  const rows = [...reconciliationRows, ...settlementRows]
    .filter((row) => (dateFromMs ? (row.sortAtMs || 0) >= dateFromMs : true))
    .filter((row) => (dateToMs ? (row.sortAtMs || 0) <= dateToMs : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) => (filters.reconciliationStatus ? row.reconciliationStatus === filters.reconciliationStatus : true))
    .filter((row) => (filters.settlementStatus ? row.settlementStatus === filters.settlementStatus : true))
    .filter((row) => (filters.exceptionOnly ? row.mismatch === true : true))
    .filter((row) => matchesQuery([row.agentName, row.agentId], filters.agentQuery))
    .filter((row) => matchesQuery([row.reference, row.operationalDate, row.paymentReference], filters.reference))
    .sort((a, b) => (b.sortAtMs || 0) - (a.sortAtMs || 0));

  return {
    role,
    filters,
    summary: buildConsoleSummary(rows),
    filterOptions: {
      institutions: institutionSnap.docs.map((doc) => ({
        id: doc.id,
        name: doc.data()?.name || doc.id,
      })),
    },
    rows,
  };
});

exports.getReconciliationSettlementDetail = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);
  const kind = String(data?.kind || "").trim();
  const itemId = String(data?.itemId || "").trim();

  if (!["reconciliation", "settlement"].includes(kind)) {
    throw httpsError("invalid-argument", "kind must be reconciliation or settlement.");
  }
  if (!itemId) {
    throw httpsError("invalid-argument", "itemId is required.");
  }

  if (kind === "reconciliation") {
    const snap = await db.collection("agentReconciliations").doc(itemId).get();
    if (!snap.exists) throw httpsError("not-found", "Reconciliation not found.");
    const row = snap.data() || {};
    const [agentSnap, settlementSnap, batchSnap] = await Promise.all([
      row.agentId ? db.collection("users").doc(row.agentId).get() : Promise.resolve(null),
      row.agentId ? db.collection("agentSettlements").where("agentId", "==", row.agentId).get() : Promise.resolve(null),
      row.agentId ? db.collection("depositBatches").where("agentId", "==", row.agentId).get() : Promise.resolve(null),
    ]);
    const agent = agentSnap?.exists ? agentSnap.data() || {} : {};
    const institutionSnap = agent.institutionId
      ? await db.collection("institutions").doc(agent.institutionId).get()
      : null;
    const institution = institutionSnap?.exists ? institutionSnap.data() || {} : {};
    const dateMs = toDateRangeStartMs(row.date);
    const nextDateMs = dateMs == null ? null : dateMs + 24 * 60 * 60 * 1000;
    const relatedSettlements = settlementSnap
      ? settlementSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((settlement) => {
            const start = toDateRangeStartMs(settlement.periodStart);
            const end = toDateRangeEndMs(settlement.periodEnd);
            return dateMs != null && start != null && end != null && dateMs >= start && dateMs <= end;
          })
          .map((settlement) => ({
            id: settlement.id,
            status: settlement.status || SETTLEMENT_STATUS.REQUESTED,
            period: `${settlement.periodStart || "—"} to ${settlement.periodEnd || "—"}`,
            amount: settlementDisplayAmount(settlement),
          }))
      : [];
    const relatedBatches = batchSnap
      ? batchSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .filter((batch) => {
            const candidateMs =
              timestampToMillis(batch.submittedAt) ||
              timestampToMillis(batch.createdAt) ||
              timestampToMillis(batch.confirmedAt);
            return dateMs != null && nextDateMs != null && candidateMs != null && candidateMs >= dateMs && candidateMs < nextDateMs;
          })
          .slice(0, 5)
          .map((batch) => ({
            id: batch.id,
            status: batch.status || null,
            totalAmount: Number(batch.totalAmount || 0),
            submittedAtMs: timestampToMillis(batch.submittedAt),
          }))
      : [];
    return {
      role,
      detail: {
        id: itemId,
        kind,
        reference: itemId,
        agentId: row.agentId || null,
        agentName: agent.fullName || agent.name || row.agentId || "Unknown agent",
        institutionId: agent.institutionId || null,
        institutionName: institution.name || "Unlinked",
        operationalDate: row.date || null,
        expectedCash: Number(row.cashExpected || 0),
        declaredCash: Number(row.cashCounted || 0),
        difference: Number(row.difference || 0),
        varianceState: summarizeVariance(row.difference).state,
        reconciliationStatus: row.status || "submitted",
        commissionAmount: Number(row.commissionAccrued || 0),
        depositCount: Number(row.depositCount || 0),
        withdrawCount: Number(row.withdrawCount || 0),
        offlinePendingCount: Number(row.offlinePendingCount || 0),
        notes: row.notes || null,
        adminNote: row.adminNote || null,
        createdAtMs: timestampToMillis(row.createdAt),
        reviewedAtMs: timestampToMillis(row.reviewedAt),
        reviewedBy: row.reviewedBy || null,
        statusHistory: [
          { label: "Submitted", atMs: timestampToMillis(row.createdAt) },
          row.reviewedAt ? { label: row.status === "flagged" ? "Flagged" : "Reviewed", atMs: timestampToMillis(row.reviewedAt) } : null,
        ].filter(Boolean),
        relatedSettlements,
        relatedBatches,
        nextStepGuidance:
          row.status === "submitted"
            ? "Review the variance, confirm whether the declared cash matches deposit and withdrawal flow, then either mark reviewed or flag for follow-up."
            : row.status === "flagged"
            ? "This item remains open because it was flagged. Use the note field to capture escalation context before clearing it as reviewed."
            : "This reconciliation is already reviewed. Use the drawer for investigation history and related settlement context.",
      },
    };
  }

  const snap = await db.collection("agentSettlements").doc(itemId).get();
  if (!snap.exists) throw httpsError("not-found", "Settlement not found.");
  const row = snap.data() || {};
  const [agentSnap, reconciliationSnap] = await Promise.all([
    row.agentId ? db.collection("users").doc(row.agentId).get() : Promise.resolve(null),
    row.agentId ? db.collection("agentReconciliations").where("agentId", "==", row.agentId).get() : Promise.resolve(null),
  ]);
  const agent = agentSnap?.exists ? agentSnap.data() || {} : {};
  const institutionSnap = agent.institutionId
    ? await db.collection("institutions").doc(agent.institutionId).get()
    : null;
  const institution = institutionSnap?.exists ? institutionSnap.data() || {} : {};
  const startMs = toDateRangeStartMs(row.periodStart);
  const endMs = toDateRangeEndMs(row.periodEnd);
  const relatedReconciliations = reconciliationSnap
    ? reconciliationSnap.docs
        .map((doc) => ({ id: doc.id, ...doc.data() }))
        .filter((reconciliation) => {
          const dayMs = toDateRangeStartMs(reconciliation.date);
          return startMs != null && endMs != null && dayMs != null && dayMs >= startMs && dayMs <= endMs;
        })
        .map((reconciliation) => ({
          id: reconciliation.id,
          date: reconciliation.date || null,
          status: reconciliation.status || "submitted",
          difference: Number(reconciliation.difference || 0),
        }))
    : [];

  return {
    role,
    detail: {
      id: itemId,
      kind,
      reference: itemId,
      agentId: row.agentId || null,
      agentName: agent.fullName || agent.name || row.agentId || "Unknown agent",
      institutionId: agent.institutionId || null,
      institutionName: institution.name || "Unlinked",
      periodStart: row.periodStart || null,
      periodEnd: row.periodEnd || null,
      settlementStatus: row.status || SETTLEMENT_STATUS.REQUESTED,
      commissionAmount: settlementDisplayAmount(row),
      requestedCommissionAmount: Number(row.commissionTotal || 0),
      approvedAmount: Number(row.approvedAmount || 0),
      paidAmount: Number(row.paidAmount || 0),
      paymentReference: row.paymentReference || row.reference || null,
      notes: row.notes || null,
      approvalNotes: row.approvalNotes || null,
      paymentNotes: row.paymentNotes || null,
      createdAtMs: timestampToMillis(row.createdAt),
      approvedAtMs: timestampToMillis(row.approvedAt),
      paidAtMs: timestampToMillis(row.paidAt),
      approvedBy: row.approvedBy || null,
      paidBy: row.paidBy || null,
      relatedReconciliations,
      statusHistory: [
        { label: "Requested", atMs: timestampToMillis(row.createdAt) },
        row.approvedAt ? { label: "Approved", atMs: timestampToMillis(row.approvedAt) } : null,
        row.paidAt ? { label: "Paid", atMs: timestampToMillis(row.paidAt) } : null,
      ].filter(Boolean),
      nextStepGuidance:
        row.status === SETTLEMENT_STATUS.REQUESTED
          ? "Review the requested commission against the reconciliations in this period before approving the payout."
          : row.status === SETTLEMENT_STATUS.APPROVED
          ? "This payout is approved but still waiting for payment confirmation. Record the payment reference when finance completes the payout."
          : "This settlement is fully paid. Use the status history and linked reconciliations for audit follow-up.",
    },
  };
});
