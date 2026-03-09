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

/**
 * adminSetGroupBorrowPause({ groupId, paused, reason })
 *
 * Allows super_admin or finance to manually pause or resume borrowing for a
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
  if (role !== ROLES.SUPER_ADMIN && role !== ROLES.ADMIN && role !== ROLES.FINANCE) {
    throw httpsError("permission-denied", "Requires super_admin, admin, or finance role.");
  }

  const groupId = String(data?.groupId || "").trim();
  if (!groupId) {
    throw httpsError("invalid-argument", "groupId is required.");
  }

  const paused = data?.paused;
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

  return { success: true, groupId, paused };
});
