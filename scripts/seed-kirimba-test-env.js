#!/usr/bin/env node
"use strict";

const admin = require("firebase-admin");

const PROJECT_ID = process.env.GCLOUD_PROJECT || "kirimba-banking";
const isEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST) && Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST);
const allowProduction = process.argv.includes("--allow-production");
const resetOnly = process.argv.includes("--reset");

if (!isEmulator && !allowProduction) {
  console.error(
    "Safety stop: seeding is emulator-only by default. Set FIRESTORE_EMULATOR_HOST + FIREBASE_AUTH_EMULATOR_HOST, or pass --allow-production intentionally."
  );
  process.exit(1);
}

if (!isEmulator && allowProduction && process.env.KIRIMBA_TEST_MODE !== "true") {
  console.error(
    "Production-test mode requires KIRIMBA_TEST_MODE=true to proceed with --allow-production."
  );
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp(
    isEmulator
      ? { projectId: PROJECT_ID }
      : { credential: admin.credential.applicationDefault(), projectId: PROJECT_ID }
  );
}

const db = admin.firestore();
const auth = admin.auth();
const { Timestamp } = admin.firestore;

const PIN = "123456";

const IDS = {
  superAdmin: "seed_super_admin",
  admin: "seed_admin",
  institution: "seed_institution_user",
  agent: "seed_agent",
  leader: "seed_leader_active",
  memberA: "seed_member_active_a",
  memberB: "seed_member_active_b",
  pendingMember: "seed_member_pending",
  memberNoGroup: "seed_member_no_group",
  pendingJoinMember: "seed_member_pending_join",
  pendingGroupLeader: "seed_member_pending_group_leader",

  activeGroup: "seed_group_active",
  pendingGroup: "seed_group_pending",

  loanPending: "seed_loan_pending",
  loanActive: "seed_loan_active",
  loanOverdue: "seed_loan_overdue",

  txnPendingDeposit: "seed_txn_deposit_pending",
  txnConfirmedDeposit: "seed_txn_deposit_confirmed",
  txnRepaymentHistory: "seed_txn_repayment_history",

  batchSubmitted: "seed_batch_submitted",
  batchConfirmed: "seed_batch_confirmed",
};

function phoneToAuthEmail(phone) {
  return `${String(phone || "").trim()}@kirimba.app`;
}

function daysFromNow(days) {
  const ms = Date.now() + days * 24 * 60 * 60 * 1000;
  return Timestamp.fromDate(new Date(ms));
}

const PERSONAS = [
  {
    uid: IDS.superAdmin,
    role: "super_admin",
    status: "active",
    fullName: "Demo Super Admin",
    phone: "+250700000001",
    memberId: null,
    institutionId: null,
  },
  {
    uid: IDS.admin,
    role: "admin",
    status: "active",
    fullName: "Demo Admin",
    phone: "+250700000002",
    memberId: null,
    institutionId: null,
  },
  {
    uid: IDS.institution,
    role: "umuco",
    status: "active",
    fullName: "Demo Umuco Officer",
    phone: "+250700000003",
    memberId: null,
    institutionId: "umuco",
  },
  {
    uid: IDS.agent,
    role: "agent",
    status: "active",
    fullName: "Demo Field Agent",
    phone: "+25766100001",
    memberId: null,
    institutionId: "umuco",
  },
  {
    uid: IDS.leader,
    role: "leader",
    status: "active",
    fullName: "Demo Group Leader",
    phone: "+25766100002",
    memberId: "M-LDR-001",
    institutionId: "umuco",
  },
  {
    uid: IDS.memberA,
    role: "member",
    status: "active",
    fullName: "Demo Member A",
    phone: "+25766100003",
    memberId: "M-MA-001",
    institutionId: "umuco",
  },
  {
    uid: IDS.memberB,
    role: "member",
    status: "active",
    fullName: "Demo Member B",
    phone: "+25766100004",
    memberId: "M-MB-001",
    institutionId: "umuco",
  },
  {
    uid: IDS.pendingMember,
    role: "member",
    status: "pending_approval",
    fullName: "Demo Pending Member",
    phone: "+25766100005",
    memberId: null,
    institutionId: null,
  },
  {
    uid: IDS.memberNoGroup,
    role: "member",
    status: "active",
    fullName: "Demo Active No Group",
    phone: "+25766100006",
    memberId: "M-NG-001",
    institutionId: "umuco",
  },
  {
    uid: IDS.pendingJoinMember,
    role: "member",
    status: "active",
    fullName: "Demo Pending Join Member",
    phone: "+25766100007",
    memberId: "M-PJ-001",
    institutionId: "umuco",
  },
  {
    uid: IDS.pendingGroupLeader,
    role: "member",
    status: "active",
    fullName: "Demo Pending Group Leader",
    phone: "+25766100008",
    memberId: "M-PG-001",
    institutionId: "umuco",
  },
];

