/**
 * backfillBatchInstitutionId.js
 *
 * Backfills missing `institutionId` on depositBatch documents.
 *
 * Derivation strategy (in priority order):
 *   1. batch.group.institutionId  — preferred, authoritative
 *   2. batch.agent.institutionId  — secondary if group has none
 *   3. SKIP — if neither source is available, the record is ambiguous and NOT written
 *              in apply mode. It is reported for manual review.
 *
 * The DEFAULT_INSTITUTION_ID constant is intentionally removed from apply logic.
 * Dry-run may suggest a fallback candidate for informational purposes only.
 *
 * Usage:
 *   FIREBASE_CONFIG='{"projectId":"kirimba-banking"}' node scripts/backfillBatchInstitutionId.js
 *   FIREBASE_CONFIG='{"projectId":"kirimba-banking"}' node scripts/backfillBatchInstitutionId.js --apply
 */

const admin = require("firebase-admin");

const isDryRun = !process.argv.includes("--apply");

if (!admin.apps.length) {
  admin.initializeApp();
}
const db = admin.firestore();

async function main() {
  console.log(`Mode: ${isDryRun ? "DRY-RUN (pass --apply to write)" : "APPLY"}`);
  console.log("Derivation: group.institutionId → agent.institutionId → SKIP (no fallback in apply)\n");

  const snap = await db.collection("depositBatches").get();
  const missing = snap.docs.filter((d) => !d.data().institutionId);

  console.log(`Total batches:               ${snap.size}`);
  console.log(`Batches missing institutionId: ${missing.length}\n`);

  if (missing.length === 0) {
    console.log("Nothing to backfill.");
    return;
  }

  // Collect unique groupIds and agentIds
  const groupIds = [...new Set(missing.map((d) => d.data().groupId).filter(Boolean))];
  const agentIds = [...new Set(missing.map((d) => d.data().agentId).filter(Boolean))];

  const groupInstMap = {};
  if (groupIds.length) {
    const snaps = await Promise.all(groupIds.map((id) => db.collection("groups").doc(id).get()));
    for (const gs of snaps) {
      if (gs.exists) groupInstMap[gs.id] = gs.data().institutionId || null;
    }
  }

  const agentInstMap = {};
  if (agentIds.length) {
    const snaps = await Promise.all(agentIds.map((id) => db.collection("users").doc(id).get()));
    for (const as of snaps) {
      if (as.exists) agentInstMap[as.id] = as.data().institutionId || null;
    }
  }

  const safeRecords = [];   // will be written in apply mode
  const skipRecords = [];   // ambiguous — no safe source found

  for (const batchDoc of missing) {
    const data = batchDoc.data();
    const groupInstId = data.groupId ? groupInstMap[data.groupId] : null;
    const agentInstId = data.agentId ? agentInstMap[data.agentId] : null;
    const resolvedId = groupInstId || agentInstId || null;
    const source = groupInstId ? "group.institutionId"
      : agentInstId ? "agent.institutionId"
      : null;

    if (resolvedId) {
      safeRecords.push({ doc: batchDoc, resolvedId, source, data });
    } else {
      skipRecords.push({ doc: batchDoc, data });
    }
  }

  // Print safe
  for (const r of safeRecords) {
    const tag = isDryRun ? "[DRY-RUN SAFE]" : "[WRITE SAFE] ";
    console.log(
      `${tag} batch ${r.doc.id} → "${r.resolvedId}"` +
      ` (source: ${r.source}, group: ${r.data.groupId || "none"}, agent: ${r.data.agentId || "none"}, status: ${r.data.status})`
    );
  }

  // Print skipped
  for (const r of skipRecords) {
    console.log(
      `[SKIP AMBIGUOUS] batch ${r.doc.id} — no group.institutionId or agent.institutionId found.` +
      ` (group: ${r.data.groupId || "none"}, agent: ${r.data.agentId || "none"}, status: ${r.data.status})` +
      ` → REQUIRES MANUAL INSTITUTION ASSIGNMENT`
    );
  }

  if (!isDryRun && safeRecords.length > 0) {
    const batchWrite = db.batch();
    let count = 0;
    for (const r of safeRecords) {
      batchWrite.update(db.collection("depositBatches").doc(r.doc.id), {
        institutionId: r.resolvedId,
      });
      count++;
      if (count % 400 === 0) {
        await batchWrite.commit();
        console.log(`  Flushed 400 writes.`);
      }
    }
    await batchWrite.commit();
    console.log(`\nCommitted ${count} safe write(s).`);
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`  Safe (${isDryRun ? "would write" : "written"}): ${safeRecords.length}`);
  console.log(`  Skipped (ambiguous, manual review needed): ${skipRecords.length}`);

  if (isDryRun) {
    console.log("\nRun with --apply to write safe records. Ambiguous records will never be auto-written.");
  }

  if (skipRecords.length > 0) {
    console.log("\nAMBIGUOUS BATCH IDs REQUIRING MANUAL ASSIGNMENT:");
    for (const r of skipRecords) {
      console.log(`  - ${r.doc.id} (status: ${r.data.status}, group: ${r.data.groupId || "none"})`);
    }
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
