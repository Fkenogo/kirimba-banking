"use strict";
/**
 * lib.js — shared utilities for all seed scripts
 */

const REQUIRED_PROJECT_ID = "kirimba-banking";

/**
 * Guard: abort immediately if we are not on the approved project.
 * Every script calls this as its very first action.
 */
function requireProjectGuard(admin) {
  const projectId = admin.app().options.projectId
    || process.env.GCLOUD_PROJECT
    || process.env.FIREBASE_CONFIG && JSON.parse(process.env.FIREBASE_CONFIG).projectId
    || null;

  console.log(`\n  Project: ${projectId || "(unknown)"}`);

  if (projectId !== REQUIRED_PROJECT_ID) {
    console.error(
      `\n  ABORT: Project guard failed.\n` +
      `  Expected: ${REQUIRED_PROJECT_ID}\n` +
      `  Got:      ${projectId || "(unknown)"}\n` +
      `  Set FIREBASE_CONFIG='{"projectId":"${REQUIRED_PROJECT_ID}"}' and retry.\n`
    );
    process.exit(1);
  }

  console.log(`  Guard: PASSED ✓\n`);
  return projectId;
}

/**
 * Thin dry-run-aware write wrapper.
 * In dry-run mode, logs the operation and returns without executing.
 */
async function w(dryRun, description, fn) {
  if (dryRun) {
    console.log(`  [DRY-RUN] ${description}`);
    return;
  }
  await fn();
  console.log(`  ✓ ${description}`);
}

/**
 * Batch-delete all documents in a Firestore collection.
 * Processes in chunks of 400 to stay under the 500-write limit.
 */
async function deleteCollection(db, collectionPath, dryRun) {
  const collRef = db.collection(collectionPath);
  let total = 0;
  let batch;

  do {
    const snap = await collRef.limit(400).get();
    if (snap.empty) break;
    total += snap.size;

    if (!dryRun) {
      batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    }
  } while (true);

  return total;
}

/**
 * Paginated Auth user deletion.
 * Returns the count of deleted users.
 */
async function deleteAllAuthUsers(admin, dryRun) {
  let pageToken;
  let total = 0;

  do {
    const listResult = await admin.auth().listUsers(1000, pageToken);
    const uids = listResult.users.map((u) => u.uid);

    if (uids.length > 0) {
      total += uids.length;
      if (!dryRun) {
        await admin.auth().deleteUsers(uids);
      }
    }

    pageToken = listResult.pageToken;
  } while (pageToken);

  return total;
}

/**
 * Parse CLI args into an options object.
 * Recognized flags: --dry-run, --demo, --skip-finance, --confirm-wipe
 */
function parseArgs(argv) {
  const args = argv.slice(2);
  return {
    dryRun:       args.includes("--dry-run"),
    demo:         args.includes("--demo"),
    skipFinance:  args.includes("--skip-finance"),
    confirmWipe:  args.includes("--confirm-wipe"),
  };
}

module.exports = { requireProjectGuard, w, deleteCollection, deleteAllAuthUsers, parseArgs };
