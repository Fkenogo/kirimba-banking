"use strict";
/**
 * 03-seed-users.js — Seed Firestore user docs + wallets, then create Auth users,
 * then set custom claims.
 *
 * WALLET STRATEGY (documented decision):
 *   We pre-seed both users/{uid} and wallets/{uid} in Firestore BEFORE calling
 *   admin.auth().createUser(). The onUserCreate trigger fires on Auth user creation
 *   and immediately checks for existing docs using { merge: true } — if both docs
 *   exist it logs "skipping create" and returns without overwriting. This prevents
 *   any trigger-written default values (role:"member", status:"pending_approval")
 *   from overwriting our correctly-seeded documents.
 *
 * Usage:
 *   node scripts/seed/03-seed-users.js --dry-run
 *   node scripts/seed/03-seed-users.js
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");
const bcrypt = require("bcrypt");

const { requireProjectGuard, w, parseArgs } = require("./lib");
const USERS = require("./data/users.json");

const SALT_ROUNDS = 12; // Must match provisionAgent/provisionAdmin backend functions

function emailFor(phone) {
  return `${phone}@kirimba.app`;
}

function buildCustomClaims(user) {
  const claims = { role: user.role };
  if (user.role === "institution_user" && user.institutionId) {
    claims.institutionId = user.institutionId;
  }
  return claims;
}

async function run({ dryRun = false } = {}) {
  console.log("=".repeat(60));
  console.log("  03-seed-users.js");
  requireProjectGuard(admin);

  const now = FieldValue.serverTimestamp();

  console.log(`  Users to seed: ${USERS.length}`);
  console.log(`  Phases: A) Firestore docs+wallets  B) Auth users  C) Custom claims\n`);

  // ── PHASE A: Firestore user docs + wallets ───────────────────────────────
  console.log("  Phase A: Firestore user docs + wallets");

  for (const user of USERS) {
    // Hash PIN synchronously (bcrypt, 12 rounds — matches backend provisionAgent)
    const pinHash = dryRun ? "<bcrypt-hash>" : bcrypt.hashSync(user.pin, SALT_ROUNDS);

    const userDoc = {
      fullName:                 user.fullName,
      phone:                    user.phone,
      role:                     user.role,
      status:                   "active",
      isLeader:                 user.isLeader ?? false,
      groupId:                  user.groupId  ?? null,
      ledGroupId:               user.ledGroupId ?? null,
      nationalId:               null,
      institutionId:            user.institutionId ?? null,
      pinHash,
      // memberId is the external-facing member number embedded in the QR code.
      // Only member and leader roles have one; admin/agent/institution_user do not.
      ...(user.memberId ? { memberId: user.memberId } : {}),
      proposedLeaderForGroupId: null,
      createdAt:                now,
      approvedAt:               now,
      updatedAt:                null,
    };

    await w(
      dryRun,
      `write users/${user.uid} (${user.role}: ${user.fullName}, ${user.phone})`,
      () => db.collection("users").doc(user.uid).set(userDoc)
    );

    // Wallet — zero state; onUserCreate trigger will find this and skip
    await w(
      dryRun,
      `write wallets/${user.uid}`,
      () => db.collection("wallets").doc(user.uid).set({
        userId:           user.uid,
        balanceConfirmed: 0,
        balancePending:   0,
        balanceLocked:    0,
        availableBalance: 0,
        createdAt:        now,
        updatedAt:        now,
      })
    );
  }

  // ── PHASE B: Firebase Auth users ─────────────────────────────────────────
  console.log("\n  Phase B: Firebase Auth users");

  for (const user of USERS) {
    const email = emailFor(user.phone);
    await w(
      dryRun,
      `createUser uid=${user.uid} email=${email}`,
      () => admin.auth().createUser({
        uid:           user.uid,
        email,
        password:      user.pin,
        displayName:   user.fullName,
        emailVerified: true,
        disabled:      false,
      })
    );
  }

  // ── PHASE C: Custom claims ────────────────────────────────────────────────
  console.log("\n  Phase C: Custom claims");

  for (const user of USERS) {
    const claims = buildCustomClaims(user);
    await w(
      dryRun,
      `setCustomUserClaims ${user.uid} → ${JSON.stringify(claims)}`,
      () => admin.auth().setCustomUserClaims(user.uid, claims)
    );
  }

  // Summary
  console.log(`\n  Summary:`);
  const roleCounts = USERS.reduce((acc, u) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});
  for (const [role, count] of Object.entries(roleCounts)) {
    console.log(`    ${role}: ${count}`);
  }

  console.log(`\n  03-seed-users: ${dryRun ? "dry-run complete" : "complete"}\n`);
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
