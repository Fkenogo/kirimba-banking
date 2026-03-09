"use strict";

const ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
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
  PENDING_CONFIRMATION: "pending_confirmation",
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

const SETTLEMENT_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  PAID: "paid",
  REJECTED: "rejected",
};

const LEDGER_TYPE = {
  FEE: "fee",
  COMMISSION: "commission",
};

const LEDGER_STATUS = {
  ACCRUED: "accrued",
  SETTLED: "settled",
  REVERSED: "reversed",
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
  LEDGER_TYPE,
  LEDGER_STATUS,
  SETTLEMENT_STATUS,
};
