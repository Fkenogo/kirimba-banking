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

export default function FlaggedBatchesScreen({ institutionId }) {
  const navigate = useNavigate();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
          where("status", "==", "flagged"),
          orderBy("flaggedAt", "desc")
        )
      );

      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

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

      setBatches(
        rows.map((b) => ({
          ...b,
          groupName: groupNames[b.groupId] || b.groupId || "Unknown Group",
          agentName: agentNames[b.agentId] || b.agentId || "—",
        }))
      );
    } catch (err) {
      setError(err.message || "Failed to load flagged batches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
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
            <h1 className="text-xl font-semibold text-slate-900">Flagged Batches</h1>
            {!loading && (
              <p className="text-xs text-slate-400 mt-0.5">
                {batches.length === 0
                  ? "No flagged batches — all clear"
                  : `${batches.length} batch${batches.length !== 1 ? "es" : ""} flagged for follow-up`}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={load}
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

        {!loading && batches.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">
              These batches were flagged due to discrepancies. Open each batch to review the issue and
              coordinate with the agent for resubmission or correction.
            </p>
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-5 py-12 text-sm text-slate-400 animate-pulse">Loading flagged batches…</div>
          ) : batches.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <p className="text-sm text-slate-500">No flagged batches.</p>
              <p className="text-xs text-slate-400 mt-1">All submitted batches have been resolved.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {batches.map((b) => (
                <div key={b.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{b.groupName}</p>
                      <p className="text-sm text-slate-600">
                        Agent: {b.agentName}
                      </p>
                      <p className="text-xs font-mono text-slate-400 mt-0.5">{b.id.slice(0, 16)}…</p>
                    </div>
                    <div className="text-right shrink-0 space-y-1">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatAmount(b.totalAmount)}
                      </p>
                      <p className="text-xs text-slate-500">{Number(b.memberCount || 0)} members</p>
                      <Link
                        to={`/umuco/batch/${b.id}`}
                        className="inline-flex rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-black"
                      >
                        Open Batch
                      </Link>
                    </div>
                  </div>

                  {(b.institutionNotes || b.umucoNotes) && (
                    <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                      <p className="text-xs font-semibold text-red-700 mb-0.5">Flag Reason</p>
                      <p className="text-sm text-red-800">{b.institutionNotes || b.umucoNotes}</p>
                    </div>
                  )}

                  <p className="text-xs text-slate-400">
                    Flagged {formatDate(b.flaggedAt)} · Submitted {formatDate(b.submittedAt)}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
