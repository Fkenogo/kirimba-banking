"use strict";

/**
 * functions/src/superAdmin.js
 * Super-admin business oversight and admin management Cloud Functions.
 * All mutating operations write an audit log entry.
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  ROLES,
  USER_STATUS,
  GROUP_STATUS,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
  DEPOSIT_BATCH_STATUS,
} = require("./constants");
const { normalizeAgentFeeConfig, normalizeCommissionPolicyConfig } = require("./agentPricing");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

// ── Helpers ───────────────────────────────────────────────────────────────────

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
    // Audit log write failure is non-fatal but should be logged
    console.error("[auditLog] Failed to write audit log:", err.message, { action, targetType, targetId });
  }
}

const VALID_CONFIG_IDS = ["fees", "loanPolicy", "commissionPolicy", "businessRules"];
const SUPPORTED_LOAN_TERM_DURATIONS = [7, 14, 21, 30];
const DEFAULT_LOAN_POLICY_CONFIG = {
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

const TRANSACTION_OVERSIGHT_TYPES = [
  TRANSACTION_TYPE.DEPOSIT,
  TRANSACTION_TYPE.WITHDRAWAL,
  TRANSACTION_TYPE.LOAN_DISBURSE,
  TRANSACTION_TYPE.LOAN_REPAY,
];

const TRANSACTION_OVERSIGHT_STATUSES = [
  TRANSACTION_STATUS.PENDING_CONFIRMATION,
  TRANSACTION_STATUS.CONFIRMED,
  TRANSACTION_STATUS.REJECTED,
];

const DEPOSIT_BATCH_CONSOLE_STATUSES = [
  "pending_queue",
  DEPOSIT_BATCH_STATUS.SUBMITTED,
  DEPOSIT_BATCH_STATUS.CONFIRMED,
  DEPOSIT_BATCH_STATUS.FLAGGED,
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function formatRoleLabel(value) {
  return String(value || "unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function timestampToMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value._seconds === "number") return value._seconds * 1000;
  if (typeof value.seconds === "number") return value.seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateInput(rawValue, endOfDay = false) {
  const value = String(rawValue || "").trim();
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw httpsError("invalid-argument", "Dates must use YYYY-MM-DD format.");
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw httpsError("invalid-argument", "Invalid date filter supplied.");
  }

  if (endOfDay) {
    date.setUTCHours(23, 59, 59, 999);
  }

  return Timestamp.fromDate(date);
}

function validateRebateBands(rebateBands, durationDays) {
  if (rebateBands == null) return [];
  if (!Array.isArray(rebateBands)) {
    throw httpsError("invalid-argument", "loanPolicy.termPricing[].rebateBands must be an array.");
  }

  return rebateBands.map((band, index) => {
    const milestoneDay = Number(band?.milestoneDay);
    const rebatePct = Number(band?.rebatePct);
    if (!Number.isFinite(milestoneDay) || milestoneDay <= 0 || milestoneDay >= durationDays) {
      throw httpsError("invalid-argument", `loanPolicy.termPricing[${index}].rebateBands milestoneDay must be between 1 and ${durationDays - 1}.`);
    }
    if (!Number.isFinite(rebatePct) || rebatePct < 0 || rebatePct > 1) {
      throw httpsError("invalid-argument", `loanPolicy.termPricing[${index}].rebateBands rebatePct must be between 0 and 1.`);
    }
    return {
      milestoneDay,
      rebatePct,
      label: String(band?.label || "").trim() || null,
    };
  }).sort((a, b) => a.milestoneDay - b.milestoneDay);
}

function validateAndNormalizeLoanPolicyConfig(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpsError("invalid-argument", "loanPolicy must be an object.");
  }

  const termPricing = Array.isArray(input.termPricing) ? input.termPricing : DEFAULT_LOAN_POLICY_CONFIG.termPricing;
  const normalizedTermPricing = termPricing.map((term, index) => {
    const durationDays = Number(term?.durationDays);
    const contractedFeePct = Number(term?.contractedFeePct);
    const minimumFeeFloor = Math.max(0, Number(term?.minimumFeeFloor || 0));
    if (!SUPPORTED_LOAN_TERM_DURATIONS.includes(durationDays)) {
      throw httpsError("invalid-argument", `loanPolicy.termPricing[${index}].durationDays must be one of ${SUPPORTED_LOAN_TERM_DURATIONS.join(", ")}.`);
    }
    if (!Number.isFinite(contractedFeePct) || contractedFeePct < 0 || contractedFeePct > 1) {
      throw httpsError("invalid-argument", `loanPolicy.termPricing[${index}].contractedFeePct must be between 0 and 1.`);
    }
    return {
      durationDays,
      contractedFeePct,
      minimumFeeFloor,
      rebateBands: validateRebateBands(term?.rebateBands || [], durationDays),
      active: term?.active !== false,
    };
  }).sort((a, b) => a.durationDays - b.durationDays);

  const uniqueDurations = new Set(normalizedTermPricing.map((term) => term.durationDays));
  if (uniqueDurations.size !== SUPPORTED_LOAN_TERM_DURATIONS.length) {
    throw httpsError("invalid-argument", "loanPolicy.termPricing must define exactly one config for 7, 14, 21, and 30 days.");
  }

  const activeTermPricing = normalizedTermPricing.filter((term) => term.active !== false);
  for (let index = 1; index < activeTermPricing.length; index += 1) {
    const previous = activeTermPricing[index - 1];
    const current = activeTermPricing[index];
    if (current.contractedFeePct <= previous.contractedFeePct) {
      throw httpsError(
        "invalid-argument",
        `loanPolicy.termPricing must increase contractedFeePct as duration increases. ${current.durationDays} days must be priced higher than ${previous.durationDays} days.`
      );
    }
  }

  return {
    autoApproval: input.autoApproval !== false,
    maxLoanMultiplier: Number.isFinite(Number(input.maxLoanMultiplier)) ? Number(input.maxLoanMultiplier) : DEFAULT_LOAN_POLICY_CONFIG.maxLoanMultiplier,
    minLoanAmount: Number.isFinite(Number(input.minLoanAmount)) ? Number(input.minLoanAmount) : DEFAULT_LOAN_POLICY_CONFIG.minLoanAmount,
    maxLoanAmount: Number.isFinite(Number(input.maxLoanAmount)) ? Number(input.maxLoanAmount) : DEFAULT_LOAN_POLICY_CONFIG.maxLoanAmount,
    defaultTermDays: SUPPORTED_LOAN_TERM_DURATIONS.includes(Number(input.defaultTermDays))
      ? Number(input.defaultTermDays)
      : DEFAULT_LOAN_POLICY_CONFIG.defaultTermDays,
    earlySettlementRebateEnabled: input.earlySettlementRebateEnabled === true,
    rebateMode: input.earlySettlementRebateEnabled === true ? "milestone_bands" : "deferred",
    groupIncentiveSharePct: Number.isFinite(Number(input.groupIncentiveSharePct))
      ? Math.max(0, Math.min(1, Number(input.groupIncentiveSharePct)))
      : DEFAULT_LOAN_POLICY_CONFIG.groupIncentiveSharePct,
    termPricing: normalizedTermPricing,
  };
}

async function getDocumentsByIds(collectionName, ids) {
  const uniqueIds = [...new Set((ids || []).filter(Boolean))];
  if (!uniqueIds.length) return new Map();

  const refs = uniqueIds.map((id) => db.collection(collectionName).doc(id));
  const snaps = await db.getAll(...refs);
  return new Map(
    snaps
      .filter((snap) => snap.exists)
      .map((snap) => [snap.id, snap.data() || {}])
  );
}

function matchesQuery(fields, query) {
  const needle = normalizeText(query);
  if (!needle) return true;
  return fields.some((field) => normalizeText(field).includes(needle));
}

function deriveGroupRiskProfile(group, metrics) {
  const totalSavings = Number(group?.totalSavings || 0);
  const totalOutstandingLoans = Number(metrics?.totalOutstandingLoans || group?.totalLoansOutstanding || 0);
  const overdueLoanCount = Number(metrics?.overdueLoanCount || 0);
  const defaultedLoanCount = Number(metrics?.defaultedLoanCount || 0);
  const utilizationRatio = totalSavings > 0 ? totalOutstandingLoans / totalSavings : totalOutstandingLoans > 0 ? 1 : 0;
  const underReview = group?.reviewStatus === "under_review";

  if (group?.status === GROUP_STATUS.SUSPENDED) {
    return { badge: "Paused", tone: "slate", isHighRisk: false, utilizationRatio };
  }
  if (underReview) {
    return { badge: "Under review", tone: "amber", isHighRisk: true, utilizationRatio };
  }
  if (defaultedLoanCount > 0 || overdueLoanCount > 0 || utilizationRatio >= 0.75) {
    return { badge: "High risk", tone: "rose", isHighRisk: true, utilizationRatio };
  }
  if (totalOutstandingLoans > 0) {
    return { badge: "Loan exposure", tone: "sky", isHighRisk: false, utilizationRatio };
  }
  return { badge: "Stable", tone: "emerald", isHighRisk: false, utilizationRatio };
}

function formatDepositBatchStatus(status) {
  if (status === "pending_queue") return "Pending queue";
  if (status === DEPOSIT_BATCH_STATUS.SUBMITTED) return "Submitted";
  if (status === DEPOSIT_BATCH_STATUS.CONFIRMED) return "Confirmed";
  if (status === DEPOSIT_BATCH_STATUS.FLAGGED) return "Flagged";
  return "Unknown";
}

function buildDepositPendingQueueKey(groupId, agentId) {
  return `pending::${groupId || "unassigned"}::${agentId || "unassigned"}`;
}

function resolveDepositBatchInstitutionId(batch, group) {
  return batch?.institutionId || group?.institutionId || null;
}

function buildDepositBatchSummary(rows) {
  const nowMs = Date.now();
  let totalAmountInScope = 0;
  let pendingQueues = 0;
  let submittedBatches = 0;
  let confirmedBatches = 0;
  let flaggedBatches = 0;
  let oldestOpenAgeMs = null;
  let totalConfirmationLagMs = 0;
  let confirmationLagCount = 0;

  for (const row of rows) {
    totalAmountInScope += Number(row.amount || 0);
    if (row.status === "pending_queue") pendingQueues += 1;
    if (row.status === DEPOSIT_BATCH_STATUS.SUBMITTED) submittedBatches += 1;
    if (row.status === DEPOSIT_BATCH_STATUS.CONFIRMED) confirmedBatches += 1;
    if (row.status === DEPOSIT_BATCH_STATUS.FLAGGED) flaggedBatches += 1;

    if (row.status === DEPOSIT_BATCH_STATUS.CONFIRMED && Number.isFinite(row.confirmationLagMs)) {
      totalConfirmationLagMs += row.confirmationLagMs;
      confirmationLagCount += 1;
    }

    if (row.status !== DEPOSIT_BATCH_STATUS.CONFIRMED) {
      const anchorMs = row.status === "pending_queue"
        ? row.oldestPendingAtMs || row.createdAtMs
        : row.submittedAtMs || row.createdAtMs || row.flaggedAtMs;
      if (anchorMs) {
        const ageMs = Math.max(0, nowMs - anchorMs);
        oldestOpenAgeMs = oldestOpenAgeMs == null ? ageMs : Math.max(oldestOpenAgeMs, ageMs);
      }
    }
  }

  return {
    pendingQueues,
    submittedBatches,
    confirmedBatches,
    flaggedBatches,
    totalAmountInScope,
    averageConfirmationLagMs: confirmationLagCount > 0 ? Math.round(totalConfirmationLagMs / confirmationLagCount) : null,
    oldestOpenAgeMs,
  };
}

// ── System Configuration ──────────────────────────────────────────────────────

exports.getSystemConfig = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);

  const configId = String(data?.configId || "").trim();
  if (!VALID_CONFIG_IDS.includes(configId)) {
    throw httpsError(
      "invalid-argument",
      `configId must be one of: ${VALID_CONFIG_IDS.join(", ")}`
    );
  }

  const snap = await db.collection("systemConfig").doc(configId).get();
  const rawData = snap.exists ? snap.data() : null;
  let normalizedData = rawData;
  if (configId === "loanPolicy") {
    normalizedData = validateAndNormalizeLoanPolicyConfig(rawData || DEFAULT_LOAN_POLICY_CONFIG);
  } else if (configId === "fees") {
    normalizedData = normalizeAgentFeeConfig(rawData || null);
  } else if (configId === "commissionPolicy") {
    const feesSnap = await db.collection("systemConfig").doc("fees").get();
    normalizedData = normalizeCommissionPolicyConfig(
      rawData || null,
      normalizeAgentFeeConfig(feesSnap.exists ? feesSnap.data() : null)
    );
  }
  return { configId, data: normalizedData };
});

exports.updateSystemConfig = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const configId = String(data?.configId || "").trim();
  if (!VALID_CONFIG_IDS.includes(configId)) {
    throw httpsError(
      "invalid-argument",
      `configId must be one of: ${VALID_CONFIG_IDS.join(", ")}`
    );
  }

  const update = data?.data;
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    throw httpsError("invalid-argument", "data must be a non-array object.");
  }

  let normalizedUpdate = update;
  if (configId === "loanPolicy") {
    normalizedUpdate = validateAndNormalizeLoanPolicyConfig(update);
  } else if (configId === "fees") {
    normalizedUpdate = normalizeAgentFeeConfig(update);
  } else if (configId === "commissionPolicy") {
    const feesSnap = await db.collection("systemConfig").doc("fees").get();
    normalizedUpdate = normalizeCommissionPolicyConfig(
      update,
      normalizeAgentFeeConfig(feesSnap.exists ? feesSnap.data() : null)
    );
  }

  const ref = db.collection("systemConfig").doc(configId);
  const before = await ref.get();
  const beforeData = before.exists ? before.data() : null;

  const payload = { ...normalizedUpdate, updatedAt: FieldValue.serverTimestamp(), updatedBy: context.auth.uid };
  if (configId === "commissionPolicy") {
    payload.agentLoanCommissionRate = FieldValue.delete();
  }
  await ref.set(payload, { merge: true });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "config_updated",
    "systemConfig",
    configId,
    { before: beforeData, after: normalizedUpdate }
  );

  return { success: true };
});

exports.seedSystemConfig = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const seeds = {
    fees: normalizeAgentFeeConfig({}),
    loanPolicy: {
      ...DEFAULT_LOAN_POLICY_CONFIG,
    },
    commissionPolicy: normalizeCommissionPolicyConfig({}, normalizeAgentFeeConfig({})),
    businessRules: {
      minBalanceBIF: 5000,
      largeWithdrawalThresholdBIF: 50000,
      maxGroupSize: 30,
      groupSplitThreshold: 25,
    },
  };

  const seeded = [];
  for (const [configId, defaults] of Object.entries(seeds)) {
    const ref = db.collection("systemConfig").doc(configId);
    const snap = await ref.get();
    if (!snap.exists) {
      await ref.set({ ...defaults, updatedAt: FieldValue.serverTimestamp(), createdAt: FieldValue.serverTimestamp() });
      seeded.push(configId);
    }
  }

  if (seeded.length > 0) {
    await writeAuditLog(
      context.auth.uid,
      context.auth.token?.role,
      "config_seeded",
      "systemConfig",
      null,
      { seeded }
    );
  }

  return { seeded };
});

// ── User Suspension ───────────────────────────────────────────────────────────

exports.suspendUser = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const userId = String(data?.userId || "").trim();
  const reason = String(data?.reason || "").trim();
  if (!userId) throw httpsError("invalid-argument", "userId is required.");
  if (!reason) throw httpsError("invalid-argument", "reason is required.");

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw httpsError("not-found", "User not found.");

  const userData = userSnap.data();
  if (userData.role === ROLES.SUPER_ADMIN) {
    throw httpsError("permission-denied", "Cannot suspend a super_admin account.");
  }
  if (userData.status === USER_STATUS.SUSPENDED) {
    throw httpsError("failed-precondition", "User is already suspended.");
  }

  await db.collection("users").doc(userId).update({
    status: USER_STATUS.SUSPENDED,
    suspendedAt: FieldValue.serverTimestamp(),
    suspendedBy: context.auth.uid,
    suspendReason: reason,
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "user_suspended", "user", userId, { reason });
  return { success: true };
});

exports.reactivateUser = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const userId = String(data?.userId || "").trim();
  if (!userId) throw httpsError("invalid-argument", "userId is required.");

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw httpsError("not-found", "User not found.");

  await db.collection("users").doc(userId).update({
    status: USER_STATUS.ACTIVE,
    reactivatedAt: FieldValue.serverTimestamp(),
    reactivatedBy: context.auth.uid,
    suspendReason: FieldValue.delete(),
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "user_reactivated", "user", userId, {});
  return { success: true };
});

exports.getAgentsConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const filters = {
    status: String(data?.status || "").trim().toLowerCase(),
    institutionId: String(data?.institutionId || "").trim(),
    query: String(data?.query || "").trim(),
  };

  const [userSnap, agentSnap, institutionSnap, flaggedReconciliationSnap] = await Promise.all([
    db.collection("users").where("role", "==", ROLES.AGENT).get(),
    db.collection("agents").get(),
    db.collection("institutions").orderBy("name", "asc").get(),
    db.collection("agentReconciliations").where("status", "==", "flagged").get(),
  ]);

  const usersById = new Map(userSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const agentsById = new Map(agentSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const institutionsById = new Map(institutionSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const flaggedCounts = new Map();

  for (const doc of flaggedReconciliationSnap.docs) {
    const agentId = String(doc.data()?.agentId || "").trim();
    if (!agentId) continue;
    flaggedCounts.set(agentId, (flaggedCounts.get(agentId) || 0) + 1);
  }

  const agentIds = [...new Set([...usersById.keys(), ...agentsById.keys()])];

  const rows = agentIds
    .map((agentId) => {
      const user = usersById.get(agentId) || {};
      const agent = agentsById.get(agentId) || {};

      const userStatus = user.status || null;
      const agentStatus = agent.status || null;
      const status =
        userStatus === USER_STATUS.SUSPENDED || agentStatus === USER_STATUS.SUSPENDED
          ? USER_STATUS.SUSPENDED
          : userStatus || agentStatus || "unknown";
      const statusMismatch = Boolean(userStatus && agentStatus && userStatus !== agentStatus);

      const institutionId = user.institutionId || agent.institutionId || null;
      const institution = institutionId ? institutionsById.get(institutionId) : null;
      const flaggedReconciliationCount = flaggedCounts.get(agentId) || 0;
      const openIssues = flaggedReconciliationCount + (statusMismatch ? 1 : 0);
      const createdAt = user.createdAt || agent.createdAt || null;
      const updatedAt =
        user.updatedAt ||
        agent.updatedAt ||
        user.suspendedAt ||
        user.reactivatedAt ||
        createdAt;
      const createdAtMs = timestampToMillis(createdAt);
      const updatedAtMs = timestampToMillis(updatedAt) || createdAtMs;

      return {
        id: agentId,
        uid: agentId,
        fullName: user.fullName || agent.fullName || user.name || agent.name || null,
        phone: user.phone || agent.phone || null,
        email: user.email || agent.email || null,
        agentCode: user.agentCode || agent.agentCode || user.code || agent.code || null,
        status,
        userStatus,
        agentStatus,
        statusMismatch,
        institutionId,
        institutionName: institution?.name || null,
        createdAt,
        updatedAt,
        createdAtMs,
        updatedAtMs,
        notes: user.suspendReason || agent.notes || null,
        metrics: {
          flaggedReconciliationCount,
          openIssues,
        },
        availableActions: {
          canSuspend:
            [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role) &&
            status === USER_STATUS.ACTIVE &&
            !statusMismatch &&
            agentsById.has(agentId),
          canReactivate:
            [ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role) &&
            status === USER_STATUS.SUSPENDED &&
            !statusMismatch &&
            agentsById.has(agentId),
        },
      };
    })
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) =>
      matchesQuery(
        [
          row.fullName,
          row.phone,
          row.email,
          row.uid,
          row.agentCode,
          row.institutionName,
          row.institutionId,
        ],
        filters.query
      )
    )
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalAgents += 1;
      if (row.status === USER_STATUS.ACTIVE) acc.activeAgents += 1;
      if (row.status === USER_STATUS.SUSPENDED) acc.suspendedAgents += 1;
      if (row.institutionId) acc.institutionLinkedAgents += 1;
      if ((row.metrics?.openIssues || 0) > 0) acc.agentsWithOpenIssues += 1;
      return acc;
    },
    {
      totalAgents: 0,
      activeAgents: 0,
      suspendedAgents: 0,
      institutionLinkedAgents: 0,
      agentsWithOpenIssues: 0,
    }
  );

  return {
    role,
    summary,
    rows,
    filterOptions: {
      statuses: [...new Set(rows.map((row) => row.status || "unknown"))]
        .sort((a, b) => String(a).localeCompare(String(b)))
        .map((value) => ({ value, label: value })),
      institutions: [...new Map(
        rows
          .filter((row) => row.institutionId)
          .map((row) => [row.institutionId, { id: row.institutionId, name: row.institutionName || row.institutionId }])
      ).values()].sort((a, b) => String(a.name).localeCompare(String(b.name))),
    },
    backendSupport: {
      statusActionsSupported: true,
      openIssueSignals: ["flagged_reconciliations", "status_record_review"],
    },
  };
});

// ── Group Suspension ──────────────────────────────────────────────────────────

exports.suspendGroup = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const groupId = String(data?.groupId || "").trim();
  const reason = String(data?.reason || "").trim();
  if (!groupId) throw httpsError("invalid-argument", "groupId is required.");
  if (!reason) throw httpsError("invalid-argument", "reason is required.");

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) throw httpsError("not-found", "Group not found.");

  if (groupSnap.data().status === GROUP_STATUS.SUSPENDED) {
    throw httpsError("failed-precondition", "Group is already suspended.");
  }

  await db.collection("groups").doc(groupId).update({
    status: GROUP_STATUS.SUSPENDED,
    suspendedAt: FieldValue.serverTimestamp(),
    suspendedBy: context.auth.uid,
    suspendReason: reason,
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "group_suspended", "group", groupId, { reason });
  return { success: true };
});

exports.reactivateGroup = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const groupId = String(data?.groupId || "").trim();
  if (!groupId) throw httpsError("invalid-argument", "groupId is required.");

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) throw httpsError("not-found", "Group not found.");

  await db.collection("groups").doc(groupId).update({
    status: GROUP_STATUS.ACTIVE,
    reactivatedAt: FieldValue.serverTimestamp(),
    reactivatedBy: context.auth.uid,
    suspendReason: FieldValue.delete(),
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "group_reactivated", "group", groupId, {});
  return { success: true };
});

// ── Admin Management ──────────────────────────────────────────────────────────

exports.getAdmins = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  // Three separate single-equality queries to avoid composite index on role+createdAt
  const [superAdminSnap, adminSnap, financeSnap] = await Promise.all([
    db.collection("users").where("role", "==", ROLES.SUPER_ADMIN).get(),
    db.collection("users").where("role", "==", ROLES.ADMIN).get(),
    db.collection("users").where("role", "==", ROLES.FINANCE).get(),
  ]);

  const allDocs = [
    ...superAdminSnap.docs,
    ...adminSnap.docs,
    ...financeSnap.docs,
  ].map((doc) => {
    const d = doc.data();
    return {
      uid: doc.id,
      fullName: d.fullName || d.name || null,
      phone: d.phone || null,
      role: d.role,
      status: d.status,
      createdAt: d.createdAt || null,
      suspendedAt: d.suspendedAt || null,
      suspendReason: d.suspendReason || null,
    };
  });

  // Sort by createdAt descending (nulls last)
  allDocs.sort((a, b) => {
    const aMs = a.createdAt?.toMillis?.() ?? 0;
    const bMs = b.createdAt?.toMillis?.() ?? 0;
    return bMs - aMs;
  });

  return { admins: allDocs };
});

exports.suspendAdmin = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const userId = String(data?.userId || "").trim();
  const reason = String(data?.reason || "").trim();
  if (!userId) throw httpsError("invalid-argument", "userId is required.");
  if (!reason) throw httpsError("invalid-argument", "reason is required.");
  if (userId === context.auth.uid) {
    throw httpsError("failed-precondition", "Cannot suspend your own account.");
  }

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw httpsError("not-found", "User not found.");

  const userData = userSnap.data();
  if (userData.role === ROLES.SUPER_ADMIN) {
    throw httpsError("permission-denied", "Cannot suspend another super_admin.");
  }
  if (userData.status === USER_STATUS.SUSPENDED) {
    throw httpsError("failed-precondition", "Admin is already suspended.");
  }

  await db.collection("users").doc(userId).update({
    status: USER_STATUS.SUSPENDED,
    suspendedAt: FieldValue.serverTimestamp(),
    suspendedBy: context.auth.uid,
    suspendReason: reason,
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "admin_suspended", "admin", userId, { reason });
  return { success: true };
});

exports.reactivateAdmin = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const userId = String(data?.userId || "").trim();
  if (!userId) throw httpsError("invalid-argument", "userId is required.");

  const userSnap = await db.collection("users").doc(userId).get();
  if (!userSnap.exists) throw httpsError("not-found", "User not found.");

  await db.collection("users").doc(userId).update({
    status: USER_STATUS.ACTIVE,
    reactivatedAt: FieldValue.serverTimestamp(),
    reactivatedBy: context.auth.uid,
    suspendReason: FieldValue.delete(),
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "admin_reactivated", "admin", userId, {});
  return { success: true };
});

exports.getUsersRolesConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const filters = {
    role: String(data?.role || "").trim().toLowerCase(),
    status: String(data?.status || "").trim().toLowerCase(),
    institutionId: String(data?.institutionId || "").trim(),
    accountType: String(data?.accountType || "").trim().toLowerCase(),
    query: String(data?.query || "").trim(),
  };

  const userSnap = await db.collection("users").get();
  const users = userSnap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));

  const institutionIds = [...new Set(users.map((user) => user.institutionId).filter(Boolean))];
  const groupIds = [...new Set(users.map((user) => user.ledGroupId || user.groupId).filter(Boolean))];
  const [institutionMap, groupMap] = await Promise.all([
    getDocumentsByIds("institutions", institutionIds),
    getDocumentsByIds("groups", groupIds),
  ]);

  function resolveAccountType(userRole) {
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE].includes(userRole)) return "admin_access";
    if (userRole === ROLES.INSTITUTION_USER || userRole === ROLES.UMUCO) return "institution_access";
    if (userRole === ROLES.AGENT) return "field_access";
    if (userRole === ROLES.LEADER || userRole === ROLES.MEMBER) return "member_access";
    return "other_access";
  }

  function resolveRoleNote(user) {
    if (user.suspendReason) return user.suspendReason;
    if (user.role === ROLES.LEADER && (user.ledGroupId || user.groupId)) return "Group leadership access is linked to the assigned group record.";
    if (user.role === ROLES.INSTITUTION_USER || user.role === ROLES.UMUCO) return "Institution access is linked to the assigned partner institution.";
    if (user.role === ROLES.AGENT) return "Field operations access follows the assigned institution footprint.";
    if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE].includes(user.role)) return "Administrative access follows role-based console permissions.";
    return null;
  }

  const rows = users
    .map((user) => {
      const institutionId = user.institutionId || null;
      const institution = institutionId ? institutionMap.get(institutionId) : null;
      const primaryGroupId = user.ledGroupId || user.groupId || null;
      const group = primaryGroupId ? groupMap.get(primaryGroupId) : null;
      const accountType = resolveAccountType(user.role);
      const isAdminRole = [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE].includes(user.role);
      const isSuspendableAdmin = isAdminRole && user.role !== ROLES.SUPER_ADMIN && user.id !== context.auth.uid;
      const isSuspendableUser = !isAdminRole && user.role !== ROLES.SUPER_ADMIN;
      const canSuspend = role === ROLES.SUPER_ADMIN && user.status !== USER_STATUS.SUSPENDED && (isSuspendableAdmin || isSuspendableUser);
      const canReactivate = role === ROLES.SUPER_ADMIN && user.status === USER_STATUS.SUSPENDED && (user.role !== ROLES.SUPER_ADMIN) && (!isAdminRole || user.id !== context.auth.uid);

      return {
        id: user.id,
        fullName: user.fullName || user.name || null,
        email: user.email || null,
        phone: user.phone || null,
        role: user.role || null,
        roleLabel: formatRoleLabel(user.role || "unknown"),
        status: user.status || "unknown",
        accountType,
        accountTypeLabel: formatRoleLabel(accountType),
        institutionId,
        institutionName: institution?.name || null,
        groupId: primaryGroupId,
        groupName: group?.name || null,
        memberId: user.memberId || null,
        createdAt: user.createdAt || null,
        updatedAt: user.updatedAt || null,
        suspendedAt: user.suspendedAt || null,
        reactivatedAt: user.reactivatedAt || null,
        suspendReason: user.suspendReason || null,
        roleNote: resolveRoleNote(user),
        availableActions: {
          canSuspend,
          canReactivate,
          actionFamily: isAdminRole ? "admin" : "user",
        },
      };
    })
    .filter((row) => (filters.role ? row.role === filters.role : true))
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) => (filters.accountType ? row.accountType === filters.accountType : true))
    .filter((row) =>
      matchesQuery(
        [
          row.fullName,
          row.email,
          row.phone,
          row.id,
          row.role,
          row.institutionName,
          row.groupName,
          row.memberId,
        ],
        filters.query
      )
    )
    .sort((a, b) => {
      const aMs = timestampToMillis(a.updatedAt) || timestampToMillis(a.createdAt) || 0;
      const bMs = timestampToMillis(b.updatedAt) || timestampToMillis(b.createdAt) || 0;
      return bMs - aMs;
    });

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalUsers += 1;
      if (row.status === USER_STATUS.ACTIVE) acc.activeUsers += 1;
      if (row.status === USER_STATUS.SUSPENDED) acc.suspendedUsers += 1;
      if ([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE].includes(row.role)) acc.adminAccounts += 1;
      if (row.role === ROLES.INSTITUTION_USER || row.role === ROLES.UMUCO) acc.institutionUsers += 1;
      if (row.role === ROLES.AGENT) acc.agents += 1;
      if (row.role === ROLES.MEMBER || row.role === ROLES.LEADER) acc.membersAndLeaders += 1;
      return acc;
    },
    {
      totalUsers: 0,
      activeUsers: 0,
      suspendedUsers: 0,
      adminAccounts: 0,
      institutionUsers: 0,
      agents: 0,
      membersAndLeaders: 0,
    }
  );

  const filterOptions = {
    roles: [...new Map(
      users
        .filter((user) => user.role)
        .map((user) => [user.role, { value: user.role, label: formatRoleLabel(user.role) }])
    ).values()].sort((a, b) => String(a.label).localeCompare(String(b.label))),
    statuses: [...new Set(users.map((user) => user.status || "unknown"))]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((value) => ({ value, label: formatRoleLabel(value) })),
    accountTypes: [...new Map(
      users.map((user) => {
        const accountType = resolveAccountType(user.role);
        return [accountType, { value: accountType, label: formatRoleLabel(accountType) }];
      })
    ).values()].sort((a, b) => String(a.label).localeCompare(String(b.label))),
    institutions: [...new Map(
      rows
        .filter((row) => row.institutionId)
        .map((row) => [row.institutionId, { id: row.institutionId, name: row.institutionName || row.institutionId }])
    ).values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
  };

  return {
    role,
    summary,
    filterOptions,
    rows,
    backendSupport: {
      statusActionsSupported: role === ROLES.SUPER_ADMIN,
      actionScope: role === ROLES.SUPER_ADMIN ? "full_status_controls" : "read_only",
      missing: [
        "Role edits are not exposed from this module.",
        "User creation and invitation flows remain in their existing dedicated entry points.",
      ],
    },
  };
});

// ── Audit Log ─────────────────────────────────────────────────────────────────

exports.getAuditLog = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const filters = {
    targetType: String(data?.targetType || "").trim() || null,
    targetId: String(data?.targetId || "").trim() || null,
    actorId: String(data?.actorId || "").trim() || null,
    actionType: String(data?.actionType || "").trim() || null,
    category: String(data?.category || "").trim() || null,
    dateFrom: String(data?.dateFrom || "").trim() || null,
    dateTo: String(data?.dateTo || "").trim() || null,
    query: String(data?.query || "").trim() || null,
  };
  const limitNum = Math.min(Number(data?.limit) || 120, 250);

  const AUDIT_CATEGORY_LABELS = {
    institution_management: "Institution Management",
    user_provisioning: "User Provisioning",
    users_roles: "Users & Roles",
    agents: "Agents",
    pricing_rules: "Pricing & Rules",
    fund_management: "Fund Management",
    reconciliation_settlements: "Reconciliation & Settlements",
    groups: "Groups",
    governance: "Governance",
  };

  const ACTION_LABELS = {
    institution_created: "Institution created",
    institution_suspended: "Institution suspended",
    institution_reactivated: "Institution reactivated",
    user_invitation_created: "User invitation created",
    user_invitation_revoked: "User invitation revoked",
    user_invitation_reissued: "User invitation regenerated",
    user_invitation_accepted: "User invitation accepted",
    user_suspended: "User suspended",
    user_reactivated: "User reactivated",
    admin_suspended: "Admin suspended",
    admin_reactivated: "Admin reactivated",
    agent_suspended: "Agent suspended",
    agent_reactivated: "Agent reactivated",
    agent_assigned_to_group: "Agent assigned to group",
    config_updated: "Pricing or rules updated",
    config_seeded: "System config seeded",
    fund_seeded: "Fund initialized",
    fund_topup: "Fund topped up",
    fund_deduction: "Fund deducted",
    lending_paused: "Lending paused",
    lending_resumed: "Lending resumed",
    group_lending_paused: "Group lending paused",
    group_lending_resumed: "Group lending resumed",
    "reconciliation.update": "Reconciliation updated",
    "settlement.approve": "Settlement approved",
    "settlement.mark_paid": "Settlement marked paid",
  };

  function getAuditCategory(action, targetType) {
    if (String(action || "").startsWith("institution_")) return "institution_management";
    if (String(action || "").startsWith("user_invitation_")) return "user_provisioning";
    if (String(action || "").startsWith("agent_")) return "agents";
    if (action === "user_suspended" || action === "user_reactivated" || action === "admin_suspended" || action === "admin_reactivated") {
      return "users_roles";
    }
    if (action === "config_updated" || action === "config_seeded" || targetType === "systemConfig") return "pricing_rules";
    if (String(action || "").startsWith("fund_") || String(action || "").startsWith("lending_") || targetType === "kirimbaFund") {
      return "fund_management";
    }
    if (String(action || "").startsWith("reconciliation.") || String(action || "").startsWith("settlement.") ||
      targetType === "agentReconciliation" || targetType === "agentSettlement") {
      return "reconciliation_settlements";
    }
    if (String(action || "").startsWith("group_") || targetType === "group") return "groups";
    return "governance";
  }

  function getAuditSourceModule(category) {
    const labels = {
      institution_management: "Institutions",
      user_provisioning: "User Provisioning",
      users_roles: "Users & Roles",
      agents: "Agents",
      pricing_rules: "Pricing & Rules",
      fund_management: "Fund Management",
      reconciliation_settlements: "Reconciliation & Settlements",
      groups: "Groups",
      governance: "Governance",
    };
    return labels[category] || "Governance";
  }

  function getActionLabel(action) {
    return ACTION_LABELS[action] || formatRoleLabel(action || "unknown");
  }

  function buildTargetLabel(targetType, targetId, targetData, meta = {}) {
    if (targetType === "institution") {
      const name = targetData?.name || meta.name || null;
      const code = targetData?.code || meta.code || null;
      return {
        label: name || targetId || "Institution",
        reference: code || targetId || null,
      };
    }

    if (targetType === "user" || targetType === "admin" || targetType === "agent") {
      const name = targetData?.fullName || targetData?.name || meta.targetName || null;
      const phone = targetData?.phone || meta.targetPhone || null;
      return {
        label: name || targetId || "User",
        reference: phone || targetId || null,
      };
    }

    if (targetType === "group") {
      const name = targetData?.name || meta.groupName || null;
      const code = targetData?.groupCode || meta.groupCode || null;
      return {
        label: name || targetId || "Group",
        reference: code || targetId || null,
      };
    }

    if (targetType === "user_invitation") {
      return {
        label: targetData?.targetName || meta.targetName || targetId || "Invitation",
        reference: targetData?.inviteCode || meta.inviteCode || targetData?.targetPhone || meta.targetPhone || targetId || null,
      };
    }

    if (targetType === "systemConfig") {
      return {
        label: formatRoleLabel(targetId || "system_config"),
        reference: targetId || null,
      };
    }

    if (targetType === "kirimbaFund") {
      return {
        label: "Kirimba Fund",
        reference: targetId || "current",
      };
    }

    if (targetType === "agentReconciliation") {
      return {
        label: targetData?.agentName || meta.agentName || targetId || "Reconciliation",
        reference: targetData?.date || meta.date || targetId || null,
      };
    }

    if (targetType === "agentSettlement") {
      return {
        label: targetData?.agentName || meta.agentName || targetId || "Settlement",
        reference: targetData?.settlementRef || meta.settlementRef || targetId || null,
      };
    }

    if (targetType === "loan") {
      return {
        label: targetData?.loanNumber || targetData?.memberName || targetId || "Loan",
        reference: targetId || null,
      };
    }

    return {
      label: targetId || formatRoleLabel(targetType || "record"),
      reference: targetId || null,
    };
  }

  function buildAuditSummary(action, targetType, targetInfo, meta = {}) {
    switch (action) {
      case "institution_created":
        return `Created institution ${targetInfo.label}${targetInfo.reference ? ` (${targetInfo.reference})` : ""}.`;
      case "institution_suspended":
        return meta.reason ? `Suspended institution. Reason: ${meta.reason}.` : "Suspended institution.";
      case "institution_reactivated":
        return "Reactivated institution access.";
      case "user_invitation_created":
        return `Created ${formatRoleLabel(meta.role || "user")} invitation${meta.targetPhone ? ` for ${meta.targetPhone}` : ""}.`;
      case "user_invitation_revoked":
        return "Revoked a pending invitation.";
      case "user_invitation_reissued":
        return "Regenerated invitation link and code.";
      case "user_invitation_accepted":
        return `Invitation accepted${meta.acceptedUserId ? ` by ${meta.acceptedUserId}` : ""}.`;
      case "user_suspended":
      case "admin_suspended":
      case "agent_suspended":
        return meta.reason ? `Suspended account. Reason: ${meta.reason}.` : "Suspended account.";
      case "user_reactivated":
      case "admin_reactivated":
      case "agent_reactivated":
        return "Reactivated account access.";
      case "agent_assigned_to_group":
        return meta.groupId ? `Assigned agent to group ${meta.groupId}.` : "Assigned agent to a group.";
      case "config_updated":
        return `Updated ${formatRoleLabel(targetInfo.reference || "system config")}.`;
      case "fund_seeded":
        return meta.initialCapital != null ? `Initialized fund with ${Number(meta.initialCapital).toLocaleString("en-US")} BIF.` : "Initialized fund.";
      case "fund_topup":
        return meta.amount != null ? `Added ${Number(meta.amount).toLocaleString("en-US")} BIF to the fund.` : "Topped up fund.";
      case "fund_deduction":
        return meta.amount != null ? `Deducted ${Number(meta.amount).toLocaleString("en-US")} BIF from the fund.` : "Deducted from fund.";
      case "lending_paused":
        return meta.reason ? `Paused lending. Reason: ${meta.reason}.` : "Paused lending.";
      case "lending_resumed":
        return "Resumed lending.";
      case "group_lending_paused":
        return meta.reason ? `Paused group lending. Reason: ${meta.reason}.` : "Paused group lending.";
      case "group_lending_resumed":
        return "Resumed group lending.";
      case "reconciliation.update":
        return `Updated reconciliation status${meta?.after?.status ? ` to ${meta.after.status}` : ""}.`;
      case "settlement.approve":
        return "Approved settlement for payout.";
      case "settlement.mark_paid":
        return "Marked settlement as paid.";
      default:
        if (meta.note) return String(meta.note);
        if (meta.notes) return String(meta.notes);
        if (meta.reason) return `Reason: ${meta.reason}`;
        return `${getActionLabel(action)} on ${formatRoleLabel(targetType || "record")}.`;
    }
  }

  let q = db.collection("auditLog").orderBy("createdAt", "desc").limit(limitNum);
  if (filters.targetType) {
    q = db.collection("auditLog")
      .where("targetType", "==", filters.targetType)
      .orderBy("createdAt", "desc")
      .limit(limitNum);
  } else if (filters.actorId) {
    q = db.collection("auditLog")
      .where("actorId", "==", filters.actorId)
      .orderBy("createdAt", "desc")
      .limit(limitNum);
  }

  const snap = await q.get();
  const rawEntries = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  const actorIds = rawEntries.map((entry) => entry.actorId).filter(Boolean);
  const institutionIds = rawEntries.filter((entry) => entry.targetType === "institution").map((entry) => entry.targetId);
  const userTargetIds = rawEntries.filter((entry) => ["user", "admin", "agent"].includes(entry.targetType)).map((entry) => entry.targetId);
  const groupIds = rawEntries.filter((entry) => entry.targetType === "group").map((entry) => entry.targetId);
  const invitationIds = rawEntries.filter((entry) => entry.targetType === "user_invitation").map((entry) => entry.targetId);
  const configIds = rawEntries.filter((entry) => entry.targetType === "systemConfig").map((entry) => entry.targetId);
  const reconciliationIds = rawEntries.filter((entry) => entry.targetType === "agentReconciliation").map((entry) => entry.targetId);
  const settlementIds = rawEntries.filter((entry) => entry.targetType === "agentSettlement").map((entry) => entry.targetId);
  const loanIds = rawEntries.filter((entry) => entry.targetType === "loan").map((entry) => entry.targetId);

  const [
    actorMap,
    institutionMap,
    userTargetMap,
    groupMap,
    invitationMap,
    configMap,
    reconciliationMap,
    settlementMap,
    loanMap,
  ] = await Promise.all([
    getDocumentsByIds("users", actorIds),
    getDocumentsByIds("institutions", institutionIds),
    getDocumentsByIds("users", userTargetIds),
    getDocumentsByIds("groups", groupIds),
    getDocumentsByIds("userInvitations", invitationIds),
    getDocumentsByIds("systemConfig", configIds),
    getDocumentsByIds("agentReconciliations", reconciliationIds),
    getDocumentsByIds("agentSettlements", settlementIds),
    getDocumentsByIds("loans", loanIds),
  ]);

  const enrichedEntries = rawEntries.map((entry) => {
    const category = getAuditCategory(entry.action, entry.targetType);
    const actorData = entry.actorId ? actorMap.get(entry.actorId) : null;
    const targetMaps = {
      institution: institutionMap,
      user: userTargetMap,
      admin: userTargetMap,
      agent: userTargetMap,
      group: groupMap,
      user_invitation: invitationMap,
      systemConfig: configMap,
      agentReconciliation: reconciliationMap,
      agentSettlement: settlementMap,
      loan: loanMap,
    };
    const targetData = entry.targetId && targetMaps[entry.targetType]
      ? targetMaps[entry.targetType].get(entry.targetId)
      : null;
    const targetInfo = buildTargetLabel(entry.targetType, entry.targetId, targetData, entry.meta || {});
    const createdAtMs = timestampToMillis(entry.createdAt);
    const actorName = actorData?.fullName || actorData?.name || null;

    return {
      id: entry.id,
      createdAt: entry.createdAt || null,
      createdAtMs,
      action: entry.action || null,
      actionLabel: getActionLabel(entry.action),
      category,
      categoryLabel: AUDIT_CATEGORY_LABELS[category] || "Governance",
      sourceModule: getAuditSourceModule(category),
      actorId: entry.actorId || null,
      actorRole: entry.actorRole || actorData?.role || null,
      actorName,
      actorLabel: actorName || entry.actorId || "System",
      targetType: entry.targetType || null,
      targetId: entry.targetId || null,
      targetLabel: targetInfo.label,
      targetReference: targetInfo.reference,
      summary: buildAuditSummary(entry.action, entry.targetType, targetInfo, entry.meta || {}),
      meta: entry.meta || {},
    };
  });

  const dateFromMs = toDateRangeStartMs(filters.dateFrom);
  const dateToMs = toDateRangeEndMs(filters.dateTo);
  const entries = enrichedEntries
    .filter((entry) => (filters.targetType ? entry.targetType === filters.targetType : true))
    .filter((entry) => (filters.targetId ? entry.targetId === filters.targetId : true))
    .filter((entry) => (filters.actorId ? entry.actorId === filters.actorId : true))
    .filter((entry) => (filters.actionType ? entry.action === filters.actionType : true))
    .filter((entry) => (filters.category ? entry.category === filters.category : true))
    .filter((entry) => (dateFromMs != null ? (entry.createdAtMs || 0) >= dateFromMs : true))
    .filter((entry) => (dateToMs != null ? (entry.createdAtMs || 0) <= dateToMs : true))
    .filter((entry) =>
      matchesQuery(
        [
          entry.actorLabel,
          entry.actorId,
          entry.action,
          entry.actionLabel,
          entry.targetType,
          entry.targetId,
          entry.targetLabel,
          entry.targetReference,
          entry.summary,
          entry.sourceModule,
          JSON.stringify(entry.meta || {}),
        ],
        filters.query
      )
    );

  function toOptions(values, labelBuilder = (value) => value) {
    return [...values.entries()]
      .map(([value, count]) => ({ value, label: labelBuilder(value), count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  const categoryCounts = new Map();
  const actionCounts = new Map();
  const actorCounts = new Map();
  const targetTypeCounts = new Map();
  for (const entry of enrichedEntries) {
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) || 0) + 1);
    actionCounts.set(entry.action, (actionCounts.get(entry.action) || 0) + 1);
    if (entry.actorId) actorCounts.set(entry.actorId, (actorCounts.get(entry.actorId) || 0) + 1);
    if (entry.targetType) targetTypeCounts.set(entry.targetType, (targetTypeCounts.get(entry.targetType) || 0) + 1);
  }

  return {
    entries,
    filterOptions: {
      categories: toOptions(categoryCounts, (value) => AUDIT_CATEGORY_LABELS[value] || formatRoleLabel(value)),
      actionTypes: toOptions(actionCounts, (value) => getActionLabel(value)),
      actors: toOptions(actorCounts, (value) => {
        const actor = actorMap.get(value);
        return actor?.fullName || actor?.name || value;
      }),
      targetTypes: toOptions(targetTypeCounts, (value) => formatRoleLabel(value)),
    },
    summary: {
      scannedEntries: enrichedEntries.length,
      visibleEntries: entries.length,
    },
    appliedFilters: filters,
  };
});

// ── Institution Management ────────────────────────────────────────────────────

function serializeInstitution(doc) {
  const d = doc.data();
  return {
    id: doc.id,
    name: d.name || null,
    code: d.code || null,
    status: d.status || "active",
    institutionType: d.institutionType || null,
    contactName: d.contactName || null,
    contactEmail: d.contactEmail || null,
    contactPhone: d.contactPhone || null,
    country: d.country || null,
    currency: d.currency || null,
    supportsDeposits: d.supportsDeposits !== false,   // default true if absent
    supportsWithdrawals: d.supportsWithdrawals !== false, // default true if absent
    supportsLoans: d.supportsLoans === true,           // default false if absent
    settlementReferencePrefix: d.settlementReferencePrefix || null,
    notes: d.notes || null,
    createdAt: d.createdAt || null,
    updatedAt: d.updatedAt || null,
    suspendedAt: d.suspendedAt || null,
    suspendReason: d.suspendReason || null,
    isBackfilled: d.isBackfilled || false,
  };
}

exports.getInstitutionsConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN]);

  const filters = {
    status: String(data?.status || "").trim().toLowerCase(),
    institutionType: String(data?.institutionType || "").trim().toLowerCase(),
    country: String(data?.country || "").trim().toUpperCase(),
    query: String(data?.query || "").trim(),
  };

  const [
    institutionSnap,
    groupSnap,
    agentSnap,
    institutionUserSnap,
    flaggedBatchSnap,
    flaggedReconciliationSnap,
  ] = await Promise.all([
    db.collection("institutions").orderBy("createdAt", "desc").get(),
    db.collection("groups").get(),
    db.collection("users").where("role", "==", ROLES.AGENT).get(),
    db.collection("users").where("role", "in", [ROLES.INSTITUTION_USER, ROLES.UMUCO]).get(),
    db.collection("depositBatches").where("status", "==", DEPOSIT_BATCH_STATUS.FLAGGED).get(),
    db.collection("agentReconciliations").where("status", "==", "flagged").get(),
  ]);

  const institutions = institutionSnap.docs.map((doc) => serializeInstitution(doc));
  const groupMap = new Map(groupSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const agentMap = new Map(agentSnap.docs.map((doc) => [doc.id, doc.data() || {}]));
  const metricsByInstitutionId = new Map();

  function getMetrics(institutionId) {
    if (!institutionId) return null;
    if (!metricsByInstitutionId.has(institutionId)) {
      metricsByInstitutionId.set(institutionId, {
        groupCount: 0,
        activeGroupCount: 0,
        suspendedGroupCount: 0,
        agentCount: 0,
        suspendedAgentCount: 0,
        institutionUserCount: 0,
        suspendedInstitutionUserCount: 0,
        flaggedBatchCount: 0,
        flaggedReconciliationCount: 0,
      });
    }
    return metricsByInstitutionId.get(institutionId);
  }

  for (const doc of groupSnap.docs) {
    const row = doc.data() || {};
    const metrics = getMetrics(row.institutionId || null);
    if (!metrics) continue;
    metrics.groupCount += 1;
    if (row.status === GROUP_STATUS.SUSPENDED) metrics.suspendedGroupCount += 1;
    else metrics.activeGroupCount += 1;
  }

  for (const doc of agentSnap.docs) {
    const row = doc.data() || {};
    const metrics = getMetrics(row.institutionId || null);
    if (!metrics) continue;
    metrics.agentCount += 1;
    if (row.status === USER_STATUS.SUSPENDED) metrics.suspendedAgentCount += 1;
  }

  for (const doc of institutionUserSnap.docs) {
    const row = doc.data() || {};
    const metrics = getMetrics(row.institutionId || null);
    if (!metrics) continue;
    metrics.institutionUserCount += 1;
    if (row.status === USER_STATUS.SUSPENDED) metrics.suspendedInstitutionUserCount += 1;
  }

  for (const doc of flaggedBatchSnap.docs) {
    const row = doc.data() || {};
    const group = row.groupId ? groupMap.get(row.groupId) : null;
    const metrics = getMetrics(row.institutionId || group?.institutionId || null);
    if (!metrics) continue;
    metrics.flaggedBatchCount += 1;
  }

  for (const doc of flaggedReconciliationSnap.docs) {
    const row = doc.data() || {};
    const agent = row.agentId ? agentMap.get(row.agentId) : null;
    const metrics = getMetrics(agent?.institutionId || null);
    if (!metrics) continue;
    metrics.flaggedReconciliationCount += 1;
  }

  const rows = institutions
    .map((institution) => {
      const metrics = metricsByInstitutionId.get(institution.id) || {
        groupCount: 0,
        activeGroupCount: 0,
        suspendedGroupCount: 0,
        agentCount: 0,
        suspendedAgentCount: 0,
        institutionUserCount: 0,
        suspendedInstitutionUserCount: 0,
        flaggedBatchCount: 0,
        flaggedReconciliationCount: 0,
      };
      const openOperationalIssues =
        metrics.suspendedGroupCount +
        metrics.suspendedAgentCount +
        metrics.suspendedInstitutionUserCount +
        metrics.flaggedBatchCount +
        metrics.flaggedReconciliationCount;
      const createdAtMs = timestampToMillis(institution.createdAt);
      const updatedAtMs =
        timestampToMillis(institution.updatedAt) ||
        timestampToMillis(institution.suspendedAt) ||
        createdAtMs;
      const pendingState = ["pending", "onboarding"].includes(String(institution.status || "").toLowerCase());

      return {
        ...institution,
        createdAtMs,
        updatedAtMs,
        metrics: {
          ...metrics,
          openOperationalIssues,
        },
        availableActions: {
          canSuspend: role === ROLES.SUPER_ADMIN && institution.status === "active",
          canReactivate: role === ROLES.SUPER_ADMIN && institution.status === "suspended",
        },
        pendingState,
      };
    })
    .filter((row) => (filters.status ? normalizeText(row.status) === filters.status : true))
    .filter((row) => (filters.institutionType ? normalizeText(row.institutionType) === filters.institutionType : true))
    .filter((row) => (filters.country ? String(row.country || "").toUpperCase() === filters.country : true))
    .filter((row) =>
      matchesQuery(
        [
          row.name,
          row.code,
          row.id,
          row.institutionType,
          row.country,
          row.currency,
          row.contactName,
          row.contactEmail,
          row.contactPhone,
          row.notes,
        ],
        filters.query
      )
    )
    .sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalInstitutions += 1;
      if (row.status === "active") acc.activeInstitutions += 1;
      if (row.status === "suspended") acc.suspendedInstitutions += 1;
      if (row.pendingState) acc.pendingInstitutions += 1;
      if ((row.metrics?.openOperationalIssues || 0) > 0) acc.institutionsWithOpenOperationalIssues += 1;
      return acc;
    },
    {
      totalInstitutions: 0,
      activeInstitutions: 0,
      suspendedInstitutions: 0,
      pendingInstitutions: 0,
      institutionsWithOpenOperationalIssues: 0,
    }
  );

  const filterOptions = {
    statuses: [...new Set(institutions.map((row) => row.status || "active"))]
      .sort((a, b) => String(a).localeCompare(String(b)))
      .map((value) => ({ value, label: value })),
    institutionTypes: [...new Map(
      institutions
        .filter((row) => row.institutionType)
        .map((row) => [normalizeText(row.institutionType), { value: normalizeText(row.institutionType), label: row.institutionType }])
    ).values()].sort((a, b) => String(a.label).localeCompare(String(b.label))),
    countries: [...new Map(
      institutions
        .filter((row) => row.country)
        .map((row) => [String(row.country).toUpperCase(), { value: String(row.country).toUpperCase(), label: String(row.country).toUpperCase() }])
    ).values()].sort((a, b) => String(a.label).localeCompare(String(b.label))),
  };

  return {
    role,
    summary,
    filterOptions,
    rows,
    backendSupport: {
      statusActionsSupported: true,
      createSupported: true,
      pendingStateSupported: summary.pendingInstitutions > 0,
      linkedOperationalMetrics: [
        "groups",
        "agents",
        "institution_users",
        "flagged_deposit_batches",
        "flagged_reconciliations",
      ],
      missing: [
        "No dedicated institution detail callable exists because the console payload already includes the current institution metadata and linked counts.",
        "No backend source currently exposes a distinct onboarding workflow state unless an institution document already uses a status like pending or onboarding.",
        "Institution-linked deep links for filtered groups or agents are not yet wired from this module.",
      ],
    },
  };
});

exports.getInstitutions = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);

  const snap = await db.collection("institutions").orderBy("createdAt", "desc").get();
  return { institutions: snap.docs.map(serializeInstitution) };
});

exports.createInstitution = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const name = String(data?.name || "").trim();
  const code = String(data?.code || "").trim().toUpperCase();

  if (!name || name.length < 3 || name.length > 100) {
    throw httpsError("invalid-argument", "name must be 3–100 characters.");
  }
  if (!code || code.length < 2 || code.length > 20) {
    throw httpsError("invalid-argument", "code must be 2–20 characters.");
  }

  const existing = await db.collection("institutions").where("code", "==", code).limit(1).get();
  if (!existing.empty) {
    throw httpsError("already-exists", `Institution code "${code}" is already taken.`);
  }

  const ref = db.collection("institutions").doc();
  await ref.set({
    name,
    code,
    status: "active",
    institutionType: String(data?.institutionType || "").trim() || null,
    contactName: String(data?.contactName || "").trim() || null,
    contactEmail: String(data?.contactEmail || "").trim() || null,
    contactPhone: String(data?.contactPhone || "").trim() || null,
    country: String(data?.country || "").trim() || "BI",
    currency: String(data?.currency || "").trim().toUpperCase() || "BIF",
    supportsDeposits: data?.supportsDeposits !== false,
    supportsWithdrawals: data?.supportsWithdrawals !== false,
    supportsLoans: data?.supportsLoans === true,
    settlementReferencePrefix: String(data?.settlementReferencePrefix || "").trim().toUpperCase() || null,
    notes: String(data?.notes || "").trim() || null,
    createdAt: FieldValue.serverTimestamp(),
    createdBy: context.auth.uid,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "institution_created",
    "institution",
    ref.id,
    { name, code }
  );

  return { institutionId: ref.id };
});

exports.suspendInstitution = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const institutionId = String(data?.institutionId || "").trim();
  const reason = String(data?.reason || "").trim();
  if (!institutionId) throw httpsError("invalid-argument", "institutionId is required.");
  if (!reason) throw httpsError("invalid-argument", "reason is required.");

  const snap = await db.collection("institutions").doc(institutionId).get();
  if (!snap.exists) throw httpsError("not-found", "Institution not found.");

  await db.collection("institutions").doc(institutionId).update({
    status: "suspended",
    suspendedAt: FieldValue.serverTimestamp(),
    suspendedBy: context.auth.uid,
    suspendReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "institution_suspended", "institution", institutionId, { reason });
  return { success: true };
});

exports.reactivateInstitution = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const institutionId = String(data?.institutionId || "").trim();
  if (!institutionId) throw httpsError("invalid-argument", "institutionId is required.");

  const snap = await db.collection("institutions").doc(institutionId).get();
  if (!snap.exists) throw httpsError("not-found", "Institution not found.");

  await db.collection("institutions").doc(institutionId).update({
    status: "active",
    reactivatedAt: FieldValue.serverTimestamp(),
    reactivatedBy: context.auth.uid,
    suspendReason: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  });

  await writeAuditLog(context.auth.uid, context.auth.token?.role, "institution_reactivated", "institution", institutionId, {});
  return { success: true };
});

// Idempotent repair: creates institutions/umuco if absent, patches missing fields if present.
// Safe to run multiple times — never overwrites fields that already have non-null values.
exports.backfillUmucoInstitution = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const ref = db.collection("institutions").doc("umuco");
  const snap = await ref.get();

  const UMUCO_DEFAULTS = {
    name: "Umuco",
    code: "UMUCO",
    status: "active",
    institutionType: "microfinance",
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    country: "BI",
    currency: "BIF",
    supportsDeposits: true,
    supportsWithdrawals: true,
    supportsLoans: false,
    settlementReferencePrefix: "UMC",
    notes: "Kirimba partner microfinance institution",
    isBackfilled: true,
  };

  if (!snap.exists) {
    await ref.set({
      ...UMUCO_DEFAULTS,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: context.auth.uid,
      updatedAt: FieldValue.serverTimestamp(),
      updatedBy: context.auth.uid,
      backfilledAt: FieldValue.serverTimestamp(),
    });
    await writeAuditLog(context.auth.uid, context.auth.token?.role, "institution_backfilled", "institution", "umuco", { action: "created" });
    return { success: true, institutionId: "umuco", action: "created" };
  }

  // Doc already exists — patch only fields that are missing or null
  const existing = snap.data();
  const patch = { updatedAt: FieldValue.serverTimestamp(), updatedBy: context.auth.uid };
  const patchedFields = [];

  for (const [key, defaultVal] of Object.entries(UMUCO_DEFAULTS)) {
    if (existing[key] === undefined || existing[key] === null) {
      patch[key] = defaultVal;
      patchedFields.push(key);
    }
  }

  await ref.set(patch, { merge: true });
  await writeAuditLog(context.auth.uid, context.auth.token?.role, "institution_repaired", "institution", "umuco", { patchedFields });
  return { success: true, institutionId: "umuco", action: "patched", patchedFields };
});

// ── Institution Role Migration ────────────────────────────────────────────────

/**
 * One-time migration: upgrade all users with role "umuco" to role "institution_user".
 * Reads each user's institutionId from Firestore, updates both the Firestore doc
 * and the Firebase Auth custom claims.
 * Safe to call multiple times — already-migrated users are skipped.
 */
