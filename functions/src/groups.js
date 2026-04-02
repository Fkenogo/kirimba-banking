"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const { ROLES } = require("./constants");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

async function writeAuditLog(actorUid, actorRole, action, targetId, meta = {}) {
  try {
    await db.collection("auditLog").add({
      actorId: actorUid,
      actorRole,
      action,
      targetType: "group",
      targetId,
      meta,
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[groupAudit] Failed to write audit log", error.message, { action, targetId });
  }
}

/**
 * adminSetGroupBorrowPause({ groupId, paused, reason })
 *
 * Allows super_admin or admin to manually pause or resume borrowing for a
 * group. The pause is checked in requestLoan() before any other eligibility
 * rules. No money movement — only the group document is updated.
 *
 * paused=true  → sets borrowingPaused, pauseReason, pausedAt, pausedBy
 * paused=false → clears all four pause fields
 */
exports.adminSetGroupBorrowPause = functions.https.onCall(async (data, context) => {
  if (!context.auth?.uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }
  const role = context.auth.token?.role;
  if (role !== ROLES.SUPER_ADMIN && role !== ROLES.ADMIN) {
    throw httpsError("permission-denied", "Requires super_admin or admin role.");
  }

  const groupId = String(data?.groupId || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  const paused = typeof data?.paused === "boolean" ? data.paused : data?.isPaused;
  if (typeof paused !== "boolean") {
    throw httpsError("invalid-argument", "paused must be a boolean (true or false).");
  }

  const reason = String(data?.reason || "").trim();
  if (paused && !reason) {
    throw httpsError("invalid-argument", "reason is required when pausing borrowing.");
  }

  const groupRef = db.collection("groups").doc(groupId);
  const snap = await groupRef.get();
  if (!snap.exists) {
    throw httpsError("not-found", `Group '${groupId}' not found.`);
  }

  const updates = paused
    ? {
        borrowingPaused: true,
        pauseReason: reason,
        pausedAt: FieldValue.serverTimestamp(),
        pausedBy: context.auth.uid,
        updatedAt: FieldValue.serverTimestamp(),
      }
    : {
        borrowingPaused: false,
        pauseReason: null,
        pausedAt: null,
        pausedBy: null,
        updatedAt: FieldValue.serverTimestamp(),
      };

  await groupRef.update(updates);
  await writeAuditLog(context.auth.uid, role, paused ? "group_lending_paused" : "group_lending_resumed", groupId, {
    reason: paused ? reason : null,
  });

  return { success: true, groupId, paused };
});
