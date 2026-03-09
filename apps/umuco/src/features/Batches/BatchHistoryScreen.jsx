import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { collection, getDocs } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

function formatAmount(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BatchHistoryScreen() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadHistory() {
    setLoading(true);
    setError("");
    try {
      const groupsSnap = await getDocs(collection(db, "groups"));
      const groups = groupsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const groupNameById = groups.reduce((acc, group) => {
        acc[group.id] = group.name || group.id;
        return acc;
      }, {});

      const getBatchesForGroup = httpsCallable(functions, "getBatchesForGroup");
      const perGroup = await Promise.all(
        groups.map(async (group) => {
          const res = await getBatchesForGroup({ groupId: group.id });
          return Array.isArray(res.data?.batches) ? res.data.batches : [];
        })
      );

      const rows = perGroup
        .flat()
        .filter((batch) => batch.status === "confirmed" || batch.status === "flagged")
        .map((batch) => ({
          ...batch,
          groupName: groupNameById[batch.groupId] || batch.groupId || "Unknown Group",
        }))
        .sort((a, b) => {
          const aMs =
            a.confirmedAt?.toMillis?.() ||
            a.flaggedAt?.toMillis?.() ||
            a.updatedAt?.toMillis?.() ||
            a.submittedAt?.toMillis?.() ||
            0;
          const bMs =
            b.confirmedAt?.toMillis?.() ||
            b.flaggedAt?.toMillis?.() ||
            b.updatedAt?.toMillis?.() ||
            b.submittedAt?.toMillis?.() ||
            0;
          return bMs - aMs;
        });

      setBatches(rows);
    } catch (err) {
      setError(err.message || "Failed to load batch history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadHistory();
  }, []);

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
                {batches.length} confirmed/flagged batch{batches.length !== 1 ? "es" : ""}
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Link
              to="/umuco/batches"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50"
            >
              Pending Batches
            </Link>
            <button
              type="button"
              onClick={loadHistory}
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

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-400">Loading history…</div>
          ) : batches.length === 0 ? (
            <div className="px-5 py-12 text-sm text-slate-500">No confirmed or flagged batches yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">Group</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3 text-center">Members</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Decision Time</th>
                    <th className="px-5 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((batch) => {
                    const decisionTs =
                      batch.confirmedAt || batch.flaggedAt || batch.updatedAt || batch.submittedAt || null;
                    return (
                      <tr key={batch.id}>
                        <td className="px-5 py-3 text-slate-800">
                          <div className="font-medium">{batch.groupName}</div>
                          <div className="text-xs text-slate-400">{batch.id}</div>
                        </td>
                        <td className="px-5 py-3 text-right font-medium text-slate-900">{formatAmount(batch.totalAmount)}</td>
                        <td className="px-5 py-3 text-center text-slate-700">{Number(batch.memberCount || 0)}</td>
                        <td className="px-5 py-3 capitalize">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                              batch.status === "confirmed"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {batch.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{formatDate(decisionTs)}</td>
                        <td className="px-5 py-3 text-slate-600">{batch.umucoNotes || "—"}</td>
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