exports.migrateInstitutionUserRoles = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const auth = admin.auth();
  const snap = await db.collection("users").where("role", "==", ROLES.UMUCO).get();

  if (snap.empty) {
    return { migratedCount: 0, skippedCount: 0, errors: [], message: "No legacy umuco users found." };
  }

  const migrated = [];
  const skipped = [];
  const errors = [];

  for (const userDoc of snap.docs) {
    const uid = userDoc.id;
    const userData = userDoc.data();
    const institutionId = userData.institutionId || "umuco";

    try {
      // Update Firestore role
      await db.collection("users").doc(uid).update({
        role: ROLES.INSTITUTION_USER,
        updatedAt: FieldValue.serverTimestamp(),
      });

      // Update Firebase Auth custom claims to include institutionId
      await auth.setCustomUserClaims(uid, {
        role: ROLES.INSTITUTION_USER,
        institutionId,
      });

      migrated.push({ uid, institutionId });
    } catch (err) {
      errors.push({ uid, error: err.message });
    }
  }

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "institution_role_migration",
    "users",
    null,
    { migratedCount: migrated.length, migrated, errors }
  );

  return {
    migratedCount: migrated.length,
    skippedCount: skipped.length,
    errors,
    migrated,
    message: `Migrated ${migrated.length} users from "umuco" to "institution_user".`,
  };
});

