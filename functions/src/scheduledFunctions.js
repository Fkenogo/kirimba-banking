"use strict";

const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");

const db = admin.firestore();

/**
 * Scheduled function to delete expired notifications
 * Runs daily at midnight (Africa/Bujumbura timezone)
 */
exports.deleteExpiredNotifications = functions.pubsub
  .schedule("every 24 hours")
  .timeZone("Africa/Bujumbura")
  .onRun(async (context) => {
    const now = new Date();
    let deletedCount = 0;

    // Delete in batches of 500 (Firestore batch limit)
    while (true) {
      const expiredSnap = await db
        .collection("notifications")
        .where("expiresAt", "<", now)
        .limit(500)
        .get();

      if (expiredSnap.empty) {
        break;
      }

      const batch = db.batch();
      expiredSnap.forEach((doc) => {
        batch.delete(doc.ref);
      });

      await batch.commit();
      deletedCount += expiredSnap.size;

      // If less than 500 docs deleted, we've processed all expired notifications
      if (expiredSnap.size < 500) {
        break;
      }
    }

    console.log(`Deleted ${deletedCount} expired notifications`);

    return {
      success: true,
      deletedCount,
      timestamp: new Date().toISOString(),
    };
  });
