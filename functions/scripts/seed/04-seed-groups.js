"use strict";
/**
 * 04-seed-groups.js — Seed groups, groupMembers, agent assignedGroups,
 * and backfill user.groupId / user.ledGroupId. Also resets receipt counters.
 *
 * GROUP CODE DECISION (documented):
 *   Both groupCode (KRM-XXX) and inviteCode (KIR-XXXX) are seeded.
 *   Reason: the codebase has two separate join flows:
 *     - joinGroup()           queries groups by groupCode
 *     - joinGroupByInviteCode() queries groups by inviteCode
 *   GroupCodeScreen displays inviteCode with groupCode as fallback.
 *   Missing either field silently breaks the corresponding join path.
 *
 * Usage:
 *   node scripts/seed/04-seed-groups.js --dry-run
 *   node scripts/seed/04-seed-groups.js
 */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();
const { FieldValue } = require("firebase-admin/firestore");

const { requireProjectGuard, w, parseArgs } = require("./lib");
const GROUPS = require("./data/groups.json");

async function run({ dryRun = false } = {}) {
  console.log("=".repeat(60));
  console.log("  04-seed-groups.js");
  requireProjectGuard(admin);

  const now = FieldValue.serverTimestamp();

  console.log(`  Groups to seed: ${GROUPS.length}\n`);

  // ── Phase 1: groups ───────────────────────────────────────────────────────
  console.log("  Phase 1: groups");

  for (const grp of GROUPS) {
    await w(
      dryRun,
      `write groups/${grp.id} (${grp.name}, code=${grp.groupCode}, invite=${grp.inviteCode})`,
      () => db.collection("groups").doc(grp.id).set({
        name:                  grp.name,
        description:           grp.description,
        groupCode:             grp.groupCode,
        inviteCode:            grp.inviteCode,
        leaderId:              grp.leaderId,
        institutionId:         grp.institutionId,
        umucoAccountNo:        grp.umucoAccountNo,
        status:                "active",
        totalSavings:          0,
        pendingSavings:        0,
        totalLoansOutstanding: 0,
        memberCount:           grp.memberIds.length,
        borrowingPaused:       false,
        createdAt:             now,
        approvedAt:            now,
      })
    );
  }

  // ── Phase 2: groupMembers (doc ID = userId) ───────────────────────────────
  console.log("\n  Phase 2: groupMembers");

  for (const grp of GROUPS) {
    for (const userId of grp.memberIds) {
      await w(
        dryRun,
        `write groupMembers/${userId} (group: ${grp.id})`,
        () => db.collection("groupMembers").doc(userId).set({
          userId,
          groupId:         grp.id,
          personalSavings: 0,
          pendingSavings:  0,
          lockedSavings:   0,
          creditLimit:     0,
          availableCredit: 0,
          joinedAt:        now,
          isActive:        true,
          updatedAt:       now,
        })
      );
    }
  }

  // ── Phase 3: backfill user.groupId / user.ledGroupId ────────────────────
  console.log("\n  Phase 3: user group fields backfill");

  for (const grp of GROUPS) {
    for (const userId of grp.memberIds) {
      const isLeader = userId === grp.leaderId;
      const update = {
        groupId:    grp.id,
        updatedAt:  now,
        ...(isLeader ? { ledGroupId: grp.id, isLeader: true, role: "leader" } : {}),
      };
      await w(
        dryRun,
        `update users/${userId} groupId=${grp.id}${isLeader ? " (leader)" : ""}`,
        () => db.collection("users").doc(userId).update(update)
      );
    }
  }

  // ── Phase 4: agent assignedGroups ────────────────────────────────────────
  console.log("\n  Phase 4: agent assignedGroups");

  // Build agent → groups map
  const agentGroups = {};
  for (const grp of GROUPS) {
    for (const agentId of grp.agentIds) {
      if (!agentGroups[agentId]) agentGroups[agentId] = [];
      agentGroups[agentId].push(grp.id);
    }
  }

  for (const [agentId, groupIds] of Object.entries(agentGroups)) {
    await w(
      dryRun,
      `update users/${agentId} assignedGroups=${JSON.stringify(groupIds)}`,
      () => db.collection("users").doc(agentId).update({
        assignedGroups: groupIds,
        updatedAt: now,
      })
    );
  }

  // ── Phase 5: reset receipt counters ──────────────────────────────────────
  console.log("\n  Phase 5: reset counters");

  const year = new Date().getFullYear();
  await w(
    dryRun,
    `write counters/TXN_${year} = 0`,
    () => db.collection("counters").doc(`TXN_${year}`).set({
      value:     0,
      updatedAt: now,
    })
  );

  console.log(`\n  04-seed-groups: ${dryRun ? "dry-run complete" : "complete"}\n`);
}

if (require.main === module) {
  const opts = parseArgs(process.argv);
  run(opts).then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
}

module.exports = { run };
