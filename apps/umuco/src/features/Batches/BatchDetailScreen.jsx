import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
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

export default function BatchDetailScreen() {
  const navigate = useNavigate();
  const { batchId } = useParams();

  const [batch, setBatch] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [groupName, setGroupName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [working, setWorking] = useState(false);

  const [confirmRef, setConfirmRef] = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [flagNotes, setFlagNotes] = useState("");

  async function loadBatch() {
    if (!batchId) return;
    setLoading(true);
    setError("");
    try {
      const batchSnap = await getDoc(doc(db, "depositBatches", batchId));
      if (!batchSnap.exists()) {
        setError("Batch not found.");
        setBatch(null);
        setTransactions([]);
        return;
      }

      const batchData = { id: batchSnap.id, ...batchSnap.data() };
      setBatch(batchData);

      if (batchData.groupId) {
        const groupSnap = await getDoc(doc(db, "groups", batchData.groupId));
        setGroupName(groupSnap.exists() ? groupSnap.data().name || batchData.groupId : batchData.groupId);
      } else {
        setGroupName("Unknown Group");
      }

      const txIds = Array.isArray(batchData.transactionIds) ? batchData.transactionIds : [];
      if (!txIds.length) {
        setTransactions([]);
        return;
      }

      const txSnaps = await Promise.all(
        txIds.map((txId) => getDoc(doc(db, "transactions", txId)))
      );
      const rows = txSnaps
        .filter((snap) => snap.exists())
        .map((snap) => ({ id: snap.id, ...snap.data() }))
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis?.() || 0;
          const bMs = b.createdAt?.toMillis?.() || 0;
          return aMs - bMs;
        });
      setTransactions(rows);
    } catch (err) {
      setError(err.message || "Failed to load batch detail.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadBatch();
  }, [batchId]);

  async function handleConfirm() {
    const ref = confirmRef.trim();
    if (!ref) {
      setActionError("Institution account reference is required.");
      return;
    }

    setActionError("");
    setWorking(true);
    try {
      const confirmBatch = httpsCallable(functions, "confirmBatch");
      await confirmBatch({
        batchId,
        umucoAccountRef: ref,
        notes: confirmNotes.trim(),
      });
      await loadBatch();
    } catch (err) {
      setActionError(err.message || "Failed to confirm batch.");
    } finally {
      setWorking(false);
    }
  }

  async function handleFlag() {
    const notes = flagNotes.trim();
    if (!notes) {
      setActionError("Flag notes are required.");
      return;
    }

    setActionError("");
    setWorking(true);
    try {
      const flagBatch = httpsCallable(functions, "flagBatch");
      await flagBatch({ batchId, notes });
      await loadBatch();
    } catch (err) {
      setActionError(err.message || "Failed to flag batch.");
    } finally {
      setWorking(false);
    }
  }

  const isSubmitted = batch?.status === "submitted";

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/umuco/batches")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Batches
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Batch Detail</h1>
            {batch && (
              <p className="text-xs text-slate-400 mt-0.5">
                {groupName || "Unknown Group"} · {formatAmount(batch.totalAmount)} · {Number(batch.memberCount || 0)} members
              </p>
            )}
          </div>
          <Link
            to="/umuco/history"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50"
          >
            View History
          </Link>
        </div>

        {(error || actionError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{error || actionError}</p>
          </div>
        )}

        {loading ? (
          <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-12 text-sm text-slate-400">
            Loading batch detail…
          </section>
        ) : !batch ? null : (
          <>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Batch ID:</span> {batch.id}
                </p>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Status:</span>{" "}
                  <span className="capitalize">{batch.status || "—"}</span>
                </p>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Submitted:</span> {formatDate(batch.submittedAt)}
                </p>
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">Notes:</span> {batch.umucoNotes || "—"}
                </p>
              </div>
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-base font-semibold text-slate-900">Batch Transactions</h2>
              </div>
              {transactions.length === 0 ? (
                <div className="px-5 py-10 text-sm text-slate-500">No transactions found in this batch.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3">Member ID</th>
                        <th className="px-5 py-3">User</th>
                        <th className="px-5 py-3 text-right">Amount</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td className="px-5 py-3 font-mono text-xs text-blue-600">{tx.memberId || "—"}</td>
                          <td className="px-5 py-3 text-slate-700">{tx.userId || "—"}</td>
                          <td className="px-5 py-3 text-right font-medium text-slate-900">{formatAmount(tx.amount)}</td>
                          <td className="px-5 py-3 capitalize text-slate-700">{tx.status || "—"}</td>
                          <td className="px-5 py-3 text-slate-500">{formatDate(tx.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
              <h2 className="text-base font-semibold text-slate-900">Batch Decision</h2>
              {!isSubmitted && (
                <p className="text-sm text-slate-500">
                  This batch is already <span className="font-medium capitalize">{batch.status}</span>.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-emerald-900">Confirm Batch</h3>
                  <label className="block text-xs font-medium text-emerald-900">
                    Institution Account Reference
                    <input
                      type="text"
                      value={confirmRef}
                      onChange={(e) => setConfirmRef(e.target.value)}
                      placeholder="e.g. UMC-ACC-REF-001"
                      className="mt-1 w-full rounded-md border border-emerald-300 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                    />
                  </label>
                  <label className="block text-xs font-medium text-emerald-900">
                    Notes (optional)
                    <textarea
                      rows={3}
                      value={confirmNotes}
                      onChange={(e) => setConfirmNotes(e.target.value)}
                      className="mt-1 w-full rounded-md border border-emerald-300 px-3 py-2 text-sm text-slate-800 focus:border-emerald-500 focus:outline-none"
                      placeholder="Optional confirmation note"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    disabled={!isSubmitted || working}
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                  >
                    {working ? "Processing…" : "Confirm Batch"}
                  </button>
                </div>

                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-amber-900">Flag Batch</h3>
                  <label className="block text-xs font-medium text-amber-900">
                    Flag Notes
                    <textarea
                      rows={5}
                      value={flagNotes}
                      onChange={(e) => setFlagNotes(e.target.value)}
                      className="mt-1 w-full rounded-md border border-amber-300 px-3 py-2 text-sm text-slate-800 focus:border-amber-500 focus:outline-none"
                      placeholder="Explain discrepancy or issue"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={handleFlag}
                    disabled={!isSubmitted || working}
                    className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                  >
                    {working ? "Processing…" : "Flag Batch"}
                  </button>
                </div>
              </div>
            </section>
          </>
        )}
      </div>
    </main>
  );
}
