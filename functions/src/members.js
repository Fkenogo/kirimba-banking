"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const {
  ROLES,
  USER_STATUS,
  GROUP_STATUS,
  JOIN_REQUEST_STATUS,
} = require("./constants");
const {
  assert,
  isNonEmptyString,
  normalizePhone,
  isValidProvisioningPhone,
  isValidPin,
  phoneToAuthEmail,
} = require("./validators");
const { generateGroupCode, generateInviteCode, hashPIN } = require("./utils");

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
      actorId: actorUid,
      actorRole,
      action,
      targetType,
      targetId: targetId || null,
      meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error("[auditLog] Failed to write audit log:", err.message, { action, targetType, targetId });
  }
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

// Trim only — do NOT lowercase. Institution IDs are Firestore doc IDs and may
// contain uppercase characters (e.g. "MVMICrbccp7YOljsPVG0").
function normalizeInstitutionId(rawValue) {
  return String(rawValue || "").trim();
}

// Validates that an institution doc exists and is active. Throws on failure.
async function requireActiveInstitution(institutionId) {
  if (!institutionId) {
    throw httpsError("invalid-argument", "institutionId is required.");
  }
  const snap = await db.collection("institutions").doc(institutionId).get();
  if (!snap.exists) {
    throw httpsError("not-found", `Institution "${institutionId}" not found.`);
  }
  if (snap.data().status !== "active") {
    throw httpsError("failed-precondition", `Institution "${institutionId}" is not currently active.`);
  }
}

async function requireActiveMember(context) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const userSnap = await db.collection("users").doc(context.auth.uid).get();
  if (!userSnap.exists) {
    throw httpsError("not-found", "User profile not found.");
  }

  const user = userSnap.data();
  const claimRole = context.auth.token?.role;
  const profileRole = user.role;
  const hasMemberRole =
    claimRole === ROLES.MEMBER ||
    claimRole === ROLES.LEADER ||
    profileRole === ROLES.MEMBER ||
    profileRole === ROLES.LEADER;
  if (!hasMemberRole) {
    throw httpsError("permission-denied", "Member account required.");
  }

  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  return { uid: context.auth.uid, user };
}

async function getUniqueInviteCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = generateInviteCode();
    const existing = await db
      .collection("groups")
      .where("inviteCode", "==", code)
      .limit(1)
      .get();
    if (existing.empty) return code;
  }
  throw new functions.https.HttpsError("internal", "Failed to generate a unique invite code.");
}

async function getUniqueGroupCode() {
  for (let i = 0; i < 10; i += 1) {
    const code = generateGroupCode();
    const existing = await db
      .collection("groups")
      .where("groupCode", "==", code)
      .limit(1)
      .get();

    if (existing.empty) {
      return code;
    }
  }

  throw httpsError("resource-exhausted", "Unable to generate unique group code.");
}

function buildMemberIdCandidate(uid) {
  const uidSuffix = String(uid || "")
    .slice(-4)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X")
    .padStart(4, "X");
  const random3 = Math.floor(100 + Math.random() * 900);
  return `M-${uidSuffix}-${random3}`;
}

async function getUniqueMemberId(uid) {
  for (let i = 0; i < 50; i += 1) {
    const memberId = buildMemberIdCandidate(uid);
    const existing = await db
      .collection("users")
      .where("memberId", "==", memberId)
      .limit(1)
      .get();
    if (existing.empty) {
      return memberId;
    }
  }
  throw httpsError("resource-exhausted", "Unable to generate unique memberId.");
}

