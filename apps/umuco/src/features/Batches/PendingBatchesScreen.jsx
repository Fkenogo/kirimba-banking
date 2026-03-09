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

export default function PendingBatchesScreen() {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadPendingBatches() {
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
          const res = await getBatchesForGroup({ groupId: group.id, status: "submitted" });
          return Array.isArray(res.data?.batches) ? res.data.batches : [];
        })
      );

      const flattened = perGroup
        .flat()
        .map((batch) => ({
          ...batch,
          groupName: groupNameById[batch.groupId] || batch.groupId || "Unknown Group",
        }))
        .sort((a, b) => {
          const aMs = a.submittedAt?.toMillis?.() || 0;
          const bMs = b.submittedAt?.toMillis?.() || 0;
          return bMs - aMs;
        });

      setBatches(flattened);
    } catch (err) {
      setError(err.message || "Failed to load submitted batches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPendingBatches();
  }, []);

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate("/umuco/home")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Home
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Submitted Deposit Batches</h1>
            {!loading && (
              <p className="text-xs text-slate-400 mt-0.5">
                {batches.length} pending batch{batches.length !== 1 ? "es" : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={loadPendingBatches}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-400">Loading batches…</div>
          ) : batches.length === 0 ? (
            <div className="px-5 py-12 text-sm text-slate-500">No submitted batches right now.</div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {batches.map((batch) => (
                <li key={batch.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{batch.groupName}</p>
                      <p className="text-sm text-slate-600">
                        Total {formatAmount(batch.totalAmount)} · {Number(batch.memberCount || 0)} members
                      </p>
                      <p className="text-xs text-slate-400 mt-1">
                        Submitted {formatDate(batch.submittedAt)}
                      </p>
                    </div>
                    <Link
                      to={`/umuco/batch/${batch.id}`}
                      className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-black"
                    >
                      Open Batch
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