// ── Aggregate Dashboards ──────────────────────────────────────────────────────

exports.getExecutiveSummary = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const [
    activeMembersSnap,
    activeGroupsSnap,
    pendingMembersSnap,
    pendingGroupsSnap,
    fundSnap,
    activeLoansSnap,
    defaultedLoansSnap,
    flaggedBatchSnap,
    submittedBatchSnap,
    activeAgentsSnap,
    activeInstitutionsSnap,
  ] = await Promise.all([
    db.collection("users").where("role", "==", ROLES.MEMBER).where("status", "==", USER_STATUS.ACTIVE).get(),
    db.collection("groups").where("status", "==", GROUP_STATUS.ACTIVE).get(),
    db.collection("users").where("status", "==", USER_STATUS.PENDING_APPROVAL).get(),
    db.collection("groups").where("status", "==", GROUP_STATUS.PENDING_APPROVAL).get(),
    db.collection("kirimbaFund").doc("current").get(),
    db.collection("loans").where("status", "==", "active").get(),
    db.collection("loans").where("status", "==", "defaulted").get(),
    db.collection("depositBatches").where("status", "==", "flagged").get(),
    db.collection("depositBatches").where("status", "==", "submitted").get(),
    db.collection("users").where("role", "==", ROLES.AGENT).where("status", "==", USER_STATUS.ACTIVE).get(),
    db.collection("institutions").where("status", "==", "active").get(),
  ]);

  const fund = fundSnap.exists ? fundSnap.data() : { totalCollateral: 0, availableFund: 0, deployedFund: 0 };

  return {
    summary: {
      activeMemberCount: activeMembersSnap.size,
      activeGroupCount: activeGroupsSnap.size,
      activeAgentCount: activeAgentsSnap.size,
      activeInstitutionCount: activeInstitutionsSnap.size,
      pendingApprovals: pendingMembersSnap.size + pendingGroupsSnap.size,
      fund: {
        totalCollateral: fund.totalCollateral || 0,
        availableFund: fund.availableFund || 0,
        deployedFund: fund.deployedFund || 0,
        lendingPaused: fund.lendingPaused === true,
      },
      activeLoansCount: activeLoansSnap.size,
      defaultedLoansCount: defaultedLoansSnap.size,
      flaggedBatchCount: flaggedBatchSnap.size,
      submittedBatchCount: submittedBatchSnap.size,
    },
  };
});