exports.registerMember = functions.https.onCall(async (data) => {
  try {
    const fullName = (data?.fullName || "").trim();
    const phone = normalizePhone(data?.phone || "");
    const email = isNonEmptyString(data?.email) ? String(data.email).trim().toLowerCase() : null;
    const nationalId = isNonEmptyString(data?.nationalId)
      ? data.nationalId.trim()
      : null;
    const pin = String(data?.pin || "");
    const groupCodeToJoin = isNonEmptyString(data?.groupCodeToJoin)
      ? data.groupCodeToJoin.trim().toUpperCase()
      : null;

    assert(isNonEmptyString(fullName), "fullName is required.");
    assert(
      isValidProvisioningPhone(phone),
      "Enter a valid phone number in international format, e.g. +25766123456"
    );
    if (email) {
      assert(/^\S+@\S+\.\S+$/.test(email), "email must be a valid email address.");
    }
    assert(isValidPin(pin), "PIN must be exactly 6 digits.");

    const authEmail = phoneToAuthEmail(phone);
    const existingUser = await auth.getUserByEmail(authEmail).catch(() => null);
    if (existingUser) {
      throw httpsError("already-exists", "Phone is already registered.");
    }

    const pinHash = await hashPIN(pin);
    const createdAuthUser = await auth.createUser({
      email: authEmail,
      password: pin,
      displayName: fullName,
      disabled: false,
    });

    await db.collection("users").doc(createdAuthUser.uid).set(
      {
        uid: createdAuthUser.uid,
        fullName,
        phone,
        email,
        nationalId,
        role: ROLES.MEMBER,
        status: USER_STATUS.PENDING_APPROVAL,
        groupId: null,
        isLeader: false,
        ledGroupId: null,
        pinHash,
        groupCodeToJoin,
        createdAt: FieldValue.serverTimestamp(),
        approvedAt: null,
      },
      { merge: true }
    );

    return { success: true, userId: createdAuthUser.uid };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }

    throw httpsError("invalid-argument", error.message || "Failed to register member.");
  }
});

exports.approveMember = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const userId = String(data?.userId || "").trim();
  if (!userId) {
    throw httpsError("invalid-argument", "userId is required.");
  }

  const userRef = db.collection("users").doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw httpsError("not-found", "User not found.");
  }

  const user = userSnap.data();
  const memberId = user.memberId || await getUniqueMemberId(userId);
  await userRef.set(
    {
      status: USER_STATUS.ACTIVE,
      memberId,
      approvedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await auth.setCustomUserClaims(userId, { role: ROLES.MEMBER });

  if (user.groupCodeToJoin) {
    const groupQuery = await db
      .collection("groups")
      .where("groupCode", "==", user.groupCodeToJoin)
      .limit(1)
      .get();

    if (!groupQuery.empty) {
      const groupDoc = groupQuery.docs[0];
      const joinRequestRef = db
        .collection("groups")
        .doc(groupDoc.id)
        .collection("joinRequests")
        .doc(userId);

      await joinRequestRef.set(
        {
          userId,
          groupId: groupDoc.id,
          status: JOIN_REQUEST_STATUS.PENDING,
          createdAt: FieldValue.serverTimestamp(),
          requestedBy: userId,
        },
        { merge: true }
      );

      await db.collection("notifications").add({
        type: "join_request",
        groupId: groupDoc.id,
        userId,
        recipientId: groupDoc.data().leaderId || null,
        status: "unread",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
      });
    }
  }

  const actorRole = context.auth.token?.role;
  await writeAuditLog(context.auth.uid, actorRole, "member_approved", "user", userId, { memberId });

  return { success: true };
});

exports.rejectMember = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const userId = String(data?.userId || "").trim();
  const reason = String(data?.reason || "").trim();

  if (!userId || !reason) {
    throw httpsError("invalid-argument", "userId and reason are required.");
  }

  await db.collection("users").doc(userId).set(
    {
      status: USER_STATUS.REJECTED,
      rejectionReason: reason,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  const actorRole = context.auth.token?.role;
  await writeAuditLog(context.auth.uid, actorRole, "member_rejected", "user", userId, { reason });

  return { success: true };
});

exports.createGroup = functions.https.onCall(async (data, context) => {
  const { uid, user } = await requireActiveMember(context);

  const name = String(data?.name || "").trim();
  const description = String(data?.description || "").trim();

  if (!name || !description) {
    throw httpsError("invalid-argument", "name and description are required.");
  }

  const institutionId = normalizeInstitutionId(user.institutionId);
  if (!institutionId) {
    throw httpsError("failed-precondition", "Select your institution before creating a group.");
  }
  await requireActiveInstitution(institutionId);

  const [groupCode, inviteCode] = await Promise.all([
    getUniqueGroupCode(),
    getUniqueInviteCode(),
  ]);
  const groupRef = db.collection("groups").doc();

  await groupRef.set({
    name,
    description,
    groupCode,
    inviteCode,
    leaderId: uid,
    status: GROUP_STATUS.PENDING_APPROVAL,
    totalSavings: 0,
    pendingSavings: 0,
    memberCount: 0,
    institutionId,
    umucoAccountNo: "",
    createdAt: FieldValue.serverTimestamp(),
    approvedAt: null,
  });

  await db.collection("users").doc(uid).set(
    {
      isLeader: false,
      proposedLeaderForGroupId: groupRef.id,
    },
    { merge: true }
  );

  return { success: true, groupId: groupRef.id, groupCode, inviteCode };
});

