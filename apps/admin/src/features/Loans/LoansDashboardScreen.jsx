import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const TABS = [
  { key: "pending", label: "Pending" },
  { key: "active", label: "Active" },
  { key: "overdue", label: "Overdue" },
  { key: "defaulted", label: "Defaulted" },
];

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

function readableStatus(status) {
  return String(status || "unknown").replace(/_/g, " ");
}

export default function LoansDashboardScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState("pending");
  const [summary, setSummary] = useState({
    pendingCount: 0,
    activeCount: 0,
    overdueCount: 0,
    defaultedCount: 0,
    activeOutstandingBIF: 0,
  });
  const [loansByTab, setLoansByTab] = useState({
    pending: [],
    active: [],
    overdue: [],
    defaulted: [],
  });

  async function load() {
    setLoading(true);
    setError("");
    try {
      const getLoansDashboard = httpsCallable(functions, "getLoansDashboard");
      const res = await getLoansDashboard({});
      const data = res.data || {};

      setSummary({
        pendingCount: Number(data.summary?.pendingCount || 0),
        activeCount: Number(data.summary?.activeCount || 0),
        overdueCount: Number(data.summary?.overdueCount || 0),
        defaultedCount: Number(data.summary?.defaultedCount || 0),
        activeOutstandingBIF: Number(data.summary?.activeOutstandingBIF || 0),
      });

      setLoansByTab({
        pending: Array.isArray(data.pendingLoans) ? data.pendingLoans : [],
        active: Array.isArray(data.activeLoans) ? data.activeLoans : [],
        overdue: Array.isArray(data.overdueLoans) ? data.overdueLoans : [],
        defaulted: Array.isArray(data.defaultedLoans) ? data.defaultedLoans : [],
      });
    } catch (err) {
      setError(err.message || "Failed to load loans dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const currentRows = useMemo(() => loansByTab[activeTab] || [], [loansByTab, activeTab]);

  return (
    <main className="px-8 py-7 bg-brand-50">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Loan Operations Console</h1>
            <p className="text-xs text-slate-400 mt-0.5">Manage full loan lifecycle operations</p>
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
          <section className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </section>
        )}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <MetricCard label="Pending" value={summary.pendingCount} tone="amber" />
          <MetricCard label="Active" value={summary.activeCount} tone="blue" />
          <MetricCard label="Overdue" value={summary.overdueCount} tone="rose" />
          <MetricCard label="Defaulted" value={summary.defaultedCount} tone="slate" />
          <MetricCard label="Outstanding" value={formatAmount(summary.activeOutstandingBIF)} tone="blue" />
        </section>

        <section className="rounded-2xl border border-brand-100 bg-white shadow-card overflow-hidden">
          <div className="px-4 pt-4 pb-2 border-b border-brand-100">
            <div className="flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                    activeTab === tab.key
                      ? "border-slate-900 bg-brand-500 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-brand-50"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-500">Loading loans…</div>
          ) : currentRows.length === 0 ? (
            <div className="px-5 py-12 text-sm text-slate-500">No loans in this bucket.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-semibold uppercase tracking-wide text-brand-700">
                    <th className="px-4 py-3">Loan</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Group</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-right">Remaining</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Due</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {currentRows.map((loan) => (
                    <tr key={loan.id}>
                      <td className="px-4 py-3 font-mono text-xs text-blue-700">{loan.id.slice(0, 8)}…</td>
                      <td className="px-4 py-3 text-slate-700">{loan.memberName || loan.userId || "—"}</td>
                      <td className="px-4 py-3 text-slate-700">{loan.groupName || loan.groupId || "—"}</td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">{formatAmount(loan.amount)}</td>
                      <td className="px-4 py-3 text-right text-slate-700">{formatAmount(loan.remainingDue)}</td>
                      <td className="px-4 py-3 capitalize text-slate-700">{readableStatus(loan.status)}</td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(loan.dueDate)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/loans/${loan.id}`}
                          className="rounded-md bg-brand-500 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-brand-700"
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function MetricCard({ label, value, tone }) {
  const toneClass = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    slate: "border-slate-300 bg-slate-100 text-slate-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  return (
    <article className={`rounded-xl border px-4 py-3 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-xl font-semibold">{value}</p>
    </article>
  );
}