exports.getAdminDashboardSummary = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);

  const [
    activeMembersSnap,
    activeGroupsSnap,
    activeAgentsSnap,
    activeInstitutionsSnap,
    pendingMembersSnap,
    pendingGroupsSnap,
    loansSnap,
    pendingDepositSnap,
    submittedBatchSnap,
    flaggedBatchSnap,
    reconciliationSnap,
    settlementsSnap,
    fundSnap,
  ] = await Promise.all([
    db.collection("users").where("role", "==", ROLES.MEMBER).where("status", "==", USER_STATUS.ACTIVE).get(),
    db.collection("groups").where("status", "==", GROUP_STATUS.ACTIVE).get(),
    db.collection("users").where("role", "==", ROLES.AGENT).where("status", "==", USER_STATUS.ACTIVE).get(),
    db.collection("institutions").where("status", "==", "active").get(),
    role === ROLES.FINANCE
      ? Promise.resolve({ size: 0 })
      : db.collection("users").where("status", "==", USER_STATUS.PENDING_APPROVAL).get(),
    role === ROLES.FINANCE
      ? Promise.resolve({ size: 0 })
      : db.collection("groups").where("status", "==", GROUP_STATUS.PENDING_APPROVAL).get(),
    db.collection("loans").get(),
    db.collection("transactions")
      .where("type", "==", "deposit")
      .where("status", "==", "pending_confirmation")
      .get(),
    db.collection("depositBatches").where("status", "==", "submitted").get(),
    role === ROLES.FINANCE
      ? Promise.resolve({ size: 0, docs: [] })
      : db.collection("depositBatches").where("status", "==", "flagged").get(),
    db.collection("agentReconciliations").get(),
    db.collection("agentSettlements").get(),
    db.collection("kirimbaFund").doc("current").get(),
  ]);

  const nowMs = Date.now();
  const activeGroups = activeGroupsSnap.docs.map((doc) => doc.data() || {});
  const confirmedSavings = activeGroups.reduce((sum, group) => sum + Number(group.totalSavings || 0), 0);
  const activeGroupLoansOutstanding = activeGroups.reduce(
    (sum, group) => sum + Number(group.totalLoansOutstanding || 0),
    0
  );

  const pendingSavingsAmount = pendingDepositSnap.docs.reduce(
    (sum, doc) => sum + Number(doc.data()?.amount || 0),
    0
  );

  let outstandingLoansAmount = 0;
  let overdueLoansCount = 0;
  let overdueLoansAmount = 0;
  let defaultedLoansCount = 0;
  let defaultedLoansAmount = 0;
  let totalLoanCount = 0;
  let activeLoanCount = 0;

  for (const doc of loansSnap.docs) {
    const loan = doc.data() || {};
    totalLoanCount += 1;
    const status = loan.status || "pending";
    const amount = Number(loan.amount || 0);
    const remainingDue = Number(loan.remainingDue || 0);
    const dueMs = loan.dueDate?.toMillis?.() || null;

    if (status === "active") {
      activeLoanCount += 1;
      outstandingLoansAmount += remainingDue;
      if (dueMs && dueMs < nowMs && remainingDue > 0) {
        overdueLoansCount += 1;
        overdueLoansAmount += remainingDue;
      }
    }

    if (status === "defaulted") {
      defaultedLoansCount += 1;
      defaultedLoansAmount += remainingDue > 0 ? remainingDue : amount;
    }
  }

  const submittedBatchAmount = submittedBatchSnap.docs.reduce(
    (sum, doc) => sum + Number(doc.data()?.totalAmount || 0),
    0
  );
  const flaggedBatchAmount = flaggedBatchSnap.docs.reduce(
    (sum, doc) => sum + Number(doc.data()?.totalAmount || 0),
    0
  );

  let pendingReconciliationCount = 0;
  let flaggedReconciliationCount = 0;
  for (const doc of reconciliationSnap.docs) {
    const status = doc.data()?.status || "submitted";
    if (status === "submitted") pendingReconciliationCount += 1;
    if (status === "flagged") flaggedReconciliationCount += 1;
  }

  let settlementRequestedCount = 0;
  let settlementApprovedCount = 0;
  let settlementRequestedAmount = 0;
  let settlementApprovedAmount = 0;
  for (const doc of settlementsSnap.docs) {
    const settlement = doc.data() || {};
    const status = settlement.status || "requested";
    const amount = Number(
      settlement.approvedAmount ?? settlement.amount ?? settlement.commissionTotal ?? 0
    );
    if (status === "requested") {
      settlementRequestedCount += 1;
      settlementRequestedAmount += amount;
    }
    if (status === "approved") {
      settlementApprovedCount += 1;
      settlementApprovedAmount += amount;
    }
  }

  const pendingApprovalsCount = pendingMembersSnap.size + pendingGroupsSnap.size;
  const fund = fundSnap.exists ? fundSnap.data() || {} : {};
  const loanToSavingsRatio = confirmedSavings > 0 ? outstandingLoansAmount / confirmedSavings : null;
  const operationsBacklog =
    pendingApprovalsCount +
    submittedBatchSnap.size +
    pendingReconciliationCount +
    settlementRequestedCount +
    settlementApprovedCount;

  const attention = [
    role !== ROLES.FINANCE
      ? {
          id: "pending-approvals",
          label: "Pending approvals",
          count: pendingApprovalsCount,
          description: `${pendingMembersSnap.size} members and ${pendingGroupsSnap.size} groups awaiting review`,
          route: "/admin/approvals",
          tone: pendingApprovalsCount > 0 ? "amber" : "slate",
        }
      : null,
    {
      id: "submitted-batches",
      label: "Submitted batches",
      count: submittedBatchSnap.size,
      description: `${submittedBatchAmount.toLocaleString("en-US")} BIF awaiting institution confirmation`,
      route: "/admin/deposits/pending",
      tone: submittedBatchSnap.size > 0 ? "amber" : "slate",
    },
    role !== ROLES.FINANCE
      ? {
          id: "flagged-batches",
          label: "Flagged batches",
          count: flaggedBatchSnap.size,
          description: `${flaggedBatchAmount.toLocaleString("en-US")} BIF currently flagged for review`,
          route: "/admin/super/exceptions",
          tone: flaggedBatchSnap.size > 0 ? "red" : "slate",
        }
      : null,
    {
      id: "pending-reconciliations",
      label: "Pending reconciliations",
      count: pendingReconciliationCount,
      description: `${flaggedReconciliationCount} reconciliations are already flagged`,
      route: "/admin/agents/reconciliation",
      tone: pendingReconciliationCount > 0 ? "amber" : "slate",
    },
    {
      id: "defaulted-loans",
      label: "Defaulted loans",
      count: defaultedLoansCount,
      description: `${defaultedLoansAmount.toLocaleString("en-US")} BIF already in default`,
      route: role === ROLES.SUPER_ADMIN ? "/admin/super/exceptions" : "/admin/loans",
      tone: defaultedLoansCount > 0 ? "red" : "slate",
    },
    {
      id: "settlements-awaiting-action",
      label: "Settlements awaiting action",
      count: settlementRequestedCount + settlementApprovedCount,
      description: `${settlementRequestedCount} requested · ${settlementApprovedCount} approved but unpaid`,
      route: "/admin/agents/settlements",
      tone:
        settlementRequestedCount + settlementApprovedCount > 0 ? "amber" : "slate",
    },
  ].filter(Boolean);

  const health = {
    savingsCoverageRatio: loanToSavingsRatio,
    operationsBacklog,
    activeLoanCount,
    totalLoanCount,
    flaggedReconciliationCount,
    activeGroupLoansOutstanding,
    lendingPaused: fund.lendingPaused === true,
    fundAvailable: Number(fund.availableFund || 0),
    fundDeployed: Number(fund.deployedFund || 0),
  };

  return {
    generatedAt: admin.firestore.Timestamp.now(),
    kpis: {
      totalMembers: activeMembersSnap.size,
      activeGroups: activeGroupsSnap.size,
      confirmedSavings,
      pendingSavings: {
        amount: pendingSavingsAmount,
        count: pendingDepositSnap.size,
      },
      outstandingLoans: outstandingLoansAmount,
      overdueLoans: {
        count: overdueLoansCount,
        amount: overdueLoansAmount,
      },
      defaultedLoans: {
        count: defaultedLoansCount,
        amount: defaultedLoansAmount,
      },
      activeAgents: activeAgentsSnap.size,
      activeInstitutions: activeInstitutionsSnap.size,
    },
    attention,
    health,
    roleView: {
      role,
      pendingApprovalsCount,
      submittedBatchCount: submittedBatchSnap.size,
      flaggedBatchCount: flaggedBatchSnap.size,
      pendingReconciliationCount,
      settlementRequestedCount,
      settlementApprovedCount,
    },
  };
});