exports.approveGroup = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const groupId = String(data?.groupId || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  let leaderId = null;

  await db.runTransaction(async (tx) => {
    // ── Phase 1: ALL reads (must precede any write in a Firestore transaction) ─

    const groupSnap = await tx.get(groupRef);
    if (!groupSnap.exists) {
      throw httpsError("not-found", "Group not found.");
    }

    const group = groupSnap.data() || {};
    leaderId = group.leaderId || null;

    // Read the leader's groupMembers and user docs before any writes.
    let leaderGroupMemberSnap = null;
    let leaderUserSnap = null;
    if (leaderId) {
      [leaderGroupMemberSnap, leaderUserSnap] = await Promise.all([
        tx.get(db.collection("groupMembers").doc(leaderId)),
        tx.get(db.collection("users").doc(leaderId)),
      ]);
    }

    // ── Phase 2: ALL writes ───────────────────────────────────────────────────

    // Ensure institutionId is always stamped on the group. If the group was
    // created before institutionId was enforced, fill it from the leader's
    // user doc so submitBatch can route batches to the correct institution.
    const existingInstId = group.institutionId || null;
    const leaderInstId = leaderUserSnap?.exists ? (leaderUserSnap.data().institutionId || null) : null;
    const groupActivatePayload = {
      status: GROUP_STATUS.ACTIVE,
      approvedAt: FieldValue.serverTimestamp(),
    };
    if (!existingInstId && leaderInstId) {
      groupActivatePayload.institutionId = leaderInstId;
    }
    tx.set(groupRef, groupActivatePayload, { merge: true });

    if (!leaderId) {
      console.warn(`[approveGroup] group ${groupId} has no leaderId — activated without leader setup.`);
      return;
    }

    const leaderRef = db.collection("users").doc(leaderId);
    const leaderGroupMemberRef = db.collection("groupMembers").doc(leaderId);

    tx.set(
      leaderRef,
      {
        role: ROLES.LEADER,
        status: USER_STATUS.ACTIVE,
        isLeader: true,
        groupId,
        ledGroupId: groupId,
        proposedLeaderForGroupId: null,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const leaderGmPayload = {
      userId: leaderId,
      groupId,
      joinedAt: leaderGroupMemberSnap.exists
        ? leaderGroupMemberSnap.data()?.joinedAt || FieldValue.serverTimestamp()
        : FieldValue.serverTimestamp(),
      isActive: true,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Initialise balance fields only on new entries — never overwrite real balances.
    if (!leaderGroupMemberSnap.exists) {
      leaderGmPayload.personalSavings = 0;
      leaderGmPayload.pendingSavings = 0;
      leaderGmPayload.lockedSavings = 0;
      leaderGmPayload.creditLimit = 0;
      leaderGmPayload.availableCredit = 0;
    }

    tx.set(leaderGroupMemberRef, leaderGmPayload, { merge: true });

    if (!leaderGroupMemberSnap.exists) {
      tx.set(
        groupRef,
        {
          memberCount: FieldValue.increment(1),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  if (leaderId) {
    try {
      await auth.setCustomUserClaims(leaderId, { role: ROLES.LEADER });
    } catch (claimErr) {
      // Claim failure is non-fatal — log and continue. The leader can still operate
      // and the backfillLeaderGroupMembership utility can fix claims later.
      console.error(`[approveGroup] Failed to set leader claim for ${leaderId}:`, claimErr.message);
    }
  }

  const actorRole = context.auth.token?.role;
  await writeAuditLog(context.auth.uid, actorRole, "group_approved", "group", groupId, { leaderId });

  return { success: true };
});

exports.joinGroup = functions.https.onCall(async (data, context) => {
  const { uid, user } = await requireActiveMember(context);

  const groupCode = String(data?.groupCode || "").trim().toUpperCase();
  if (!groupCode) {
    throw httpsError("invalid-argument", "groupCode is required.");
  }

  if (user.groupId) {
    throw httpsError("failed-precondition", "User is already in a group.");
  }

  const memberInstitutionId = normalizeInstitutionId(user.institutionId);
  if (!memberInstitutionId) {
    throw httpsError("failed-precondition", "Select your institution before joining a group.");
  }
  await requireActiveInstitution(memberInstitutionId);

  const groupQuery = await db
    .collection("groups")
    .where("groupCode", "==", groupCode)
    .limit(1)
    .get();

  if (groupQuery.empty) {
    throw httpsError("not-found", "Group not found.");
  }

  const groupDoc = groupQuery.docs[0];
  const group = groupDoc.data();
  if (group.status !== GROUP_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Group is not active.");
  }

  const groupInstitutionId = normalizeInstitutionId(group.institutionId);
  if (groupInstitutionId && groupInstitutionId !== memberInstitutionId) {
    throw httpsError("failed-precondition", "Your institution does not match this group's institution.");
  }

  const joinRequestRef = db
    .collection("groups")
    .doc(groupDoc.id)
    .collection("joinRequests")
    .doc(uid);

  await joinRequestRef.set(
    {
      userId: uid,
      groupId: groupDoc.id,
      groupCode,
      fullName: user.fullName || user.name || "",
      name: user.name || user.fullName || "",
      phone: user.phone || "",
      memberId: user.memberId || "",
      status: JOIN_REQUEST_STATUS.PENDING,
      createdAt: FieldValue.serverTimestamp(),
      requestedBy: uid,
    },
    { merge: true }
  );

  await db.collection("notifications").add({
    type: "join_request",
    groupId: groupDoc.id,
    userId: uid,
    recipientId: group.leaderId || null,
    status: "unread",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
  });

  let leaderName = "Group Leader";
  if (group.leaderId) {
    const leaderSnap = await db.collection("users").doc(group.leaderId).get();
    if (leaderSnap.exists) {
      leaderName = leaderSnap.data().fullName || leaderName;
    }
  }

  return { success: true, groupName: group.name, leaderName };
});

exports.approveJoinRequest = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.LEADER]);

  const joinRequestId = String(data?.joinRequestId || "").trim();
  const userId = String(data?.userId || "").trim();

  if (!joinRequestId || !userId) {
    throw httpsError("invalid-argument", "joinRequestId and userId are required.");
  }

  const leaderGroups = await db
    .collection("groups")
    .where("leaderId", "==", context.auth.uid)
    .get();

  let targetGroupDoc = null;
  let targetRequestRef = null;
  let targetRequestData = null;

  for (const groupDoc of leaderGroups.docs) {
    const requestRef = db
      .collection("groups")
      .doc(groupDoc.id)
      .collection("joinRequests")
      .doc(joinRequestId);

    const requestSnap = await requestRef.get();
    if (requestSnap.exists && requestSnap.data().userId === userId) {
      targetGroupDoc = groupDoc;
      targetRequestRef = requestRef;
      targetRequestData = requestSnap.data();
      break;
    }
  }

  if (!targetGroupDoc || !targetRequestRef) {
    throw httpsError("not-found", "Join request not found for this leader.");
  }

  const groupId = targetGroupDoc.id;
  const groupMemberRef = db.collection("groupMembers").doc(userId);
  const groupInstitutionId = normalizeInstitutionId(targetGroupDoc.data()?.institutionId);

  await db.runTransaction(async (tx) => {
    const gmSnap = await tx.get(groupMemberRef);
    if (!gmSnap.exists) {
      tx.set(groupMemberRef, {
        userId,
        groupId,
        joinedAt: FieldValue.serverTimestamp(),
        isActive: true,
      });
    }

    const userRef = db.collection("users").doc(userId);
    const userSnap = await tx.get(userRef);
    const memberInstitutionId = normalizeInstitutionId(userSnap.data()?.institutionId);

    if (groupInstitutionId && memberInstitutionId && memberInstitutionId !== groupInstitutionId) {
      throw httpsError("failed-precondition", "Member institution does not match this group.");
    }

    tx.set(
      userRef,
      {
        groupId,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      db.collection("groups").doc(groupId),
      {
        memberCount: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      targetRequestRef,
      {
        status: JOIN_REQUEST_STATUS.APPROVED,
        approvedAt: FieldValue.serverTimestamp(),
        approvedBy: context.auth.uid,
      },
      { merge: true }
    );
  });

  await db.collection("notifications").add({
    type: "join_request_approved",
    groupId,
    userId,
    status: "unread",
    sourceRequestStatus: targetRequestData?.status || JOIN_REQUEST_STATUS.PENDING,
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
  });

  return { success: true };
});

exports.rejectJoinRequest = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.LEADER]);

  const joinRequestId = String(data?.joinRequestId || "").trim();
  const userId = String(data?.userId || "").trim();

  if (!joinRequestId || !userId) {
    throw httpsError("invalid-argument", "joinRequestId and userId are required.");
  }

  const leaderGroups = await db
    .collection("groups")
    .where("leaderId", "==", context.auth.uid)
    .get();

  let targetGroupDoc = null;
  let targetRequestRef = null;

  for (const groupDoc of leaderGroups.docs) {
    const requestRef = db
      .collection("groups")
      .doc(groupDoc.id)
      .collection("joinRequests")
      .doc(joinRequestId);

    const requestSnap = await requestRef.get();
    if (requestSnap.exists && requestSnap.data().userId === userId) {
      targetGroupDoc = groupDoc;
      targetRequestRef = requestRef;
      break;
    }
  }

  if (!targetGroupDoc || !targetRequestRef) {
    throw httpsError("not-found", "Join request not found for this leader.");
  }

  await targetRequestRef.set(
    {
      status: JOIN_REQUEST_STATUS.REJECTED,
      rejectedAt: FieldValue.serverTimestamp(),
      rejectedBy: context.auth.uid,
    },
    { merge: true }
  );

  await db.collection("notifications").add({
    type: "join_request_rejected",
    groupId: targetGroupDoc.id,
    userId,
    status: "unread",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
  });

  return { success: true };
});

exports.resetPIN = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AGENT]);

  const userId = String(data?.userId || "").trim();
  const newPIN = String(data?.newPIN || "").trim();

  if (!userId || !isValidPin(newPIN)) {
    throw httpsError("invalid-argument", "userId and a valid 6-digit newPIN are required.");
  }

  const pinHash = await hashPIN(newPIN);
  await auth.updateUser(userId, { password: newPIN });
  await db.collection("users").doc(userId).set({ pinHash }, { merge: true });

  return { success: true };
});

