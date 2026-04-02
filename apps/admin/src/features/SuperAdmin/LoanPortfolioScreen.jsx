import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function formatAmount(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

function pct(num, denom) {
  if (!denom || denom === 0) return "—";
  return `${((num / denom) * 100).toFixed(1)}%`;
}

export default function LoanPortfolioScreen() {
  const navigate = useNavigate();
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const getLoanPortfolioSummary = httpsCallable(functions, "getLoanPortfolioSummary");
      const res = await getLoanPortfolioSummary({});
      setPortfolio(res.data?.portfolio || null);
    } catch (err) {
      setError(err.message || "Failed to load loan portfolio.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const counts = portfolio?.countByStatus || {};
  const termEconomics = portfolio?.termEconomics || [];
  const totalIssued = (counts.active || 0) + (counts.repaid || 0) + (counts.defaulted || 0) + (counts.pending || 0);

  return (
    <main className="px-8 py-7 bg-brand-50">
      <div className="mx-auto max-w-4xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Loan Portfolio</h1>
            <p className="text-xs text-slate-400 mt-0.5">Aggregate view of all lending activity</p>
          </div>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-brand-50 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="rounded-xl border border-slate-200 bg-white h-20 animate-pulse" />
            ))}
          </div>
        ) : portfolio ? (
          <>
            {/* Volume cards */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Portfolio Volume</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <MetricCard label="Total Deployed" value={formatAmount(portfolio.totalDeployed)} tone="blue" />
                <MetricCard label="Total Defaulted" value={formatAmount(portfolio.totalDefaulted)} tone="red" />
                <MetricCard label="Total Repaid" value={formatAmount(portfolio.totalRepaid)} tone="green" />
                <MetricCard label="Pending Disbursement" value={formatAmount(portfolio.pendingDisbursement)} tone="amber" />
              </div>
            </section>

            {/* Count by status */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Loan Counts</h2>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <CountCard label="Pending" value={counts.pending || 0} tone="amber" onClick={() => navigate("/admin/loans")} />
                <CountCard label="Active" value={counts.active || 0} tone="blue" onClick={() => navigate("/admin/loans")} />
                <CountCard label="Overdue" value={portfolio.overdueLoanCount || 0} tone="orange" onClick={() => navigate("/admin/loans")} />
                <CountCard label="Defaulted" value={counts.defaulted || 0} tone="red" onClick={() => navigate("/admin/loans")} />
                <CountCard label="Repaid" value={counts.repaid || 0} tone="green" />
              </div>
            </section>

            <section className="rounded-2xl border border-brand-100 bg-white shadow-card px-6 py-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Term Economics</h2>
                  <p className="text-xs text-slate-400 mt-1">Loan count, collected fee income, and average size by contracted term</p>
                </div>
                <span className="text-xs text-slate-400">{totalIssued} issued loans in view</span>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                {termEconomics.map((entry) => (
                  <div key={entry.termDays} className="rounded-xl border border-slate-200 bg-brand-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-800">{entry.termDays} days</p>
                      <span className="rounded-full bg-brand-500 px-2.5 py-1 text-[11px] font-semibold text-white">
                        {entry.loanCount} loans
                      </span>
                    </div>
                    <dl className="mt-4 space-y-2">
                      <SummaryRow label="Fee Income" value={formatAmount(entry.feeIncomeCollected)} />
                      <SummaryRow label="Average Size" value={formatAmount(entry.averageLoanSize)} />
                    </dl>
                  </div>
                ))}
              </div>
            </section>

            {/* Health ratios */}
            <section className="rounded-2xl border border-brand-100 bg-white shadow-card px-6 py-5">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-4">Portfolio Health</h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                <HealthRow
                  label="Default Rate"
                  value={pct(portfolio.totalDefaulted, portfolio.totalPortfolio)}
                  note="Defaulted / total portfolio"
                  warn={portfolio.totalDefaulted / (portfolio.totalPortfolio || 1) > 0.1}
                />
                <HealthRow
                  label="Overdue Rate"
                  value={pct(portfolio.overdueLoanCount, counts.active || 1)}
                  note="Overdue / active loans"
                  warn={portfolio.overdueLoanCount / ((counts.active || 0) + 1) > 0.15}
                />
                <HealthRow
                  label="Collection Rate"
                  value={pct(portfolio.totalRepaid, (portfolio.totalRepaid || 0) + (portfolio.totalDefaulted || 0))}
                  note="Repaid / (repaid + defaulted)"
                  good
                />
              </div>
            </section>

            {/* Quick link */}
            <div className="text-center">
              <button
                type="button"
                onClick={() => navigate("/admin/loans")}
                className="text-sm text-indigo-600 hover:text-indigo-700 font-medium underline underline-offset-2"
              >
                Open Loan Operations Console →
              </button>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No loan portfolio data available.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value, tone }) {
  const toneClass = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-green-200 bg-green-50 text-green-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs font-medium opacity-60 uppercase tracking-wide">{label}</p>
      <p className="text-base font-bold mt-1 leading-tight">{value}</p>
    </div>
  );
}

function CountCard({ label, value, tone, onClick }) {
  const toneClass = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    red: "border-red-200 bg-red-50 text-red-900",
    green: "border-green-200 bg-green-50 text-green-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    orange: "border-orange-200 bg-orange-50 text-orange-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-center ${toneClass} ${onClick ? "hover:opacity-80 transition-opacity" : ""}`}
    >
      <p className="text-2xl font-bold">{value}</p>
      <p className="text-xs font-medium mt-0.5 opacity-70">{label}</p>
    </Tag>
  );
}

function HealthRow({ label, value, note, warn, good }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-700">{label}</p>
        <p className={`text-sm font-bold ${warn ? "text-red-600" : good ? "text-green-600" : "text-slate-800"}`}>
          {value}
        </p>
      </div>
      <p className="text-xs text-slate-400">{note}</p>
    </div>
  );
}

function SummaryRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold text-slate-800">{value}</dd>
    </div>
  );
}