exports.getGroupsGovernanceConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const [groupsSnap, loansSnap, leadersSnap, institutionsSnap] = await Promise.all([
    db.collection("groups").orderBy("createdAt", "desc").get(),
    db.collection("loans").get(),
    db.collection("users")
      .where("role", "in", [ROLES.LEADER, ROLES.MEMBER])
      .get(),
    db.collection("institutions").orderBy("name", "asc").get(),
  ]);

  const leadersById = new Map(
    leadersSnap.docs.map((doc) => [doc.id, doc.data() || {}])
  );
  const institutionsById = new Map(
    institutionsSnap.docs.map((doc) => [doc.id, doc.data() || {}])
  );

  const loanMetricsByGroup = new Map();
  const nowMs = Date.now();
  for (const doc of loansSnap.docs) {
    const loan = doc.data() || {};
    const groupId = loan.groupId;
    if (!groupId) continue;

    const metrics = loanMetricsByGroup.get(groupId) || {
      activeLoanCount: 0,
      totalOutstandingLoans: 0,
      overdueLoanCount: 0,
      overdueAmount: 0,
      defaultedLoanCount: 0,
      defaultedAmount: 0,
    };

    const remainingDue = Number(loan.remainingDue || loan.amount || 0);
    const dueMs = loan.dueDate?.toMillis?.() || null;
    if (loan.status === "active") {
      metrics.activeLoanCount += 1;
      metrics.totalOutstandingLoans += remainingDue;
      if (dueMs && dueMs < nowMs && remainingDue > 0) {
        metrics.overdueLoanCount += 1;
        metrics.overdueAmount += remainingDue;
      }
    }
    if (loan.status === "defaulted") {
      metrics.defaultedLoanCount += 1;
      metrics.defaultedAmount += remainingDue;
    }

    loanMetricsByGroup.set(groupId, metrics);
  }

  const rows = groupsSnap.docs.map((doc) => {
    const group = doc.data() || {};
    const leader = group.leaderId ? leadersById.get(group.leaderId) : null;
    const institution = group.institutionId ? institutionsById.get(group.institutionId) : null;
    const metrics = loanMetricsByGroup.get(doc.id) || {
      activeLoanCount: 0,
      totalOutstandingLoans: Number(group.totalLoansOutstanding || 0),
      overdueLoanCount: 0,
      overdueAmount: 0,
      defaultedLoanCount: 0,
      defaultedAmount: 0,
    };
    const risk = deriveGroupRiskProfile(group, metrics);

    return {
      groupId: doc.id,
      name: group.name || `Group ${doc.id}`,
      groupCode: group.groupCode || null,
      leaderName: leader?.fullName || leader?.name || "Leader unavailable",
      institutionId: group.institutionId || null,
      institutionName: institution?.name || "Institution unavailable",
      memberCount: Number(group.memberCount || 0),
      totalSavings: Number(group.totalSavings || 0),
      pendingSavings: Number(group.pendingSavings || 0),
      totalOutstandingLoans: Number(metrics.totalOutstandingLoans || 0),
      overdueLoanCount: Number(metrics.overdueLoanCount || 0),
      defaultedLoanCount: Number(metrics.defaultedLoanCount || 0),
      status: group.status || "unknown",
      lendingState: group.borrowingPaused ? "paused" : "active",
      reviewStatus: group.reviewStatus || null,
      reviewNote: group.reviewNote || null,
      riskBadge: risk.badge,
      riskTone: risk.tone,
      highRisk: risk.isHighRisk,
      createdAtMs: timestampToMillis(group.createdAt),
    };
  });

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalGroups += 1;
      if (row.status === GROUP_STATUS.ACTIVE) acc.activeGroups += 1;
      if (row.status === GROUP_STATUS.SUSPENDED) acc.pausedGroups += 1;
      if (row.status === GROUP_STATUS.PENDING_APPROVAL) acc.pendingGroups += 1;
      if (row.reviewStatus === "under_review") acc.flaggedGroups += 1;
      if (row.totalOutstandingLoans > 0) acc.groupsWithOutstandingLoans += 1;
      if (row.highRisk) acc.highRiskGroups += 1;
      return acc;
    },
    {
      totalGroups: 0,
      activeGroups: 0,
      pausedGroups: 0,
      flaggedGroups: 0,
      pendingGroups: 0,
      groupsWithOutstandingLoans: 0,
      highRiskGroups: 0,
    }
  );

  return {
    role,
    summary,
    rows,
    filterOptions: {
      institutions: [...institutionsById.entries()].map(([id, institution]) => ({
        id,
        name: institution.name || id,
      })),
    },
  };
});

exports.getGroupGovernanceDetail = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const groupId = String(data?.groupId || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Group not found.");
  }

  const group = groupSnap.data() || {};
  const [leaderSnap, institutionSnap, membersSnap, loansSnap, auditSnap] = await Promise.all([
    group.leaderId ? db.collection("users").doc(group.leaderId).get() : Promise.resolve(null),
    group.institutionId ? db.collection("institutions").doc(group.institutionId).get() : Promise.resolve(null),
    db.collection("groupMembers").where("groupId", "==", groupId).get(),
    db.collection("loans").where("groupId", "==", groupId).get(),
    db.collection("auditLog").orderBy("createdAt", "desc").limit(50).get(),
  ]);

  const memberUserIds = membersSnap.docs.map((doc) => doc.id);
  const memberUsers = await getDocumentsByIds("users", memberUserIds);

  const loans = loansSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const nowMs = Date.now();
  const loanMetrics = loans.reduce(
    (acc, loan) => {
      const remainingDue = Number(loan.remainingDue || loan.amount || 0);
      const dueMs = loan.dueDate?.toMillis?.() || null;
      if (loan.status === "active") {
        acc.activeLoanCount += 1;
        acc.outstandingLoans += remainingDue;
        if (dueMs && dueMs < nowMs && remainingDue > 0) {
          acc.overdueLoanCount += 1;
          acc.overdueAmount += remainingDue;
        }
      }
      if (loan.status === "defaulted") {
        acc.defaultedLoanCount += 1;
        acc.defaultedAmount += remainingDue;
      }
      return acc;
    },
    {
      activeLoanCount: 0,
      outstandingLoans: Number(group.totalLoansOutstanding || 0),
      overdueLoanCount: 0,
      overdueAmount: 0,
      defaultedLoanCount: 0,
      defaultedAmount: 0,
    }
  );

  const risk = deriveGroupRiskProfile(group, loanMetrics);
  const exceptionCount =
    loanMetrics.overdueLoanCount +
    loanMetrics.defaultedLoanCount +
    (group.reviewStatus === "under_review" ? 1 : 0);

  const members = membersSnap.docs
    .map((doc) => {
      const membership = doc.data() || {};
      const user = memberUsers.get(doc.id) || {};
      return {
        userId: doc.id,
        fullName: user.fullName || user.name || "Unknown member",
        role: doc.id === group.leaderId ? "Leader" : "Member",
        joinedAtMs: timestampToMillis(membership.joinedAt || user.approvedAt || user.createdAt),
      };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const recentActions = auditSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((entry) => entry.targetType === "group" && entry.targetId === groupId)
    .slice(0, 6)
    .map((entry) => ({
      id: entry.id,
      action: entry.action || "group_updated",
      actorRole: entry.actorRole || null,
      createdAtMs: timestampToMillis(entry.createdAt),
      note: entry.meta?.reason || entry.meta?.note || null,
    }));

  return {
    role,
    group: {
      groupId,
      name: group.name || `Group ${groupId}`,
      groupCode: group.groupCode || null,
      status: group.status || "unknown",
      createdAtMs: timestampToMillis(group.createdAt),
      institutionName: institutionSnap?.exists ? institutionSnap.data()?.name || null : null,
      leaderName: leaderSnap?.exists ? leaderSnap.data()?.fullName || leaderSnap.data()?.name || "Leader unavailable" : "Leader unavailable",
      memberCount: Number(group.memberCount || members.length || 0),
      totalSavings: Number(group.totalSavings || 0),
      pendingSavings: Number(group.pendingSavings || 0),
      outstandingLoans: Number(loanMetrics.outstandingLoans || 0),
      overdueLoanCount: Number(loanMetrics.overdueLoanCount || 0),
      overdueAmount: Number(loanMetrics.overdueAmount || 0),
      defaultedLoanCount: Number(loanMetrics.defaultedLoanCount || 0),
      defaultedAmount: Number(loanMetrics.defaultedAmount || 0),
      lendingPaused: group.borrowingPaused === true,
      pauseReason: group.pauseReason || null,
      reviewStatus: group.reviewStatus || null,
      reviewNote: group.reviewNote || null,
      riskBadge: risk.badge,
      riskTone: risk.tone,
      coverageRatio: risk.utilizationRatio,
      exceptionCount,
      members,
      recentActions,
    },
  };
});

exports.setGroupGovernanceReviewState = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const groupId = String(data?.groupId || "").trim();
  const underReview = data?.underReview;
  const note = String(data?.note || "").trim();

  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }
  if (typeof underReview !== "boolean") {
    throw httpsError("invalid-argument", "underReview must be a boolean.");
  }
  if (underReview && !note) {
    throw httpsError("invalid-argument", "note is required when marking a group for review.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Group not found.");
  }

  await groupRef.set(
    underReview
      ? {
          reviewStatus: "under_review",
          reviewNote: note,
          reviewMarkedAt: FieldValue.serverTimestamp(),
          reviewMarkedBy: context.auth.uid,
          updatedAt: FieldValue.serverTimestamp(),
        }
      : {
          reviewStatus: null,
          reviewNote: null,
          reviewMarkedAt: null,
          reviewMarkedBy: null,
          updatedAt: FieldValue.serverTimestamp(),
        },
    { merge: true }
  );

  await writeAuditLog(
    context.auth.uid,
    role,
    underReview ? "group_review_marked" : "group_review_cleared",
    "group",
    groupId,
    { note: underReview ? note : null }
  );

  return { success: true, groupId, underReview };
});

exports.queryTransactionsOversight = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);

  const filters = {
    dateFrom: String(data?.dateFrom || "").trim(),
    dateTo: String(data?.dateTo || "").trim(),
    type: String(data?.type || "").trim(),
    status: String(data?.status || "").trim(),
    institutionId: String(data?.institutionId || "").trim(),
    groupQuery: String(data?.groupQuery || "").trim(),
    agentQuery: String(data?.agentQuery || "").trim(),
    memberQuery: String(data?.memberQuery || "").trim(),
    reference: String(data?.reference || "").trim(),
    flaggedOnly: data?.flaggedOnly === true,
  };

  if (filters.type && !TRANSACTION_OVERSIGHT_TYPES.includes(filters.type)) {
    throw httpsError("invalid-argument", "Unsupported transaction type filter.");
  }
  if (filters.status && !TRANSACTION_OVERSIGHT_STATUSES.includes(filters.status)) {
    throw httpsError("invalid-argument", "Unsupported transaction status filter.");
  }

  const dateFrom = parseDateInput(filters.dateFrom, false);
  const dateTo = parseDateInput(filters.dateTo, true);
  const dateFromMs = dateFrom?.toMillis?.() || null;
  const dateToMs = dateTo?.toMillis?.() || null;
  if (dateFrom && dateTo && dateFrom.toMillis() > dateTo.toMillis()) {
    throw httpsError("invalid-argument", "dateFrom cannot be later than dateTo.");
  }

  const pageSize = clamp(Number(data?.limit || 150), 25, 250);
  const scanLimit = clamp(pageSize * 4, 250, 800);

  let queryRef = db.collection("transactions").orderBy("createdAt", "desc");
  if (dateFrom) queryRef = queryRef.where("createdAt", ">=", dateFrom);
  if (dateTo) queryRef = queryRef.where("createdAt", "<=", dateTo);

  const baseSnap = await queryRef.limit(scanLimit).get();
  const candidateDocs = [...baseSnap.docs];

  if (filters.reference) {
    const [directSnap, receiptSnap, batchSnap, loanSnap] = await Promise.all([
      db.collection("transactions").doc(filters.reference).get(),
      db.collection("transactions").where("receiptNo", "==", filters.reference).limit(20).get(),
      db.collection("transactions").where("batchId", "==", filters.reference).limit(20).get(),
      db.collection("transactions").where("loanId", "==", filters.reference).limit(20).get(),
    ]);

    if (directSnap.exists) candidateDocs.push(directSnap);
    candidateDocs.push(...receiptSnap.docs, ...batchSnap.docs, ...loanSnap.docs);
  }

  const uniqueDocs = [];
  const seenTxnIds = new Set();
  for (const doc of candidateDocs) {
    if (!doc?.exists || seenTxnIds.has(doc.id)) continue;
    seenTxnIds.add(doc.id);
    uniqueDocs.push(doc);
  }

  const rawRows = uniqueDocs.map((doc) => ({ txnId: doc.id, ...doc.data() }));
  const groupMap = await getDocumentsByIds(
    "groups",
    rawRows.map((row) => row.groupId).filter(Boolean)
  );
  const [batchMap, userMap, agentMap, institutionMap] = await Promise.all([
    getDocumentsByIds(
      "depositBatches",
      rawRows.map((row) => row.batchId).filter(Boolean)
    ),
    getDocumentsByIds(
      "users",
      rawRows.flatMap((row) => [row.userId, row.memberId, row.agentId]).filter(Boolean)
    ),
    getDocumentsByIds(
      "agents",
      rawRows.map((row) => row.agentId).filter(Boolean)
    ),
    getDocumentsByIds(
      "institutions",
      [
        ...rawRows.map((row) => row.institutionId).filter(Boolean),
        ...rawRows.map((row) => groupMap.get(row.groupId)?.institutionId).filter(Boolean),
      ]
    ),
  ]);

  const flaggedBatchIds = new Set(
    [...batchMap.entries()]
      .filter(([, batch]) => batch?.status === DEPOSIT_BATCH_STATUS.FLAGGED)
      .map(([batchId]) => batchId)
  );

  const rows = rawRows
    .map((row) => {
      const memberId = row.userId || row.memberId || null;
      const member = memberId ? userMap.get(memberId) : null;
      const group = row.groupId ? groupMap.get(row.groupId) : null;
      const institutionId = row.institutionId || group?.institutionId || null;
      const institution = institutionId ? institutionMap.get(institutionId) : null;
      const agentId = row.agentId || null;
      const agent = agentId ? userMap.get(agentId) || agentMap.get(agentId) : null;
      const batch = row.batchId ? batchMap.get(row.batchId) : null;
      const flagged = row.batchId ? flaggedBatchIds.has(row.batchId) : false;

      return {
        txnId: row.txnId,
        type: row.type || null,
        status: row.status || null,
        amount: Number(row.amount || 0),
        createdAtMs: timestampToMillis(row.createdAt),
        confirmedAtMs: timestampToMillis(row.confirmedAt),
        rejectedAtMs: timestampToMillis(row.rejectedAt),
        memberId,
        memberName: member?.fullName || member?.name || null,
        groupId: row.groupId || null,
        groupName: group?.name || group?.groupName || null,
        agentId,
        agentName: agent?.fullName || agent?.name || null,
        institutionId,
        institutionName: institution?.name || null,
        reference: row.receiptNo || row.txnId,
        receiptNo: row.receiptNo || null,
        batchId: row.batchId || null,
        loanId: row.loanId || null,
        channel: row.channel || null,
        source: row.source || null,
        notes: row.notes || null,
        flagged,
        batchStatus: batch?.status || null,
        batchInstitutionNotes: batch?.institutionNotes || null,
        batchConfirmedAtMs: timestampToMillis(batch?.confirmedAt),
        batchFlaggedAtMs: timestampToMillis(batch?.flaggedAt),
      };
    })
    .filter((row) => (dateFromMs ? (row.createdAtMs || 0) >= dateFromMs : true))
    .filter((row) => (dateToMs ? (row.createdAtMs || 0) <= dateToMs : true))
    .filter((row) => (filters.type ? row.type === filters.type : true))
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) => (filters.flaggedOnly ? row.flagged === true : true))
    .filter((row) => matchesQuery([row.groupName, row.groupId], filters.groupQuery))
    .filter((row) => matchesQuery([row.agentName, row.agentId], filters.agentQuery))
    .filter((row) => matchesQuery([row.memberName, row.memberId], filters.memberQuery))
    .filter((row) =>
      matchesQuery([row.txnId, row.reference, row.receiptNo, row.batchId, row.loanId], filters.reference)
    )
    .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalTransactions += 1;
      if (row.type === TRANSACTION_TYPE.DEPOSIT) acc.deposits += 1;
      if (row.type === TRANSACTION_TYPE.WITHDRAWAL) acc.withdrawals += 1;
      if (row.type === TRANSACTION_TYPE.LOAN_DISBURSE) acc.loanDisbursements += 1;
      if (row.type === TRANSACTION_TYPE.LOAN_REPAY) acc.repayments += 1;
      if (row.flagged) acc.flagged += 1;
      if (row.status === "reversed") acc.reversed += 1;
      if (row.status === "failed") acc.failed += 1;
      return acc;
    },
    {
      totalTransactions: 0,
      deposits: 0,
      withdrawals: 0,
      loanDisbursements: 0,
      repayments: 0,
      flagged: 0,
      reversed: 0,
      failed: 0,
    }
  );

  const institutionOptions = (await db.collection("institutions").orderBy("name", "asc").get()).docs.map((doc) => {
    const institution = doc.data() || {};
    return {
      id: doc.id,
      name: institution.name || doc.id,
      status: institution.status || "unknown",
    };
  });

  return {
    role,
    filters,
    meta: {
      appliedToLatest: rawRows.length >= scanLimit,
      scannedTransactions: rawRows.length,
      returnedTransactions: rows.length,
      limit: pageSize,
      supportedTypes: TRANSACTION_OVERSIGHT_TYPES,
      supportedStatuses: TRANSACTION_OVERSIGHT_STATUSES,
      unsupportedStatuses: ["reversed", "failed"],
    },
    summary,
    filterOptions: {
      institutions: institutionOptions,
    },
    rows: rows.slice(0, pageSize),
  };
});

