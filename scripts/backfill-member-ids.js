"use strict";

const admin = require("firebase-admin");

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
});

const db = admin.firestore();

function buildMemberIdCandidate(uid) {
  const uidSuffix = String(uid || "")
    .slice(-4)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "X")
    .padStart(4, "X");
  const random3 = Math.floor(100 + Math.random() * 900);
  return `M-${uidSuffix}-${random3}`;
}

async function getUniqueMemberId(uid) {
  for (let i = 0; i < 50; i += 1) {
    const memberId = buildMemberIdCandidate(uid);
    const existing = await db
      .collection("users")
      .where("memberId", "==", memberId)
      .limit(1)
      .get();
    if (existing.empty) {
      return memberId;
    }
  }
  throw new Error(`Unable to generate unique memberId for uid=${uid}`);
}

function isMemberLike(user) {
  return user.role === "member" || user.role === "leader" || user.isLeader === true;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const activeSnap = await db.collection("users").where("status", "==", "active").get();

  const targets = activeSnap.docs.filter((docSnap) => {
    const user = docSnap.data();
    return isMemberLike(user) && !user.memberId;
  });

  if (targets.length === 0) {
    console.log("No active members missing memberId.");
    return;
  }

  console.log(
    `${dryRun ? "[dry-run] " : ""}Found ${targets.length} active member(s) missing memberId.`
  );

  let updated = 0;
  for (const docSnap of targets) {
    const memberId = await getUniqueMemberId(docSnap.id);
    if (dryRun) {
      console.log(`[dry-run] ${docSnap.id} -> ${memberId}`);
      continue;
    }

    await docSnap.ref.set(
      {
        memberId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    updated += 1;
    console.log(`${docSnap.id} -> ${memberId}`);
  }

  console.log(
    dryRun
      ? "[dry-run] No writes executed."
      : `Backfill complete. Updated ${updated} member(s).`
  );
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
