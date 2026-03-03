"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { ROLES } = require("./constants");
const { hashPIN } = require("./utils");
const { isNonEmptyString, isValidBurundiPhone, isValidPin, normalizePhone } = require("./validators");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

// Local to agents.js — custom claim required strictly; no Firestore fallback.
function requireSuperAdmin(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }
  if (context.auth.token?.role !== ROLES.SUPER_ADMIN) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }
}

/**
 * Provision a new agent account (Firebase Auth + users/{uid} + agents/{uid}).
 * Callable by super_admin only.
 */
const provisionAgent = functions.https.onCall(async (data, context) => {
  await requireSuperAdmin(context);

  const { fullName, phone, pin } = data;

  // Validate inputs
  if (!isNonEmptyString(fullName) || fullName.trim().length < 3 || fullName.trim().length > 100) {
    throw httpsError("invalid-argument", "fullName must be between 3 and 100 characters.");
  }
  if (!isValidBurundiPhone(phone)) {
    throw httpsError("invalid-argument", "phone must be in +257XXXXXXXX format.");
  }
  if (!isValidPin(pin)) {
    throw httpsError("invalid-argument", "pin must be exactly 4 digits.");
  }

  const normalizedPhone = normalizePhone(phone);
  const email = `${normalizedPhone}@kirimba.app`;
  const callerUid = context.auth.uid;

  // Duplicate check
  try {
    await auth.getUserByEmail(email);
    throw httpsError("already-exists", "Phone number is already registered.");
  } catch (err) {
    if (err.code === "already-exists") throw err;
    if (err.errorInfo?.code !== "auth/user-not-found") {
      throw httpsError("internal", "Agent provisioning failed.");
    }
    // auth/user-not-found is expected — proceed
  }

  // Hash PIN
  const pinHash = await hashPIN(pin);

  // Create Firebase Auth user
  let uid;
  try {
    const userRecord = await auth.createUser({
      email,
      password: pinHash,
      displayName: fullName.trim(),
    });
    uid = userRecord.uid;
  } catch (err) {
    throw httpsError("internal", "Agent provisioning failed.");
  }

  // Set custom claim before Firestore writes
  await auth.setCustomUserClaims(uid, { role: ROLES.AGENT });

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
      pinHash,
      createdAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: null,
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
 * Callable by super_admin only.
 */
const assignAgentToGroup = functions.https.onCall(async (data, context) => {
  await requireSuperAdmin(context);

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

module.exports = { provisionAgent, assignAgentToGroup };