const seedManifest = {
  users: PERSONAS.map((u) => ({ uid: u.uid, role: u.role, phone: u.phone, pin: PIN })),
  notes: [
    "All seeded users use PIN 123456.",
    "Auth username is phone@kirimba.app internally.",
    "Data is deterministic and uses seed_* IDs for cleanup.",
  ],
};

async function upsertAuthUser(persona) {
  const email = persona.role === "super_admin" ? "seed.superadmin@kirimba.app" : phoneToAuthEmail(persona.phone);
  const userPayload = {
    uid: persona.uid,
    email,
    password: PIN,
    displayName: persona.fullName,
    disabled: false,
  };

  try {
    await auth.getUser(persona.uid);
    await auth.updateUser(persona.uid, userPayload);
  } catch (err) {
    if (err && err.code === "auth/user-not-found") {
      await auth.createUser(userPayload);
    } else {
      throw err;
    }
  }

  await auth.setCustomUserClaims(persona.uid, { role: persona.role });
}

async function seedUsersAndWallets() {
  for (const persona of PERSONAS) {
    await upsertAuthUser(persona);

    const userPayload = {
      uid: persona.uid,
      role: persona.role,
      status: persona.status,
      fullName: persona.fullName,
      name: persona.fullName,
      phone: persona.phone,
      email: persona.role === "super_admin" ? "seed.superadmin@kirimba.app" : phoneToAuthEmail(persona.phone),
      institutionId: persona.institutionId || null,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    };

    if (persona.memberId) {
      userPayload.memberId = persona.memberId;
    }

    if (persona.uid === IDS.leader) {
      userPayload.isLeader = true;
      userPayload.groupId = IDS.activeGroup;
      userPayload.ledGroupId = IDS.activeGroup;
    }

    if (persona.uid === IDS.memberA || persona.uid === IDS.memberB) {
      userPayload.groupId = IDS.activeGroup;
    }

    await db.collection("users").doc(persona.uid).set(userPayload, { merge: true });

    if (persona.status === "active" && (persona.role === "member" || persona.role === "leader")) {
      await db.collection("wallets").doc(persona.uid).set(
        {
          userId: persona.uid,
          balanceConfirmed: persona.uid === IDS.leader ? 220000 : 120000,
          balancePending: 0,
          balanceLocked: persona.uid === IDS.memberB ? 70000 : persona.uid === IDS.leader ? 50000 : 0,
          availableBalance: persona.uid === IDS.memberB ? 50000 : persona.uid === IDS.leader ? 170000 : 120000,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        },
        { merge: true }
      );
    }
  }
}

