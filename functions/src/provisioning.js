"use strict";

const crypto = require("crypto");
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { ROLES } = require("./constants");
const { hashPIN } = require("./utils");
const {
  isNonEmptyString,
  isValidProvisioningPhone,
  isValidPin,
  normalizePhone,
  phoneToAuthEmail,
} = require("./validators");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();

const INVITATION_COLLECTION = "userInvitations";
const INVITE_EXPIRY_DAYS = 7;
const INVITE_STATUSES = {
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  REVOKED: "revoked",
};

const INVITE_ROLES = {
  [ROLES.ADMIN]: {
    label: "Operations Admin",
    accountType: "admin_access",
    allowedCreators: [ROLES.SUPER_ADMIN],
    requiresInstitution: false,
    loginSurface: "admin_console",
  },
  [ROLES.FINANCE]: {
    label: "Finance",
    accountType: "admin_access",
    allowedCreators: [ROLES.SUPER_ADMIN],
    requiresInstitution: false,
    loginSurface: "admin_console",
  },
  [ROLES.INSTITUTION_USER]: {
    label: "Institution User",
    accountType: "institution_access",
    allowedCreators: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    requiresInstitution: true,
    loginSurface: "institution_console",
  },
  [ROLES.AGENT]: {
    label: "Agent",
    accountType: "field_access",
    allowedCreators: [ROLES.SUPER_ADMIN, ROLES.ADMIN],
    requiresInstitution: true,
    loginSurface: "agent_console",
  },
};

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
  return { uid: context.auth.uid, role };
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

