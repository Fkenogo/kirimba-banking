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
}

/**
 * closeAgentDay({ dateYYYYMMDD, cashCounted, notes, offlinePendingCount })
 *
 * Agent submits their end-of-day cash reconciliation for a given date.
 * Calculates expected cash from Firestore transactions and commission from
 * agentLedgers. Stores result in agentReconciliations/{agentId}_{date}.
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

  const updates = {
    reviewedBy: context.auth.uid,
    reviewedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  if (status !== undefined) updates.status = status;
  if (adminNote !== undefined) updates.adminNote = adminNote || null;

  await reconcRef.update(updates);

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
  const totalWithdrawals = withdrawals.reduce(
    (s, d) => s + Number(d.amount || 0),
    0
  );
  const cashExpected = totalDeposits - totalWithdrawals;

  const dayLedger = ledgerSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((d) => {
      const ms = d.createdAt?.toMillis?.() ?? 0;
      return ms >= startMs && ms < endMs;
    });

  const commissionAccrued = dayLedger
    .filter((e) => e.type === LEDGER_TYPE.COMMISSION)
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const difference = cashCounted - cashExpected;

  await reconcRef.set({
    agentId,
    date: dateStr,
    cashExpected,
    cashCounted,
    difference,
    depositCount: deposits.length,
    withdrawCount: withdrawals.length,
    commissionAccrued,
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
    cashCounted,
    difference,
    depositCount: deposits.length,
    withdrawCount: withdrawals.length,
    commissionAccrued,
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
 * commissionTotal from agentLedgers and creates a settlement record.
 * Blocks duplicate open requests for the exact same period.
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

  // Prevent duplicate open requests for the same agent + period
  const existingSnap = await db
    .collection("agentSettlements")
    .where("agentId", "==", agentId)
    .get();

  const duplicate = existingSnap.docs.find((d) => {
    const s = d.data();
    return (
      s.periodStart === periodStart &&
      s.periodEnd === periodEnd &&
      (s.status === SETTLEMENT_STATUS.REQUESTED || s.status === SETTLEMENT_STATUS.APPROVED)
    );
  });

  if (duplicate) {
    throw httpsError(
      "already-exists",
      `An open settlement request already exists for this period (${duplicate.id}).`
    );
  }

  // Sum commission entries in the period (single-field query, filter in-memory)
  const ledgerSnap = await db
    .collection("agentLedgers")
    .where("agentId", "==", agentId)
    .get();

  const commissionTotal = ledgerSnap.docs
    .map((d) => d.data())
    .filter((e) => {
      const ms = e.createdAt?.toMillis?.() ?? 0;
      return e.type === LEDGER_TYPE.COMMISSION && ms >= startMs && ms < endMs;
    })
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const settlementRef = db.collection("agentSettlements").doc();

  await settlementRef.set({
    agentId,
    periodStart,
    periodEnd,
    commissionTotal,
    status: SETTLEMENT_STATUS.REQUESTED,
    notes: notes || null,
    createdAt: FieldValue.serverTimestamp(),
    approvedAt: null,
    approvedBy: null,
    paidAt: null,
    paidBy: null,
    reference: null,
  });

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

  const { status } = snap.data();
  if (status !== SETTLEMENT_STATUS.REQUESTED) {
    throw httpsError(
      "failed-precondition",
      `Settlement is '${status}', expected 'requested'.`
    );
  }

  await ref.update({
    status: SETTLEMENT_STATUS.APPROVED,
    approvedBy: context.auth.uid,
    approvedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true, settlementId };
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
  const reference = String(data?.reference || "").trim();
  if (!settlementId) throw httpsError("invalid-argument", "settlementId is required.");
  if (!reference) throw httpsError("invalid-argument", "reference is required.");

  const ref = db.collection("agentSettlements").doc(settlementId);
  const snap = await ref.get();
  if (!snap.exists) throw httpsError("not-found", "Settlement not found.");

  const { status } = snap.data();
  if (status !== SETTLEMENT_STATUS.APPROVED) {
    throw httpsError(
      "failed-precondition",
      `Settlement is '${status}', expected 'approved'.`
    );
  }

  await ref.update({
    status: SETTLEMENT_STATUS.PAID,
    reference,
    paidBy: context.auth.uid,
    paidAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return { success: true, settlementId };
});
