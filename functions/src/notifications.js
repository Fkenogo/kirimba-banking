"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

function httpsError(code, message) {
  return new functions.https.HttpsError(code, message);
}

exports.markNotificationRead = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) {
    throw httpsError("unauthenticated", "Authentication required.");
  }

  const notificationId = String(data?.notificationId || "").trim();
  if (!notificationId) {
    throw httpsError("invalid-argument", "notificationId is required.");
  }

  const ref = db.collection("notifications").doc(notificationId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw httpsError("not-found", "Notification not found.");
  }

  const row = snap.data() || {};
  const isOwner = row.recipientId === uid || row.userId === uid;
  if (!isOwner) {
    throw httpsError("permission-denied", "You can only update your own notifications.");
  }

  if (row.status === "read") {
    return { success: true, notificationId, status: "read" };
  }

  await ref.set(
    {
      status: "read",
      readAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { success: true, notificationId, status: "read" };
});
