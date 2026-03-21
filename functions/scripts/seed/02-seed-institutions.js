"use strict";
/**
 * 02-seed-institutions.js — Seed the institutions collection.
 *
 * Usage:
 *   node scripts/seed/02-seed-institutions.js --dry-run
 *   node scripts/seed/02-seed-institutions.js
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const { requireProjectGuard, w, parseArgs } = require("./lib");
const INSTITUTIONS = require("./data/institutions.json");

async function run({ dryRun = false } = {}) {
  console.log("=".repeat(60));
  console.log("  02-seed-institutions.js");
  requireProjectGuard(admin);

  const now = FieldValue.serverTimestamp();
  const createdBy = "seed_super_admin_001";

  console.log(`  Institutions to seed: ${INSTITUTIONS.length}`);

  for (const inst of INSTITUTIONS) {
    const { id, name, code, status, contactEmail, notes } = inst;

    await w(dryRun, `write institutions/${id} (${name}, code=${code})`, () =>
      db.collection("institutions").doc(id).set({
        name,
        code,
        status,
        contactEmail: contactEmail ?? null,
        notes:        notes ?? null,
        createdAt:    now,
        createdBy,
        // Suspension fields absent on active institutions
      })
    );
  }

  console.log(`\n  02-seed-institutions: ${dryRun ? "dry-run complete" : "complete"}\n`);
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