exports.joinGroupByInviteCode = functions.https.onCall(async (data, context) => {
  const { uid, user } = await requireActiveMember(context);

  if (user.groupId) {
    throw httpsError("failed-precondition", "You are already in a group.");
  }

  const memberInstitutionId = normalizeInstitutionId(user.institutionId);
  if (!memberInstitutionId) {
    throw httpsError("failed-precondition", "Select your institution before joining a group.");
  }
  await requireActiveInstitution(memberInstitutionId);

  const inviteCode = String(data?.inviteCode || "").trim().toUpperCase();
  if (!inviteCode) {
    throw httpsError("invalid-argument", "inviteCode is required.");
  }

  const groupQuery = await db
    .collection("groups")
    .where("inviteCode", "==", inviteCode)
    .limit(1)
    .get();

  if (groupQuery.empty) {
    throw httpsError("not-found", "Invalid invite code. Please check and try again.");
  }

  const groupDoc = groupQuery.docs[0];
  const group = groupDoc.data();
  const groupId = groupDoc.id;

  if (group.status !== GROUP_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "This group is not currently accepting members.");
  }

  const groupInstitutionId = normalizeInstitutionId(group.institutionId);
  if (groupInstitutionId && groupInstitutionId !== memberInstitutionId) {
    throw httpsError("failed-precondition", "Your institution does not match this group.");
  }

  const joinRequestRef = db
    .collection("groups")
    .doc(groupId)
    .collection("joinRequests")
    .doc(uid);

  await joinRequestRef.set(
    {
      userId: uid,
      groupId,
      inviteCode,
      fullName: user.fullName || user.name || "",
      name: user.name || user.fullName || "",
      phone: user.phone || "",
      memberId: user.memberId || "",
      status: JOIN_REQUEST_STATUS.PENDING,
      createdAt: FieldValue.serverTimestamp(),
      requestedBy: uid,
    },
    { merge: true }
  );

  await db.collection("notifications").add({
    type: "join_request",
    groupId,
    userId: uid,
    recipientId: group.leaderId || null,
    status: "unread",
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days TTL
  });

  let leaderName = "Group Leader";
  if (group.leaderId) {
    const leaderSnap = await db.collection("users").doc(group.leaderId).get();
    if (leaderSnap.exists) {
      leaderName = leaderSnap.data().fullName || leaderName;
    }
  }

  return {
    success: true,
    status: JOIN_REQUEST_STATUS.PENDING,
    groupId,
    groupName: group.name,
    leaderName,
  };
});

