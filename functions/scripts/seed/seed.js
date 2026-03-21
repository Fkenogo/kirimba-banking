"use strict";
/**
 * seed.js — Master orchestrator for the KIRIMBA reseed pipeline.
 *
 * SAFETY:
 *   - Project guard enforced before any phase executes
 *   - Wipe requires --confirm-wipe in addition to absence of --dry-run
 *   - Finance data is opt-in: requires --demo flag
 *
 * Usage:
 *
 *   Dry-run (zero-state, no changes):
 *     node scripts/seed/seed.js --dry-run
 *
 *   Dry-run with demo finance data:
 *     node scripts/seed/seed.js --dry-run --demo
 *
 *   Real reseed (zero-state — confirm-wipe required):
 *     node scripts/seed/seed.js --confirm-wipe
 *
 *   Real reseed with demo financial data:
 *     node scripts/seed/seed.js --confirm-wipe --demo
 *
 *   Validate only (read-only, no flags needed):
 *     node scripts/seed/06-validate.js
 *     node scripts/seed/06-validate.js --demo
 *
 * PRE-EXECUTION CHECKLIST (before running real reseed):
 *   [ ] Run a Firestore export or log document counts per collection
 *       (console: Firebase → Firestore → Export  OR  use a count script)
 *   [ ] Confirm firebase project alias: run `firebase use` — must show kirimba-banking
 *   [ ] All team members signed out of the app
 *   [ ] Notify team that reseed is in progress
 *   [ ] Verify no CI/CD jobs are running against this project
 *   [ ] After reseed: clear browser storage / sign in fresh to get updated tokens
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();

const { requireProjectGuard, parseArgs } = require("./lib");
const wipeAll        = require("./00-wipe-all");
const seedConfig     = require("./01-seed-config");
const seedInst       = require("./02-seed-institutions");
const seedUsers      = require("./03-seed-users");
const seedGroups     = require("./04-seed-groups");
const seedFinance    = require("./05-seed-finance");
const validate       = require("./06-validate");

async function main() {
  const opts = parseArgs(process.argv);
  const { dryRun, demo, confirmWipe } = opts;

  console.log("\n" + "=".repeat(60));
  console.log("  KIRIMBA RESEED — Master Orchestrator");
  console.log("=".repeat(60));
  console.log(`  Mode:         ${dryRun ? "DRY-RUN (no changes)" : "REAL EXECUTION"}`);
  console.log(`  Demo finance: ${demo ? "ENABLED (--demo)" : "disabled (zero-state)"}`);
  console.log(`  Confirm wipe: ${confirmWipe ? "YES" : "no"}`);
  requireProjectGuard(admin);

  if (!dryRun && !confirmWipe) {
    console.error(
      "  ABORT: Real reseed requires --confirm-wipe flag.\n" +
      "  Use --dry-run to preview first.\n"
    );
    process.exit(1);
  }

  const phases = [
    { name: "Phase 0: Wipe",         fn: () => wipeAll.run({ dryRun, confirmWipe }) },
    { name: "Phase 1: System config", fn: () => seedConfig.run({ dryRun }) },
    { name: "Phase 2: Institutions",  fn: () => seedInst.run({ dryRun }) },
    { name: "Phase 3: Users",         fn: () => seedUsers.run({ dryRun }) },
    { name: "Phase 4: Groups",        fn: () => seedGroups.run({ dryRun }) },
    ...(demo
      ? [{ name: "Phase 5: Demo finance", fn: () => seedFinance.run({ dryRun }) }]
      : [{ name: "Phase 5: Finance", fn: () => { console.log("  Phase 5 skipped (no --demo flag)\n"); } }]
    ),
    {
      name: "Phase 6: Validate",
      fn: () => {
        if (dryRun) {
          console.log("  [DRY-RUN] validate would run post-seed — skipped in dry-run mode");
          console.log("  To validate after a real seed: node scripts/seed/06-validate.js\n");
          return;
        }
        return validate.run({ demo });
      },
    },
  ];

  for (const phase of phases) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`  ${phase.name}`);
    console.log("─".repeat(60));
    await phase.fn();
  }

  console.log("=".repeat(60));
  console.log(`  RESEED ${dryRun ? "DRY-RUN" : "EXECUTION"} COMPLETE`);
  if (!dryRun) {
    console.log(`\n  Post-reseed steps:`);
    console.log(`    1. Deploy indexes:  firebase deploy --only firestore:indexes`);
    console.log(`    2. Sign in as each role to verify token claims are fresh`);
    console.log(`    3. Run validate:    node scripts/seed/06-validate.js${demo ? " --demo" : ""}`);
  }
  console.log("=".repeat(60) + "\n");
}

main().catch((e) => {
  console.error("\n  FATAL:", e.message || e);
  process.exit(1);
});
