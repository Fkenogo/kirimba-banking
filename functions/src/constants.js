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

module.exports = {
  ROLES,
  USER_STATUS,
  GROUP_STATUS,
  JOIN_REQUEST_STATUS,
};