exports.getDepositsBatchesConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);

  const filters = {
    dateFrom: String(data?.dateFrom || "").trim(),
    dateTo: String(data?.dateTo || "").trim(),
    institutionId: String(data?.institutionId || "").trim(),
    groupQuery: String(data?.groupQuery || "").trim(),
    agentQuery: String(data?.agentQuery || "").trim(),
    status: String(data?.status || "").trim(),
    reference: String(data?.reference || "").trim(),
    flaggedOnly: data?.flaggedOnly === true,
  };

  if (filters.status && !DEPOSIT_BATCH_CONSOLE_STATUSES.includes(filters.status)) {
    throw httpsError("invalid-argument", "Unsupported batch status filter.");
  }

  const dateFrom = parseDateInput(filters.dateFrom, false);
  const dateTo = parseDateInput(filters.dateTo, true);
  const dateFromMs = dateFrom?.toMillis?.() || null;
  const dateToMs = dateTo?.toMillis?.() || null;
  if (dateFrom && dateTo && dateFrom.toMillis() > dateTo.toMillis()) {
    throw httpsError("invalid-argument", "dateFrom cannot be later than dateTo.");
  }

  const scanLimit = clamp(Number(data?.limit || 400), 100, 800);

  const [batchSnap, pendingDepositSnap, institutionSnap] = await Promise.all([
    db.collection("depositBatches").limit(scanLimit).get(),
    db.collection("transactions")
      .where("type", "==", TRANSACTION_TYPE.DEPOSIT)
      .where("status", "==", TRANSACTION_STATUS.PENDING_CONFIRMATION)
      .limit(scanLimit)
      .get(),
    db.collection("institutions").orderBy("name", "asc").get(),
  ]);

  const batches = batchSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  const pendingDeposits = pendingDepositSnap.docs
    .map((doc) => ({ id: doc.id, ...doc.data() }))
    .filter((row) => !row.batchId);

  const batchGroupIds = batches.map((row) => row.groupId).filter(Boolean);
  const pendingGroupIds = pendingDeposits.map((row) => row.groupId).filter(Boolean);
  const batchAgentIds = batches.map((row) => row.agentId).filter(Boolean);
  const pendingAgentIds = pendingDeposits.map((row) => row.agentId || row.recordedBy).filter(Boolean);
  const pendingMemberIds = pendingDeposits.map((row) => row.userId || row.memberId).filter(Boolean);

  const [groupMap, userMap] = await Promise.all([
    getDocumentsByIds("groups", [...batchGroupIds, ...pendingGroupIds]),
    getDocumentsByIds("users", [...batchAgentIds, ...pendingAgentIds, ...pendingMemberIds]),
  ]);

  const institutionMap = new Map(
    institutionSnap.docs.map((doc) => [doc.id, { id: doc.id, ...doc.data() }])
  );

  const pendingQueueMap = new Map();
  for (const row of pendingDeposits) {
    const groupId = row.groupId || null;
    const agentId = row.agentId || row.recordedBy || null;
    const queueKey = buildDepositPendingQueueKey(groupId, agentId);
    const createdAtMs = timestampToMillis(row.createdAt);
    if (!pendingQueueMap.has(queueKey)) {
      pendingQueueMap.set(queueKey, {
        id: queueKey,
        kind: "pending_queue",
        reference: queueKey,
        batchId: null,
        queueKey,
        status: "pending_queue",
        statusLabel: formatDepositBatchStatus("pending_queue"),
        amount: 0,
        transactionCount: 0,
        memberIds: new Set(),
        groupId,
        agentId,
        institutionId: row.institutionId || groupMap.get(groupId)?.institutionId || null,
        createdAtMs,
        oldestPendingAtMs: createdAtMs,
        newestPendingAtMs: createdAtMs,
        flagged: false,
      });
    }

    const queue = pendingQueueMap.get(queueKey);
    queue.amount += Number(row.amount || 0);
    queue.transactionCount += 1;
    if (row.userId || row.memberId) {
      queue.memberIds.add(row.userId || row.memberId);
    }
    if (createdAtMs) {
      queue.oldestPendingAtMs = queue.oldestPendingAtMs == null ? createdAtMs : Math.min(queue.oldestPendingAtMs, createdAtMs);
      queue.newestPendingAtMs = queue.newestPendingAtMs == null ? createdAtMs : Math.max(queue.newestPendingAtMs, createdAtMs);
    }
  }

  const pendingRows = [...pendingQueueMap.values()].map((row) => {
    const group = row.groupId ? groupMap.get(row.groupId) : null;
    const agent = row.agentId ? userMap.get(row.agentId) : null;
    const institution = row.institutionId ? institutionMap.get(row.institutionId) : null;
    return {
      id: row.id,
      kind: row.kind,
      reference: row.reference,
      batchId: null,
      queueKey: row.queueKey,
      status: row.status,
      statusLabel: row.statusLabel,
      amount: row.amount,
      transactionCount: row.transactionCount,
      memberCount: row.memberIds.size,
      groupId: row.groupId,
      groupName: group?.name || row.groupId || null,
      agentId: row.agentId,
      agentName: agent?.fullName || agent?.name || row.agentId || null,
      institutionId: row.institutionId,
      institutionName: institution?.name || null,
      createdAtMs: row.oldestPendingAtMs || row.createdAtMs || null,
      submittedAtMs: null,
      confirmedAtMs: null,
      flaggedAtMs: null,
      oldestPendingAtMs: row.oldestPendingAtMs || null,
      newestPendingAtMs: row.newestPendingAtMs || null,
      confirmationLagMs: null,
      flagged: false,
      notes: null,
      sortAtMs: row.newestPendingAtMs || row.oldestPendingAtMs || 0,
    };
  });

  const batchRows = batches.map((row) => {
    const group = row.groupId ? groupMap.get(row.groupId) : null;
    const institutionId = resolveDepositBatchInstitutionId(row, group);
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const agent = row.agentId ? userMap.get(row.agentId) : null;
    const createdAtMs = timestampToMillis(row.createdAt) || timestampToMillis(row.submittedAt);
    const submittedAtMs = timestampToMillis(row.submittedAt) || createdAtMs;
    const confirmedAtMs = timestampToMillis(row.confirmedAt);
    const flaggedAtMs = timestampToMillis(row.flaggedAt);
    const confirmationLagMs =
      row.status === DEPOSIT_BATCH_STATUS.CONFIRMED && submittedAtMs && confirmedAtMs
        ? Math.max(0, confirmedAtMs - submittedAtMs)
        : null;

    return {
      id: row.id,
      kind: "batch",
      reference: row.id,
      batchId: row.id,
      queueKey: null,
      status: row.status || null,
      statusLabel: formatDepositBatchStatus(row.status),
      amount: Number(row.totalAmount || 0),
      transactionCount: Array.isArray(row.transactionIds) ? row.transactionIds.length : 0,
      memberCount: Number(row.memberCount || 0),
      groupId: row.groupId || null,
      groupName: group?.name || row.groupId || null,
      agentId: row.agentId || null,
      agentName: agent?.fullName || agent?.name || row.agentId || null,
      institutionId,
      institutionName: institution?.name || null,
      createdAtMs,
      submittedAtMs,
      confirmedAtMs,
      flaggedAtMs,
      oldestPendingAtMs: null,
      newestPendingAtMs: null,
      confirmationLagMs,
      flagged: row.status === DEPOSIT_BATCH_STATUS.FLAGGED,
      notes: row.institutionNotes || null,
      sortAtMs: confirmedAtMs || flaggedAtMs || submittedAtMs || createdAtMs || 0,
    };
  });

  const rows = [...pendingRows, ...batchRows]
    .filter((row) => (dateFromMs ? (row.sortAtMs || 0) >= dateFromMs : true))
    .filter((row) => (dateToMs ? (row.sortAtMs || 0) <= dateToMs : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.flaggedOnly ? row.flagged === true : true))
    .filter((row) => matchesQuery([row.groupName, row.groupId], filters.groupQuery))
    .filter((row) => matchesQuery([row.agentName, row.agentId], filters.agentQuery))
    .filter((row) => matchesQuery([row.reference, row.batchId, row.queueKey], filters.reference))
    .sort((a, b) => (b.sortAtMs || 0) - (a.sortAtMs || 0));

  return {
    role,
    filters,
    summary: buildDepositBatchSummary(rows),
    filterOptions: {
      institutions: institutionSnap.docs.map((doc) => {
        const institution = doc.data() || {};
        return {
          id: doc.id,
          name: institution.name || doc.id,
          status: institution.status || "unknown",
        };
      }),
    },
    meta: {
      pendingQueueMode: "Pending deposits are grouped into operational queues because there is no pre-submission batch document in the current model.",
      scannedBatches: batches.length,
      scannedPendingDeposits: pendingDeposits.length,
    },
    rows: rows.slice(0, scanLimit),
  };
});

exports.getDepositBatchDetail = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);
  const kind = String(data?.kind || "batch").trim();

  if (!["batch", "pending_queue"].includes(kind)) {
    throw httpsError("invalid-argument", "kind must be 'batch' or 'pending_queue'.");
  }

  let detail;
  let transactionDocs = [];

  if (kind === "batch") {
    const batchId = String(data?.batchId || "").trim();
    if (!batchId) {
      throw httpsError("invalid-argument", "batchId is required.");
    }

    const batchSnap = await db.collection("depositBatches").doc(batchId).get();
    if (!batchSnap.exists) {
      throw httpsError("not-found", "Batch not found.");
    }

    const batch = batchSnap.data() || {};
    const [groupMap, userMap, institutionMap, batchTransactionsSnap] = await Promise.all([
      getDocumentsByIds("groups", [batch.groupId].filter(Boolean)),
      getDocumentsByIds("users", [batch.agentId].filter(Boolean)),
      getDocumentsByIds(
        "institutions",
        [batch.institutionId].filter(Boolean)
      ),
      db.collection("transactions").where("batchId", "==", batchId).get(),
    ]);

    transactionDocs = batchTransactionsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    const memberMap = await getDocumentsByIds(
      "users",
      transactionDocs.map((row) => row.userId || row.memberId).filter(Boolean)
    );
    const group = batch.groupId ? groupMap.get(batch.groupId) : null;
    const institutionId = resolveDepositBatchInstitutionId(batch, group);
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const agent = batch.agentId ? userMap.get(batch.agentId) : null;
    const createdAtMs = timestampToMillis(batch.createdAt) || timestampToMillis(batch.submittedAt);
    const submittedAtMs = timestampToMillis(batch.submittedAt) || createdAtMs;
    const confirmedAtMs = timestampToMillis(batch.confirmedAt);
    const flaggedAtMs = timestampToMillis(batch.flaggedAt);

    const relatedReconciliationSnap = batch.agentId
      ? await db.collection("agentReconciliations").where("agentId", "==", batch.agentId).get()
      : null;
    const reconciliationRows = relatedReconciliationSnap
      ? relatedReconciliationSnap.docs
          .map((doc) => ({ id: doc.id, ...doc.data() }))
          .sort((a, b) => (timestampToMillis(b.updatedAt || b.createdAt) || 0) - (timestampToMillis(a.updatedAt || a.createdAt) || 0))
          .slice(0, 3)
          .map((row) => ({
            id: row.id,
            date: row.date || null,
            status: row.status || null,
            updatedAtMs: timestampToMillis(row.updatedAt || row.createdAt),
          }))
      : [];

    detail = {
      id: batchId,
      kind,
      reference: batchId,
      batchId,
      queueKey: null,
      status: batch.status || null,
      statusLabel: formatDepositBatchStatus(batch.status),
      amount: Number(batch.totalAmount || 0),
      transactionCount: transactionDocs.length,
      memberCount: Number(batch.memberCount || 0),
      groupId: batch.groupId || null,
      groupName: group?.name || batch.groupId || null,
      institutionId,
      institutionName: institution?.name || null,
      agentId: batch.agentId || null,
      agentName: agent?.fullName || agent?.name || batch.agentId || null,
      createdAtMs,
      submittedAtMs,
      confirmedAtMs,
      flaggedAtMs,
      confirmationLagMs:
        batch.status === DEPOSIT_BATCH_STATUS.CONFIRMED && submittedAtMs && confirmedAtMs
          ? Math.max(0, confirmedAtMs - submittedAtMs)
          : null,
      institutionNotes: batch.institutionNotes || null,
      institutionRef: batch.institutionRef || null,
      relatedReconciliations: reconciliationRows,
      reconciliationAvailable: reconciliationRows.length > 0,
      relatedTransactionsRoute: "/admin/super/transactions",
      relatedGroupRoute:
        role === ROLES.FINANCE || !batch.groupId ? null : `/admin/super/groups/${batch.groupId}`,
      statusHistory: [
        { label: "Created", atMs: createdAtMs },
        { label: "Submitted", atMs: submittedAtMs },
        { label: "Confirmed", atMs: confirmedAtMs },
        { label: "Flagged", atMs: flaggedAtMs },
      ].filter((item) => item.atMs),
      operationsNote:
        batch.status === DEPOSIT_BATCH_STATUS.CONFIRMED
          ? "Institution staff completed the confirmation. Admin roles can investigate but not confirm on behalf of the institution."
          : "Admin roles can investigate this batch and escalate issues, but institution confirmation remains outside this console.",
      constituentDeposits: transactionDocs.map((row) => {
        const memberId = row.userId || row.memberId || null;
        const member = memberId ? memberMap.get(memberId) : null;
        return {
          transactionId: row.id,
          reference: row.receiptNo || row.id,
          memberId,
          memberName: member?.fullName || member?.name || memberId || null,
          amount: Number(row.amount || 0),
          createdAtMs: timestampToMillis(row.createdAt),
          status: row.status || null,
          notes: row.notes || null,
        };
      }).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    };
  } else {
    const groupId = String(data?.groupId || "").trim();
    const agentId = String(data?.agentId || "").trim();
    if (!groupId || !agentId) {
      throw httpsError("invalid-argument", "groupId and agentId are required for a pending queue.");
    }

    const [pendingSnap, groupMap, userMap] = await Promise.all([
      db.collection("transactions")
        .where("type", "==", TRANSACTION_TYPE.DEPOSIT)
        .where("status", "==", TRANSACTION_STATUS.PENDING_CONFIRMATION)
        .where("groupId", "==", groupId)
        .get(),
      getDocumentsByIds("groups", [groupId]),
      getDocumentsByIds("users", [agentId]),
    ]);

    transactionDocs = pendingSnap.docs
      .map((doc) => ({ id: doc.id, ...doc.data() }))
      .filter((row) => !row.batchId && (row.agentId || row.recordedBy) === agentId);

    const memberMap = await getDocumentsByIds(
      "users",
      transactionDocs.map((row) => row.userId || row.memberId).filter(Boolean)
    );

    const group = groupMap.get(groupId) || {};
    const institutionId = group.institutionId || null;
    const institutionMap = await getDocumentsByIds("institutions", [institutionId].filter(Boolean));
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const agent = userMap.get(agentId) || {};
    const createdTimes = transactionDocs.map((row) => timestampToMillis(row.createdAt)).filter(Boolean);
    const oldestPendingAtMs = createdTimes.length ? Math.min(...createdTimes) : null;
    const newestPendingAtMs = createdTimes.length ? Math.max(...createdTimes) : null;

    detail = {
      id: buildDepositPendingQueueKey(groupId, agentId),
      kind,
      reference: buildDepositPendingQueueKey(groupId, agentId),
      batchId: null,
      queueKey: buildDepositPendingQueueKey(groupId, agentId),
      status: "pending_queue",
      statusLabel: formatDepositBatchStatus("pending_queue"),
      amount: transactionDocs.reduce((sum, row) => sum + Number(row.amount || 0), 0),
      transactionCount: transactionDocs.length,
      memberCount: new Set(transactionDocs.map((row) => row.userId || row.memberId).filter(Boolean)).size,
      groupId,
      groupName: group.name || groupId,
      institutionId,
      institutionName: institution?.name || null,
      agentId,
      agentName: agent.fullName || agent.name || agentId,
      createdAtMs: oldestPendingAtMs,
      submittedAtMs: null,
      confirmedAtMs: null,
      flaggedAtMs: null,
      confirmationLagMs: null,
      institutionNotes: null,
      institutionRef: null,
      relatedReconciliations: [],
      reconciliationAvailable: false,
      relatedTransactionsRoute: "/admin/super/transactions",
      relatedGroupRoute:
        role === ROLES.FINANCE ? null : `/admin/super/groups/${groupId}`,
      statusHistory: [
        { label: "Oldest pending deposit", atMs: oldestPendingAtMs },
        { label: "Newest pending deposit", atMs: newestPendingAtMs },
      ].filter((item) => item.atMs),
      operationsNote:
        "These deposit records have not yet been submitted as an institution batch. Admin roles can investigate queue age and escalation, but cannot submit or confirm on behalf of the agent or institution.",
      constituentDeposits: transactionDocs.map((row) => {
        const memberId = row.userId || row.memberId || null;
        const member = memberId ? memberMap.get(memberId) : null;
        return {
          transactionId: row.id,
          reference: row.receiptNo || row.id,
          memberId,
          memberName: member?.fullName || member?.name || memberId || null,
          amount: Number(row.amount || 0),
          createdAtMs: timestampToMillis(row.createdAt),
          status: row.status || null,
          notes: row.notes || null,
        };
      }).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0)),
    };
  }

  return { role, detail };
});