function formatLabel(value) {
  return String(value || "Unknown")
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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function matchesQuery(fields, query) {
  const needle = normalizeText(query);
  if (!needle) return true;
  return fields.some((field) => normalizeText(field).includes(needle));
}

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function generateRawToken() {
  return crypto.randomBytes(24).toString("base64url");
}

async function generateInvitationCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `INV-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
    const existing = await db.collection(INVITATION_COLLECTION).where("inviteCode", "==", code).limit(1).get();
    if (existing.empty) return code;
  }
  throw httpsError("resource-exhausted", "Unable to generate a unique invitation code.");
}

function buildExpirationTimestamp() {
  return Timestamp.fromDate(new Date(Date.now() + INVITE_EXPIRY_DAYS * 24 * 60 * 60 * 1000));
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

function sanitizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

function getRoleConfig(role) {
  return INVITE_ROLES[sanitizeRole(role)] || null;
}

function assertRoleAllowedForCaller(callerRole, targetRole) {
  const roleConfig = getRoleConfig(targetRole);
  if (!roleConfig) {
    throw httpsError("invalid-argument", "Unsupported invitation role.");
  }
  if (!roleConfig.allowedCreators.includes(callerRole)) {
    throw httpsError("permission-denied", "Your role cannot invite this account type.");
  }
  return roleConfig;
}

async function getCallerProfile(uid) {
  if (!uid) return null;
  const snap = await db.collection("users").doc(uid).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

async function assertPhoneNotRegistered(phone) {
  const normalizedPhone = normalizePhone(phone);
  const authEmail = phoneToAuthEmail(normalizedPhone);

  try {
    await auth.getUserByEmail(authEmail);
    throw httpsError("already-exists", "This phone number is already registered.");
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    if (error?.errorInfo?.code !== "auth/user-not-found") {
      throw httpsError("internal", "Failed to verify existing account.");
    }
  }

  const userSnap = await db.collection("users").where("phone", "==", normalizedPhone).limit(1).get();
  if (!userSnap.empty) {
    throw httpsError("already-exists", "This phone number is already linked to an existing platform user.");
  }
}

async function resolveLinkage(roleConfig, rawInstitutionId, rawGroupId) {
  const institutionId = isNonEmptyString(rawInstitutionId) ? String(rawInstitutionId).trim() : null;
  const groupId = isNonEmptyString(rawGroupId) ? String(rawGroupId).trim() : null;

  if (roleConfig.requiresInstitution && !institutionId) {
    throw httpsError("invalid-argument", "institutionId is required for this invitation role.");
  }

  if (!roleConfig.requiresInstitution && institutionId) {
    throw httpsError("invalid-argument", "This invitation role does not accept institution linkage.");
  }

  if (!roleConfig.requiresInstitution && groupId) {
    throw httpsError("invalid-argument", "This invitation role does not accept group linkage.");
  }

  let institution = null;
  if (institutionId) {
    const institutionSnap = await db.collection("institutions").doc(institutionId).get();
    if (!institutionSnap.exists) {
      throw httpsError("not-found", `Institution "${institutionId}" not found.`);
    }
    institution = institutionSnap.data() || {};
    if (institution.status === "suspended") {
      throw httpsError("failed-precondition", "This institution is suspended and cannot receive new invitations.");
    }
  }

  let group = null;
  if (groupId) {
    const groupSnap = await db.collection("groups").doc(groupId).get();
    if (!groupSnap.exists) {
      throw httpsError("not-found", `Group "${groupId}" not found.`);
    }
    group = groupSnap.data() || {};
    if (institutionId && group.institutionId && group.institutionId !== institutionId) {
      throw httpsError("failed-precondition", "The selected group does not belong to the selected institution.");
    }
  }

  return {
    institutionId,
    institutionName: institution?.name || null,
    groupId,
    groupName: group?.name || null,
  };
}

function getAcceptanceBaseUrl() {
  const configured = String(process.env.INVITE_ACCEPT_BASE_URL || "").trim();
  return configured || "http://127.0.0.1:5175/admin/invitations/accept";
}

function buildAcceptanceLink(invitationId, token) {
  const url = new URL(getAcceptanceBaseUrl());
  url.searchParams.set("invitation", invitationId);
  url.searchParams.set("token", token);
  return url.toString();
}

function deriveStatus(invitation) {
  const status = invitation.status || INVITE_STATUSES.PENDING;
  if (status !== INVITE_STATUSES.PENDING) return status;
  const expiresAtMs = timestampToMillis(invitation.expiresAt);
  if (expiresAtMs && expiresAtMs <= Date.now()) return INVITE_STATUSES.EXPIRED;
  return INVITE_STATUSES.PENDING;
}

async function syncExpiredInvitation(docRef, invitation) {
  const derivedStatus = deriveStatus(invitation);
  if (derivedStatus === INVITE_STATUSES.EXPIRED && invitation.status !== INVITE_STATUSES.EXPIRED) {
    await docRef.set(
      {
        status: INVITE_STATUSES.EXPIRED,
        expiredAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return { ...invitation, status: INVITE_STATUSES.EXPIRED };
  }
  return { ...invitation, status: derivedStatus };
}

function mapInvitationRow(id, invitation, creator) {
  const roleConfig = getRoleConfig(invitation.role) || {};
  const status = deriveStatus(invitation);
  return {
    id,
    inviteCode: invitation.inviteCode || id,
    inviteeName: invitation.targetName || "Unnamed invitee",
    inviteePhone: invitation.targetPhone || null,
    inviteeEmail: invitation.targetEmail || null,
    role: invitation.role || null,
    roleLabel: roleConfig.label || formatLabel(invitation.role),
    accountType: invitation.accountType || roleConfig.accountType || null,
    accountTypeLabel: formatLabel(invitation.accountType || roleConfig.accountType),
    institutionId: invitation.institutionId || null,
    institutionName: invitation.institutionName || null,
    groupId: invitation.groupId || null,
    groupName: invitation.groupName || null,
    inviteMethod: invitation.inviteMethod || "link",
    status,
    createdBy: invitation.createdBy || null,
    createdByName: creator?.fullName || creator?.name || invitation.createdBy || "Unknown",
    createdAt: invitation.createdAt || null,
    updatedAt: invitation.updatedAt || null,
    expiresAt: invitation.expiresAt || null,
    acceptedAt: invitation.acceptedAt || null,
    revokedAt: invitation.revokedAt || null,
    acceptedUserId: invitation.acceptedUserId || null,
    loginSurface: roleConfig.loginSurface || "admin_console",
    canReissueLink: status !== INVITE_STATUSES.ACCEPTED && status !== INVITE_STATUSES.REVOKED,
  };
}

function canManageInvitation(callerRole, invitationRole) {
  const roleConfig = getRoleConfig(invitationRole);
  return Boolean(roleConfig && roleConfig.allowedCreators.includes(callerRole));
}

function buildClaims(invitation) {
  const claims = { role: invitation.role };
  if (invitation.role === ROLES.INSTITUTION_USER || invitation.role === ROLES.AGENT) {
    claims.institutionId = invitation.institutionId;
  }
  return claims;
}

async function createAcceptedUserFromInvitation(invitation) {
  const fullName = String(invitation.targetName || "").trim();
  const phone = normalizePhone(invitation.targetPhone);
  const authEmail = phoneToAuthEmail(phone);

  const pinHash = await hashPIN(invitation.pinToHash || "");
  const userRecord = await auth.createUser({
    email: authEmail,
    password: invitation.pinToHash,
    displayName: fullName,
  });

  try {
    await auth.setCustomUserClaims(userRecord.uid, buildClaims(invitation));

    const userPayload = {
      uid: userRecord.uid,
      fullName,
      phone,
      email: invitation.targetEmail || null,
      role: invitation.role,
      status: "active",
      groupId: invitation.groupId || null,
      isLeader: false,
      ledGroupId: null,
      nationalId: null,
      pinHash,
      createdAt: FieldValue.serverTimestamp(),
      approvedAt: FieldValue.serverTimestamp(),
      updatedAt: null,
      createdBy: invitation.createdBy || null,
      invitedBy: invitation.createdBy || null,
      invitationId: invitation.id,
      invitationAcceptedAt: FieldValue.serverTimestamp(),
      institutionId: invitation.institutionId || null,
    };

    const batch = db.batch();
    batch.set(db.collection("users").doc(userRecord.uid), userPayload, { merge: true });

    if (invitation.role === ROLES.AGENT) {
      batch.set(db.collection("agents").doc(userRecord.uid), {
        uid: userRecord.uid,
        fullName,
        phone,
        role: ROLES.AGENT,
        status: "active",
        institutionId: invitation.institutionId || null,
        createdAt: FieldValue.serverTimestamp(),
        createdBy: invitation.createdBy || null,
        invitationId: invitation.id,
        updatedAt: null,
      }, { merge: true });
    }

    await batch.commit();
    return { uid: userRecord.uid };
  } catch (error) {
    try {
      await auth.deleteUser(userRecord.uid);
    } catch {
      // Best-effort cleanup only.
    }
    throw error;
  }
}

exports.createUserInvitation = functions.https.onCall(async (data, context) => {
  const caller = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const role = sanitizeRole(data?.role);
  const roleConfig = assertRoleAllowedForCaller(caller.role, role);

  const targetName = String(data?.targetName || data?.fullName || "").trim();
  if (targetName.length < 3 || targetName.length > 100) {
    throw httpsError("invalid-argument", "targetName must be between 3 and 100 characters.");
  }

  const targetPhone = normalizePhone(data?.targetPhone || data?.phone || "");
  if (!isValidProvisioningPhone(targetPhone)) {
    throw httpsError("invalid-argument", "Enter a valid phone number in international format, e.g. +25766123456");
  }

  const targetEmail = isNonEmptyString(data?.targetEmail)
    ? String(data.targetEmail).trim().toLowerCase()
    : null;

  await assertPhoneNotRegistered(targetPhone);

  const linkage = await resolveLinkage(roleConfig, data?.institutionId, data?.groupId);
  const callerProfile = await getCallerProfile(caller.uid);
  const inviteCode = await generateInvitationCode();
  const rawToken = generateRawToken();
  const invitationRef = db.collection(INVITATION_COLLECTION).doc();

  await invitationRef.set({
    role,
    accountType: roleConfig.accountType,
    targetName,
    targetPhone,
    targetEmail,
    institutionId: linkage.institutionId,
    institutionName: linkage.institutionName,
    groupId: linkage.groupId,
    groupName: linkage.groupName,
    createdBy: caller.uid,
    createdByRole: caller.role,
    createdByName: callerProfile?.fullName || callerProfile?.name || null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt: buildExpirationTimestamp(),
    status: INVITE_STATUSES.PENDING,
    inviteMethod: "link",
    inviteCode,
    acceptanceTokenHash: hashToken(rawToken),
    lastIssuedAt: FieldValue.serverTimestamp(),
    acceptedAt: null,
    acceptedUserId: null,
    revokedAt: null,
    revokedBy: null,
  });

  await writeAuditLog(caller.uid, caller.role, "user_invitation_created", "user_invitation", invitationRef.id, {
    role,
    institutionId: linkage.institutionId,
    groupId: linkage.groupId,
    targetPhone,
  });

  return {
    success: true,
    invitationId: invitationRef.id,
    inviteCode,
    acceptanceLink: buildAcceptanceLink(invitationRef.id, rawToken),
    expiresAt: buildExpirationTimestamp().toMillis(),
  };
});

exports.listUserInvitations = functions.https.onCall(async (data, context) => {
  const caller = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const filters = {
    role: sanitizeRole(data?.role),
    status: sanitizeRole(data?.status),
    institutionId: String(data?.institutionId || "").trim(),
    query: String(data?.query || "").trim(),
  };

  const [inviteSnap, institutionSnap] = await Promise.all([
    db.collection(INVITATION_COLLECTION).orderBy("createdAt", "desc").limit(250).get(),
    db.collection("institutions").where("status", "==", "active").get(),
  ]);

  const rawInvitations = [];
  for (const doc of inviteSnap.docs) {
    const synced = await syncExpiredInvitation(doc.ref, doc.data() || {});
    rawInvitations.push({ id: doc.id, ...synced });
  }

  const creatorMap = await getDocumentsByIds("users", rawInvitations.map((invite) => invite.createdBy).filter(Boolean));

  const rows = rawInvitations
    .map((invite) => {
      const creator = invite.createdBy ? creatorMap.get(invite.createdBy) : null;
      const row = mapInvitationRow(invite.id, invite, creator);
      return {
        ...row,
        availableActions: {
          canRevoke: row.status === INVITE_STATUSES.PENDING && canManageInvitation(caller.role, row.role),
          canRegenerate: (row.status === INVITE_STATUSES.PENDING || row.status === INVITE_STATUSES.EXPIRED) &&
            canManageInvitation(caller.role, row.role),
        },
      };
    })
    .filter((row) => (filters.role ? row.role === filters.role : true))
    .filter((row) => (filters.status ? row.status === filters.status : true))
    .filter((row) => (filters.institutionId ? row.institutionId === filters.institutionId : true))
    .filter((row) =>
      matchesQuery(
        [
          row.inviteeName,
          row.inviteePhone,
          row.inviteeEmail,
          row.inviteCode,
          row.id,
          row.institutionName,
          row.groupName,
          row.createdByName,
        ],
        filters.query
      )
    );

  const summary = rows.reduce(
    (acc, row) => {
      acc.totalInvitations += 1;
      if (row.status === INVITE_STATUSES.PENDING) acc.pendingInvitations += 1;
      if (row.status === INVITE_STATUSES.ACCEPTED) acc.acceptedInvitations += 1;
      if (row.status === INVITE_STATUSES.EXPIRED) acc.expiredInvitations += 1;
      if (row.status === INVITE_STATUSES.REVOKED) acc.revokedInvitations += 1;
      return acc;
    },
    {
      totalInvitations: 0,
      pendingInvitations: 0,
      acceptedInvitations: 0,
      expiredInvitations: 0,
      revokedInvitations: 0,
    }
  );

  return {
    role: caller.role,
    summary,
    rows,
    filterOptions: {
      roles: Object.entries(INVITE_ROLES)
        .filter(([, config]) => config.allowedCreators.includes(caller.role))
        .map(([value, config]) => ({ value, label: config.label }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      statuses: [
        { value: INVITE_STATUSES.PENDING, label: "Pending" },
        { value: INVITE_STATUSES.ACCEPTED, label: "Accepted" },
        { value: INVITE_STATUSES.EXPIRED, label: "Expired" },
        { value: INVITE_STATUSES.REVOKED, label: "Revoked" },
      ],
      institutions: institutionSnap.docs
        .map((doc) => ({ id: doc.id, name: doc.data()?.name || doc.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    createOptions: {
      roles: Object.entries(INVITE_ROLES)
        .filter(([, config]) => config.allowedCreators.includes(caller.role))
        .map(([value, config]) => ({
          value,
          label: config.label,
          accountType: config.accountType,
          requiresInstitution: config.requiresInstitution,
          loginSurface: config.loginSurface,
        })),
      institutions: institutionSnap.docs
        .map((doc) => ({ id: doc.id, name: doc.data()?.name || doc.id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    },
    backendSupport: {
      acceptanceFlow: true,
      deliveryModel: "secure_link",
      revocationSupported: true,
      regenerationSupported: true,
    },
  };
});

exports.revokeUserInvitation = functions.https.onCall(async (data, context) => {
  const caller = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const invitationId = String(data?.invitationId || "").trim();
  if (!invitationId) throw httpsError("invalid-argument", "invitationId is required.");

  const invitationRef = db.collection(INVITATION_COLLECTION).doc(invitationId);
  const invitationSnap = await invitationRef.get();
  if (!invitationSnap.exists) throw httpsError("not-found", "Invitation not found.");

  const invitation = await syncExpiredInvitation(invitationRef, invitationSnap.data() || {});
  if (!canManageInvitation(caller.role, invitation.role)) {
    throw httpsError("permission-denied", "Your role cannot revoke this invitation.");
  }
  if (invitation.status === INVITE_STATUSES.ACCEPTED) {
    throw httpsError("failed-precondition", "Accepted invitations cannot be revoked.");
  }
  if (invitation.status === INVITE_STATUSES.REVOKED) {
    throw httpsError("failed-precondition", "This invitation is already revoked.");
  }

  await invitationRef.set({
    status: INVITE_STATUSES.REVOKED,
    revokedAt: FieldValue.serverTimestamp(),
    revokedBy: caller.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAuditLog(caller.uid, caller.role, "user_invitation_revoked", "user_invitation", invitationId, {
    role: invitation.role,
  });

  return { success: true };
});

exports.regenerateUserInvitation = functions.https.onCall(async (data, context) => {
  const caller = requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);
  const invitationId = String(data?.invitationId || "").trim();
  if (!invitationId) throw httpsError("invalid-argument", "invitationId is required.");

  const invitationRef = db.collection(INVITATION_COLLECTION).doc(invitationId);
  const invitationSnap = await invitationRef.get();
  if (!invitationSnap.exists) throw httpsError("not-found", "Invitation not found.");

  const invitation = await syncExpiredInvitation(invitationRef, invitationSnap.data() || {});
  if (!canManageInvitation(caller.role, invitation.role)) {
    throw httpsError("permission-denied", "Your role cannot regenerate this invitation.");
  }
  if (invitation.status === INVITE_STATUSES.ACCEPTED || invitation.status === INVITE_STATUSES.REVOKED) {
    throw httpsError("failed-precondition", "This invitation can no longer be reissued.");
  }

  const rawToken = generateRawToken();
  const inviteCode = await generateInvitationCode();
  await invitationRef.set({
    status: INVITE_STATUSES.PENDING,
    inviteCode,
    acceptanceTokenHash: hashToken(rawToken),
    expiresAt: buildExpirationTimestamp(),
    lastIssuedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAuditLog(caller.uid, caller.role, "user_invitation_reissued", "user_invitation", invitationId, {
    role: invitation.role,
  });

  return {
    success: true,
    invitationId,
    inviteCode,
    acceptanceLink: buildAcceptanceLink(invitationId, rawToken),
    expiresAt: buildExpirationTimestamp().toMillis(),
  };
});

exports.getUserInvitationAcceptance = functions.https.onCall(async (data) => {
  const invitationId = String(data?.invitationId || "").trim();
  const token = String(data?.token || "").trim();
  if (!invitationId || !token) {
    throw httpsError("invalid-argument", "invitationId and token are required.");
  }

  const invitationRef = db.collection(INVITATION_COLLECTION).doc(invitationId);
  const invitationSnap = await invitationRef.get();
  if (!invitationSnap.exists) throw httpsError("not-found", "Invitation not found.");

  const invitation = await syncExpiredInvitation(invitationRef, invitationSnap.data() || {});
  if (invitation.acceptanceTokenHash !== hashToken(token)) {
    throw httpsError("permission-denied", "This invitation link is not valid.");
  }
  if (invitation.status !== INVITE_STATUSES.PENDING) {
    throw httpsError("failed-precondition", "This invitation is no longer available for acceptance.");
  }

  const roleConfig = getRoleConfig(invitation.role) || {};
  return {
    invitation: {
      id: invitationId,
      inviteCode: invitation.inviteCode,
      targetName: invitation.targetName || null,
      targetPhone: invitation.targetPhone || null,
      targetEmail: invitation.targetEmail || null,
      role: invitation.role,
      roleLabel: roleConfig.label || formatLabel(invitation.role),
      institutionName: invitation.institutionName || null,
      groupName: invitation.groupName || null,
      expiresAt: timestampToMillis(invitation.expiresAt),
      loginSurface: roleConfig.loginSurface || "admin_console",
    },
  };
});

exports.acceptUserInvitation = functions.https.onCall(async (data) => {
  const invitationId = String(data?.invitationId || "").trim();
  const token = String(data?.token || "").trim();
  const pin = String(data?.pin || "").trim();

  if (!invitationId || !token) {
    throw httpsError("invalid-argument", "invitationId and token are required.");
  }
  if (!isValidPin(pin)) {
    throw httpsError("invalid-argument", "PIN must be exactly 6 digits.");
  }

  const invitationRef = db.collection(INVITATION_COLLECTION).doc(invitationId);
  const invitationSnap = await invitationRef.get();
  if (!invitationSnap.exists) throw httpsError("not-found", "Invitation not found.");

  const invitation = await syncExpiredInvitation(invitationRef, invitationSnap.data() || {});
  if (invitation.acceptanceTokenHash !== hashToken(token)) {
    throw httpsError("permission-denied", "This invitation link is not valid.");
  }
  if (invitation.status !== INVITE_STATUSES.PENDING) {
    throw httpsError("failed-precondition", "This invitation is no longer available for acceptance.");
  }
  if (!isValidProvisioningPhone(invitation.targetPhone)) {
    throw httpsError("failed-precondition", "This invitation is missing a valid phone number.");
  }

  await assertPhoneNotRegistered(invitation.targetPhone);
  const accepted = await createAcceptedUserFromInvitation({
    ...invitation,
    id: invitationId,
    pinToHash: pin,
  });

  await invitationRef.set({
    status: INVITE_STATUSES.ACCEPTED,
    acceptedAt: FieldValue.serverTimestamp(),
    acceptedUserId: accepted.uid,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  await writeAuditLog(accepted.uid, invitation.role, "user_invitation_accepted", "user_invitation", invitationId, {
    acceptedUserId: accepted.uid,
    invitedRole: invitation.role,
  });

  const roleConfig = getRoleConfig(invitation.role) || {};
  return {
    success: true,
    acceptedUserId: accepted.uid,
    loginSurface: roleConfig.loginSurface || "admin_console",
    role: invitation.role,
  };
});

exports.disableDirectProvisioning = functions.https.onCall(async () => {
  throw httpsError("failed-precondition", "Direct provisioning is retired. Use the invitation flow.");
});
