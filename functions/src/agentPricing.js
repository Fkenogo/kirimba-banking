"use strict";

const DEFAULT_AGENT_TRANSACTION_FEE_BIF = 700;
const DEFAULT_AGENT_COMMISSION_SHARE_PCT = 0.7;
const DEFAULT_KIRIMBA_RETAINED_SHARE_PCT = 0.3;
const DEFAULT_SETTLEMENT_CYCLE_DAYS = 30;
const DEFAULT_LOAN_FEE_REVENUE_OWNER = "kirimba";

function roundMoney(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.round(parsed));
}

function roundPositiveMoney(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function normalizeShare(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
    return fallback;
  }
  return parsed;
}

function normalizePositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.round(parsed);
}

function normalizeAgentFeeConfig(input = {}) {
  const raw = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const depositFeeFlat = roundPositiveMoney(raw.depositFeeFlat, DEFAULT_AGENT_TRANSACTION_FEE_BIF);
  const withdrawFeeFlat = roundPositiveMoney(raw.withdrawFeeFlat, DEFAULT_AGENT_TRANSACTION_FEE_BIF);

  const derivedDepositShare = depositFeeFlat > 0
    ? Number(raw.agentCommissionDepositFlat) / depositFeeFlat
    : null;
  const derivedWithdrawShare = withdrawFeeFlat > 0
    ? Number(raw.agentCommissionWithdrawFlat) / withdrawFeeFlat
    : null;

  const agentCommissionSharePct = normalizeShare(
    raw.agentCommissionSharePct ?? raw.agentCommissionShareRate ?? derivedDepositShare ?? derivedWithdrawShare,
    DEFAULT_AGENT_COMMISSION_SHARE_PCT
  );
  const kirimbaRetainedSharePct = normalizeShare(
    raw.kirimbaRetainedSharePct ?? raw.kirimbaRetainedShareRate,
    Math.max(0, 1 - agentCommissionSharePct)
  );

  const normalizedAgentShare = agentCommissionSharePct;
  const normalizedKirimbaShare = kirimbaRetainedSharePct;
  const agentCommissionDepositFlat = roundMoney(
    raw.agentCommissionDepositFlat,
    Math.round(depositFeeFlat * normalizedAgentShare)
  );
  const agentCommissionWithdrawFlat = roundMoney(
    raw.agentCommissionWithdrawFlat,
    Math.round(withdrawFeeFlat * normalizedAgentShare)
  );

  return {
    depositFeeFlat,
    withdrawFeeFlat,
    agentCommissionSharePct: normalizedAgentShare,
    kirimbaRetainedSharePct: normalizedKirimbaShare,
    agentCommissionDepositFlat,
    agentCommissionWithdrawFlat,
    kirimbaRetainedDepositFlat: Math.max(0, depositFeeFlat - agentCommissionDepositFlat),
    kirimbaRetainedWithdrawFlat: Math.max(0, withdrawFeeFlat - agentCommissionWithdrawFlat),
  };
}

function normalizeCommissionPolicyConfig(input = {}, feesConfig = null) {
  const normalizedFees = feesConfig || normalizeAgentFeeConfig({});
  return {
    agentTransactionCommissionSharePct: normalizedFees.agentCommissionSharePct,
    kirimbaTransactionRetainedSharePct: normalizedFees.kirimbaRetainedSharePct,
    loanFeeRevenueOwner: DEFAULT_LOAN_FEE_REVENUE_OWNER,
    settlementCycleDays: normalizePositiveInt(
      input?.settlementCycleDays,
      DEFAULT_SETTLEMENT_CYCLE_DAYS
    ),
  };
}

module.exports = {
  DEFAULT_AGENT_TRANSACTION_FEE_BIF,
  DEFAULT_AGENT_COMMISSION_SHARE_PCT,
  DEFAULT_KIRIMBA_RETAINED_SHARE_PCT,
  DEFAULT_SETTLEMENT_CYCLE_DAYS,
  DEFAULT_LOAN_FEE_REVENUE_OWNER,
  normalizeAgentFeeConfig,
  normalizeCommissionPolicyConfig,
};
