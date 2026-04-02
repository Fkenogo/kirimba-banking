import admin from "firebase-admin";

process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";

if (!admin.apps.length) {
  admin.initializeApp({ projectId: "kirimba-banking" });
}

const adminDb = admin.firestore();

async function ensureAuthUser({ uid, email, password, claims }) {
  try {
    await admin.auth().deleteUser(uid);
  } catch {}
  await admin.auth().createUser({ uid, email, password });
  await admin.auth().setCustomUserClaims(uid, claims);
}

async function deleteDoc(path) {
  try {
    await adminDb.doc(path).delete();
  } catch {}
}

await Promise.all([
  deleteDoc("depositBatches/seed_batch_pending"),
  deleteDoc("depositBatches/seed_batch_confirm"),
  deleteDoc("depositBatches/seed_batch_flag"),
  deleteDoc("depositBatches/seed_batch_other"),
  deleteDoc("transactions/seed_tx_pending"),
  deleteDoc("transactions/seed_tx_confirm"),
  deleteDoc("transactions/seed_tx_flag"),
  deleteDoc("transactions/seed_tx_other"),
  deleteDoc("users/seed_institution_user"),
  deleteDoc("users/seed_agent_a"),
  deleteDoc("users/seed_agent_b"),
  deleteDoc("users/seed_member_a"),
  deleteDoc("users/seed_member_b"),
  deleteDoc("users/seed_member_c"),
  deleteDoc("users/seed_member_other"),
  deleteDoc("groups/seed_group_a"),
  deleteDoc("groups/seed_group_b"),
  deleteDoc("groups/seed_group_other"),
  deleteDoc("wallets/seed_member_a"),
  deleteDoc("wallets/seed_member_b"),
  deleteDoc("wallets/seed_member_c"),
  deleteDoc("wallets/seed_member_other"),
  deleteDoc("institutions/seed_inst_a"),
  deleteDoc("institutions/seed_inst_b"),
]);

await ensureAuthUser({
  uid: "seed_institution_user",
  email: "+25766100020@kirimba.app",
  password: "123456",
  claims: { role: "institution_user", institutionId: "seed_inst_a" },
});

await Promise.all([
  adminDb.doc("institutions/seed_inst_a").set({ name: "Kibira SACCO", status: "active" }, { merge: true }),
  adminDb.doc("institutions/seed_inst_b").set({ name: "Tanganyika MFI", status: "active" }, { merge: true }),
  adminDb.doc("users/seed_institution_user").set({
    uid: "seed_institution_user",
    role: "institution_user",
    institutionId: "seed_inst_a",
    fullName: "Institution Operator",
    phone: "+25766100020",
    status: "active",
  }, { merge: true }),
  adminDb.doc("users/seed_agent_a").set({ uid: "seed_agent_a", role: "agent", fullName: "Alice Agent", institutionId: "seed_inst_a", status: "active" }, { merge: true }),
  adminDb.doc("users/seed_agent_b").set({ uid: "seed_agent_b", role: "agent", fullName: "Blaise Agent", institutionId: "seed_inst_a", status: "active" }, { merge: true }),
  adminDb.doc("users/seed_member_a").set({ uid: "seed_member_a", role: "member", fullName: "Member A", memberId: "M-A-001", status: "active", institutionId: "seed_inst_a", groupId: "seed_group_a" }, { merge: true }),
  adminDb.doc("users/seed_member_b").set({ uid: "seed_member_b", role: "member", fullName: "Member B", memberId: "M-B-001", status: "active", institutionId: "seed_inst_a", groupId: "seed_group_a" }, { merge: true }),
  adminDb.doc("users/seed_member_c").set({ uid: "seed_member_c", role: "member", fullName: "Member C", memberId: "M-C-001", status: "active", institutionId: "seed_inst_a", groupId: "seed_group_b" }, { merge: true }),
  adminDb.doc("users/seed_member_other").set({ uid: "seed_member_other", role: "member", fullName: "Other Member", memberId: "M-O-001", status: "active", institutionId: "seed_inst_b", groupId: "seed_group_other" }, { merge: true }),
  adminDb.doc("groups/seed_group_a").set({ name: "Kibira Alpha", institutionId: "seed_inst_a", totalSavings: 0, pendingSavings: 15000, status: "active" }, { merge: true }),
  adminDb.doc("groups/seed_group_b").set({ name: "Kibira Beta", institutionId: "seed_inst_a", totalSavings: 0, pendingSavings: 12000, status: "active" }, { merge: true }),
  adminDb.doc("groups/seed_group_other").set({ name: "Tanganyika Gamma", institutionId: "seed_inst_b", totalSavings: 0, pendingSavings: 9000, status: "active" }, { merge: true }),
  adminDb.doc("wallets/seed_member_a").set({ userId: "seed_member_a", balanceConfirmed: 0, balancePending: 10000, balanceLocked: 0, availableBalance: 0 }, { merge: true }),
  adminDb.doc("wallets/seed_member_b").set({ userId: "seed_member_b", balanceConfirmed: 0, balancePending: 5000, balanceLocked: 0, availableBalance: 0 }, { merge: true }),
  adminDb.doc("wallets/seed_member_c").set({ userId: "seed_member_c", balanceConfirmed: 0, balancePending: 12000, balanceLocked: 0, availableBalance: 0 }, { merge: true }),
  adminDb.doc("wallets/seed_member_other").set({ userId: "seed_member_other", balanceConfirmed: 0, balancePending: 9000, balanceLocked: 0, availableBalance: 0 }, { merge: true }),
  adminDb.doc("kirimbaFund/current").set({ totalCollateral: 0, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true }),
]);