exports.getLoanPortfolioSummary = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.FINANCE]);

  const snap = await db.collection("loans").get();
  const loans = snap.docs.map((d) => d.data());

  const now = Date.now();
  const countByStatus = { pending: 0, active: 0, repaid: 0, defaulted: 0, rejected: 0 };
  let totalDeployed = 0;
  let totalDefaulted = 0;
  let totalRepaid = 0;
  let pendingDisbursement = 0;
  let overdueLoanCount = 0;
  const termEconomicsMap = new Map(
    SUPPORTED_LOAN_TERM_DURATIONS.map((termDays) => [
      termDays,
      {
        termDays,
        loanCount: 0,
        totalLoanAmount: 0,
        feeIncomeCollected: 0,
      },
    ])
  );

  for (const loan of loans) {
    const status = loan.status || "pending";
    countByStatus[status] = (countByStatus[status] || 0) + 1;

    const amount = Number(loan.amount || 0);
    const termDays = Number(loan.termDays || 0);
    const termEconomics = termEconomicsMap.get(termDays);
    if (termEconomics && status !== "rejected") {
      termEconomics.loanCount += 1;
      termEconomics.totalLoanAmount += amount;
      termEconomics.feeIncomeCollected += Number(loan.feeCollectedAmount || 0);
    }

    if (status === "active") {
      totalDeployed += amount;
      const dueMs = loan.dueDate?.toMillis?.() || 0;
      if (dueMs > 0 && dueMs < now) overdueLoanCount++;
    } else if (status === "defaulted") {
      totalDefaulted += amount;
    } else if (status === "repaid") {
      totalRepaid += amount;
    } else if (status === "pending") {
      pendingDisbursement += amount;
    }
  }

  const totalPortfolio = totalDeployed + totalDefaulted;
  const termEconomics = Array.from(termEconomicsMap.values()).map((entry) => ({
    termDays: entry.termDays,
    loanCount: entry.loanCount,
    feeIncomeCollected: entry.feeIncomeCollected,
    averageLoanSize: entry.loanCount > 0 ? Math.round(entry.totalLoanAmount / entry.loanCount) : 0,
  }));

  return {
    portfolio: {
      totalPortfolio,
      totalDeployed,
      totalDefaulted,
      totalRepaid,
      pendingDisbursement,
      countByStatus,
      overdueLoanCount,
      termEconomics,
    },
  };
});

// ── Kirimba Fund Management ───────────────────────────────────────────────────

exports.getKirimbaFundOverview = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const snap = await db.collection("kirimbaFund").doc("current").get();
  const fund = snap.exists ? snap.data() : {};

  return {
    fund: {
      exists: snap.exists,
      totalCapital: Number(fund.totalCapital || 0),
      availableFund: Number(fund.availableFund || 0),
      deployedFund: Number(fund.deployedFund || 0),
      totalCollateral: Number(fund.totalCollateral || 0),
      defaultedExposure: Number(fund.defaultedExposure || 0),
      repaidReturned: Number(fund.repaidReturned || 0),
      feeIncomeCollected: Number(fund.feeIncomeCollected || 0),
      retainedFeeIncome: Number(fund.retainedFeeIncome || 0),
      groupIncentiveAccrued: Number(fund.groupIncentiveAccrued || 0),
      lendingPaused: fund.lendingPaused === true,
      lendingPausedReason: fund.lendingPausedReason || null,
      lendingPausedAt: fund.lendingPausedAt || null,
      lendingPausedBy: fund.lendingPausedBy || null,
      lastUpdated: fund.lastUpdated || null,
      updatedBy: fund.updatedBy || null,
    },
  };
});

exports.seedKirimbaFund = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const initialCapital = Number(data?.initialCapital);
  if (!Number.isFinite(initialCapital) || initialCapital <= 0) {
    throw httpsError("invalid-argument", "initialCapital must be a positive number.");
  }
  const notes = String(data?.notes || "").trim() || "Initial fund seeding";

  const fundRef = db.collection("kirimbaFund").doc("current");
  const fundSnap = await fundRef.get();
  if (fundSnap.exists) {
    throw httpsError("already-exists", "Fund already seeded. Use topUpKirimbaFund to add capital.");
  }

  await fundRef.set({
    totalCapital: initialCapital,
    availableFund: initialCapital,
    deployedFund: 0,
    totalCollateral: 0,
    defaultedExposure: 0,
    repaidReturned: 0,
    feeIncomeCollected: 0,
    retainedFeeIncome: 0,
    groupIncentiveAccrued: 0,
    lendingPaused: false,
    lendingPausedReason: null,
    lastUpdated: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  });

  await db.collection("fundLedger").add({
    type: "seed",
    amount: initialCapital,
    beforeBalance: 0,
    afterBalance: initialCapital,
    notes,
    actorId: context.auth.uid,
    actorRole: context.auth.token?.role,
    loanId: null,
    createdAt: FieldValue.serverTimestamp(),
  });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "fund_seeded",
    "kirimbaFund",
    "current",
    { initialCapital, notes }
  );

  return { success: true, totalCapital: initialCapital, availableFund: initialCapital };
});

exports.topUpKirimbaFund = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const amount = Number(data?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpsError("invalid-argument", "amount must be a positive number.");
  }
  const notes = String(data?.notes || "").trim() || "Fund top-up";

  const fundRef = db.collection("kirimbaFund").doc("current");
  let beforeBalance = 0;
  let afterBalance = 0;

  await db.runTransaction(async (tx) => {
    const fundSnap = await tx.get(fundRef);
    if (!fundSnap.exists) {
      throw httpsError("not-found", "Fund not initialized. Call seedKirimbaFund first.");
    }
    const fund = fundSnap.data();
    beforeBalance = Number(fund.availableFund || 0);
    afterBalance = beforeBalance + amount;

    tx.set(fundRef, {
      totalCapital: FieldValue.increment(amount),
      availableFund: FieldValue.increment(amount),
      lastUpdated: FieldValue.serverTimestamp(),
      updatedBy: context.auth.uid,
    }, { merge: true });

    const ledgerRef = db.collection("fundLedger").doc();
    tx.set(ledgerRef, {
      type: "topup",
      amount,
      beforeBalance,
      afterBalance,
      notes,
      actorId: context.auth.uid,
      actorRole: context.auth.token?.role,
      loanId: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "fund_topup",
    "kirimbaFund",
    "current",
    { amount, notes, beforeBalance, afterBalance }
  );

  return { success: true, amount, beforeBalance, afterBalance };
});

exports.deductKirimbaFund = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const amount = Number(data?.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw httpsError("invalid-argument", "amount must be a positive number.");
  }
  const notes = String(data?.notes || "").trim();
  if (!notes) throw httpsError("invalid-argument", "notes is required for fund deductions.");

  const fundRef = db.collection("kirimbaFund").doc("current");
  let beforeBalance = 0;
  let afterBalance = 0;

  await db.runTransaction(async (tx) => {
    const fundSnap = await tx.get(fundRef);
    if (!fundSnap.exists) {
      throw httpsError("not-found", "Fund not initialized.");
    }
    const fund = fundSnap.data();
    beforeBalance = Number(fund.availableFund || 0);
    if (amount > beforeBalance) {
      throw httpsError(
        "failed-precondition",
        `Cannot deduct ${amount} BIF: only ${beforeBalance} BIF available.`
      );
    }
    afterBalance = beforeBalance - amount;

    tx.set(fundRef, {
      totalCapital: FieldValue.increment(-amount),
      availableFund: FieldValue.increment(-amount),
      lastUpdated: FieldValue.serverTimestamp(),
      updatedBy: context.auth.uid,
    }, { merge: true });

    const ledgerRef = db.collection("fundLedger").doc();
    tx.set(ledgerRef, {
      type: "deduction",
      amount,
      beforeBalance,
      afterBalance,
      notes,
      actorId: context.auth.uid,
      actorRole: context.auth.token?.role,
      loanId: null,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "fund_deduction",
    "kirimbaFund",
    "current",
    { amount, notes, beforeBalance, afterBalance }
  );

  return { success: true, amount, beforeBalance, afterBalance };
});

exports.pauseKirimbaLending = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const reason = String(data?.reason || "").trim();
  if (!reason) throw httpsError("invalid-argument", "reason is required.");

  const fundRef = db.collection("kirimbaFund").doc("current");
  const fundSnap = await fundRef.get();
  if (!fundSnap.exists) throw httpsError("not-found", "Fund not initialized.");
  if (fundSnap.data().lendingPaused === true) {
    throw httpsError("failed-precondition", "Lending is already paused.");
  }

  await fundRef.set({
    lendingPaused: true,
    lendingPausedReason: reason,
    lendingPausedAt: FieldValue.serverTimestamp(),
    lendingPausedBy: context.auth.uid,
    lastUpdated: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  }, { merge: true });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "lending_paused",
    "kirimbaFund",
    "current",
    { reason }
  );

  return { success: true };
});

exports.resumeKirimbaLending = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const fundRef = db.collection("kirimbaFund").doc("current");
  const fundSnap = await fundRef.get();
  if (!fundSnap.exists) throw httpsError("not-found", "Fund not initialized.");
  if (fundSnap.data().lendingPaused !== true) {
    throw httpsError("failed-precondition", "Lending is not currently paused.");
  }

  await fundRef.set({
    lendingPaused: false,
    lendingPausedReason: null,
    lastUpdated: FieldValue.serverTimestamp(),
    updatedBy: context.auth.uid,
  }, { merge: true });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "lending_resumed",
    "kirimbaFund",
    "current",
    {}
  );

  return { success: true };
});

exports.getKirimbaFundLedger = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const limitNum = Math.min(Number(data?.limit) || 50, 200);
  const snap = await db.collection("fundLedger")
    .orderBy("createdAt", "desc")
    .limit(limitNum)
    .get();

  return {
    entries: snap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});

// ── Group Institution Backfill ────────────────────────────────────────────────

/**
 * Backfill institutionId for all groups where it is null or missing.
 * Never overwrites groups that already have institutionId set.
 * Safe to call multiple times — idempotent.
 *
 * Inference order per group:
 *   1. users/{leaderId}.institutionId
 *   2. active groupMembers — infer only if all agree on a single institutionId
 *   3. If conflicting or not inferable, skip and report
 *
 * Supports dryRun=true to preview changes without writing anything.
 */
exports.backfillGroupInstitutionIds = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const dryRun = data?.dryRun === true;

  // Fetch all groups — collection is small enough for a management utility full scan
  const allGroupsSnap = await db.collection("groups").get();

  // Keep only groups missing a valid institutionId
  const needsBackfill = allGroupsSnap.docs.filter((d) => {
    const iid = d.data().institutionId;
    return !iid || typeof iid !== "string" || iid.trim() === "";
  });

  if (needsBackfill.length === 0) {
    return {
      processed: 0,
      updated: 0,
      skipped: 0,
      conflicts: [],
      notInferable: [],
      updatedGroups: [],
      dryRun,
      message: "All groups already have institutionId set.",
    };
  }

  // Batch-fetch all unique leader user docs up-front to minimise round trips
  const leaderIds = [...new Set(needsBackfill.map((d) => d.data().leaderId).filter(Boolean))];
  const leaderUserSnaps = leaderIds.length > 0
    ? await Promise.all(leaderIds.map((id) => db.collection("users").doc(id).get()))
    : [];

  const leaderInstitutionMap = {};
  leaderIds.forEach((id, i) => {
    if (leaderUserSnaps[i].exists) {
      const iid = leaderUserSnaps[i].data().institutionId;
      if (iid && typeof iid === "string" && iid.trim()) {
        leaderInstitutionMap[id] = iid.trim();
      }
    }
  });

  const updatedGroups = [];
  const conflicts = [];
  const notInferable = [];
  let skipped = 0;

  for (const groupDoc of needsBackfill) {
    const groupId = groupDoc.id;
    const group = groupDoc.data();
    const leaderId = group.leaderId || null;

    // Step 1: Try leader's institutionId
    let inferredId = leaderId ? (leaderInstitutionMap[leaderId] || null) : null;
    let inferMethod = "leader";

    // Step 2: No luck from leader — inspect active groupMembers
    if (!inferredId) {
      const membersSnap = await db.collection("groupMembers")
        .where("groupId", "==", groupId)
        .where("isActive", "==", true)
        .get();

      if (!membersSnap.empty) {
        const memberUids = membersSnap.docs.map((m) => m.data().userId).filter(Boolean);
        if (memberUids.length > 0) {
          const memberUserSnaps = await Promise.all(
            memberUids.map((uid) => db.collection("users").doc(uid).get())
          );
          const memberInstIds = [
            ...new Set(
              memberUserSnaps
                .filter((s) => s.exists)
                .map((s) => s.data().institutionId)
                .filter((iid) => iid && typeof iid === "string" && iid.trim())
                .map((iid) => iid.trim())
            ),
          ];

          if (memberInstIds.length === 1) {
            inferredId = memberInstIds[0];
            inferMethod = "members";
          } else if (memberInstIds.length > 1) {
            // Conflicting institutions — cannot safely infer, skip
            conflicts.push({ groupId, groupName: group.name || groupId, candidates: memberInstIds });
            skipped++;
            continue;
          }
        }
      }
    }

    if (!inferredId) {
      notInferable.push({
        groupId,
        groupName: group.name || groupId,
        reason: "No institutionId found on leader or active members",
      });
      skipped++;
      continue;
    }

    if (!dryRun) {
      await db.collection("groups").doc(groupId).set(
        { institutionId: inferredId, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    }

    updatedGroups.push({ groupId, groupName: group.name || groupId, institutionId: inferredId, inferMethod });
  }

  if (!dryRun && updatedGroups.length > 0) {
    await writeAuditLog(
      context.auth.uid,
      context.auth.token?.role,
      "group_institution_backfill",
      "groups",
      null,
      {
        updated: updatedGroups.length,
        skipped,
        conflicts: conflicts.length,
        notInferable: notInferable.length,
        updatedGroups,
        dryRun: false,
      }
    );
  }

  return {
    processed: needsBackfill.length,
    updated: updatedGroups.length,
    skipped,
    conflicts,
    notInferable,
    updatedGroups,
    dryRun,
    message: dryRun
      ? `Dry run: would update ${updatedGroups.length} group(s), skip ${skipped} (${conflicts.length} conflicts, ${notInferable.length} not inferable).`
      : `Updated ${updatedGroups.length} group(s). Skipped ${skipped} (${conflicts.length} conflicts, ${notInferable.length} not inferable).`,
  };
});

// ── Exceptions ────────────────────────────────────────────────────────────────