exports.setMemberInstitution = functions.https.onCall(async (data, context) => {
  const { uid } = await requireActiveMember(context);
  const institutionId = normalizeInstitutionId(data?.institutionId);

  await requireActiveInstitution(institutionId);

  await db.collection("users").doc(uid).set(
    {
      institutionId,
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, institutionId };
});

// Returns active institutions for member-facing institution selection.
// Callable by any authenticated active member.
exports.getActiveInstitutions = functions.https.onCall(async (data, context) => {
  await requireActiveMember(context);

  const snap = await db
    .collection("institutions")
    .where("status", "==", "active")
    .get();

  const institutions = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      name: d.name || doc.id,
      code: d.code || null,
    };
  });

  return { institutions };
});

exports.getGroupMembers = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.LEADER, ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.AGENT, ROLES.FINANCE]);

  const groupId = String(data?.groupId || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  if (context.auth.token?.role === ROLES.LEADER) {
    const groupSnap = await db.collection("groups").doc(groupId).get();
    if (!groupSnap.exists || groupSnap.data().leaderId !== context.auth.uid) {
      throw httpsError("permission-denied", "Leaders can only view members of their own group.");
    }
  }

  const gmSnap = await db
    .collection("groupMembers")
    .where("groupId", "==", groupId)
    .get();

  const members = gmSnap.docs.map((d) => ({ userId: d.data().userId, joinedAt: d.data().joinedAt }));
  const userSnaps = await Promise.all(members.map(({ userId }) => db.collection("users").doc(userId).get()));

  return {
    success: true,
    members: members.map(({ userId, joinedAt }, i) => {
      const u = userSnaps[i].exists ? userSnaps[i].data() : {};
      return {
        userId,
        fullName: u.fullName || u.name || "Unknown",
        phone: u.phone || null,
        joinedAt,
      };
    }),
  };
});

