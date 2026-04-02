"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { ROLES } = require("./constants");
const { hashPIN } = require("./utils");
const { isNonEmptyString, isValidProvisioningPhone, isValidPin, normalizePhone, phoneToAuthEmail } = require("./validators");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

async function writeAuditLog(actorUid, actorRole, action, targetType, targetId, meta = {}) {
  try {
    await db.collection("auditLog").add({
      actorId: actorUid || null,
      actorRole: actorRole || null,
      action,
      targetType,
      targetId: targetId || null,
      meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[auditLog] Failed to write audit log:", error.message, { action, targetType, targetId });
  }
}

function toProvisioningError(error, fallbackMessage = "User provisioning failed.") {
  if (error instanceof functions.https.HttpsError) {
    return error;
  }

  const authCode = error?.errorInfo?.code || error?.code || "";
  switch (authCode) {
    case "auth/email-already-exists":
      return httpsError("already-exists", "Phone number is already registered.");
    case "auth/invalid-email":
      return httpsError("invalid-argument", "Enter a valid phone number in international format, e.g. +25766123456");
    case "auth/invalid-password":
      return httpsError("invalid-argument", "PIN is not accepted by Firebase Auth. Contact support to verify password policy.");
    case "auth/insufficient-permission":
    case "auth/unauthorized-continue-uri":
      return httpsError("permission-denied", "Insufficient permissions.");
    default:
      return httpsError("internal", fallbackMessage);
  }
}

function requireRoles(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }
  const role = context.auth.token?.role;
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }
  return { uid: context.auth.uid, role };
}

async function assertEmailNotTaken(email) {
  try {
    await auth.getUserByEmail(email);
    throw httpsError("already-exists", "Phone number is already registered.");
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    if (err.errorInfo?.code !== "auth/user-not-found") {
      functions.logger.error("assertEmailNotTaken failed", {
        code: err?.errorInfo?.code || err?.code || "unknown",
        message: err?.message || "Unknown error",
        email,
      });
      throw toProvisioningError(err, "Failed to verify existing account.");
    }
  }
}

async function provisionUserWithRole({
  fullName,
  phone,
  pin,
  role,
  callerUid,
  userExtra = {},
  extraClaims = {},
}) {
  try {
    if (!isNonEmptyString(fullName) || fullName.trim().length < 3 || fullName.trim().length > 100) {
      throw httpsError("invalid-argument", "fullName must be between 3 and 100 characters.");
    }
    if (!isValidProvisioningPhone(phone)) {
      throw httpsError(
        "invalid-argument",
        "Enter a valid phone number in international format, e.g. +25766123456"
      );
    }
    if (!isValidPin(pin)) {
      throw httpsError("invalid-argument", "PIN must be exactly 6 digits.");
    }

    const normalizedPhone = normalizePhone(phone);
    const email = phoneToAuthEmail(normalizedPhone);
    await assertEmailNotTaken(email);

    const pinHash = await hashPIN(pin);

    let uid;
    try {
      const userRecord = await auth.createUser({
        email,
        password: pin,
        displayName: fullName.trim(),
      });
      uid = userRecord.uid;
    } catch (err) {
      functions.logger.error("auth.createUser failed", {
        code: err?.errorInfo?.code || err?.code || "unknown",
        message: err?.message || "Unknown error",
        email,
      });
      throw toProvisioningError(err);
    }

    try {
      await auth.setCustomUserClaims(uid, { role, ...extraClaims });
    } catch (err) {
      functions.logger.error("auth.setCustomUserClaims failed", {
        code: err?.errorInfo?.code || err?.code || "unknown",
        message: err?.message || "Unknown error",
        uid,
        role,
      });
      throw toProvisioningError(err, "Failed to assign account role.");
    }

    try {
      await db.collection("users").doc(uid).set(
        {
          uid,
          fullName: fullName.trim(),
          phone: normalizedPhone,
          role,
          status: "active",
          groupId: null,
          isLeader: false,
          ledGroupId: null,
          nationalId: null,
          pinHash,
          createdAt: FieldValue.serverTimestamp(),
          approvedAt: FieldValue.serverTimestamp(),
          updatedAt: null,
          createdBy: callerUid,
          ...userExtra,
        },
        { merge: true }
      );
    } catch (err) {
      functions.logger.error("users write failed", {
        code: err?.code || "unknown",
        message: err?.message || "Unknown error",
        uid,
      });
      throw httpsError("internal", "Failed to save user profile.");
    }

    return { uid, normalizedPhone };
  } catch (err) {
    throw toProvisioningError(err);
  }
}