exports.getRiskExceptionsConsole = functions.https.onCall(async (data, context) => {
  const role = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const filters = {
    severity: String(data?.severity || "").trim().toLowerCase(),
    exceptionType: String(data?.exceptionType || "").trim().toLowerCase(),
    entityType: String(data?.entityType || "").trim().toLowerCase(),
    status: String(data?.status || "").trim().toLowerCase(),
    institutionId: String(data?.institutionId || "").trim(),
    query: String(data?.query || data?.reference || "").trim(),
    dateFrom: String(data?.dateFrom || "").trim(),
    dateTo: String(data?.dateTo || "").trim(),
  };

  const scanLimit = clamp(Number(data?.limit || 150) || 150, 50, 300);
  const dateFrom = parseDateInput(filters.dateFrom, false);
  const dateTo = parseDateInput(filters.dateTo, true);
  const dateFromMs = timestampToMillis(dateFrom);
  const dateToMs = timestampToMillis(dateTo);

  const [
    flaggedBatchSnap,
    defaultedLoanSnap,
    suspendedUserSnap,
    suspendedGroupSnap,
    suspendedInstitutionSnap,
    flaggedReconciliationSnap,
  ] = await Promise.all([
    db.collection("depositBatches").where("status", "==", DEPOSIT_BATCH_STATUS.FLAGGED).limit(scanLimit).get(),
    db.collection("loans").where("status", "==", "defaulted").limit(scanLimit).get(),
    db.collection("users").where("status", "==", USER_STATUS.SUSPENDED).limit(scanLimit).get(),
    db.collection("groups").where("status", "==", GROUP_STATUS.SUSPENDED).limit(scanLimit).get(),
    db.collection("institutions").where("status", "==", "suspended").limit(scanLimit).get(),
    db.collection("agentReconciliations").where("status", "==", "flagged").limit(scanLimit).get(),
  ]);

  const allGroupIds = [
    ...flaggedBatchSnap.docs.map((doc) => doc.data()?.groupId),
    ...defaultedLoanSnap.docs.map((doc) => doc.data()?.groupId),
    ...suspendedGroupSnap.docs.map((doc) => doc.id),
  ].filter(Boolean);
  const allUserIds = [
    ...flaggedBatchSnap.docs.map((doc) => doc.data()?.agentId),
    ...defaultedLoanSnap.docs.map((doc) => doc.data()?.userId),
    ...suspendedUserSnap.docs.map((doc) => doc.id),
    ...flaggedReconciliationSnap.docs.map((doc) => doc.data()?.agentId),
  ].filter(Boolean);

  const [groupMap, userMap] = await Promise.all([
    getDocumentsByIds("groups", allGroupIds),
    getDocumentsByIds("users", allUserIds),
  ]);

  const institutionIds = [
    ...flaggedBatchSnap.docs.map((doc) => doc.data()?.institutionId),
    ...defaultedLoanSnap.docs.map((doc) => {
      const row = doc.data() || {};
      const group = row.groupId ? groupMap.get(row.groupId) : null;
      const user = row.userId ? userMap.get(row.userId) : null;
      return row.institutionId || group?.institutionId || user?.institutionId || null;
    }),
    ...suspendedUserSnap.docs.map((doc) => doc.data()?.institutionId),
    ...suspendedGroupSnap.docs.map((doc) => doc.data()?.institutionId),
    ...suspendedInstitutionSnap.docs.map((doc) => doc.id),
    ...flaggedReconciliationSnap.docs.map((doc) => {
      const row = doc.data() || {};
      const agent = row.agentId ? userMap.get(row.agentId) : null;
      return agent?.institutionId || null;
    }),
  ].filter(Boolean);

  const institutionMap = await getDocumentsByIds("institutions", institutionIds);

  const rows = [];

  for (const doc of flaggedBatchSnap.docs) {
    const row = doc.data() || {};
    const group = row.groupId ? groupMap.get(row.groupId) : null;
    const agent = row.agentId ? userMap.get(row.agentId) : null;
    const institutionId = row.institutionId || group?.institutionId || null;
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const createdAtMs =
      timestampToMillis(row.flaggedAt) ||
      timestampToMillis(row.updatedAt) ||
      timestampToMillis(row.submittedAt) ||
      timestampToMillis(row.createdAt);

    rows.push({
      id: `flagged_batch:${doc.id}`,
      sourceId: doc.id,
      exceptionType: "flagged_batch",
      entityType: "batch",
      severity: "medium",
      status: "flagged",
      sourceModule: "Deposits & Batches",
      title: `Flagged batch ${doc.id.slice(0, 8)}`,
      affectedEntity: group?.name || agent?.fullName || "Deposit batch",
      summary: row.institutionNotes || "Institution-side notes indicate this batch needs review.",
      riskReason: "The batch is in a flagged state and requires batch-level investigation before it can move forward.",
      recommendedAction: "Review the batch note and confirmation context in Deposits & Batches.",
      reference: doc.id,
      linkedRoute: "/admin/deposits/pending",
      sourceRoute: "/admin/deposits/pending",
      sourceRecordType: "Deposit batch",
      sourceRecordId: doc.id,
      sourceReference: doc.id,
      handoffLabel: "Open in Deposits & Batches",
      handoffTarget: "Deposits & Batches",
      institutionId,
      institutionName: institution?.name || "Unlinked",
      createdAtMs,
      updatedAtMs: createdAtMs,
      amount: Number(row.totalAmount || 0),
      statusLabel: "Flagged",
      detail: {
        batchId: doc.id,
        groupName: group?.name || row.groupId || "Unlinked",
        agentName: agent?.fullName || agent?.name || row.agentId || "Unknown agent",
        institutionName: institution?.name || "Unlinked",
        amount: Number(row.totalAmount || 0),
        note: row.institutionNotes || row.umucoNotes || null,
      },
    });
  }

  for (const doc of defaultedLoanSnap.docs) {
    const row = doc.data() || {};
    const group = row.groupId ? groupMap.get(row.groupId) : null;
    const member = row.userId ? userMap.get(row.userId) : null;
    const institutionId = row.institutionId || group?.institutionId || member?.institutionId || null;
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const createdAtMs =
      timestampToMillis(row.defaultedAt) ||
      timestampToMillis(row.updatedAt) ||
      timestampToMillis(row.disbursedAt) ||
      timestampToMillis(row.createdAt);

    rows.push({
      id: `defaulted_loan:${doc.id}`,
      sourceId: doc.id,
      exceptionType: "defaulted_loan",
      entityType: "loan",
      severity: "high",
      status: "defaulted",
      sourceModule: "Loans",
      title: `Defaulted loan ${doc.id.slice(0, 8)}`,
      affectedEntity: member?.fullName || member?.name || row.userId || "Unknown member",
      summary: `Remaining due ${Number(row.remainingDue || row.amount || 0).toLocaleString("en-US")} BIF.`,
      riskReason: "The loan status is defaulted and still carries outstanding exposure.",
      recommendedAction: "Open the loan detail to review repayment history and intervention options.",
      reference: doc.id,
      linkedRoute: `/admin/loans/${doc.id}`,
      sourceRoute: `/admin/loans/${doc.id}`,
      sourceRecordType: "Loan",
      sourceRecordId: doc.id,
      sourceReference: doc.id,
      handoffLabel: "Open in Loans",
      handoffTarget: "Loans",
      institutionId,
      institutionName: institution?.name || "Unlinked",
      createdAtMs,
      updatedAtMs: createdAtMs,
      amount: Number(row.remainingDue || row.amount || 0),
      statusLabel: "Defaulted",
      detail: {
        loanId: doc.id,
        memberName: member?.fullName || member?.name || row.userId || "Unknown member",
        groupName: group?.name || row.groupId || "Unlinked",
        institutionName: institution?.name || "Unlinked",
        principal: Number(row.amount || 0),
        remainingDue: Number(row.remainingDue || row.amount || 0),
      },
    });
  }

  for (const doc of flaggedReconciliationSnap.docs) {
    const row = doc.data() || {};
    const agent = row.agentId ? userMap.get(row.agentId) : null;
    const institutionId = agent?.institutionId || null;
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const difference = Number(row.difference || 0);
    const createdAtMs =
      timestampToMillis(row.reviewedAt) ||
      timestampToMillis(row.updatedAt) ||
      timestampToMillis(row.createdAt);

    rows.push({
      id: `flagged_reconciliation:${doc.id}`,
      sourceId: doc.id,
      exceptionType: "flagged_reconciliation",
      entityType: "reconciliation",
      severity: difference !== 0 || Number(row.offlinePendingCount || 0) > 0 ? "high" : "medium",
      status: "flagged",
      sourceModule: "Reconciliation & Settlements",
      title: `Flagged reconciliation ${doc.id.slice(0, 8)}`,
      affectedEntity: agent?.fullName || agent?.name || row.agentId || "Unknown agent",
      summary: row.adminNote || "This reconciliation remains flagged for follow-up.",
      riskReason: "The reconciliation is flagged, or still carries mismatch exposure that requires follow-up in the mismatch lane.",
      recommendedAction: "Open the mismatch lane to review variance, notes, and linked settlement context.",
      reference: doc.id,
      linkedRoute: "/admin/operations/reconciliation-settlements?focus=mismatch",
      sourceRoute: "/admin/operations/reconciliation-settlements?focus=mismatch",
      sourceRecordType: "Reconciliation",
      sourceRecordId: doc.id,
      sourceReference: doc.id,
      handoffLabel: "Open in Reconciliation & Settlements",
      handoffTarget: "Reconciliation & Settlements",
      institutionId,
      institutionName: institution?.name || "Unlinked",
      createdAtMs,
      updatedAtMs: createdAtMs,
      amount: difference,
      statusLabel: "Flagged",
      detail: {
        reconciliationId: doc.id,
        agentName: agent?.fullName || agent?.name || row.agentId || "Unknown agent",
        institutionName: institution?.name || "Unlinked",
        operationalDate: row.date || null,
        difference,
        offlinePendingCount: Number(row.offlinePendingCount || 0),
        note: row.adminNote || null,
      },
    });
  }

  for (const doc of suspendedUserSnap.docs) {
    const row = doc.data() || {};
    const institutionId = row.institutionId || null;
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const entityType = row.role === ROLES.AGENT
      ? "agent"
      : row.role === ROLES.ADMIN || row.role === ROLES.SUPER_ADMIN || row.role === ROLES.FINANCE
      ? "admin"
      : row.role === ROLES.LEADER
      ? "leader"
      : row.role === ROLES.MEMBER
      ? "member"
      : "user";
    const severity = entityType === "admin" ? "high" : entityType === "agent" ? "medium" : "medium";
    const linkedRoute =
      entityType === "agent"
        ? "/admin/agents"
        : entityType === "admin" && role === ROLES.SUPER_ADMIN
        ? "/admin/super/admins"
        : null;
    const handoffLabel =
      entityType === "agent"
        ? "Open in Agents"
        : entityType === "admin" && role === ROLES.SUPER_ADMIN
        ? "Open in Users & Roles"
        : null;
    const handoffTarget =
      entityType === "agent"
        ? "Agents"
        : entityType === "admin"
        ? "Users & Roles"
        : null;
    const createdAtMs = timestampToMillis(row.suspendedAt) || timestampToMillis(row.updatedAt);

    rows.push({
      id: `suspended_user:${doc.id}`,
      sourceId: doc.id,
      exceptionType: "suspended_user",
      entityType,
      severity,
      status: "suspended",
      sourceModule: entityType === "agent" ? "Agents" : "Administration",
      title: `Suspended ${entityType}`,
      affectedEntity: row.fullName || row.name || doc.id,
      summary: row.suspendReason || "This account is suspended pending administrative review.",
      riskReason: "The entity is in a suspended state and requires review in its ownership module before it can return to service.",
      recommendedAction: linkedRoute
        ? "Open the source module for status review and reactivation controls."
        : "Review the suspension reason and related audit history before intervention.",
      reference: doc.id,
      linkedRoute,
      sourceRoute: linkedRoute,
      sourceRecordType: entityType === "agent" ? "Agent account" : entityType === "admin" ? "Admin account" : "User account",
      sourceRecordId: doc.id,
      sourceReference: doc.id,
      handoffLabel,
      handoffTarget,
      institutionId,
      institutionName: institution?.name || "Unlinked",
      createdAtMs,
      updatedAtMs: createdAtMs,
      amount: null,
      statusLabel: "Suspended",
      detail: {
        userId: doc.id,
        role: row.role || "unknown",
        phone: row.phone || null,
        institutionName: institution?.name || "Unlinked",
        note: row.suspendReason || null,
      },
    });
  }

  for (const doc of suspendedGroupSnap.docs) {
    const row = doc.data() || {};
    const institutionId = row.institutionId || null;
    const institution = institutionId ? institutionMap.get(institutionId) : null;
    const createdAtMs = timestampToMillis(row.suspendedAt) || timestampToMillis(row.updatedAt);

    rows.push({
      id: `suspended_group:${doc.id}`,
      sourceId: doc.id,
      exceptionType: "suspended_group",
      entityType: "group",
      severity: "high",
      status: "suspended",
      sourceModule: "Group Governance",
      title: `Suspended group ${row.groupCode || doc.id.slice(0, 8)}`,
      affectedEntity: row.name || doc.id,
      summary: row.suspendReason || "This group is suspended pending governance review.",
      riskReason: "The group is suspended and requires governance review before reactivation.",
      recommendedAction: "Open Group Governance for the full record and reactivation controls.",
      reference: doc.id,
      linkedRoute: `/admin/super/groups/${doc.id}`,
      sourceRoute: `/admin/super/groups/${doc.id}`,
      sourceRecordType: "Group",
      sourceRecordId: doc.id,
      sourceReference: row.groupCode || doc.id,
      handoffLabel: "Open in Groups",
      handoffTarget: "Groups",
      institutionId,
      institutionName: institution?.name || "Unlinked",
      createdAtMs,
      updatedAtMs: createdAtMs,
      amount: null,
      statusLabel: "Suspended",
      detail: {
        groupId: doc.id,
        groupCode: row.groupCode || null,
        institutionName: institution?.name || "Unlinked",
        note: row.suspendReason || null,
      },
    });
  }

  for (const doc of suspendedInstitutionSnap.docs) {
    const row = doc.data() || {};
    const createdAtMs = timestampToMillis(row.suspendedAt) || timestampToMillis(row.updatedAt);

    rows.push({
      id: `suspended_institution:${doc.id}`,
      sourceId: doc.id,
      exceptionType: "suspended_institution",
      entityType: "institution",
      severity: "high",
      status: "suspended",
      sourceModule: "Administration",
      title: `Suspended institution ${row.name || doc.id}`,
      affectedEntity: row.name || doc.id,
      summary: row.suspendReason || "This institution is suspended pending administrative review.",
      riskReason: "The institution is suspended and requires administrative review before it can return to active service.",
      recommendedAction:
        role === ROLES.SUPER_ADMIN
          ? "Open Institutions for context and reactivation controls."
          : "Review the suspension reason with a super admin before intervention.",
      reference: doc.id,
      linkedRoute: role === ROLES.SUPER_ADMIN ? "/admin/super/institutions" : null,
      sourceRoute: role === ROLES.SUPER_ADMIN ? "/admin/super/institutions" : null,
      sourceRecordType: "Institution",
      sourceRecordId: doc.id,
      sourceReference: row.name || doc.id,
      handoffLabel: role === ROLES.SUPER_ADMIN ? "Open in Institutions" : null,
      handoffTarget: role === ROLES.SUPER_ADMIN ? "Institutions" : null,
      institutionId: doc.id,
      institutionName: row.name || doc.id,
      createdAtMs,
      updatedAtMs: createdAtMs,
      amount: null,
      statusLabel: "Suspended",
      detail: {
        institutionId: doc.id,
        note: row.suspendReason || null,
      },
    });
  }

  const filteredRows = rows
    .filter((row) => (filters.severity ? row.severity === filters.severity : true))
    .filter((row) => (filters.exceptionType ? row.exceptionType === filters.exceptionType : true))
    .filter((row) => (filters.entityType ? row.entityType === filters.entityType : true))
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) => (dateFromMs ? (row.createdAtMs || 0) >= dateFromMs : true))
    .filter((row) => (dateToMs ? (row.createdAtMs || 0) <= dateToMs : true))
    .filter((row) =>
      matchesQuery(
        [
          row.title,
          row.affectedEntity,
          row.reference,
          row.summary,
          row.institutionName,
          row.detail?.groupId,
          row.detail?.groupCode,
          row.detail?.userId,
          row.detail?.phone,
          row.detail?.loanId,
          row.detail?.batchId,
          row.detail?.reconciliationId,
        ],
        filters.query
      )
    )
    .sort((a, b) => (b.updatedAtMs || b.createdAtMs || 0) - (a.updatedAtMs || a.createdAtMs || 0));

  const summary = filteredRows.reduce(
    (acc, row) => {
      acc.openExceptions += 1;
      if (row.exceptionType === "flagged_batch") acc.flaggedBatches += 1;
      if (row.exceptionType === "suspended_group") acc.suspendedGroups += 1;
      if (row.entityType === "agent" && row.status === "suspended") acc.suspendedAgents += 1;
      if (row.severity === "high") acc.highSeverityItems += 1;
      if (row.exceptionType === "flagged_reconciliation") acc.flaggedReconciliations += 1;
      return acc;
    },
    {
      openExceptions: 0,
      flaggedBatches: 0,
      suspendedGroups: 0,
      suspendedAgents: 0,
      highSeverityItems: 0,
      flaggedReconciliations: 0,
    }
  );

  const filterOptions = {
    institutions: [...new Map(
      filteredRows
        .filter((row) => row.institutionId)
        .map((row) => [row.institutionId, { id: row.institutionId, name: row.institutionName || row.institutionId }])
    ).values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""))),
  };

  return {
    role,
    summary,
    filterOptions,
    rows: filteredRows,
    backendSupport: {
      actionsSupported: false,
      detailMode: "inline",
      missing: [
        "No dedicated risk-module resolve/review/escalate actions are wired yet.",
        "Settlement blocker classification is not exposed by a backend source yet.",
      ],
    },
  };
});

exports.getExceptions = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const [flaggedBatchSnap, defaultedLoanSnap, suspendedUserSnap, suspendedGroupSnap] = await Promise.all([
    db.collection("depositBatches").where("status", "==", "flagged").limit(50).get(),
    db.collection("loans").where("status", "==", "defaulted").limit(50).get(),
    db.collection("users").where("status", "==", USER_STATUS.SUSPENDED).limit(50).get(),
    db.collection("groups").where("status", "==", GROUP_STATUS.SUSPENDED).limit(50).get(),
  ]);

  const flaggedBatches = flaggedBatchSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const defaultedLoans = defaultedLoanSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const suspendedUsers = suspendedUserSnap.docs.map((d) => {
    const dd = d.data();
    return { uid: d.id, fullName: dd.fullName || dd.name, phone: dd.phone, role: dd.role, suspendedAt: dd.suspendedAt, suspendReason: dd.suspendReason };
  });
  const suspendedGroups = suspendedGroupSnap.docs.map((d) => {
    const dd = d.data();
    return { id: d.id, name: dd.name, groupCode: dd.groupCode, suspendedAt: dd.suspendedAt, suspendReason: dd.suspendReason };
  });

  return { flaggedBatches, defaultedLoans, suspendedUsers, suspendedGroups };
});
