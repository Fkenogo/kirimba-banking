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
  isValidBurundiPhone,
  isValidPin,
} = require("./validators");
const { generateGroupCode, hashPIN } = require("./utils");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();
const auth = admin.auth();

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

async function getUserRole(uid, token) {
  if (token && token.role) {
    return token.role;
  }

  const userSnap = await db.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return null;
  }

  return userSnap.data().role || null;
}

async function requireRole(context, allowedRoles) {
  if (!context.auth || !context.auth.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const role = await getUserRole(context.auth.uid, context.auth.token);
  if (!role || !allowedRoles.includes(role)) {
    throw httpsError("permission-denied", "Insufficient permissions.");
  }

  return role;
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
  if (user.role !== ROLES.MEMBER && user.role !== ROLES.LEADER) {
    throw httpsError("permission-denied", "Member account required.");
  }

  if (user.status !== USER_STATUS.ACTIVE) {
    throw httpsError("failed-precondition", "Member account must be active.");
  }

  return { uid: context.auth.uid, user };
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

exports.registerMember = functions.https.onCall(async (data) => {
  try {
    const fullName = (data?.fullName || "").trim();
    const phone = normalizePhone(data?.phone || "");
    const nationalId = isNonEmptyString(data?.nationalId)
      ? data.nationalId.trim()
      : null;
    const pin = String(data?.pin || "");
    const groupCodeToJoin = isNonEmptyString(data?.groupCodeToJoin)
      ? data.groupCodeToJoin.trim().toUpperCase()
      : null;

    assert(isNonEmptyString(fullName), "fullName is required.");
    assert(isValidBurundiPhone(phone), "Phone must be in +257XXXXXXXX format.");
    assert(isValidPin(pin), "PIN must be exactly 4 digits.");

    const existingUser = await auth.getUserByEmail(`${phone}@kirimba.app`).catch(() => null);
    if (existingUser) {
      throw httpsError("already-exists", "Phone is already registered.");
    }

    const pinHash = await hashPIN(pin);
    const createdAuthUser = await auth.createUser({
      email: `${phone}@kirimba.app`,
      password: pinHash,
      displayName: fullName,
      disabled: false,
    });

    await db.collection("users").doc(createdAuthUser.uid).set(
      {
        uid: createdAuthUser.uid,
        fullName,
        phone,
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
  await requireRole(context, [ROLES.SUPER_ADMIN]);

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
  await userRef.set(
    {
      status: USER_STATUS.ACTIVE,
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

  return { success: true };
});

exports.rejectMember = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN]);

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

  return { success: true };
});

exports.createGroup = functions.https.onCall(async (data, context) => {
  const { uid } = await requireActiveMember(context);

  const name = String(data?.name || "").trim();
  const description = String(data?.description || "").trim();

  if (!name || !description) {
    throw httpsError("invalid-argument", "name and description are required.");
  }

  const groupCode = await getUniqueGroupCode();
  const groupRef = db.collection("groups").doc();

  await groupRef.set({
    name,
    description,
    groupCode,
    leaderId: uid,
    status: GROUP_STATUS.PENDING_APPROVAL,
    totalSavings: 0,
    pendingSavings: 0,
    memberCount: 0,
    umucoAccountNo: "",
    createdAt: FieldValue.serverTimestamp(),
    approvedAt: null,
  });

  await db.collection("users").doc(uid).set(
    {
      isLeader: true,
      ledGroupId: groupRef.id,
    },
    { merge: true }
  );

  return { success: true, groupId: groupRef.id, groupCode };
});

exports.approveGroup = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN]);

  const groupId = String(data?.groupId || "").trim();
  const umucoAccountNo = String(data?.umucoAccountNo || "").trim();

  if (!groupId || !umucoAccountNo) {
    throw httpsError("invalid-argument", "groupId and umucoAccountNo are required.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const groupSnap = await groupRef.get();
  if (!groupSnap.exists) {
    throw httpsError("not-found", "Group not found.");
  }

  const group = groupSnap.data();
  await groupRef.set(
    {
      status: GROUP_STATUS.ACTIVE,
      umucoAccountNo,
      approvedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  if (group.leaderId) {
    await auth.setCustomUserClaims(group.leaderId, { role: ROLES.LEADER });
    await db.collection("users").doc(group.leaderId).set({ role: ROLES.LEADER }, { merge: true });
  }

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

  await db.runTransaction(async (tx) => {
    const gmSnap = await tx.get(groupMemberRef);
    if (!gmSnap.exists) {
      tx.set(groupMemberRef, {
        userId,
        groupId,
        personalSavings: 0,
        pendingSavings: 0,
        lockedSavings: 0,
        creditLimit: 0,
        availableCredit: 0,
        joinedAt: FieldValue.serverTimestamp(),
        isActive: true,
      });
    }

    tx.set(
      db.collection("users").doc(userId),
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

exports.resetPIN = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN, ROLES.AGENT]);

  const userId = String(data?.userId || "").trim();
  const newPIN = String(data?.newPIN || "").trim();

  if (!userId || !isValidPin(newPIN)) {
    throw httpsError("invalid-argument", "userId and a valid 4-digit newPIN are required.");
  }

  const pinHash = await hashPIN(newPIN);
  await auth.updateUser(userId, { password: pinHash });
  await db.collection("users").doc(userId).set({ pinHash }, { merge: true });

  return { success: true };
});

exports.getPendingApprovals = functions.https.onCall(async (_, context) => {
  await requireRole(context, [ROLES.SUPER_ADMIN]);

  const [usersSnap, groupsSnap] = await Promise.all([
    db
      .collection("users")
      .where("status", "==", USER_STATUS.PENDING_APPROVAL)
      .orderBy("createdAt", "asc")
      .get(),
    db
      .collection("groups")
      .where("status", "==", GROUP_STATUS.PENDING_APPROVAL)
      .orderBy("createdAt", "asc")
      .get(),
  ]);

  return {
    success: true,
    users: usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
    groups: groupsSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() })),
  };
});