/**
 * Provision a new agent account (Firebase Auth + users/{uid} + agents/{uid}).
 * Callable by admin or super_admin.
 */
const provisionAgent = functions.https.onCall(async (data, context) => {
  requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  throw httpsError("failed-precondition", "Direct provisioning is retired. Create an invitation instead.");
});

async function getValidatedAgentRecords(agentId) {
  const agentRef = db.collection("agents").doc(agentId);
  const userRef = db.collection("users").doc(agentId);
  const [agentSnap, userSnap] = await Promise.all([agentRef.get(), userRef.get()]);

  if (!agentSnap.exists) {
    throw httpsError("not-found", "Agent profile not found.");
  }
  if (!userSnap.exists) {
    throw httpsError("failed-precondition", "Agent access record is incomplete.");
  }

  const agentData = agentSnap.data() || {};
  const userData = userSnap.data() || {};
  if (agentData.role !== ROLES.AGENT || userData.role !== ROLES.AGENT) {
    throw httpsError("failed-precondition", "Target record is not an agent.");
  }

  return { agentRef, userRef, agentData, userData };
}

const suspendAgent = functions.https.onCall(async (data, context) => {
  const caller = requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const agentId = String(data?.agentId || "").trim();
  const reason = String(data?.reason || "").trim();
  if (!isNonEmptyString(agentId)) {
    throw httpsError("invalid-argument", "agentId is required.");
  }
  if (!reason) {
    throw httpsError("invalid-argument", "reason is required.");
  }

  const { agentRef, userRef, agentData, userData } = await getValidatedAgentRecords(agentId);
  if (agentData.status === "suspended" || userData.status === "suspended") {
    throw httpsError("failed-precondition", "Agent is already suspended.");
  }

  const batch = db.batch();
  batch.update(userRef, {
    status: "suspended",
    suspendedAt: FieldValue.serverTimestamp(),
    suspendedBy: caller.uid,
    suspendReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  batch.update(agentRef, {
    status: "suspended",
    suspendedAt: FieldValue.serverTimestamp(),
    suspendedBy: caller.uid,
    suspendReason: reason,
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  await batch.commit();

  await writeAuditLog(caller.uid, caller.role, "agent_suspended", "agent", agentId, {
    reason,
    institutionId: userData.institutionId || agentData.institutionId || null,
  });

  return { success: true };
});

const reactivateAgent = functions.https.onCall(async (data, context) => {
  const caller = requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const agentId = String(data?.agentId || "").trim();
  if (!isNonEmptyString(agentId)) {
    throw httpsError("invalid-argument", "agentId is required.");
  }

  const { agentRef, userRef, agentData, userData } = await getValidatedAgentRecords(agentId);
  if (agentData.status !== "suspended" && userData.status !== "suspended") {
    throw httpsError("failed-precondition", "Agent is not suspended.");
  }

  const batch = db.batch();
  batch.update(userRef, {
    status: "active",
    reactivatedAt: FieldValue.serverTimestamp(),
    reactivatedBy: caller.uid,
    suspendReason: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  batch.update(agentRef, {
    status: "active",
    reactivatedAt: FieldValue.serverTimestamp(),
    reactivatedBy: caller.uid,
    suspendReason: FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: caller.uid,
  });
  await batch.commit();

  await writeAuditLog(caller.uid, caller.role, "agent_reactivated", "agent", agentId, {
    institutionId: userData.institutionId || agentData.institutionId || null,
  });

  return { success: true };
});

/**
 * Provision a new admin account.
 * Callable by super_admin only.
 */
const provisionAdmin = functions.https.onCall(async (data, context) => {
  requireRoles(context, [ROLES.SUPER_ADMIN]);
  throw httpsError("failed-precondition", "Direct provisioning is retired. Create an invitation instead.");
});

/**
 * Provision a new institution staff account.
 * Callable by admin or super_admin.
 */
const provisionInstitutionUser = functions.https.onCall(async (data, context) => {
  requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  throw httpsError("failed-precondition", "Direct provisioning is retired. Create an invitation instead.");
});

module.exports = {
  provisionAgent,
  suspendAgent,
  reactivateAgent,
  provisionAdmin,
  provisionInstitutionUser,
};
