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
            userId: uid,
            balanceConfirmed: 0,
            balancePending: 0,
            balanceLocked: 0,
            availableBalance: 0,
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
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
exports.rejectJoinRequest = members.rejectJoinRequest;
exports.resetPIN = members.resetPIN;
exports.getPendingApprovals = members.getPendingApprovals;
exports.joinGroupByInviteCode = members.joinGroupByInviteCode;
exports.setMemberInstitution = members.setMemberInstitution;
exports.getActiveInstitutions = members.getActiveInstitutions;
exports.getGroupMembers = members.getGroupMembers;
exports.initiateGroupSplit = members.initiateGroupSplit;
exports.backfillLeaderGroupMembership = members.backfillLeaderGroupMembership;
exports.getGroupDetail = members.getGroupDetail;

exports.recordDeposit = savings.recordDeposit;
exports.recordWithdrawal = savings.recordWithdrawal;
exports.memberRequestWithdrawal = savings.memberRequestWithdrawal;
exports.adminApproveDeposits = savings.adminApproveDeposits;
exports.submitBatch = savings.submitBatch;
exports.confirmBatch = savings.confirmBatch;
exports.flagBatch = savings.flagBatch;
exports.getBatchesForGroup = savings.getBatchesForGroup;
exports.getAgentLedger = savings.getAgentLedger;
exports.getPendingWithdrawalRequests = savings.getPendingWithdrawalRequests;

exports.requestLoan = loans.requestLoan;
exports.disburseLoan = loans.disburseLoan;
exports.recordRepayment = loans.recordRepayment;
exports.markLoanDefaulted = loans.markLoanDefaulted;
exports.getMemberLoans = loans.getMemberLoans;
exports.getLoansByGroup = loans.getLoansByGroup;
exports.getLoansDashboard = loans.getLoansDashboard;
exports.getLoanDetails = loans.getLoanDetails;
exports.approveLoan = loans.approveLoan;
exports.adminDisburseLoan = loans.adminDisburseLoan;
exports.adminMarkRepayment = loans.adminMarkRepayment;
exports.adminMarkLoanDefault = loans.adminMarkLoanDefault;

// Scheduled functions
exports.deleteExpiredNotifications = scheduledFunctions.deleteExpiredNotifications;

const agents = require("./src/agents");
exports.provisionAgent    = agents.provisionAgent;
exports.assignAgentToGroup = agents.assignAgentToGroup;
exports.provisionAdmin = agents.provisionAdmin;
exports.provisionInstitutionUser = agents.provisionInstitutionUser;

const groups = require("./src/groups");
exports.adminSetGroupBorrowPause = groups.adminSetGroupBorrowPause;

const reconciliation = require("./src/reconciliation");
exports.closeAgentDay = reconciliation.closeAgentDay;
exports.adminUpdateReconciliation = reconciliation.adminUpdateReconciliation;
exports.requestSettlement = reconciliation.requestSettlement;
exports.approveSettlement = reconciliation.approveSettlement;
exports.markSettlementPaid = reconciliation.markSettlementPaid;

// Super-admin business oversight
const superAdmin = require("./src/superAdmin");
exports.getSystemConfig = superAdmin.getSystemConfig;
exports.updateSystemConfig = superAdmin.updateSystemConfig;
exports.seedSystemConfig = superAdmin.seedSystemConfig;
exports.suspendUser = superAdmin.suspendUser;
exports.reactivateUser = superAdmin.reactivateUser;
exports.suspendGroup = superAdmin.suspendGroup;
exports.reactivateGroup = superAdmin.reactivateGroup;
exports.getAdmins = superAdmin.getAdmins;
exports.suspendAdmin = superAdmin.suspendAdmin;
exports.reactivateAdmin = superAdmin.reactivateAdmin;
exports.getAuditLog = superAdmin.getAuditLog;
exports.getInstitutions = superAdmin.getInstitutions;
exports.createInstitution = superAdmin.createInstitution;
exports.suspendInstitution = superAdmin.suspendInstitution;
exports.reactivateInstitution = superAdmin.reactivateInstitution;
exports.backfillUmucoInstitution = superAdmin.backfillUmucoInstitution;
exports.migrateInstitutionUserRoles = superAdmin.migrateInstitutionUserRoles;
exports.backfillGroupInstitutionIds = superAdmin.backfillGroupInstitutionIds;
exports.getExecutiveSummary = superAdmin.getExecutiveSummary;
exports.getLoanPortfolioSummary = superAdmin.getLoanPortfolioSummary;
exports.getExceptions = superAdmin.getExceptions;
exports.getKirimbaFundOverview = superAdmin.getKirimbaFundOverview;
exports.seedKirimbaFund = superAdmin.seedKirimbaFund;
exports.topUpKirimbaFund = superAdmin.topUpKirimbaFund;
exports.deductKirimbaFund = superAdmin.deductKirimbaFund;
exports.pauseKirimbaLending = superAdmin.pauseKirimbaLending;
exports.resumeKirimbaLending = superAdmin.resumeKirimbaLending;
exports.getKirimbaFundLedger = superAdmin.getKirimbaFundLedger;
