"use strict";

const ROLES = {
  SUPER_ADMIN: "super_admin",
  LEADER: "leader",
  AGENT: "agent",
  MEMBER: "member",
  UMUCO: "umuco",
  FINANCE: "finance",
};

const USER_STATUS = {
  PENDING_APPROVAL: "pending_approval",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REJECTED: "rejected",
};

const GROUP_STATUS = {
  PENDING_APPROVAL: "pending_approval",
  ACTIVE: "active",
  SUSPENDED: "suspended",
};

const JOIN_REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
};

const TRANSACTION_TYPE = {
  DEPOSIT: "deposit",
  WITHDRAWAL: "withdrawal",
  LOAN_DISBURSE: "loan_disburse",
  LOAN_REPAY: "loan_repay",
};

const TRANSACTION_STATUS = {
  PENDING_UMUCO: "pending_umuco",
  CONFIRMED: "confirmed",
  REJECTED: "rejected",
};

const DEPOSIT_BATCH_STATUS = {
  SUBMITTED: "submitted",
  CONFIRMED: "confirmed",
  FLAGGED: "flagged",
};

const LOAN_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  REPAID: "repaid",
  DEFAULTED: "defaulted",
  REJECTED: "rejected",
};

const LOAN_TERMS = {
  DAYS_7: 7,
  DAYS_14: 14,
  DAYS_30: 30,
};

module.exports = {
  ROLES,
  USER_STATUS,
  GROUP_STATUS,
  JOIN_REQUEST_STATUS,
  TRANSACTION_TYPE,
  TRANSACTION_STATUS,
  DEPOSIT_BATCH_STATUS,
  LOAN_STATUS,
  LOAN_TERMS,
};
