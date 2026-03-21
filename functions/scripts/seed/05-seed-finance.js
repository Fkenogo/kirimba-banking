"use strict";
/**
 * 05-seed-finance.js — Optional demo-state financial data.
 *
 * Produces a realistic end-to-end loan test scenario:
 *
 *   GROUP: seed_group_001 (Twese Hamwe)
 *   AGENT: seed_agent_001
 *
 *   Step 1 — Confirmed deposit batch
 *     - seed_leader_001  deposits 100,000 BIF  → confirmed
 *     - seed_member_001  deposits 100,000 BIF  → confirmed  ← LOAN DEMO MEMBER
 *     - seed_member_002  deposits  50,000 BIF  → confirmed
 *     Batch: seed_batch_001  (status: "confirmed")
 *     After confirmation:
 *       wallet.balanceConfirmed updated for all three members
 *       group.totalSavings = 250,000 BIF
 *       kirimbaFund.totalCollateral += 250,000
 *
 *   Step 2 — Pending loan (awaiting agent disbursement)
 *     - seed_member_001 requests 50,000 BIF / 7 days / 6% interest
 *       → totalDue = 53,000 BIF
 *       → status: "pending"  (auto-approved, waiting for agent to call disburseLoan)
 *     This loan is ready for the full test sequence:
 *       member request ✓ → admin visibility ✓ → agent disbursement → post-disburse state
 *
 * MODES:
 *   --demo   enables this script (zero-state seed skips it)
 *
 * Usage:
 *   node scripts/seed/05-seed-finance.js --dry-run --demo
 *   node scripts/seed/05-seed-finance.js --demo
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const { requireProjectGuard, w, parseArgs } = require("./lib");

// ── Seed constants ────────────────────────────────────────────────────────
const BATCH_ID    = "seed_batch_001";
const TXN_LEADER  = "seed_txn_001";
const TXN_M001    = "seed_txn_002";
const TXN_M002    = "seed_txn_003";
const LOAN_ID     = "seed_loan_001";

const GROUP_ID     = "seed_group_001";
const AGENT_ID     = "seed_agent_001";
const INST_USER_ID = "seed_inst_user_001";
const INSTITUTION_ID = "umuco";

const DEPOSITS = [
  { txnId: TXN_LEADER, userId: "seed_leader_001", amount: 100_000 },
  { txnId: TXN_M001,   userId: "seed_member_001", amount: 100_000 },
  { txnId: TXN_M002,   userId: "seed_member_002", amount:  50_000 },
];

const LOAN_AMOUNT   = 50_000;
const LOAN_INTEREST = Math.round(LOAN_AMOUNT * 0.06); // 3,000
const LOAN_TOTAL    = LOAN_AMOUNT + LOAN_INTEREST;     // 53,000
const LOAN_TERM     = 7;

// Fixed seed date for historical demo data consistency
const SEED_DATE = new Date("2026-03-01T09:00:00Z");
const SEED_TS   = admin.firestore.Timestamp.fromDate(SEED_DATE);

function receiptNo(seq) {
  return `TXN-2026-${String(seq).padStart(5, "0")}`;
}

async function run({ dryRun = false } = {}) {
  console.log("=".repeat(60));
  console.log("  05-seed-finance.js");
  requireProjectGuard(admin);

  const now = FieldValue.serverTimestamp();

  // ── Phase 1: individual deposit transactions ──────────────────────────────
  console.log("  Phase 1: deposit transactions");

  let seq = 1;
  for (const dep of DEPOSITS) {
    const txReceiptNo = receiptNo(seq++);   // increment unconditionally (dry-run safe)
    await w(
      dryRun,
      `write transactions/${dep.txnId} (deposit ${dep.amount.toLocaleString()} BIF, user=${dep.userId})`,
      () => db.collection("transactions").doc(dep.txnId).set({
        userId:        dep.userId,
        memberId:      dep.userId,
        groupId:       GROUP_ID,
        agentId:       AGENT_ID,
        type:          "deposit",
        amount:        dep.amount,
        status:        "confirmed",
        channel:       "agent",
        batchId:       BATCH_ID,
        receiptNo:     txReceiptNo,
        balanceBefore: 0,
        balanceAfter:  dep.amount,
        notes:         "",
        loanId:        null,
        institutionId: INSTITUTION_ID,
        createdAt:     SEED_TS,
      })
    );
  }

  // ── Phase 2: deposit batch (confirmed) ───────────────────────────────────
  console.log("\n  Phase 2: deposit batch");

  const totalDepositAmount = DEPOSITS.reduce((s, d) => s + d.amount, 0); // 250,000

  await w(
    dryRun,
    `write depositBatches/${BATCH_ID} (status=confirmed, total=${totalDepositAmount.toLocaleString()} BIF)`,
    () => db.collection("depositBatches").doc(BATCH_ID).set({
      groupId:          GROUP_ID,
      agentId:          AGENT_ID,
      institutionId:    INSTITUTION_ID,
      transactionIds:   [TXN_LEADER, TXN_M001, TXN_M002],
      totalAmount:      totalDepositAmount,
      memberCount:      DEPOSITS.length,
      status:           "confirmed",
      submittedAt:      SEED_TS,
      confirmedBy:      INST_USER_ID,
      confirmedAt:      SEED_TS,
      institutionRef:   "REF-UMUCO-001",
      institutionNotes: null,   // fresh seed — no legacy umucoNotes
      flaggedBy:        null,
      flaggedAt:        null,
      updatedAt:        SEED_TS,
    })
  );

  // ── Phase 3: wallet + groupMember balance updates ─────────────────────────
  console.log("\n  Phase 3: wallet and groupMember balance updates");

  for (const dep of DEPOSITS) {
    const creditLimit = Math.round(dep.amount * 1.5);
    const availableCredit = creditLimit; // no loans yet at this point

    await w(
      dryRun,
      `update wallets/${dep.userId} balanceConfirmed=${dep.amount.toLocaleString()}`,
      () => db.collection("wallets").doc(dep.userId).update({
        balanceConfirmed: dep.amount,
        balancePending:   0,
        balanceLocked:    0,
        availableBalance: dep.amount,
        updatedAt:        now,
      })
    );

    await w(
      dryRun,
      `update groupMembers/${dep.userId} personalSavings=${dep.amount.toLocaleString()} creditLimit=${creditLimit.toLocaleString()}`,
      () => db.collection("groupMembers").doc(dep.userId).update({
        personalSavings: dep.amount,
        pendingSavings:  0,
        lockedSavings:   0,
        creditLimit,
        availableCredit,
        updatedAt:       now,
      })
    );
  }

  // ── Phase 4: group and fund totals ───────────────────────────────────────
  console.log("\n  Phase 4: group totalSavings and kirimbaFund.totalCollateral");

  await w(
    dryRun,
    `update groups/${GROUP_ID} totalSavings=${totalDepositAmount.toLocaleString()}`,
    () => db.collection("groups").doc(GROUP_ID).update({
      totalSavings: totalDepositAmount,
      updatedAt:    now,
    })
  );

  await w(
    dryRun,
    `update kirimbaFund/current totalCollateral+=${totalDepositAmount.toLocaleString()}`,
    () => db.collection("kirimbaFund").doc("current").update({
      totalCollateral: FieldValue.increment(totalDepositAmount),
      lastUpdated:     now,
    })
  );

  // ── Phase 5: loan (pending — awaiting agent disbursement) ─────────────────
  console.log("\n  Phase 5: pending loan for seed_member_001 (demo scenario)");

  const dueDate = new Date(SEED_DATE);
  dueDate.setDate(dueDate.getDate() + LOAN_TERM);

  await w(
    dryRun,
    `write loans/${LOAN_ID} (${LOAN_AMOUNT.toLocaleString()} BIF / ${LOAN_TERM}-day / status=pending)`,
    () => db.collection("loans").doc(LOAN_ID).set({
      userId:          "seed_member_001",
      groupId:         GROUP_ID,
      amount:          LOAN_AMOUNT,
      interestRate:    0.06,
      interestAmount:  LOAN_INTEREST,
      totalDue:        LOAN_TOTAL,
      termDays:        LOAN_TERM,
      dueDate:         admin.firestore.Timestamp.fromDate(dueDate),
      status:          "pending",   // auto-approved; waiting for agent disburseLoan call
      approvalType:    "auto",
      paidAmount:      0,
      remainingDue:    LOAN_TOTAL,
      purpose:         "Stock purchase for market stall",
      fundSource:      "kirimba_fund",
      disbursedBy:     null,
      disbursedAt:     null,
      repaidAt:        null,
      defaultedAt:     null,
      rejectionReason: null,
      createdAt:       SEED_TS,
      updatedAt:       null,
    })
  );

  // ── Phase 6: reset counters after seeding transactions ───────────────────
  console.log("\n  Phase 6: advance receipt counter past seeded transactions");

  const year = new Date().getFullYear();
  await w(
    dryRun,
    `update counters/TXN_${year} value=${seq - 1} (accounts for ${seq - 1} seeded transactions)`,
    () => db.collection("counters").doc(`TXN_${year}`).set({
      value:     seq - 1,
      updatedAt: now,
    })
  );

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("\n  Demo finance scenario summary:");
  console.log(`    Group:         ${GROUP_ID} (Twese Hamwe)`);
  console.log(`    Deposit batch: ${BATCH_ID} → confirmed`);
  console.log(`    Transactions:  ${DEPOSITS.length} deposits, ${totalDepositAmount.toLocaleString()} BIF total`);
  console.log(`    Loan:          ${LOAN_ID} — seed_member_001, ${LOAN_AMOUNT.toLocaleString()} BIF, status=PENDING`);
  console.log(`    → Agent can call disburseLoan("${LOAN_ID}") to complete the demo scenario`);
  console.log(`    → Admin sees pending loan at /admin/loans`);
  console.log(`    → seed_member_001 wallet: balanceConfirmed=100,000 / creditLimit=150,000`);

  console.log(`\n  05-seed-finance: ${dryRun ? "dry-run complete" : "complete"}\n`);
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  if (!opts.demo) {
    console.log("  05-seed-finance: SKIPPED (--demo flag not provided)");
    console.log("  Use --demo to seed demo financial data.");
    process.exit(0);
  }
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