const now = admin.firestore.Timestamp.now();

await Promise.all([
  adminDb.doc("transactions/seed_tx_pending").set({
    userId: "seed_member_a",
    memberId: "M-A-001",
    memberName: "Member A",
    groupId: "seed_group_a",
    institutionId: "seed_inst_a",
    agentId: "seed_agent_a",
    type: "deposit",
    amount: 10000,
    status: "pending_confirmation",
    createdAt: now,
  }),
  adminDb.doc("transactions/seed_tx_confirm").set({
    userId: "seed_member_b",
    memberId: "M-B-001",
    memberName: "Member B",
    groupId: "seed_group_a",
    institutionId: "seed_inst_a",
    agentId: "seed_agent_a",
    type: "deposit",
    amount: 5000,
    status: "pending_confirmation",
    createdAt: now,
  }),
  adminDb.doc("transactions/seed_tx_flag").set({
    userId: "seed_member_c",
    memberId: "M-C-001",
    memberName: "Member C",
    groupId: "seed_group_b",
    institutionId: "seed_inst_a",
    agentId: "seed_agent_b",
    type: "deposit",
    amount: 12000,
    status: "pending_confirmation",
    createdAt: now,
  }),
  adminDb.doc("transactions/seed_tx_other").set({
    userId: "seed_member_other",
    memberId: "M-O-001",
    memberName: "Other Member",
    groupId: "seed_group_other",
    institutionId: "seed_inst_b",
    agentId: "seed_agent_b",
    type: "deposit",
    amount: 9000,
    status: "pending_confirmation",
    createdAt: now,
  }),
]);

await Promise.all([
  adminDb.doc("depositBatches/seed_batch_pending").set({
    institutionId: "seed_inst_a",
    groupId: "seed_group_a",
    agentId: "seed_agent_a",
    transactionIds: ["seed_tx_pending"],
    totalAmount: 10000,
    memberCount: 1,
    status: "submitted",
    submittedAt: now,
    createdAt: now,
    institutionNotes: null,
    institutionRef: null,
  }),
  adminDb.doc("depositBatches/seed_batch_confirm").set({
    institutionId: "seed_inst_a",
    groupId: "seed_group_a",
    agentId: "seed_agent_a",
    transactionIds: ["seed_tx_confirm"],
    totalAmount: 5000,
    memberCount: 1,
    status: "submitted",
    submittedAt: now,
    createdAt: now,
    institutionNotes: null,
    institutionRef: null,
  }),
  adminDb.doc("depositBatches/seed_batch_flag").set({
    institutionId: "seed_inst_a",
    groupId: "seed_group_b",
    agentId: "seed_agent_b",
    transactionIds: ["seed_tx_flag"],
    totalAmount: 12000,
    memberCount: 1,
    status: "submitted",
    submittedAt: now,
    createdAt: now,
    institutionNotes: null,
    institutionRef: null,
  }),
  adminDb.doc("depositBatches/seed_batch_other").set({
    institutionId: "seed_inst_b",
    groupId: "seed_group_other",
    agentId: "seed_agent_b",
    transactionIds: ["seed_tx_other"],
    totalAmount: 9000,
    memberCount: 1,
    status: "submitted",
    submittedAt: now,
    createdAt: now,
    institutionNotes: null,
    institutionRef: null,
  }),
]);

const [pendingSnap, historySnap, flaggedSnap] = await Promise.all([
  adminDb.collection("depositBatches").where("institutionId", "==", "seed_inst_a").where("status", "==", "submitted").get(),
  adminDb.collection("depositBatches").where("institutionId", "==", "seed_inst_a").where("status", "in", ["confirmed", "flagged"]).get(),
  adminDb.collection("depositBatches").where("institutionId", "==", "seed_inst_a").where("status", "==", "flagged").get(),
]);

console.log(JSON.stringify({
  login: {
    phone: "+25766100020",
    pin: "123456",
  },
  pendingIds: pendingSnap.docs.map((docSnap) => docSnap.id),
  historyIds: historySnap.docs.map((docSnap) => docSnap.id),
  flaggedIds: flaggedSnap.docs.map((docSnap) => docSnap.id),
}, null, 2));
process.exit(0);
