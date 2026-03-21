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
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusBadge({ status }) {
  const cls = {
    submitted: "bg-amber-100 text-amber-700",
    confirmed: "bg-emerald-100 text-emerald-700",
    flagged: "bg-red-100 text-red-700",
  }[status] || "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium capitalize ${cls}`}>
      {status || "—"}
    </span>
  );
}

export default function BatchDetailScreen() {
  const navigate = useNavigate();
  const { batchId } = useParams();

  const [batch, setBatch] = useState(null);
  const [groupName, setGroupName] = useState("");
  const [agentName, setAgentName] = useState("");
  const [transactions, setTransactions] = useState([]);
  const [memberNames, setMemberNames] = useState({});
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
        return;
      }

      const batchData = { id: batchSnap.id, ...batchSnap.data() };
      setBatch(batchData);

      // Fetch group name
      if (batchData.groupId) {
        const groupSnap = await getDoc(doc(db, "groups", batchData.groupId));
        setGroupName(groupSnap.exists() ? groupSnap.data().name || batchData.groupId : batchData.groupId);
      }

      // Fetch agent name
      if (batchData.agentId) {
        const agentSnap = await getDoc(doc(db, "users", batchData.agentId));
        if (agentSnap.exists()) {
          const d = agentSnap.data();
          setAgentName(d.fullName || d.name || batchData.agentId);
        } else {
          setAgentName(batchData.agentId);
        }
      }

      const txIds = Array.isArray(batchData.transactionIds) ? batchData.transactionIds : [];
      if (!txIds.length) {
        setTransactions([]);
        return;
      }

      // Fetch all transactions
      const txSnaps = await Promise.all(txIds.map((id) => getDoc(doc(db, "transactions", id))));
      const rows = txSnaps
        .filter((s) => s.exists())
        .map((s) => ({ id: s.id, ...s.data() }))
        .sort((a, b) => {
          const aMs = a.createdAt?._seconds
            ? a.createdAt._seconds * 1000
            : a.createdAt?.toMillis?.() || 0;
          const bMs = b.createdAt?._seconds
            ? b.createdAt._seconds * 1000
            : b.createdAt?.toMillis?.() || 0;
          return aMs - bMs;
        });
      setTransactions(rows);

      // Batch-fetch member names
      const userIds = [...new Set(rows.map((tx) => tx.userId).filter(Boolean))];
      if (userIds.length) {
        const userSnaps = await Promise.all(userIds.map((id) => getDoc(doc(db, "users", id))));
        const names = {};
        userIds.forEach((id, i) => {
          if (userSnaps[i].exists()) {
            const d = userSnaps[i].data();
            names[id] = d.fullName || d.name || id;
          }
        });
        setMemberNames(names);
      }
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
      await confirmBatch({ batchId, institutionRef: ref, notes: confirmNotes.trim() });
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/umuco/batches")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Pending Batches
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Batch Detail</h1>
            {batch && (
              <p className="text-xs text-slate-400 mt-0.5 font-mono">{batchId}</p>
            )}
          </div>
          <Link
            to="/umuco/history"
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 shrink-0"
          >
            History
          </Link>
        </div>

        {(error || actionError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{error || actionError}</p>
          </div>
        )}

        {loading ? (
          <>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4 space-y-4 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="h-4 w-28 rounded bg-slate-200" />
                <div className="h-5 w-20 rounded-full bg-slate-200" />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between gap-3">
                    <div className="h-3.5 w-20 rounded bg-slate-100" />
                    <div className="h-3.5 w-28 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-pulse">
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="h-4 w-40 rounded bg-slate-200" />
              </div>
              <div className="px-5 py-4 space-y-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="h-9 rounded bg-slate-100" />
                ))}
              </div>
            </section>
          </>
        ) : !batch ? null : (
          <>
            {/* Batch Metadata */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Batch Summary</h2>
                <StatusBadge status={batch.status} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Row label="Group" value={groupName || batch.groupId || "—"} />
                <Row label="Agent" value={agentName || batch.agentId || "—"} />
                <Row label="Total Amount" value={formatAmount(batch.totalAmount)} />
                <Row label="Member Count" value={String(Number(batch.memberCount || 0))} />
                <Row label="Submitted" value={formatDate(batch.submittedAt)} />
                {batch.status === "confirmed" && (
                  <>
                    <Row label="Confirmed At" value={formatDate(batch.confirmedAt)} />
                    <Row label="Confirmed By" value={batch.confirmedBy || "—"} />
                    <Row label="Institution Reference" value={batch.institutionRef || batch.umucoAccountRef || "—"} />
                  </>
                )}
                {batch.status === "flagged" && (
                  <>
                    <Row label="Flagged At" value={formatDate(batch.flaggedAt)} />
                    <Row label="Flagged By" value={batch.flaggedBy || "—"} />
                  </>
                )}
                {(batch.institutionNotes || batch.umucoNotes) && (
                  <div className="sm:col-span-2">
                    <p className="text-xs text-slate-500 mb-0.5">Decision Notes</p>
                    <p className="text-sm text-slate-800">{batch.institutionNotes || batch.umucoNotes}</p>
                  </div>
                )}
              </div>
            </section>

            {/* Member Transactions */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Member Transactions ({transactions.length})
                </h2>
              </div>
              {transactions.length === 0 ? (
                <div className="px-5 py-10 text-sm text-slate-500">No transactions found in this batch.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3">Member Name</th>
                        <th className="px-5 py-3">Member ID</th>
                        <th className="px-5 py-3 text-right">Amount</th>
                        <th className="px-5 py-3">Status</th>
                        <th className="px-5 py-3">Recorded</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {transactions.map((tx) => (
                        <tr key={tx.id}>
                          <td className="px-5 py-3 font-medium text-slate-900">
                            {memberNames[tx.userId] || tx.userId || "—"}
                          </td>
                          <td className="px-5 py-3 font-mono text-xs text-blue-600">
                            {tx.memberId || "—"}
                          </td>
                          <td className="px-5 py-3 text-right font-medium text-slate-900">
                            {formatAmount(tx.amount)}
                          </td>
                          <td className="px-5 py-3 capitalize text-slate-700">
                            {tx.status?.replace(/_/g, " ") || "—"}
                          </td>
                          <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                            {formatDate(tx.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Decision Panel */}
            {isSubmitted && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm p-5 space-y-4">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Batch Decision</h2>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {/* Confirm */}
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-emerald-900">Confirm Batch</h3>
                    <label className="block text-xs font-medium text-emerald-900">
                      Institution Account Reference *
                      <input
                        type="text"
                        value={confirmRef}
                        onChange={(e) => setConfirmRef(e.target.value)}
                        placeholder="e.g. REF-2026-001"
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
                      disabled={working}
                      className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                    >
                      {working ? "Processing…" : "Confirm Batch"}
                    </button>
                  </div>

                  {/* Flag */}
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-amber-900">Flag Batch</h3>
                    <label className="block text-xs font-medium text-amber-900">
                      Flag Notes *
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
                      disabled={working}
                      className="rounded-md bg-amber-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-60"
                    >
                      {working ? "Processing…" : "Flag Batch"}
                    </button>
                  </div>
                </div>
              </section>
            )}

            {!isSubmitted && (
              <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4">
                <p className="text-sm text-slate-500">
                  This batch has already been{" "}
                  <span className="font-medium capitalize">{batch.status}</span> and cannot be modified.
                </p>
              </section>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value || "—"}</span>
    </div>
  );
}
