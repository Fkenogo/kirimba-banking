/**
 * auditBackfill.js — verifies the institutionId assignments made by backfillBatchInstitutionId.js
 * Usage: FIREBASE_CONFIG='{"projectId":"kirimba-banking"}' node scripts/auditBackfill.js
 */
const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const DEFAULT_INSTITUTION_ID = "umuco";

// The 7 batch IDs updated during Phase 2B.2 backfill
const UPDATED_BATCH_IDS = [
  "9NRO6IxMzBdvphzlniST",
  "Pal67P3HLCzfj8OWUT5A",
  "WPTmb9ExeQ7YycfqJKEx",
  "dXoN6Ii7HYjaYiRMUVzw",
  "ihnE5WlLDAa9Q5F7sWvW",
  "ye94DIhtCEdKLwiYQCHI",
  "zTbG4dhy5Tp1h7n1cPAX",
];

async function main() {
  const batchSnaps = await Promise.all(
    UPDATED_BATCH_IDS.map((id) => db.collection("depositBatches").doc(id).get())
  );

  const groupIds = new Set();
  const agentIds = new Set();
  for (const s of batchSnaps) {
    if (s.exists) {
      const d = s.data();
      if (d.groupId) groupIds.add(d.groupId);
      if (d.agentId) agentIds.add(d.agentId);
    }
  }

  const groupMap = {};
  for (const gid of groupIds) {
    const gs = await db.collection("groups").doc(gid).get();
    groupMap[gid] = gs.exists ? gs.data() : null;
  }

  const agentMap = {};
  for (const aid of agentIds) {
    const as = await db.collection("users").doc(aid).get();
    agentMap[aid] = as.exists ? as.data() : null;
  }

  const results = [];
  for (const s of batchSnaps) {
    if (!s.exists) {
      results.push({ batchId: s.id, error: "NOT FOUND" });
      continue;
    }
    const d = s.data();
    const currentInstId = d.institutionId || null;
    const groupData = d.groupId ? groupMap[d.groupId] : null;
    const groupInstId = (groupData && groupData.institutionId) ? groupData.institutionId : null;
    const agentData = d.agentId ? agentMap[d.agentId] : null;
    const agentInstId = (agentData && agentData.institutionId) ? agentData.institutionId : null;

    let source, confidence, explanation;

    if (groupInstId && groupInstId === currentInstId) {
      source = "group.institutionId";
      confidence = "safe";
      explanation = "Written value matches group.institutionId exactly. No fallback used.";
    } else if (agentInstId && agentInstId === currentInstId) {
      source = "agent.institutionId";
      confidence = "safe";
      explanation = "Written value matches agent.institutionId (group had none). No fallback used.";
    } else if (!groupInstId && !agentInstId && currentInstId === DEFAULT_INSTITUTION_ID) {
      source = "DEFAULT_INSTITUTION_ID fallback";
      confidence = "ambiguous";
      explanation = "Neither group nor agent has institutionId set. Value was written via hardcoded fallback — requires manual review.";
    } else if (!groupInstId && !agentInstId) {
      source = "DEFAULT_INSTITUTION_ID fallback (non-default value)";
      confidence = "ambiguous";
      explanation = "Neither group nor agent has institutionId. Written value differs from DEFAULT — unexpected state.";
    } else {
      source = "MISMATCH";
      confidence = "ambiguous";
      explanation = `Written value '${currentInstId}' differs from group inst '${groupInstId}' and agent inst '${agentInstId}'.`;
    }

    results.push({
      batchId: s.id,
      status: d.status || "unknown",
      currentInstId,
      groupId: d.groupId || null,
      groupInstId,
      agentId: d.agentId || null,
      agentInstId,
      source,
      confidence,
      explanation,
    });
  }

  // Print table
  console.log("\n=== BATCH INSTITUTIONID BACKFILL AUDIT ===\n");
  let safe = 0, ambiguous = 0, fallbackUsed = [];

  for (const r of results) {
    if (r.error) {
      console.log(`[ERROR] ${r.batchId}: ${r.error}`);
      continue;
    }
    const marker = r.confidence === "safe" ? "OK " : "WARN";
    console.log(`[${marker}] ${r.batchId}`);
    console.log(`       status:       ${r.status}`);
    console.log(`       institutionId: ${r.currentInstId}`);
    console.log(`       source:       ${r.source}`);
    console.log(`       group:        ${r.groupId} (inst=${r.groupInstId})`);
    console.log(`       agent:        ${r.agentId} (inst=${r.agentInstId})`);
    console.log(`       explanation:  ${r.explanation}`);
    console.log();

    if (r.confidence === "safe") safe++;
    else {
      ambiguous++;
      if (r.source.includes("DEFAULT_INSTITUTION_ID")) fallbackUsed.push(r.batchId);
    }
  }

  console.log("=== SUMMARY ===");
  console.log(`  Total updated:    ${results.length}`);
  console.log(`  Safe:             ${safe}`);
  console.log(`  Ambiguous:        ${ambiguous}`);
  console.log(`  Fallback-derived: ${fallbackUsed.length} ${fallbackUsed.length ? JSON.stringify(fallbackUsed) : ""}`);
  console.log();
}

main().catch((err) => { console.error(err); process.exit(1); });
