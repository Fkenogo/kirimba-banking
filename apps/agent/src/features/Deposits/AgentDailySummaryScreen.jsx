import { useEffect, useState } from "react";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { getOfflineDeposits } from "../../services/offlineDeposits";
import { onPendingCountChange, getPendingCount } from "../../services/depositSyncService";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

function formatTime(ts) {
  if (!ts) return "—";
  const date = ts._seconds ? new Date(ts._seconds * 1000) : ts.toDate ? ts.toDate() : new Date(ts);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatAmount(n) {
  return Number(n).toLocaleString();
}

export default function AgentDailySummaryScreen({ user }) {
  const [deposits, setDeposits] = useState([]);
  const [offlineDeposits, setOfflineDeposits] = useState([]);
  const [batches, setBatches] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submittingGroup, setSubmittingGroup] = useState(null); // groupId being submitted
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null); // { groupId, batchId }

  async function loadDeposits() {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const todayStart = startOfToday();

      // Composite index required: agentId ASC + type ASC + createdAt ASC
      const [txSnap, batchSnap] = await Promise.all([
        getDocs(query(
          collection(db, "transactions"),
          where("agentId", "==", user.uid),
          where("type", "==", "deposit"),
          where("createdAt", ">=", todayStart)
        )),
        // Single-field query — no composite index required
        getDocs(query(
          collection(db, "depositBatches"),
          where("agentId", "==", user.uid)
        )),
      ]);

      const rows = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      rows.sort((a, b) => (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0));
      setDeposits(rows);

      // Filter batches to today client-side (avoids composite index)
      const todayMs = todayStart.toMillis();
      const todayBatches = batchSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((b) => (b.submittedAt?.toMillis?.() ?? 0) >= todayMs);
      todayBatches.sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0));
      setBatches(todayBatches);
    } catch (err) {
      setError(err.message || "Failed to load deposits.");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmitBatch(groupId, txIds) {
    setSubmittingGroup(groupId);
    setSubmitError(null);
    setSubmitSuccess(null);
    try {
      const submitBatch = httpsCallable(functions, "submitBatch");
      const token = `${groupId}_${user.uid}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const result = await submitBatch({ groupId, transactionIds: txIds, idempotencyToken: token });
      setSubmitSuccess({ groupId, batchId: result.data.batchId });
      await loadDeposits();
    } catch (err) {
      setSubmitError(err.message || "Failed to submit batch.");
    } finally {
      setSubmittingGroup(null);
    }
  }

  // Load Firestore deposits for today
  useEffect(() => {
    loadDeposits();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load offline (unsynced) deposits for this agent
  useEffect(() => {
    async function load() {
      try {
        const all = await getOfflineDeposits();
        const mine = all.filter((d) => d.agentId === user?.uid);
        setOfflineDeposits(mine);
      } catch {
        // Non-critical — offline deposits may be unavailable
      }
    }
    load();
  }, [user?.uid]);

  // Subscribe to sync count badge
  useEffect(() => {
    getPendingCount().then(setPendingCount);
    return onPendingCountChange(setPendingCount);
  }, []);

  const onlineTotal = deposits.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const offlineTotal = offlineDeposits.reduce((sum, d) => sum + Number(d.amount || 0), 0);
  const grandTotal = onlineTotal + offlineTotal;

  // Deposits recorded today that haven't been batched yet, grouped by groupId
  const unbatchedByGroup = deposits
    .filter((d) => !d.batchId && d.status === "pending_confirmation")
    .reduce((acc, d) => {
      if (d.groupId) {
        if (!acc[d.groupId]) acc[d.groupId] = [];
        acc[d.groupId].push(d);
      }
      return acc;
    }, {});
  const groupsWithUnbatched = Object.keys(unbatchedByGroup);

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Today&apos;s Deposits</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          {pendingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-amber-100 text-amber-700 text-xs font-medium px-2.5 py-1 rounded-full">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
              Pending Sync: {pendingCount}
            </span>
          )}
        </div>
      </header>

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-4 pb-32 space-y-4">

        {/* Errors */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}
        {submitError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start justify-between gap-2">
            <p className="text-sm text-red-600">{submitError}</p>
            <button onClick={() => setSubmitError(null)} className="text-red-400 hover:text-red-600 text-lg leading-none shrink-0">×</button>
          </div>
        )}
        {submitSuccess && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-start justify-between gap-2">
            <p className="text-sm text-emerald-700">Batch submitted to institution. Batch ID: <span className="font-mono text-xs">{submitSuccess.batchId}</span></p>
            <button onClick={() => setSubmitSuccess(null)} className="text-emerald-400 hover:text-emerald-600 text-lg leading-none shrink-0">×</button>
          </div>
        )}

        {/* Flagged Batches — prominent alert */}
        {!loading && batches.filter((b) => b.status === "flagged").length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-red-600 uppercase tracking-wider px-1">
              Flagged Batches — Action Required
            </p>
            {batches.filter((b) => b.status === "flagged").map((batch) => (
              <div key={batch.id} className="bg-red-50 border border-red-300 rounded-xl px-4 py-3 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-red-800">Batch Flagged by Institution</p>
                  <span className="text-xs font-mono text-red-400">{batch.id.slice(0, 8)}…</span>
                </div>
                <p className="text-xs text-red-600">
                  {formatAmount(batch.totalAmount)} BIF · {batch.memberCount} member{batch.memberCount !== 1 ? "s" : ""}
                </p>
                {(batch.institutionNotes || batch.umucoNotes) && (
                  <p className="text-sm text-red-700 bg-white border border-red-200 rounded-lg px-3 py-2 mt-1">
                    <span className="font-medium">Note: </span>{batch.institutionNotes || batch.umucoNotes}
                  </p>
                )}
              </div>
            ))}
          </section>
        )}

        {/* Submitted Batches — awaiting confirmation */}
        {!loading && batches.filter((b) => b.status === "submitted").length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-blue-600 uppercase tracking-wider px-1">
              Submitted — Awaiting Institution
            </p>
            {batches.filter((b) => b.status === "submitted").map((batch) => (
              <div key={batch.id} className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-blue-900">
                    {formatAmount(batch.totalAmount)} BIF · {batch.memberCount} member{batch.memberCount !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs font-mono text-blue-400 mt-0.5">{batch.id.slice(0, 12)}…</p>
                </div>
                <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-1 rounded-full">Pending</span>
              </div>
            ))}
          </section>
        )}

        {/* Confirmed Batches */}
        {!loading && batches.filter((b) => b.status === "confirmed").length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wider px-1">
              Confirmed Today
            </p>
            {batches.filter((b) => b.status === "confirmed").map((batch) => (
              <div key={batch.id} className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-emerald-900">
                    {formatAmount(batch.totalAmount)} BIF · {batch.memberCount} member{batch.memberCount !== 1 ? "s" : ""}
                  </p>
                  <p className="text-xs font-mono text-emerald-400 mt-0.5">{batch.id.slice(0, 12)}…</p>
                </div>
                <span className="text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-1 rounded-full">Confirmed</span>
              </div>
            ))}
          </section>
        )}

        {/* Submit to institution — shown when there are unbatched pending deposits */}
        {!loading && groupsWithUnbatched.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-violet-600 uppercase tracking-wider px-1">
              Ready to Submit
            </p>
            {groupsWithUnbatched.map((groupId) => {
              const txs = unbatchedByGroup[groupId];
              const total = txs.reduce((s, d) => s + Number(d.amount || 0), 0);
              const isSubmitting = submittingGroup === groupId;
              return (
                <div key={groupId} className="bg-violet-50 border border-violet-200 rounded-xl px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-violet-900">{txs.length} deposit{txs.length !== 1 ? "s" : ""}</p>
                    <p className="text-xs text-violet-600 font-mono truncate">{groupId}</p>
                    <p className="text-xs text-violet-700 mt-0.5">{formatAmount(total)} BIF pending</p>
                  </div>
                  <button
                    type="button"
                    disabled={isSubmitting || !!submittingGroup}
                    onClick={() => handleSubmitBatch(groupId, txs.map((t) => t.id))}
                    className="shrink-0 bg-violet-700 hover:bg-violet-800 disabled:opacity-50 text-white text-xs font-semibold px-3 py-2 rounded-lg transition-colors"
                  >
                    {isSubmitting ? "Submitting…" : "Submit Batch"}
                  </button>
                </div>
              );
            })}
          </section>
        )}

        {/* Loading */}
        {loading && (
          <div className="flex items-center justify-center py-16">
            <p className="text-sm text-slate-400 animate-pulse">Loading deposits…</p>
          </div>
        )}

        {/* Online deposits */}
        {!loading && (
          <>
            {deposits.length > 0 && (
              <section className="space-y-2">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider px-1">
                  Synced ({deposits.length})
                </p>
                <ul className="space-y-2">
                  {deposits.map((dep) => (
                    <DepositRow
                      key={dep.id}
                      fullName={dep.memberName ?? dep.memberId ?? dep.userId}
                      memberId={dep.memberId}
                      amount={dep.amount}
                      time={formatTime(dep.createdAt)}
                      badge={null}
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Offline / unsynced deposits */}
            {offlineDeposits.length > 0 && (
              <section className="space-y-2">
                <p className="text-xs font-medium text-amber-600 uppercase tracking-wider px-1">
                  Pending Sync ({offlineDeposits.length})
                </p>
                <ul className="space-y-2">
                  {offlineDeposits.map((dep) => (
                    <DepositRow
                      key={dep.localId}
                      fullName={dep.memberId}
                      memberId={dep.memberId}
                      amount={dep.amount}
                      time={dep.createdAt ? new Date(dep.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      badge="offline"
                    />
                  ))}
                </ul>
              </section>
            )}

            {/* Empty state */}
            {deposits.length === 0 && offlineDeposits.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="w-14 h-14 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                  <svg className="w-7 h-7 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M3 12a9 9 0 1118 0A9 9 0 013 12z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-500">No deposits recorded today</p>
                <p className="text-xs text-slate-400 mt-1">Deposits you record will appear here.</p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sticky total footer */}
      {!loading && (deposits.length > 0 || offlineDeposits.length > 0) && (
        <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-4 py-4 shadow-lg">
          <div className="max-w-md mx-auto space-y-1.5">
            {offlineDeposits.length > 0 && (
              <div className="flex justify-between text-sm text-slate-500">
                <span>Synced</span>
                <span>{formatAmount(onlineTotal)} BIF</span>
              </div>
            )}
            {offlineDeposits.length > 0 && (
              <div className="flex justify-between text-sm text-amber-600">
                <span>Pending Sync</span>
                <span>{formatAmount(offlineTotal)} BIF</span>
              </div>
            )}
            <div className="flex justify-between items-center pt-1 border-t border-slate-100">
              <span className="text-sm font-semibold text-slate-700">Total Deposits Today</span>
              <span className="text-lg font-bold text-slate-900">{formatAmount(grandTotal)} BIF</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function DepositRow({ fullName, memberId, amount, time, badge }) {
  return (
    <li className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-medium text-slate-800 truncate">{fullName}</p>
          {badge === "offline" && (
            <span className="text-[10px] font-semibold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full uppercase tracking-wide">
              Offline
            </span>
          )}
        </div>
        {memberId && memberId !== fullName && (
          <p className="text-xs font-mono text-blue-600 mt-0.5">{memberId}</p>
        )}
        <p className="text-xs text-slate-400 mt-0.5">{time}</p>
      </div>
      <p className="text-sm font-semibold text-slate-800 shrink-0">
        {formatAmount(amount)} <span className="text-xs font-normal text-slate-400">BIF</span>
      </p>
    </li>
  );
}
