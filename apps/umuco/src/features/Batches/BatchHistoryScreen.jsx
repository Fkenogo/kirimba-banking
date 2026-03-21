import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../services/firebase";

function formatAmount(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const STATUS_TABS = [
  { key: "all", label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "flagged", label: "Flagged" },
];

export default function BatchHistoryScreen({ institutionId }) {
  const navigate = useNavigate();
  const [allBatches, setAllBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  async function load() {
    if (!institutionId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(
          collection(db, "depositBatches"),
          where("institutionId", "==", institutionId),
          where("status", "in", ["confirmed", "flagged"]),
          orderBy("submittedAt", "desc")
        )
      );

      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Batch-fetch group + agent names
      const groupIds = [...new Set(rows.map((b) => b.groupId).filter(Boolean))];
      const agentIds = [...new Set(rows.map((b) => b.agentId).filter(Boolean))];

      const [groupSnaps, agentSnaps] = await Promise.all([
        Promise.all(groupIds.map((id) => getDoc(doc(db, "groups", id)))),
        Promise.all(agentIds.map((id) => getDoc(doc(db, "users", id)))),
      ]);

      const groupNames = {};
      groupIds.forEach((id, i) => {
        if (groupSnaps[i].exists()) groupNames[id] = groupSnaps[i].data().name || id;
      });

      const agentNames = {};
      agentIds.forEach((id, i) => {
        if (agentSnaps[i].exists()) {
          const d = agentSnaps[i].data();
          agentNames[id] = d.fullName || d.name || id;
        }
      });

      setAllBatches(
        rows.map((b) => ({
          ...b,
          groupName: groupNames[b.groupId] || b.groupId || "Unknown Group",
          agentName: agentNames[b.agentId] || b.agentId || "—",
        }))
      );
    } catch (err) {
      setError(err.message || "Failed to load batch history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const batches =
    statusFilter === "all"
      ? allBatches
      : allBatches.filter((b) => b.status === statusFilter);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/umuco/home")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Home
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Batch History</h1>
            {!loading && (
              <p className="text-xs text-slate-400 mt-0.5">
                {batches.length} batch{batches.length !== 1 ? "es" : ""}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              to="/umuco/batches"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50"
            >
              Pending
            </Link>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* Status filter */}
        <div className="flex gap-2">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setStatusFilter(tab.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                statusFilter === tab.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}
              {!loading && tab.key !== "all" && (
                <span className="ml-1.5 opacity-70">
                  {allBatches.filter((b) => b.status === tab.key).length}
                </span>
              )}
            </button>
          ))}
        </div>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-400 animate-pulse">Loading history…</div>
          ) : batches.length === 0 ? (
            <div className="px-5 py-12 text-sm text-slate-500">No batches found.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">Group</th>
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-center">Members</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Submitted</th>
                    <th className="px-5 py-3">Decision</th>
                    <th className="px-5 py-3">Notes</th>
                    <th className="px-5 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((b) => {
                    const decisionTs = b.confirmedAt || b.flaggedAt || null;
                    return (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3 text-slate-900 font-medium">{b.groupName}</td>
                        <td className="px-5 py-3 text-slate-600">{b.agentName}</td>
                        <td className="px-5 py-3 text-right font-semibold text-slate-800">
                          {formatAmount(b.totalAmount)}
                        </td>
                        <td className="px-5 py-3 text-center text-slate-700">
                          {Number(b.memberCount || 0)}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${
                              b.status === "confirmed"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-red-100 text-red-700"
                            }`}
                          >
                            {b.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                          {formatDate(b.submittedAt)}
                        </td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                          {formatDate(decisionTs)}
                        </td>
                        <td className="px-5 py-3 text-slate-600 max-w-[200px] truncate">
                          {b.institutionNotes || b.umucoNotes || "—"}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Link
                            to={`/umuco/batch/${b.id}`}
                            className="text-xs text-blue-600 hover:underline"
                          >
                            View
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
