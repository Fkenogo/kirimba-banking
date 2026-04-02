"use strict";
/**
 * 01-seed-config.js — Seed systemConfig (4 docs) and kirimbaFund/current.
 *
 * Usage:
 *   node scripts/seed/01-seed-config.js --dry-run
 *   node scripts/seed/01-seed-config.js
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const { requireProjectGuard, w, parseArgs } = require("./lib");
const { normalizeAgentFeeConfig, normalizeCommissionPolicyConfig } = require("../../src/agentPricing");

// Initial fund capital seeded into kirimbaFund/current.
// MUST be > 0. Zero causes every loan request to fail with "Insufficient fund".
const INITIAL_AVAILABLE_FUND = 10_000_000; // 10M BIF

const SYSTEM_CONFIG = {
  fees: normalizeAgentFeeConfig({}),
  loanPolicy: {
    autoApproval: true,
    maxLoanMultiplier: 1.5,
    minLoanAmount: 1000,
    maxLoanAmount: 5_000_000,
    defaultTermDays: 14,
    earlySettlementRebateEnabled: false,
    rebateMode: "deferred",
    groupIncentiveSharePct: 0.1,
    termPricing: [
      { durationDays: 7, contractedFeePct: 0.025, minimumFeeFloor: 0, rebateBands: [], active: true },
      { durationDays: 14, contractedFeePct: 0.04, minimumFeeFloor: 0, rebateBands: [], active: true },
      { durationDays: 21, contractedFeePct: 0.055, minimumFeeFloor: 0, rebateBands: [], active: true },
      { durationDays: 30, contractedFeePct: 0.07, minimumFeeFloor: 0, rebateBands: [], active: true },
    ],
  },
  commissionPolicy: normalizeCommissionPolicyConfig({}, normalizeAgentFeeConfig({})),
  businessRules: {
    minBalanceBIF:                5000,
    largeWithdrawalThresholdBIF:  50000,
    maxGroupSize:                 50,
    groupSplitThreshold:          40,
  },
};

async function run({ dryRun = false } = {}) {
  console.log("=".repeat(60));
  console.log("  01-seed-config.js");
  requireProjectGuard(admin);

  const now = FieldValue.serverTimestamp();
  const superAdminUid = "seed_super_admin_001";

  // systemConfig documents
  for (const [configId, data] of Object.entries(SYSTEM_CONFIG)) {
    await w(dryRun, `write systemConfig/${configId}`, () =>
      db.collection("systemConfig").doc(configId).set({
        ...data,
        updatedAt: now,
        updatedBy: superAdminUid,
      })
    );
  }

  // kirimbaFund/current
  // totalCapital: tracks total capital in system (seed + topups - deductions).
  // Must be seeded here so KirimbaFundManagementScreen doesn't show 0.
  // repaidReturned: cumulative repayments received; starts at 0.
  await w(dryRun, `write kirimbaFund/current (availableFund: ${INITIAL_AVAILABLE_FUND.toLocaleString()} BIF)`, () =>
    db.collection("kirimbaFund").doc("current").set({
      totalCapital:      INITIAL_AVAILABLE_FUND,
      totalCollateral:   0,
      availableFund:     INITIAL_AVAILABLE_FUND,
      deployedFund:      0,
      defaultedExposure: 0,
      repaidReturned:    0,
      lastUpdated:       now,
      updatedBy:         superAdminUid,
    })
  );

  console.log(`\n  01-seed-config: ${dryRun ? "dry-run complete" : "complete"}\n`);
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
