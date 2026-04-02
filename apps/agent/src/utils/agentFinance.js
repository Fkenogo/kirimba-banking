import { Timestamp } from "firebase/firestore";

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function startOfDate(dateStr) {
  return Timestamp.fromDate(new Date(`${dateStr}T00:00:00`));
}

export function endOfDateExclusive(dateStr) {
  return Timestamp.fromDate(new Date(new Date(`${dateStr}T00:00:00`).getTime() + 86_400_000));
}

export function dayBoundsMs(dateStr) {
  const startMs = new Date(`${dateStr}T00:00:00`).getTime();
  return { startMs, endMs: startMs + 86_400_000 };
}

export function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value?._seconds) return value._seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

export function buildAgentDailyFinanceSummary({ transactions = [], ledgerEntries = [], dateStr }) {
  const { startMs, endMs } = dayBoundsMs(dateStr);
  const dayTransactions = transactions.filter((entry) => {
    const createdAtMs = toMillis(entry.createdAt);
    return createdAtMs >= startMs && createdAtMs < endMs;
  });
  const dayLedgerEntries = ledgerEntries.filter((entry) => {
    const createdAtMs = toMillis(entry.createdAt);
    return createdAtMs >= startMs && createdAtMs < endMs;
  });

  const deposits = dayTransactions.filter(
    (entry) =>
      entry.type === "deposit" &&
      (entry.status === "pending_confirmation" || entry.status === "confirmed")
  );
  const withdrawals = dayTransactions.filter(
    (entry) => entry.type === "withdrawal" && entry.status === "confirmed"
  );
  const feeEntries = dayLedgerEntries.filter((entry) => entry.type === "fee");
  const commissionEntries = dayLedgerEntries.filter((entry) => entry.type === "commission");

  const totalDeposits = deposits.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const totalWithdrawals = withdrawals.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const customerFeesCollected = feeEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const agentCommissionEarned = commissionEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
  const kirimbaRetainedFees = Math.max(0, customerFeesCollected - agentCommissionEarned);
  const expectedCashOnHand = totalDeposits - totalWithdrawals;
  const remittanceDue = expectedCashOnHand;

  return {
    deposits,
    withdrawals,
    feeEntries,
    commissionEntries,
    totalDeposits,
    totalWithdrawals,
    customerFeesCollected,
    agentCommissionEarned,
    kirimbaRetainedFees,
    expectedCashOnHand,
    remittanceDue,
  };
}

export function buildSettlementPayableSummary({ ledgerEntries = [], settlements = [], periodStart, periodEnd }) {
  const { startMs } = dayBoundsMs(periodStart);
  const { endMs } = dayBoundsMs(periodEnd);
  const eligibleEntries = ledgerEntries.filter((entry) => {
    const createdAtMs = toMillis(entry.createdAt);
    return (
      entry.type === "commission" &&
      createdAtMs >= startMs &&
      createdAtMs < endMs &&
      !entry.settlementId &&
      !entry.settledAt
    );
  });
  const openSettlements = settlements.filter(
    (entry) => entry.status === "requested" || entry.status === "approved"
  );

  return {
    eligibleEntries,
    payableAmount: eligibleEntries.reduce((sum, entry) => sum + Number(entry.amount || 0), 0),
    openSettlements,
  };
}

function activityTypeMeta(type) {
  switch (type) {
    case "deposit":
      return { label: "Deposit", tone: "brand" };
    case "withdrawal":
      return { label: "Withdrawal", tone: "blue" };
    case "loan_repay":
      return { label: "Loan Repayment", tone: "gold" };
    case "loan_disburse":
      return { label: "Loan Disbursement", tone: "slate" };
    default:
      return { label: "Activity", tone: "slate" };
  }
}

export function buildAgentActivityFeed({ transactions = [], batches = [], dateStr }) {
  const { startMs, endMs } = dayBoundsMs(dateStr);

  const activityTransactions = transactions
    .filter((entry) => {
      const createdAtMs = toMillis(entry.createdAt);
      return (
        createdAtMs >= startMs &&
        createdAtMs < endMs &&
        ["deposit", "withdrawal", "loan_repay", "loan_disburse"].includes(entry.type)
      );
    })
    .map((entry) => {
      const meta = activityTypeMeta(entry.type);
      return {
        id: `txn_${entry.id}`,
        kind: "transaction",
        label: meta.label,
        tone: meta.tone,
        amount: Number(entry.amount || 0),
        createdAt: entry.createdAt,
        memberName: entry.memberName || entry.memberId || entry.userId || "Member transaction",
        reference: entry.memberId || entry.userId || entry.id,
        status: entry.status || null,
      };
    });

  const activityBatches = batches
    .filter((entry) => {
      const activityMs = toMillis(entry.submittedAt) || toMillis(entry.createdAt);
      return activityMs >= startMs && activityMs < endMs;
    })
    .map((entry) => ({
      id: `batch_${entry.id}`,
      kind: "batch",
      label: "Batch Submission",
      tone: entry.status === "flagged" ? "red" : entry.status === "confirmed" ? "brand" : "blue",
      amount: Number(entry.totalAmount || 0),
      createdAt: entry.submittedAt || entry.createdAt,
      memberName: `${Number(entry.memberCount || 0)} member${Number(entry.memberCount || 0) === 1 ? "" : "s"}`,
      reference: entry.id,
      status: entry.status || null,
    }));

  return [...activityTransactions, ...activityBatches].sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
}
