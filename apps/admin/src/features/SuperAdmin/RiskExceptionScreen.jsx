import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const TABS = ["flaggedBatches", "defaultedLoans", "suspendedUsers", "suspendedGroups"];
const TAB_LABELS = {
  flaggedBatches: "Flagged Batches",
  defaultedLoans: "Defaulted Loans",
  suspendedUsers: "Suspended Users",
  suspendedGroups: "Suspended Groups",
};
const TAB_TONES = {
  flaggedBatches: "amber",
  defaultedLoans: "red",
  suspendedUsers: "red",
  suspendedGroups: "red",
};

export default function RiskExceptionScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("flaggedBatches");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getExceptions");
      const res = await fn({});
      setData(res.data || {});
    } catch (err) {
      setError(err.message || "Failed to load exceptions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const items = data?.[tab] || [];

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Risk & Exceptions</h1>
            <p className="text-xs text-slate-400 mt-0.5">Flagged batches, defaulted loans, suspended accounts</p>
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
            Refresh
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}

        {/* Summary chips */}
        {data && !loading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {TABS.map((t) => {
              const count = data[t]?.length || 0;
              const tone = TAB_TONES[t];
              const cls = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900"
                : "border-red-200 bg-red-50 text-red-900";
              return (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`rounded-xl border px-4 py-3 text-left transition-all ${cls} ${tab === t ? "ring-2 ring-offset-1 ring-slate-400" : "opacity-80 hover:opacity-100"}`}>
                  <p className="text-2xl font-bold">{count}</p>
                  <p className="text-xs font-medium opacity-70 mt-0.5">{TAB_LABELS[t]}</p>
                </button>
              );
            })}
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-14 rounded-xl border border-slate-200 bg-white animate-pulse" />)}</div>
        ) : items.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No {TAB_LABELS[tab].toLowerCase()} found.</p>
          </div>
        ) : tab === "flaggedBatches" ? (
          <FlaggedBatchTable items={items} onView={(id) => navigate(`/admin/deposits/pending`)} />
        ) : tab === "defaultedLoans" ? (
          <DefaultedLoanTable items={items} onView={(id) => navigate(`/admin/loans/${id}`)} />
        ) : tab === "suspendedUsers" ? (
          <SuspendedUserTable items={items} />
        ) : (
          <SuspendedGroupTable items={items} />
        )}
      </div>
    </main>
  );
}

function FlaggedBatchTable({ items, onView }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Batch ID</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Flagged</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((b) => (
            <tr key={b.batchId} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs text-slate-700">{b.batchId?.slice(0, 12)}…</td>
              <td className="px-4 py-3 text-right text-slate-700">{fmt(b.totalAmount)} BIF</td>
              <td className="px-4 py-3 text-xs text-slate-500">{fmtTs(b.flaggedAt)}</td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{b.institutionNotes || b.umucoNotes || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DefaultedLoanTable({ items, onView }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Loan ID</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Total Due</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Defaulted</th>
            <th className="px-4 py-3 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((l) => (
            <tr key={l.loanId} className="hover:bg-slate-50">
              <td className="px-4 py-3 font-mono text-xs text-slate-700">{l.loanId?.slice(0, 12)}…</td>
              <td className="px-4 py-3 text-right text-slate-700">{fmt(l.amount)} BIF</td>
              <td className="px-4 py-3 text-right text-red-700 font-medium">{fmt(l.remainingDue)} BIF</td>
              <td className="px-4 py-3 text-xs text-slate-500">{fmtTs(l.defaultedAt)}</td>
              <td className="px-4 py-3 text-right">
                <button type="button" onClick={() => onView(l.loanId)}
                  className="text-xs text-indigo-600 hover:text-indigo-700">View →</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuspendedUserTable({ items }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((u) => (
            <tr key={u.userId} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-900">{u.fullName || "—"}</p>
                <p className="text-xs text-slate-400">{u.phone || u.userId?.slice(0, 10)}</p>
              </td>
              <td className="px-4 py-3 text-xs text-slate-600">{u.role || "member"}</td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{u.suspendReason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SuspendedGroupTable({ items }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Group</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Code</th>
            <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Members</th>
            <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {items.map((g) => (
            <tr key={g.groupId} className="hover:bg-slate-50">
              <td className="px-4 py-3">
                <p className="font-medium text-slate-900">{g.name}</p>
                <p className="text-xs text-slate-400">{g.groupId?.slice(0, 10)}…</p>
              </td>
              <td className="px-4 py-3 font-mono text-xs text-slate-600">{g.groupCode || "—"}</td>
              <td className="px-4 py-3 text-right text-slate-700">{fmt(g.memberCount)}</td>
              <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate">{g.suspendReason || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
