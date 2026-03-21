import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}
function fmtBIF(n) {
  return `${fmt(n)} BIF`;
}

export default function ExecutiveDashboardScreen() {
  const navigate = useNavigate();
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getExecutiveSummary");
      const res = await fn({});
      setSummary(res.data?.summary || null);
    } catch (err) {
      setError(err.message || "Failed to load executive summary.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const s = summary || {};
  const fund = s.fund || {};

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-6">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Executive Overview</h1>
            <p className="text-xs text-slate-400 mt-0.5">System-wide business health snapshot</p>
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-20 rounded-xl border border-slate-200 bg-white animate-pulse" />
            ))}
          </div>
        ) : summary ? (
          <>
            {/* Member & group counts */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Membership</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                <Metric label="Active Members" value={fmt(s.activeMemberCount)} tone="blue" />
                <Metric label="Active Groups" value={fmt(s.activeGroupCount)} tone="green" />
                <Metric label="Active Agents" value={fmt(s.activeAgentCount)} tone="slate" />
                <Metric label="Institutions" value={fmt(s.activeInstitutionCount)} tone="slate" />
                <Metric
                  label="Pending Approvals"
                  value={fmt(s.pendingApprovals)}
                  tone={s.pendingApprovals > 0 ? "amber" : "slate"}
                  onClick={() => navigate("/admin/approvals")}
                  hint="Click to review"
                />
              </div>
            </section>

            {/* Fund health */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Fund Health</h2>
              {fund.lendingPaused && (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 flex items-center gap-2">
                  <span className="text-amber-600 font-bold">⚠</span>
                  <p className="text-xs font-semibold text-amber-800">Lending is currently PAUSED</p>
                  <button type="button" onClick={() => navigate("/admin/super/fund")}
                    className="ml-auto text-xs text-amber-700 underline">Manage →</button>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <FundCard label="Total Collateral" value={fmtBIF(fund.totalCollateral)} tone="slate" />
                <FundCard label="Available Fund" value={fmtBIF(fund.availableFund)} tone="green" />
                <FundCard label="Deployed Fund" value={fmtBIF(fund.deployedFund)} tone="blue" />
              </div>
            </section>

            {/* Loan & exception */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Loan & Exceptions</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Metric label="Active Loans" value={fmt(s.activeLoansCount)} tone="blue" onClick={() => navigate("/admin/loans")} hint="View loans" />
                <Metric label="Defaulted Loans" value={fmt(s.defaultedLoansCount)} tone={s.defaultedLoansCount > 0 ? "red" : "slate"} onClick={() => navigate("/admin/loans")} />
                <Metric
                  label="Flagged Batches"
                  value={fmt(s.flaggedBatchCount)}
                  tone={s.flaggedBatchCount > 0 ? "amber" : "slate"}
                  onClick={() => navigate("/admin/super/exceptions")}
                  hint="View exceptions"
                />
                <Metric label="Submitted Batches" value={fmt(s.submittedBatchCount)} tone="slate" onClick={() => navigate("/admin/deposits/pending")} hint="View deposits" />
              </div>
            </section>

            {/* Quick links */}
            <section className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {[
                { label: "Transaction Oversight", path: "/admin/super/transactions" },
                { label: "All Groups", path: "/admin/super/groups" },
                { label: "Loan Portfolio", path: "/admin/super/loans" },
                { label: "Risk & Exceptions", path: "/admin/super/exceptions" },
              ].map((link) => (
                <button key={link.path} type="button" onClick={() => navigate(link.path)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 hover:border-slate-400 hover:bg-slate-50 transition-all text-left">
                  {link.label} →
                </button>
              ))}
            </section>
          </>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No summary data available.</p>
          </div>
        )}
      </div>
    </main>
  );
}

function Metric({ label, value, tone, onClick, hint }) {
  const toneClass = {
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    green: "border-green-200 bg-green-50 text-green-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    slate: "border-slate-200 bg-white text-slate-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={`rounded-xl border px-4 py-3 ${toneClass} ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity text-left w-full" : ""}`}>
      <p className="text-xs font-medium opacity-60 uppercase tracking-wide">{label}</p>
      <p className="text-2xl font-bold mt-1 leading-tight">{value}</p>
      {hint && <p className="text-xs opacity-50 mt-0.5">{hint}</p>}
    </Tag>
  );
}

function FundCard({ label, value, tone }) {
  const toneClass = {
    slate: "border-slate-200 bg-slate-800 text-white",
    green: "border-green-200 bg-green-50 text-green-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-xl border px-5 py-4 ${toneClass}`}>
      <p className="text-xs font-medium opacity-60 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold mt-1 leading-tight">{value}</p>
    </div>
  );
}
