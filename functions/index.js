const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
const { FieldValue } = require("firebase-admin/firestore");
const members = require("./src/members");
const savings = require("./src/savings");
const loans = require("./src/loans");
const scheduledFunctions = require("./src/scheduledFunctions");

if (!admin.apps.length) {
  admin.initializeApp();
}

const db = admin.firestore();

/**
 * Health check endpoint
 */
exports.healthCheck = functions.https.onRequest((req, res) => {
  res.status(200).send("KIRIMBA backend is running");
});

/**
 * Automatically create user profile and wallet
 * when a new Firebase Auth user is created
 */
exports.onUserCreate = functions.auth.user().onCreate(async (user) => {
  const { uid, email, phoneNumber } = user;

  const userRef = db.collection("users").doc(uid);
  const walletRef = db.collection("wallets").doc(uid);

  try {
    const [userSnap, walletSnap] = await Promise.all([
      userRef.get(),
      walletRef.get(),
    ]);

    const writes = [];

    if (!userSnap.exists) {
      const userPayload = {
        uid,
        role: "member",
        status: "pending_approval",
        createdAt: FieldValue.serverTimestamp(),
      };
      if (email) {
        userPayload.email = email;
      }
      if (phoneNumber) {
        userPayload.phone = phoneNumber;
      }

      writes.push(
        userRef.set(
          userPayload,
          { merge: true }
        )
      );
    } else {
      console.log('User profile already exists, skipping create');
    }

    if (!walletSnap.exists) {
      writes.push(
        walletRef.set(
          {
            uid,
            balance: 0,
            currency: "BIF",
            createdAt: FieldValue.serverTimestamp(),
          },
          { merge: true }
        )
      );
    } else {
      console.log('Wallet already exists, skipping create');
    }

    if (writes.length) {
      await Promise.all(writes);
      console.log('User initialization completed');
    } else {
      console.log('No initialization needed');
    }
  } catch (error) {
    console.error('Error creating user/wallet:', error.message);
  }
});

exports.registerMember = members.registerMember;
exports.approveMember = members.approveMember;
exports.rejectMember = members.rejectMember;
exports.createGroup = members.createGroup;
exports.approveGroup = members.approveGroup;
exports.joinGroup = members.joinGroup;
exports.approveJoinRequest = members.approveJoinRequest;
exports.resetPIN = members.resetPIN;
exports.getPendingApprovals = members.getPendingApprovals;

exports.recordDeposit = savings.recordDeposit;
exports.recordWithdrawal = savings.recordWithdrawal;
exports.submitBatch = savings.submitBatch;
exports.confirmBatch = savings.confirmBatch;
exports.flagBatch = savings.flagBatch;
exports.getBatchesForGroup = savings.getBatchesForGroup;

exports.requestLoan = loans.requestLoan;
exports.disburseLoan = loans.disburseLoan;
exports.recordRepayment = loans.recordRepayment;
exports.markLoanDefaulted = loans.markLoanDefaulted;
exports.getMemberLoans = loans.getMemberLoans;
exports.getLoansByGroup = loans.getLoansByGroup;

// Scheduled functions
exports.deleteExpiredNotifications = scheduledFunctions.deleteExpiredNotifications;

const agents = require("./src/agents");
exports.provisionAgent    = agents.provisionAgent;
exports.assignAgentToGroup = agents.assignAgentToGroup;
