"use strict";
/**
 * 00-wipe-all.js — Destructive reset: wipe all seed-managed Firestore collections
 * and all Firebase Auth users.
 *
 * Usage (dry-run, no changes):
 *   node scripts/seed/00-wipe-all.js --dry-run
 *
 * Usage (REAL wipe — irreversible):
 *   node scripts/seed/00-wipe-all.js --confirm-wipe
 *
 * SAFETY: Requires --confirm-wipe to execute any deletion.
 * Project guard aborts immediately if not on kirimba-banking.
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const { requireProjectGuard, deleteCollection, deleteAllAuthUsers, parseArgs } = require("./lib");

// All Firestore collections that the seed manages.
// Order matters for subcollections: delete parent-level first, then sub.
const WIPE_TARGETS = [
  // Financial data — deepest dependency, wipe first
  "transactions",
  "loans",
  "depositBatches",
  "withdrawalRequests",
  "agentSettlements",
  "agentReconciliations",
  "notifications",
  "auditLog",
  "fundLedger",
  "counters",
  // Member/group state — depends on users/groups
  "groupMembers",
  // Groups (subcollections wiped separately below)
  "groups",
  // Core entities
  "wallets",
  "users",
  "institutions",
  // Config / fund — recreated by 01 + 02
  "systemConfig",
  "kirimbaFund",
];

// Subcollections that must be wiped before their parent docs are deleted.
// Format: dynamic — we query all group docs and wipe their joinRequests.
async function wipeGroupSubcollections(dryRun) {
  if (dryRun) {
    // Skip live Firestore queries in dry-run — just report intent
    console.log(`  [DRY-RUN] would delete joinRequests subcollections under all groups`);
    return;
  }
  const groupSnap = await db.collection("groups").get();
  let count = 0;
  for (const groupDoc of groupSnap.docs) {
    const deleted = await deleteCollection(db, `groups/${groupDoc.id}/joinRequests`, false);
    count += deleted;
  }
  if (count > 0) {
    console.log(`  ✓ deleted ${count} joinRequest docs across ${groupSnap.size} groups`);
  }
}

async function run({ dryRun = false, confirmWipe = false } = {}) {
  console.log("=".repeat(60));
  console.log("  00-wipe-all.js");
  requireProjectGuard(admin);

  const isExecuting = !dryRun && confirmWipe;

  if (!dryRun && !confirmWipe) {
    console.error(
      "  ABORT: Real wipe requires --confirm-wipe flag.\n" +
      "  Use --dry-run to preview, or add --confirm-wipe to execute.\n"
    );
    process.exit(1);
  }

  if (isExecuting) {
    console.log("  *** REAL WIPE — this is irreversible ***\n");
  } else {
    console.log("  Mode: DRY-RUN (no changes will be made)\n");
  }

  // Pre-execution checklist (always shown)
  console.log("  PRE-EXECUTION CHECKLIST:");
  console.log("  [ ] Firebase project verified: kirimba-banking (dev/staging)");
  console.log("  [ ] Firestore export / collection-count snapshot taken");
  console.log("  [ ] Team notified that reseed is in progress");
  console.log("  [ ] All testers signed out of the app");
  console.log("");

  // --- Auth users ---
  if (dryRun) {
    console.log(`  [DRY-RUN] would delete all Firebase Auth users (count from live project)`);
  } else {
    const authUserCount = await countAuthUsers(admin);
    console.log(`  Deleting ${authUserCount} Firebase Auth users…`);
    const deleted = await deleteAllAuthUsers(admin, false);
    console.log(`  ✓ deleted ${deleted} Auth users`);
  }

  // --- Subcollections first ---
  await wipeGroupSubcollections(dryRun);

  // --- Top-level collections ---
  for (const col of WIPE_TARGETS) {
    if (dryRun) {
      console.log(`  [DRY-RUN] would wipe collection: ${col}`);
    } else {
      const count = await deleteCollection(db, col, false);
      console.log(`  ✓ wiped ${col} (${count} docs)`);
    }
  }

  console.log("\n  00-wipe-all: complete\n");
}

async function countAuthUsers(admin) {
  let count = 0;
  let pageToken;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    count += result.users.length;
    pageToken = result.pageToken;
  } while (pageToken);
  return count;
}

// Standalone execution
if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
