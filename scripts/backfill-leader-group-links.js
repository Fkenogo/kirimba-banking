"use strict";

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();
const { FieldValue } = admin.firestore;

async function main() {
  const apply = process.argv.includes("--apply");
  const leadersSnap = await db.collection("users").where("role", "==", "leader").get();

  const targets = leadersSnap.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    return typeof data.ledGroupId === "string" && data.ledGroupId.trim().length > 0;
  });

  if (targets.length === 0) {
    console.log("No leader users with ledGroupId found.");
    return;
  }

  let usersUpdated = 0;
  let groupMembersCreated = 0;
  let skipped = 0;

  console.log(`${apply ? "[apply]" : "[dry-run]"} Found ${targets.length} leader user(s) with ledGroupId.`);

  for (const docSnap of targets) {
    const uid = docSnap.id;
    const userData = docSnap.data() || {};
    const ledGroupId = String(userData.ledGroupId || "").trim();
    const existingGroupId = String(userData.groupId || "").trim();

    const gmRef = db.collection("groupMembers").doc(uid);
    const gmSnap = await gmRef.get();

    const needsUserGroupId = !existingGroupId;
    const needsGroupMember = !gmSnap.exists;

    if (!needsUserGroupId && !needsGroupMember) {
      skipped += 1;
      console.log(`SKIP ${uid} (groupId and groupMembers already present)`);
      continue;
    }

    if (!apply) {
      console.log(
        `[dry-run] ${uid} ledGroupId=${ledGroupId} user.groupId=${existingGroupId || "<missing>"} groupMember=${gmSnap.exists ? "exists" : "missing"}`
      );
      if (needsUserGroupId) usersUpdated += 1;
      if (needsGroupMember) groupMembersCreated += 1;
      continue;
    }

    const batch = db.batch();

    if (needsUserGroupId) {
      batch.set(
        docSnap.ref,
        {
          groupId: ledGroupId,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      usersUpdated += 1;
    }

    if (needsGroupMember) {
      batch.set(
        gmRef,
        {
          userId: uid,
          groupId: ledGroupId,
          joinedAt: FieldValue.serverTimestamp(),
          isActive: true,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      groupMembersCreated += 1;
    }

    await batch.commit();
    console.log(`UPDATED ${uid} (groupId=${needsUserGroupId ? "set" : "kept"}, groupMember=${needsGroupMember ? "created" : "kept"})`);
  }

  console.log("Summary:");
  console.log(`- user.groupId updates: ${usersUpdated}`);
  console.log(`- groupMembers created: ${groupMembersCreated}`);
  console.log(`- skipped: ${skipped}`);
  if (!apply) {
    console.log("Dry run only. Re-run with --apply to persist changes.");
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
