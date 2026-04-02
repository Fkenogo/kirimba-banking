#!/usr/bin/env node
/**
 * One-time migration: upgrade all users with role "umuco" to role "institution_user".
 * Mirrors the migrateInstitutionUserRoles Cloud Function.
 *
 * Usage:
 *   node scripts/migrate-institution-users.js          # dry run (no writes)
 *   node scripts/migrate-institution-users.js --apply  # execute migration
 */

"use strict";

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const auth = admin.auth();
const { FieldValue } = admin.firestore;

const apply = process.argv.includes("--apply");

async function main() {
  console.log("\n=== Kirimba Institution-User Role Migration ===");
  console.log(`Mode:    ${apply ? "APPLY (writes enabled)" : "DRY RUN (no writes)"}`);
  console.log("Project: kirimba-banking\n");

  // Query all users with legacy role "umuco"
  const snap = await db.collection("users").where("role", "==", "umuco").get();

  if (snap.empty) {
    console.log("✅ No legacy umuco users found. Migration not needed.");
    return;
  }

  console.log(`Found ${snap.size} legacy umuco user(s):\n`);

  const migrated = [];
  const errors = [];

  for (const userDoc of snap.docs) {
    const uid = userDoc.id;
    const data = userDoc.data();
    const institutionId = data.institutionId || "umuco";
    const displayName = data.fullName || data.name || "Unknown";

    console.log(`  [${uid}] ${displayName} | institutionId: ${institutionId}`);

    if (!apply) continue;

    try {
      await db.collection("users").doc(uid).update({
        role: "institution_user",
        updatedAt: FieldValue.serverTimestamp(),
      });

      await auth.setCustomUserClaims(uid, {
        role: "institution_user",
        institutionId,
      });

      console.log(`    ✅ Migrated → institution_user (institutionId: ${institutionId})`);
      migrated.push({ uid, institutionId, name: displayName });
    } catch (err) {
      console.error(`    ❌ Failed: ${err.message}`);
      errors.push({ uid, error: err.message });
    }
  }

  if (!apply) {
    console.log(`\n--- DRY RUN COMPLETE ---`);
    console.log(`Would migrate: ${snap.size} user(s)`);
    console.log(`Re-run with --apply to execute.`);
    return;
  }

  console.log(`\n--- MIGRATION COMPLETE ---`);
  console.log(`Total found:  ${snap.size}`);
  console.log(`Migrated:     ${migrated.length}`);
  console.log(`Errors:       ${errors.length}`);

  if (errors.length > 0) {
    console.log("\nUsers requiring manual fix:");
    errors.forEach((e) => console.log(`  [${e.uid}] ${e.error}`));
  }

  try {
    await db.collection("auditLog").add({
      actorId: "system_migration_script",
      actorRole: "super_admin",
      action: "institution_role_migration",
      targetType: "users",
      targetId: null,
      meta: {
        migratedCount: migrated.length,
        errorCount: errors.length,
        migrated,
        errors,
        runBy: "migrate-institution-users.js CLI script",
      },
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log("\n✅ Audit log entry written.");
  } catch (auditErr) {
    console.warn(`\n⚠️  Audit log write failed (non-fatal): ${auditErr.message}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nFATAL:", err.message);
    process.exit(1);
  });