exports.initiateGroupSplit = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.LEADER]);

  const sourceGroupId = String(data?.sourceGroupId || "").trim();
  const newGroupName = String(data?.newGroupName || "").trim();
  const memberIdsToMove = Array.isArray(data?.memberIdsToMove) ? data.memberIdsToMove : [];

  if (!sourceGroupId || !newGroupName) {
    throw httpsError("invalid-argument", "sourceGroupId and newGroupName are required.");
  }
  if (memberIdsToMove.length === 0) {
    throw httpsError("invalid-argument", "Select at least one member to move.");
  }

  const sourceGroupRef = db.collection("groups").doc(sourceGroupId);
  const sourceGroupSnap = await sourceGroupRef.get();
  if (!sourceGroupSnap.exists) {
    throw httpsError("not-found", "Source group not found.");
  }
  const sourceGroup = sourceGroupSnap.data();
  if (sourceGroup.leaderId !== context.auth.uid) {
    throw httpsError("permission-denied", "Only the group leader can initiate a split.");
  }
  if (memberIdsToMove.includes(context.auth.uid)) {
    throw httpsError("invalid-argument", "The group leader cannot be moved to the new group.");
  }

  // Validate all selected members belong to this group
  const gmSnaps = await Promise.all(
    memberIdsToMove.map((userId) => db.collection("groupMembers").doc(userId).get())
  );
  for (let i = 0; i < gmSnaps.length; i++) {
    const snap = gmSnaps[i];
    if (!snap.exists || snap.data().groupId !== sourceGroupId) {
      throw httpsError("invalid-argument", `Member ${memberIdsToMove[i]} is not in this group.`);
    }
  }

  const [newGroupCode, newInviteCode] = await Promise.all([
    getUniqueGroupCode(),
    getUniqueInviteCode(),
  ]);

  const newGroupRef = db.collection("groups").doc();
  const batch = db.batch();

  batch.set(newGroupRef, {
    name: newGroupName,
    description: `Split from ${sourceGroup.name}`,
    groupCode: newGroupCode,
    inviteCode: newInviteCode,
    leaderId: null,
    status: GROUP_STATUS.ACTIVE,
    totalSavings: 0,
    pendingSavings: 0,
    memberCount: memberIdsToMove.length,
    institutionId: sourceGroup.institutionId || null,
    umucoAccountNo: "",
    splitFromGroupId: sourceGroupId,
    createdAt: FieldValue.serverTimestamp(),
    approvedAt: FieldValue.serverTimestamp(),
  });

  for (const userId of memberIdsToMove) {
    batch.set(
      db.collection("groupMembers").doc(userId),
      { groupId: newGroupRef.id, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    batch.set(
      db.collection("users").doc(userId),
      { groupId: newGroupRef.id, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
  }

  batch.set(
    sourceGroupRef,
    { memberCount: FieldValue.increment(-memberIdsToMove.length), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );

  await batch.commit();

  return {
    success: true,
    newGroupId: newGroupRef.id,
    newGroupCode,
    newInviteCode,
    movedCount: memberIdsToMove.length,
  };
});

/**
 * One-time backfill: create missing groupMembers entries for approved leaders.
 * Safe to re-run — skips leaders that already have a complete entry.
 * Also ensures users.groupId, wallets/{uid}, memberId, and the Auth
 * custom claim (role: leader) are all present and correct.
 */
exports.backfillLeaderGroupMembership = functions.https.onCall(async (_, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN, ROLES.ADMIN]);

  const leadersSnap = await db.collection("users").where("role", "==", ROLES.LEADER).get();

  const results = { processed: 0, created: 0, skipped: 0, claimsFixed: 0, errors: [] };

  for (const leaderDoc of leadersSnap.docs) {
    const leaderId = leaderDoc.id;
    const leaderData = leaderDoc.data();
    results.processed++;

    // Prefer ledGroupId — it is the authoritative field set by approveGroup
    // and is not subject to manual data-entry errors that can affect groupId.
    const groupId = leaderData.ledGroupId || leaderData.groupId;
    if (!groupId) {
      results.errors.push(`${leaderId}: no groupId or ledGroupId — skipped`);
      continue;
    }

    const gmRef = db.collection("groupMembers").doc(leaderId);
    const [gmSnap, groupSnap, walletSnap] = await Promise.all([
      gmRef.get(),
      db.collection("groups").doc(groupId).get(),
      db.collection("wallets").doc(leaderId).get(),
    ]);

    // Patch existing entry if it's missing groupId (edge case from old schema)
    if (gmSnap.exists && !gmSnap.data().groupId) {
      await gmRef.set({ groupId, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      results.skipped++;
      // Still fall through to fix Auth claim below.
    } else if (gmSnap.exists) {
      results.skipped++;
      // Still fall through to fix Auth claim below.
    } else {
      // groupMembers doc is fully missing — create it.
      try {
        const batch = db.batch();

        batch.set(gmRef, {
          userId: leaderId,
          groupId,
          joinedAt: leaderData.approvedAt || FieldValue.serverTimestamp(),
          isActive: true,
          personalSavings: 0,
          pendingSavings: 0,
          lockedSavings: 0,
          creditLimit: 0,
          availableCredit: 0,
          updatedAt: FieldValue.serverTimestamp(),
        });

        // Ensure users.groupId is set
        const userPatch = { updatedAt: FieldValue.serverTimestamp() };
        if (!leaderData.groupId) {
          userPatch.groupId = groupId;
        }
        // Assign memberId if somehow missing (defensive — normally set by approveMember)
        if (!leaderData.memberId) {
          userPatch.memberId = await getUniqueMemberId(leaderId);
        }
        if (Object.keys(userPatch).length > 1) {
          batch.set(
            db.collection("users").doc(leaderId),
            userPatch,
            { merge: true }
          );
        }

        // Create wallet if missing
        if (!walletSnap.exists) {
          batch.set(db.collection("wallets").doc(leaderId), {
            userId: leaderId,
            balanceConfirmed: 0,
            balancePending: 0,
            balanceLocked: 0,
            availableBalance: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          });
        }

        // Increment group memberCount
        if (groupSnap.exists) {
          batch.set(
            db.collection("groups").doc(groupId),
            { memberCount: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
            { merge: true }
          );
        }

        await batch.commit();
        results.created++;
      } catch (err) {
        results.errors.push(`${leaderId}: ${err.message}`);
        continue;
      }
    }

    // Always ensure the Auth custom claim is role: leader.
    // This fixes the case where approveGroup's setCustomUserClaims call was
    // never reached (e.g., it ran before the fix or failed after the transaction).
    // A stale "member" claim causes isLeader() → false in Firestore rules,
    // which combined with a missing groupMembers doc produces permission-denied.
    try {
      const authUser = await auth.getUser(leaderId).catch(() => null);
      if (authUser) {
        const currentClaim = authUser.customClaims?.role;
        if (currentClaim !== ROLES.LEADER) {
          await auth.setCustomUserClaims(leaderId, { role: ROLES.LEADER });
          results.claimsFixed++;
        }
      }
    } catch (claimErr) {
      results.errors.push(`${leaderId} (claim): ${claimErr.message}`);
    }
  }

  return { success: true, ...results };
});

exports.getPendingApprovals = functions.https.onCall(async (_, context) => {
  const diag = {
    step: "start",
    callerUid: context?.auth?.uid || null,
    callerRole: context?.auth?.token?.role || null,
    usersQuerySucceeded: false,
    groupsQuerySucceeded: false,
  };

  try {
    diag.step = "authContext";
    if (!context?.auth?.uid) {
      throw new Error("Authentication required.");
    }

    diag.step = "roleCheck";
    if (![ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(diag.callerRole)) {
      throw new Error("Insufficient permissions.");
    }

    diag.step = "usersQuery";
    const usersSnap = await db
      .collection("users")
      .where("status", "==", USER_STATUS.PENDING_APPROVAL)
      .orderBy("createdAt", "asc")
      .get();
    diag.usersQuerySucceeded = true;

    diag.step = "groupsQuery";
    const groupsSnap = await db
      .collection("groups")
      .where("status", "==", GROUP_STATUS.PENDING_APPROVAL)
      .orderBy("createdAt", "asc")
      .get();
    diag.groupsQuerySucceeded = true;

    diag.step = "mapUsers";
    const pendingMembers = usersSnap.docs.map((snap) => {
      const data = snap.data() || {};
      return {
        id: snap.id,
        uid: data.uid || snap.id,
        fullName: data.fullName || data.name || data.email || snap.id,
        phone: data.phone || "",
        createdAt: data.createdAt || snap.createTime || null,
        role: data.role || ROLES.MEMBER,
        status: data.status || USER_STATUS.PENDING_APPROVAL,
      };
    });

    diag.step = "mapGroups";
    const pendingGroups = groupsSnap.docs.map((snap) => {
      const data = snap.data() || {};
      return {
        id: snap.id,
        groupId: snap.id,
        name: data.name || data.groupName || `Group ${snap.id}`,
        leaderId: data.leaderId || null,
        leaderName: data.leaderName || null,
        createdAt: data.createdAt || snap.createTime || null,
        status: data.status || GROUP_STATUS.PENDING_APPROVAL,
      };
    });

    diag.step = "done";
    return {
      success: true,
      pendingMembers,
      pendingGroups,
      users: pendingMembers,
      groups: pendingGroups,
    };
  } catch (error) {
    const originalMessage = String(error?.message || "Unknown error");
    const diagnosticMessage = `getPendingApprovals failed at step: ${diag.step} — ${originalMessage}`;
    const code = String(error?.code || error?.errorInfo?.code || "");
    const shouldUseInternal = code.includes("internal");

    functions.logger.error("getPendingApprovals diagnostic failure", {
      ...diag,
      code,
      message: originalMessage,
      stack: error?.stack || null,
    });

    throw new functions.https.HttpsError(
      shouldUseInternal ? "internal" : "failed-precondition",
      diagnosticMessage,
      diag
    );
  }
});

exports.getGroupDetail = functions.https.onCall(async (data, context) => {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }
  const role = context.auth.token?.role;
  if (![ROLES.SUPER_ADMIN, ROLES.ADMIN].includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  const groupId = String(data?.groupId || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  const groupSnap = await db.collection("groups").doc(groupId).get();
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Group not found.");
  }

  const group = groupSnap.data();

  // Parallel: leader, institution, member list, active loans
  const [leaderSnap, institutionSnap, membersSnap, activeLoansSnap] = await Promise.all([
    group.leaderId ? db.collection("users").doc(group.leaderId).get() : Promise.resolve(null),
    group.institutionId ? db.collection("institutions").doc(group.institutionId).get() : Promise.resolve(null),
    db.collection("groupMembers").where("groupId", "==", groupId).get(),
    db.collection("loans").where("groupId", "==", groupId).where("status", "==", "active").get(),
  ]);

  const leader = leaderSnap && leaderSnap.exists
    ? { uid: group.leaderId, fullName: leaderSnap.data().fullName || leaderSnap.data().name || null, phone: leaderSnap.data().phone || null }
    : { uid: group.leaderId || null, fullName: null, phone: null };

  const institutionName = institutionSnap && institutionSnap.exists
    ? (institutionSnap.data().name || null)
    : null;

  const members = membersSnap.docs.map((d) => ({ userId: d.id, ...d.data() }));

  const activeLoans = activeLoansSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const activeLoansCount = activeLoans.length;
  const activeOutstandingBIF = activeLoans.reduce((s, l) => s + Number(l.remainingDue || 0), 0);

  return {
    success: true,
    group: {
      id: groupId,
      ...group,
      institutionName,
      leader,
      memberList: members,
      activeLoansCount,
      activeOutstandingBIF,
    },
  };
});
