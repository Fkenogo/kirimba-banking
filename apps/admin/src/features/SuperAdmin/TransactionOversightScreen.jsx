import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";
import { db } from "../../services/firebase";

const STATUS_OPTIONS = ["", "pending_confirmation", "confirmed", "rejected"];
const TYPE_OPTIONS = ["", "deposit", "withdrawal", "loan_disburse", "loan_repay"];

function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

const TYPE_COLORS = {
  deposit: "bg-green-100 text-green-700",
  withdrawal: "bg-amber-100 text-amber-700",
  loan_disburse: "bg-blue-100 text-blue-700",
  loan_repay: "bg-teal-100 text-teal-700",
};
const STATUS_COLORS = {
  confirmed: "bg-green-100 text-green-700",
  pending_confirmation: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

export default function TransactionOversightScreen() {
  const navigate = useNavigate();
  const [txns, setTxns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterGroupId, setFilterGroupId] = useState("");
  const [filterUserId, setFilterUserId] = useState("");
  const [limitVal] = useState(50);
  const [searched, setSearched] = useState(false);

  async function handleSearch(e) {
    e?.preventDefault();
    setLoading(true);
    setError("");
    setSearched(true);
    try {
      const constraints = [orderBy("createdAt", "desc"), limit(limitVal)];
      if (filterStatus) constraints.unshift(where("status", "==", filterStatus));
      if (filterType) constraints.unshift(where("type", "==", filterType));
      if (filterGroupId.trim()) constraints.unshift(where("groupId", "==", filterGroupId.trim()));
      if (filterUserId.trim()) constraints.unshift(where("userId", "==", filterUserId.trim()));

      const q = query(collection(db, "transactions"), ...constraints);
      const snap = await getDocs(q);
      setTxns(snap.docs.map((d) => ({ txnId: d.id, ...d.data() })));
    } catch (err) {
      setError(err.message || "Query failed. You may need to adjust filters (avoid combining too many field filters).");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-6xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Transaction Oversight</h1>
            <p className="text-xs text-slate-400 mt-0.5">Browse and filter all transactions across the system</p>
          </div>
        </div>

        {/* Filter bar */}
        <form onSubmit={handleSearch}
          className="rounded-xl border border-slate-200 bg-white px-4 py-3 flex flex-wrap items-end gap-3">
          <FilterSelect label="Status" value={filterStatus} onChange={setFilterStatus} options={STATUS_OPTIONS} />
          <FilterSelect label="Type" value={filterType} onChange={setFilterType} options={TYPE_OPTIONS} />
          <FilterInput label="Group ID" value={filterGroupId} onChange={setFilterGroupId} placeholder="exact group ID" />
          <FilterInput label="User ID" value={filterUserId} onChange={setFilterUserId} placeholder="exact user UID" />
          <button type="submit" disabled={loading}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60 self-end">
            {loading ? "Searching…" : "Search"}
          </button>
        </form>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}

        {!searched ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">Apply filters and click Search to load transactions.</p>
          </div>
        ) : loading ? (
          <div className="space-y-2">{[...Array(6)].map((_, i) => <div key={i} className="h-12 rounded-xl border border-slate-200 bg-white animate-pulse" />)}</div>
        ) : txns.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No transactions found for the selected filters.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-slate-100 px-4 py-2 text-xs text-slate-400">
              Showing {txns.length} transactions (latest first, max {limitVal})
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap">Date</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Receipt</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">User</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Group</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {txns.map((t) => (
                    <tr key={t.txnId} className="hover:bg-slate-50">
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtTs(t.createdAt)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TYPE_COLORS[t.type] || "bg-slate-100 text-slate-600"}`}>
                          {t.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">{fmt(t.amount)} BIF</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_COLORS[t.status] || "bg-slate-100 text-slate-600"}`}>
                          {t.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-600">{t.receiptNo || "—"}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">{t.userId?.slice(0, 8)}…</td>
                      <td className="px-4 py-3 text-xs text-slate-500 font-mono">{t.groupId?.slice(0, 8)}…</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function FilterSelect({ label, value, onChange, options }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 bg-white min-w-[130px]">
        {options.map((o) => <option key={o} value={o}>{o || `All ${label.toLowerCase()}s`}</option>)}
      </select>
    </div>
  );
}

function FilterInput({ label, value, onChange, placeholder }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-slate-600">{label}</label>
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 min-w-[160px] focus:outline-none focus:ring-2 focus:ring-indigo-500" />
    </div>
  );
}
