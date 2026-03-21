"use strict";

/**
 * functions/src/superAdmin.js
 * Super-admin business oversight and admin management Cloud Functions.
 * All mutating operations write an audit log entry.
 */

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { ROLES, USER_STATUS, GROUP_STATUS } = require("./constants");

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
  return { configId, data: snap.exists ? snap.data() : null };
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

  const ref = db.collection("systemConfig").doc(configId);
  const before = await ref.get();
  const beforeData = before.exists ? before.data() : null;

  const payload = { ...update, updatedAt: FieldValue.serverTimestamp(), updatedBy: context.auth.uid };
  await ref.set(payload, { merge: true });

  await writeAuditLog(
    context.auth.uid,
    context.auth.token?.role,
    "config_updated",
    "systemConfig",
    configId,
    { before: beforeData, after: update }
  );

  return { success: true };
});

exports.seedSystemConfig = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN]);

  const seeds = {
    fees: {
      depositFeeFlat: 0,
      withdrawFeeFlat: 0,
      agentCommissionRate: 0.01,
    },
    loanPolicy: {
      maxLoanMultiplier: 1.5,
      minLoanAmount: 1000,
      maxLoanAmount: 5000000,
      defaultTermDays: 14,
      interestRates: { 7: 0.06, 14: 0.05, 30: 0.04 },
    },
    commissionPolicy: {
      agentDepositCommissionRate: 0.01,
      agentLoanCommissionRate: 0.005,
      settlementCycleDays: 30,
    },
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

// ── Audit Log ─────────────────────────────────────────────────────────────────

exports.getAuditLog = functions.https.onCall(async (data, context) => {
  requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const targetType = String(data?.targetType || "").trim() || null;
  const targetId = String(data?.targetId || "").trim() || null;
  const actorId = String(data?.actorId || "").trim() || null;
  const limitNum = Math.min(Number(data?.limit) || 50, 200);

  let q = db.collection("auditLog").orderBy("createdAt", "desc").limit(limitNum);

  // Apply at most one additional equality filter to keep queries index-compatible
  if (targetType) {
    q = db.collection("auditLog")
      .where("targetType", "==", targetType)
      .orderBy("createdAt", "desc")
      .limit(limitNum);
  } else if (actorId) {
    q = db.collection("auditLog")
      .where("actorId", "==", actorId)
      .orderBy("createdAt", "desc")
      .limit(limitNum);
  }

  const snap = await q.get();
  let entries = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));

  // Client-side filter for secondary conditions
  if (targetId) entries = entries.filter((e) => e.targetId === targetId);
  if (actorId && targetType) entries = entries.filter((e) => e.actorId === actorId);

  return { entries };
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

  for (const loan of loans) {
    const status = loan.status || "pending";
    countByStatus[status] = (countByStatus[status] || 0) + 1;

    const amount = Number(loan.amount || 0);
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

  return {
    portfolio: {
      totalPortfolio,
      totalDeployed,
      totalDefaulted,
      totalRepaid,
      pendingDisbursement,
      countByStatus,
      overdueLoanCount,
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
