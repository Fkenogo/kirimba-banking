"use strict";
/**
 * 06-validate.js — Post-seed data integrity validation.
 * Read-only. Safe to run at any time.
 *
 * Usage:
 *   node scripts/seed/06-validate.js
 *   node scripts/seed/06-validate.js --demo   (also checks demo finance docs)
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const { requireProjectGuard, parseArgs } = require("./lib");
const USERS        = require("./data/users.json");
const GROUPS       = require("./data/groups.json");
const INSTITUTIONS = require("./data/institutions.json");

let passed = 0;
let failed = 0;

function pass(msg) {
  console.log(`  ✓ ${msg}`);
  passed++;
}

function fail(msg) {
  console.error(`  ✗ FAIL: ${msg}`);
  failed++;
}

async function check(label, fn) {
  try {
    const ok = await fn();
    if (ok !== false) pass(label);
  } catch (e) {
    fail(`${label} → ${e.message}`);
  }
}

async function run({ demo = false } = {}) {
  console.log("=".repeat(60));
  console.log("  06-validate.js");
  requireProjectGuard(admin);

  // ── 1. kirimbaFund/current ───────────────────────────────────────────────
  await check("kirimbaFund/current exists and availableFund > 0", async () => {
    const snap = await db.collection("kirimbaFund").doc("current").get();
    if (!snap.exists) throw new Error("document missing");
    const { availableFund } = snap.data();
    if (!(availableFund > 0)) throw new Error(`availableFund=${availableFund} — must be > 0`);
  });

  // ── 2. systemConfig documents ────────────────────────────────────────────
  for (const configId of ["fees", "loanPolicy", "commissionPolicy", "businessRules"]) {
    await check(`systemConfig/${configId} exists`, async () => {
      const snap = await db.collection("systemConfig").doc(configId).get();
      if (!snap.exists) throw new Error("missing");
    });
  }

  // ── 3. institutions ──────────────────────────────────────────────────────
  for (const inst of INSTITUTIONS) {
    await check(`institutions/${inst.id} exists with status=active`, async () => {
      const snap = await db.collection("institutions").doc(inst.id).get();
      if (!snap.exists) throw new Error("missing");
      const d = snap.data();
      if (d.status !== "active") throw new Error(`status=${d.status}`);
    });
  }

  // ── 4. No legacy "umuco" role anywhere ───────────────────────────────────
  await check('No users with role="umuco" in Firestore', async () => {
    const snap = await db.collection("users").where("role", "==", "umuco").limit(1).get();
    if (!snap.empty) throw new Error(`found ${snap.size} user(s) with legacy role "umuco"`);
  });

  // ── 5. User docs + wallets ────────────────────────────────────────────────
  for (const user of USERS) {
    await check(`users/${user.uid} exists with role=${user.role} status=active`, async () => {
      const snap = await db.collection("users").doc(user.uid).get();
      if (!snap.exists) throw new Error("missing");
      const d = snap.data();
      if (d.role !== user.role)     throw new Error(`role=${d.role}, expected ${user.role}`);
      if (d.status !== "active")    throw new Error(`status=${d.status}`);
      if (!d.pinHash)               throw new Error("pinHash missing");
    });

    await check(`wallets/${user.uid} has all balance fields`, async () => {
      const snap = await db.collection("wallets").doc(user.uid).get();
      if (!snap.exists) throw new Error("missing");
      const d = snap.data();
      for (const f of ["balanceConfirmed", "balancePending", "balanceLocked", "availableBalance"]) {
        if (typeof d[f] !== "number") throw new Error(`${f} is not a number (${typeof d[f]})`);
      }
    });

    // institution_user must have institutionId
    if (user.role === "institution_user") {
      await check(`users/${user.uid} (institution_user) has institutionId`, async () => {
        const snap = await db.collection("users").doc(user.uid).get();
        const d = snap.data();
        if (!d.institutionId) throw new Error("institutionId missing or null");
      });
    }

  }

  // ── 6. Auth users and custom claims ───────────────────────────────────────
  for (const user of USERS) {
    await check(`Auth user ${user.uid} exists with correct role claim`, async () => {
      const authUser = await admin.auth().getUser(user.uid);
      const claims = authUser.customClaims || {};
      if (claims.role !== user.role) {
        throw new Error(`claim role=${claims.role}, expected ${user.role}`);
      }
      if (user.role === "institution_user" && claims.institutionId !== user.institutionId) {
        throw new Error(`claim institutionId=${claims.institutionId}, expected ${user.institutionId}`);
      }
    });
  }

  // ── 7. Groups ─────────────────────────────────────────────────────────────
  for (const grp of GROUPS) {
    await check(`groups/${grp.id} has groupCode, inviteCode, status=active`, async () => {
      const snap = await db.collection("groups").doc(grp.id).get();
      if (!snap.exists) throw new Error("missing");
      const d = snap.data();
      if (!d.groupCode)           throw new Error("groupCode missing");
      if (!d.inviteCode)          throw new Error("inviteCode missing");
      if (d.status !== "active")  throw new Error(`status=${d.status}`);
      if (!d.institutionId)       throw new Error("institutionId missing");
      if (typeof d.borrowingPaused !== "boolean") throw new Error("borrowingPaused missing or wrong type");
      if (typeof d.totalLoansOutstanding !== "number") throw new Error("totalLoansOutstanding not a number");
    });

    // groupMembers for all members
    for (const userId of grp.memberIds) {
      await check(`groupMembers/${userId} exists for group ${grp.id}`, async () => {
        const snap = await db.collection("groupMembers").doc(userId).get();
        if (!snap.exists) throw new Error("missing");
        const d = snap.data();
        if (d.groupId !== grp.id) throw new Error(`groupId=${d.groupId}, expected ${grp.id}`);
        if (!d.isActive)          throw new Error("isActive=false");
      });
    }

    // Leader must have groupMembers record (historical bug — now guarded)
    await check(`leader ${grp.leaderId} has groupMembers record`, async () => {
      const snap = await db.collection("groupMembers").doc(grp.leaderId).get();
      if (!snap.exists) throw new Error("leader missing from groupMembers");
    });

  }

  // ── 8. No orphaned groupMembers ───────────────────────────────────────────
  await check("No groupMembers docs reference non-existent groups", async () => {
    const gmSnap = await db.collection("groupMembers").get();
    const groupIds = new Set(GROUPS.map((g) => g.id));
    const orphans = gmSnap.docs.filter((d) => !groupIds.has(d.data().groupId));
    if (orphans.length > 0) {
      throw new Error(`${orphans.length} orphaned groupMember doc(s): ${orphans.map((d) => d.id).join(", ")}`);
    }
  });

  // ── 9. Counter reset ──────────────────────────────────────────────────────
  await check("counters/TXN_2026 exists", async () => {
    const snap = await db.collection("counters").doc("TXN_2026").get();
    if (!snap.exists) throw new Error("missing");
  });

  // ── 10. Demo finance checks (only with --demo) ───────────────────────────
  if (demo) {
    console.log("\n  Demo finance checks:");

    await check("depositBatches/seed_batch_001 exists (status=confirmed)", async () => {
      const snap = await db.collection("depositBatches").doc("seed_batch_001").get();
      if (!snap.exists) throw new Error("missing");
      const d = snap.data();
      if (d.status !== "confirmed") throw new Error(`status=${d.status}`);
      if (d.institutionNotes !== null && d.umucoNotes === undefined) {
        // no legacy field: fine
      }
    });

    await check("loans/seed_loan_001 exists (status=pending)", async () => {
      const snap = await db.collection("loans").doc("seed_loan_001").get();
      if (!snap.exists) throw new Error("missing");
      const d = snap.data();
      if (d.status !== "pending") throw new Error(`status=${d.status}`);
      if (d.amount !== 50_000)    throw new Error(`amount=${d.amount}`);
    });

    await check("wallets/seed_member_001 balanceConfirmed=100000", async () => {
      const snap = await db.collection("wallets").doc("seed_member_001").get();
      const d = snap.data();
      if (d.balanceConfirmed !== 100_000) throw new Error(`balanceConfirmed=${d.balanceConfirmed}`);
    });

    await check("kirimbaFund/current totalCollateral=250000", async () => {
      const snap = await db.collection("kirimbaFund").doc("current").get();
      const d = snap.data();
      if (d.totalCollateral !== 250_000) throw new Error(`totalCollateral=${d.totalCollateral}`);
    });
  }

  // ── Final summary ─────────────────────────────────────────────────────────
  console.log("");
  console.log(`  ─────────────────────────────────`);
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log(`  ─────────────────────────────────`);

  if (failed > 0) {
    console.error(`\n  VALIDATION FAILED — ${failed} check(s) did not pass.\n`);
    process.exit(1);
  } else {
    console.log(`\n  All checks passed. Seed data is valid.\n`);
  }
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
