import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function formatAmount(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

function formatDate(value) {
  if (!value) return "—";
  const date = value._seconds ? new Date(value._seconds * 1000) : value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LoanDetailScreen() {
  const navigate = useNavigate();
  const { loanId } = useParams();

  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [loan, setLoan] = useState(null);
  const [member, setMember] = useState(null);
  const [group, setGroup] = useState(null);
  const [repaymentHistory, setRepaymentHistory] = useState([]);
  const [collateralExposure, setCollateralExposure] = useState(null);

  const [repaymentAmount, setRepaymentAmount] = useState("");

  async function load() {
    if (!loanId) return;
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const getLoanDetails = httpsCallable(functions, "getLoanDetails");
      const res = await getLoanDetails({ loanId });
      const data = res.data || {};
      setLoan(data.loan || null);
      setMember(data.member || null);
      setGroup(data.group || null);
      setRepaymentHistory(Array.isArray(data.repaymentHistory) ? data.repaymentHistory : []);
      setCollateralExposure(data.collateralExposure || null);
    } catch (err) {
      setError(err.message || "Failed to load loan details.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [loanId]);

  const canDisburse = loan?.status === "pending";
  const canRepay = loan?.status === "active";
  const canDefault = loan?.status === "active" || loan?.status === "pending";
  const approvalModeLabel = loan?.approvalMode === "auto_policy" ? "Auto-approved by policy" : loan?.approvalStatus || "Not required";

  const exposureText = useMemo(() => {
    if (!collateralExposure) return "—";
    const ratio = collateralExposure.exposureRatio;
    if (ratio === null || ratio === undefined) return "—";
    return `${(ratio * 100).toFixed(1)}%`;
  }, [collateralExposure]);

  async function runAction(actionName, payload = {}) {
    if (!loanId) return;
    setWorking(true);
    setError("");
    setSuccess("");

    try {
      const fn = httpsCallable(functions, actionName);
      await fn({ loanId, ...payload });
      setSuccess("Action completed successfully.");
      await load();
    } catch (err) {
      setError(err.message || "Action failed.");
    } finally {
      setWorking(false);
    }
  }

  function handleRepaymentAmountChange(raw) {
    const clean = String(raw || "").replace(/[^0-9]/g, "");
    setRepaymentAmount(clean);
  }

  async function handleMarkRepayment() {
    const amount = Number(repaymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid repayment amount.");
      return;
    }
    await runAction("adminMarkRepayment", { amount });
    setRepaymentAmount("");
  }

  return (
    <main className="px-8 py-7 bg-brand-50">
      <div className="mx-auto max-w-5xl space-y-4">
        <div>
          <button
            type="button"
            onClick={() => navigate("/admin/loans")}
            className="mb-1 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
          >
            ← Back to Loan Console
          </button>
          <h1 className="text-xl font-semibold text-slate-900">Loan Detail</h1>
          <p className="text-xs text-slate-400 mt-0.5 font-mono">{loanId}</p>
        </div>

        {error && (
          <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </section>
        )}

        {success && (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-700">{success}</p>
          </section>
        )}

        {loading ? (
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-sm text-slate-500">
            Loading loan details…
          </section>
        ) : !loan ? (
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-12 text-sm text-slate-500">
            Loan not found.
          </section>
        ) : (
          <>
            <section className="rounded-2xl border border-brand-100 bg-white shadow-card px-5 py-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Loan Snapshot</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Row label="Member" value={member?.fullName || member?.name || loan.userId || "—"} />
                <Row label="Member Phone" value={member?.phone || "—"} />
                <Row label="Group" value={group?.name || loan.groupId || "—"} />
                <Row label="Group ID" value={loan.groupId || "—"} />
                <Row label="Loan Amount" value={formatAmount(loan.amount)} />
                <Row label="Contracted Fee" value={formatAmount(loan.contractedFeeAmount ?? loan.interestAmount)} />
                <Row label="Contracted Fee %" value={`${Number((loan.contractedFeePct ?? loan.interestRate ?? 0) * 100).toFixed(2)}%`} />
                <Row label="Term" value={`${loan.termDays || "—"} days`} />
                <Row label="Fee Collected" value={formatAmount(loan.feeCollectedAmount)} />
                <Row label="Group Incentive Accrued" value={formatAmount(loan.groupIncentiveAccruedAmount)} />
                <Row label="Remaining Due" value={formatAmount(loan.remainingDue)} />
                <Row label="Status" value={String(loan.status || "—").replace(/_/g, " ")} />
                <Row label="Decision Mode" value={approvalModeLabel} />
                <Row label="Created" value={formatDate(loan.createdAt)} />
                <Row label="Disbursed" value={formatDate(loan.disbursedAt)} />
                <Row label="Due Date" value={formatDate(loan.dueDate)} />
                <Row label="Repaid At" value={formatDate(loan.repaidAt)} />
              </div>
            </section>

            <section className="rounded-2xl border border-brand-100 bg-white shadow-card px-5 py-4 space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Collateral Exposure</h2>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <Row label="Group Total Savings" value={formatAmount(collateralExposure?.groupTotalSavings)} />
                <Row label="Group Loans Outstanding" value={formatAmount(collateralExposure?.groupTotalLoansOutstanding)} />
                <Row label="Exposure Ratio" value={exposureText} />
                <Row label="Max Allowed" value={`${Number((collateralExposure?.maxExposureRatio || 0) * 100).toFixed(0)}%`} />
              </div>
            </section>

            <section className="rounded-2xl border border-brand-100 bg-white shadow-card p-5 space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Admin Actions</h2>
              <p className="text-sm text-slate-500">Eligible loans are created as auto-approved by policy. Disbursement and repayment remain operational actions.</p>

              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                <button
                  type="button"
                  onClick={() => runAction("adminDisburseLoan")}
                  disabled={!canDisburse || working}
                  className="rounded-md bg-blue-700 px-3 py-2 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-60"
                >
                  Disburse Loan
                </button>
                <button
                  type="button"
                  onClick={() => runAction("adminMarkLoanDefault")}
                  disabled={!canDefault || working}
                  className="rounded-md bg-rose-700 px-3 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-60"
                >
                  Mark Default
                </button>
              </div>

              <div className="rounded-lg border border-slate-200 p-4">
                <p className="text-sm font-medium text-slate-900">Mark Repayment</p>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="text"
                    value={repaymentAmount}
                    onChange={(e) => handleRepaymentAmountChange(e.target.value)}
                    inputMode="numeric"
                    placeholder="Repayment amount"
                    className="w-full sm:w-56 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={handleMarkRepayment}
                    disabled={!canRepay || working}
                    className="rounded-md bg-brand-500 px-3 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
                  >
                    Mark Repayment
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-brand-100 bg-white shadow-card overflow-hidden">
              <div className="px-5 py-4 border-b border-brand-100">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Repayment History</h2>
              </div>

              {repaymentHistory.length === 0 ? (
                <div className="px-5 py-10 text-sm text-slate-500">No repayments recorded yet.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700">
                        <th className="px-5 py-3">Date</th>
                        <th className="px-5 py-3 text-right">Amount</th>
                        <th className="px-5 py-3">Recorded By</th>
                        <th className="px-5 py-3">Channel</th>
                        <th className="px-5 py-3">Receipt</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-50">
                      {repaymentHistory.map((item) => (
                        <tr key={item.id}>
                          <td className="px-5 py-3 text-slate-700">{formatDate(item.createdAt)}</td>
                          <td className="px-5 py-3 text-right font-medium text-slate-900">{formatAmount(item.amount)}</td>
                          <td className="px-5 py-3 text-slate-700">{item.recordedBy || "—"}</td>
                          <td className="px-5 py-3 text-slate-700">{item.channel || "—"}</td>
                          <td className="px-5 py-3 font-mono text-xs text-slate-700">{item.receiptNo || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value || "—"}</span>
    </div>
  );
}
