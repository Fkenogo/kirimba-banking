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
  return context.auth.uid;
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
      await auth.setCustomUserClaims(uid, { role });
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
  const callerUid = requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const { fullName, phone, pin } = data;
  const { uid, normalizedPhone } = await provisionUserWithRole({
    fullName,
    phone,
    pin,
    role: ROLES.AGENT,
    callerUid,
  });

  // Atomic batch write
  const batch = db.batch();

  const userRef = db.collection("users").doc(uid);
  batch.set(
    userRef,
    {
      uid,
      fullName: fullName.trim(),
      phone: normalizedPhone,
      role: ROLES.AGENT,
      status: "active",
      groupId: null,
      isLeader: false,
      ledGroupId: null,
      nationalId: null,
      createdAt: FieldValue.serverTimestamp(),
      createdBy: callerUid,
      },
      { merge: true }
  );

  const agentRef = db.collection("agents").doc(uid);
  batch.set(agentRef, {
    uid,
    fullName: fullName.trim(),
    phone: normalizedPhone,
    role: ROLES.AGENT,
    status: "active",
    assignedGroups: [],
    createdAt: FieldValue.serverTimestamp(),
    createdBy: callerUid,
    updatedAt: null,
  });

  await batch.commit();

  return { success: true, agentId: uid };
});

/**
 * Assign a provisioned agent to an active group.
 * Callable by admin or super_admin.
 */
const assignAgentToGroup = functions.https.onCall(async (data, context) => {
  requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const { agentId, groupId } = data;

  // Validate inputs
  if (!isNonEmptyString(agentId) || !isNonEmptyString(groupId)) {
    throw httpsError("invalid-argument", "agentId and groupId are required.");
  }

  const agentRef = db.collection("agents").doc(agentId);
  const groupRef = db.collection("groups").doc(groupId);

  // Load documents in parallel
  const [agentSnap, groupSnap] = await Promise.all([agentRef.get(), groupRef.get()]);

  // Validate agent
  if (!agentSnap.exists) {
    throw httpsError("not-found", "Agent not found.");
  }
  const agentData = agentSnap.data();
  if (agentData.role !== ROLES.AGENT) {
    throw httpsError("failed-precondition", "User is not an agent.");
  }
  if (agentData.status !== "active") {
    throw httpsError("failed-precondition", "Agent is not active.");
  }
  if ((agentData.assignedGroups || []).includes(groupId)) {
    throw httpsError("already-exists", "Agent is already assigned to this group.");
  }

  // Validate group
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Group not found.");
  }
  if (groupSnap.data().status !== "active") {
    throw httpsError("failed-precondition", "Group is not active.");
  }

  // Atomic batch write
  const batch = db.batch();
  batch.update(agentRef, { assignedGroups: FieldValue.arrayUnion(groupId), updatedAt: FieldValue.serverTimestamp() });
  batch.set(
    db.collection("users").doc(agentId),
    { assignedGroups: FieldValue.arrayUnion(groupId), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
  await batch.commit();

  return { success: true };
});

/**
 * Provision a new admin account.
 * Callable by super_admin only.
 */
const provisionAdmin = functions.https.onCall(async (data, context) => {
  const callerUid = requireRoles(context, [ROLES.SUPER_ADMIN]);
  const { fullName, phone, pin } = data;
  const { uid } = await provisionUserWithRole({
    fullName,
    phone,
    pin,
    role: ROLES.ADMIN,
    callerUid,
  });
  return { success: true, adminId: uid };
});

/**
 * Provision a new institution staff account.
 * Callable by admin or super_admin.
 */
const provisionInstitutionUser = functions.https.onCall(async (data, context) => {
  const callerUid = requireRoles(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const { fullName, phone, pin, institutionId } = data;
  const extra = {};
  if (isNonEmptyString(institutionId)) {
    extra.institutionId = institutionId.trim();
  }

  const { uid } = await provisionUserWithRole({
    fullName,
    phone,
    pin,
    role: ROLES.UMUCO,
    callerUid,
    userExtra: extra,
  });

  return { success: true, institutionUserId: uid };
});

module.exports = {
  provisionAgent,
  assignAgentToGroup,
  provisionAdmin,
  provisionInstitutionUser,
};