async function seedGroups() {
  await db.collection("groups").doc(IDS.activeGroup).set(
    {
      name: "Demo Active Group",
      groupCode: "KIR-DEMO-ACT",
      inviteCode: "KIR-ACT-001",
      status: "active",
      leaderId: IDS.leader,
      institutionId: "umuco",
      memberCount: 3,
      totalSavings: 450000,
      totalLoansOutstanding: 130000,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("groups").doc(IDS.pendingGroup).set(
    {
      name: "Demo Pending Group",
      groupCode: "KIR-DEMO-PEN",
      inviteCode: "KIR-PEN-001",
      status: "pending_approval",
      leaderId: IDS.pendingGroupLeader,
      institutionId: "umuco",
      memberCount: 0,
      totalSavings: 0,
      totalLoansOutstanding: 0,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("groupMembers").doc(IDS.leader).set(
    {
      userId: IDS.leader,
      groupId: IDS.activeGroup,
      isActive: true,
      joinedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("groupMembers").doc(IDS.memberA).set(
    {
      userId: IDS.memberA,
      groupId: IDS.activeGroup,
      isActive: true,
      joinedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("groupMembers").doc(IDS.memberB).set(
    {
      userId: IDS.memberB,
      groupId: IDS.activeGroup,
      isActive: true,
      joinedAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db
    .collection("groups")
    .doc(IDS.activeGroup)
    .collection("joinRequests")
    .doc(IDS.pendingJoinMember)
    .set(
      {
        userId: IDS.pendingJoinMember,
        groupId: IDS.activeGroup,
        groupCode: "KIR-DEMO-ACT",
        fullName: "Demo Pending Join Member",
        name: "Demo Pending Join Member",
        phone: "+25766100007",
        memberId: "M-PJ-001",
        status: "pending",
        requestedBy: IDS.pendingJoinMember,
        createdAt: Timestamp.now(),
      },
      { merge: true }
    );
}

async function seedFinancialState() {
  await db.collection("transactions").doc(IDS.txnPendingDeposit).set(
    {
      userId: IDS.memberA,
      memberId: IDS.memberA,
      groupId: IDS.activeGroup,
      walletId: IDS.memberA,
      type: "deposit",
      amount: 15000,
      status: "pending_confirmation",
      channel: "agent",
      batchId: IDS.batchSubmitted,
      recordedBy: IDS.agent,
      notes: "Demo pending deposit",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("transactions").doc(IDS.txnConfirmedDeposit).set(
    {
      userId: IDS.memberB,
      memberId: IDS.memberB,
      groupId: IDS.activeGroup,
      walletId: IDS.memberB,
      type: "deposit",
      amount: 30000,
      status: "confirmed",
      channel: "agent",
      batchId: IDS.batchConfirmed,
      recordedBy: IDS.agent,
      notes: "Demo confirmed deposit",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("transactions").doc(IDS.txnRepaymentHistory).set(
    {
      userId: IDS.memberB,
      memberId: IDS.memberB,
      groupId: IDS.activeGroup,
      walletId: IDS.memberB,
      type: "loan_repay",
      amount: 10000,
      status: "confirmed",
      channel: "admin_console",
      recordedBy: IDS.admin,
      receiptNo: "TXN-DEMO-0001",
      loanId: IDS.loanActive,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("depositBatches").doc(IDS.batchSubmitted).set(
    {
      groupId: IDS.activeGroup,
      institutionId: "umuco",
      status: "submitted",
      totalAmount: 15000,
      memberCount: 1,
      transactionIds: [IDS.txnPendingDeposit],
      submittedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("depositBatches").doc(IDS.batchConfirmed).set(
    {
      groupId: IDS.activeGroup,
      institutionId: "umuco",
      status: "confirmed",
      totalAmount: 30000,
      memberCount: 1,
      transactionIds: [IDS.txnConfirmedDeposit],
      submittedAt: Timestamp.now(),
      confirmedAt: Timestamp.now(),
      umucoNotes: "Demo confirmed batch",
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    },
    { merge: true }
  );

  await db.collection("loans").doc(IDS.loanPending).set(
    {
      userId: IDS.memberA,
      memberId: IDS.memberA,
      groupId: IDS.activeGroup,
      amount: 50000,
      paidAmount: 0,
      remainingDue: 55000,
      interestAmount: 5000,
      totalDue: 55000,
      termDays: 30,
      purpose: "Demo pending loan",
      status: "pending",
      createdAt: Timestamp.now(),
      dueDate: daysFromNow(20),
    },
    { merge: true }
  );

  await db.collection("loans").doc(IDS.loanActive).set(
    {
      userId: IDS.memberB,
      memberId: IDS.memberB,
      groupId: IDS.activeGroup,
      amount: 70000,
      paidAmount: 10000,
      remainingDue: 60000,
      interestAmount: 7000,
      totalDue: 77000,
      termDays: 30,
      purpose: "Demo active loan",
      status: "active",
      disbursedBy: IDS.admin,
      disbursedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      dueDate: daysFromNow(10),
    },
    { merge: true }
  );

  await db.collection("loans").doc(IDS.loanOverdue).set(
    {
      userId: IDS.leader,
      memberId: IDS.leader,
      groupId: IDS.activeGroup,
      amount: 60000,
      paidAmount: 0,
      remainingDue: 66000,
      interestAmount: 6000,
      totalDue: 66000,
      termDays: 14,
      purpose: "Demo overdue loan",
      status: "active",
      disbursedBy: IDS.agent,
      disbursedAt: Timestamp.now(),
      createdAt: Timestamp.now(),
      dueDate: daysFromNow(-5),
    },
    { merge: true }
  );

  await db.collection("kirimbaFund").doc("current").set(
    {
      availableFund: 2500000,
      deployedFund: 130000,
      updatedAt: Timestamp.now(),
      lastUpdated: Timestamp.now(),
      updatedBy: IDS.admin,
    },
    { merge: true }
  );
}

async function resetSeededData() {
  const docRefs = [
    ...PERSONAS.map((u) => db.collection("users").doc(u.uid)),
    ...PERSONAS.map((u) => db.collection("wallets").doc(u.uid)),
    db.collection("groups").doc(IDS.activeGroup),
    db.collection("groups").doc(IDS.pendingGroup),
    db.collection("groupMembers").doc(IDS.leader),
    db.collection("groupMembers").doc(IDS.memberA),
    db.collection("groupMembers").doc(IDS.memberB),
    db.collection("transactions").doc(IDS.txnPendingDeposit),
    db.collection("transactions").doc(IDS.txnConfirmedDeposit),
    db.collection("transactions").doc(IDS.txnRepaymentHistory),
    db.collection("depositBatches").doc(IDS.batchSubmitted),
    db.collection("depositBatches").doc(IDS.batchConfirmed),
    db.collection("loans").doc(IDS.loanPending),
    db.collection("loans").doc(IDS.loanActive),
    db.collection("loans").doc(IDS.loanOverdue),
    db.collection("config").doc("seed_manifest"),
  ];

  const batch = db.batch();
  docRefs.forEach((ref) => batch.delete(ref));
  batch.delete(db.collection("groups").doc(IDS.activeGroup).collection("joinRequests").doc(IDS.pendingJoinMember));
  await batch.commit();

  for (const persona of PERSONAS) {
    try {
      await auth.deleteUser(persona.uid);
    } catch (err) {
      if (err && err.code !== "auth/user-not-found") {
        throw err;
      }
    }
  }
}

async function seed() {
  await seedUsersAndWallets();
  await seedGroups();
  await seedFinancialState();

  await db.collection("config").doc("seed_manifest").set(
    {
      key: "kirimba_seed_v1",
      seededAt: Timestamp.now(),
      environment: isEmulator ? "emulator" : "production-test",
      data: seedManifest,
    },
    { merge: true }
  );
}

async function main() {
  console.log(`Seeding target: ${isEmulator ? "emulator" : "production-test"}`);
  await resetSeededData();
  if (!resetOnly) {
    await seed();
    console.log("Seed complete.");
  } else {
    console.log("Reset complete.");
  }

  console.log("Seeded personas (phone / PIN):");
  PERSONAS.forEach((p) => {
    console.log(`- ${p.role.padEnd(12)} ${p.phone || "seed.superadmin@kirimba.app"} / ${PIN}`);
  });
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
