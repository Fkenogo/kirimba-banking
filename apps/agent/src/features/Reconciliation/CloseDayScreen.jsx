import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { getOfflineDeposits } from "../../services/offlineDeposits";

// ─── helpers ────────────────────────────────────────────────────────────────

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Returns [startMs, endMs) for a YYYY-MM-DD date in the local timezone. */
function dayBoundsMs(dateStr) {
  const start = new Date(dateStr + "T00:00:00").getTime();
  return { startMs: start, endMs: start + 86_400_000 };
}

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ─── main component ─────────────────────────────────────────────────────────

export default function CloseDayScreen({ user }) {
  const [selectedDate, setSelectedDate] = useState(todayISO);

  // Raw Firestore data (fetched once, filtered client-side per date)
  const [allTxns, setAllTxns] = useState(null);
  const [allLedger, setAllLedger] = useState(null);
  const [offlinePending, setOfflinePending] = useState([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [dataError, setDataError] = useState(null);

  // Existing reconciliation for selected date
  const [existingReconc, setExistingReconc] = useState(undefined); // undefined = loading
  const [reconcLoading, setReconcLoading] = useState(true);

  // Form state
  const [cashCounted, setCashCounted] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [submitResult, setSubmitResult] = useState(null); // success payload

  // ── Load all agent transactions + ledger entries once ──────────────────────
  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      setDataLoading(true);
      setDataError(null);
      try {
        const [txSnap, ledgerSnap, offline] = await Promise.all([
          getDocs(
            query(collection(db, "transactions"), where("agentId", "==", user.uid))
          ),
          getDocs(
            query(collection(db, "agentLedgers"), where("agentId", "==", user.uid))
          ),
          getOfflineDeposits(),
        ]);

        setAllTxns(txSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setAllLedger(ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() })));
        setOfflinePending(offline.filter((d) => d.agentId === user.uid));
      } catch (err) {
        setDataError(err.message || "Failed to load transaction data.");
      } finally {
        setDataLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  // ── Load existing reconciliation whenever date changes ────────────────────
  useEffect(() => {
    if (!user?.uid) return;
    setReconcLoading(true);
    setExistingReconc(undefined);
    setSubmitResult(null);
    setCashCounted("");
    setNotes("");
    setSubmitError(null);

    const reconcId = `${user.uid}_${selectedDate}`;
    getDoc(doc(db, "agentReconciliations", reconcId))
      .then((snap) => setExistingReconc(snap.exists() ? snap.data() : null))
      .catch(() => setExistingReconc(null)) // treat fetch error as "no record"
      .finally(() => setReconcLoading(false));
  }, [user?.uid, selectedDate]);

  // ── Derive metrics for the selected date ──────────────────────────────────
  const metrics = useMemo(() => {
    if (!allTxns || !allLedger) return null;

    const { startMs, endMs } = dayBoundsMs(selectedDate);

    const dayTxns = allTxns.filter((d) => {
      const ms = d.createdAt?.toMillis?.() ?? 0;
      return ms >= startMs && ms < endMs;
    });

    const deposits = dayTxns.filter(
      (d) =>
        d.type === "deposit" &&
        (d.status === "pending_confirmation" || d.status === "confirmed")
    );
    const withdrawals = dayTxns.filter(
      (d) => d.type === "withdrawal" && d.status === "confirmed"
    );

    const totalDeposits = deposits.reduce((s, d) => s + Number(d.amount || 0), 0);
    const totalWithdrawals = withdrawals.reduce((s, d) => s + Number(d.amount || 0), 0);
    const cashExpected = totalDeposits - totalWithdrawals;

    const dayLedger = allLedger.filter((d) => {
      const ms = d.createdAt?.toMillis?.() ?? 0;
      return ms >= startMs && ms < endMs;
    });
    const commissionEarned = dayLedger
      .filter((e) => e.type === "commission")
      .reduce((s, e) => s + Number(e.amount || 0), 0);

    return {
      deposits,
      withdrawals,
      totalDeposits,
      totalWithdrawals,
      cashExpected,
      commissionEarned,
    };
  }, [allTxns, allLedger, selectedDate]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    const cashCountedNum = Number(cashCounted);
    if (!Number.isFinite(cashCountedNum) || cashCountedNum < 0) {
      setSubmitError("Please enter a valid non-negative cash amount.");
      setSubmitting(false);
      return;
    }

    try {
      const closeAgentDay = httpsCallable(functions, "closeAgentDay");
      const result = await closeAgentDay({
        dateYYYYMMDD: selectedDate,
        cashCounted: cashCountedNum,
        notes: notes.trim(),
        offlinePendingCount: offlinePending.length,
      });
      setSubmitResult(result.data);
    } catch (err) {
      setSubmitError(err.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  const isInitializing = dataLoading || reconcLoading;

  // ── Derived: live difference ───────────────────────────────────────────────
  const cashCountedNum = cashCounted === "" ? null : Number(cashCounted);
  const liveDifference =
    cashCountedNum !== null && metrics
      ? cashCountedNum - metrics.cashExpected
      : null;

  const maxDate = todayISO();

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Close Day</h1>
            <p className="text-xs text-slate-400 mt-0.5">Daily cash reconciliation</p>
          </div>
          <input
            type="date"
            max={maxDate}
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="text-xs text-slate-600 border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </header>

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-5 pb-12 space-y-4">

        {/* Data fetch error */}
        {dataError && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{dataError}</p>
          </div>
        )}

        {/* Offline warning */}
        {!dataLoading && offlinePending.length > 0 && (
          <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-xs text-amber-700">
              <span className="font-semibold">{offlinePending.length} deposit{offlinePending.length !== 1 ? "s" : ""} pending sync</span>
              {" "}— not yet included in expected cash. Sync before closing if possible.
            </p>
          </div>
        )}

        {isInitializing ? (
          <LoadingSkeleton />
        ) : submitResult ? (
          <SuccessView
            result={submitResult}
            date={selectedDate}
            onResubmit={() => {
              setSubmitResult(null);
              setExistingReconc(null);
            }}
          />
        ) : existingReconc && !submitResult ? (
          <AlreadySubmittedView
            reconc={existingReconc}
            date={selectedDate}
            onResubmit={() => setExistingReconc(null)}
          />
        ) : (
          <>
            {/* Calculated summary */}
            <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Calculated from {formatDate(selectedDate)}
                </p>
              </div>

              {metrics && (metrics.deposits.length > 0 || metrics.withdrawals.length > 0) ? (
                <div className="divide-y divide-slate-100">
                  {/* Expected cash */}
                  <div className="px-4 py-3 flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-700">Expected Cash</span>
                    <span className="text-base font-bold text-slate-900">
                      {fmt(metrics.cashExpected)} <span className="text-xs font-normal text-slate-400">BIF</span>
                    </span>
                  </div>

                  {/* Deposit breakdown */}
                  <div className="px-4 py-2.5 flex items-center justify-between">
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
                      Deposits ({metrics.deposits.length})
                    </span>
                    <span className="text-xs font-medium text-emerald-700">+{fmt(metrics.totalDeposits)} BIF</span>
                  </div>

                  {/* Withdrawal breakdown */}
                  {metrics.withdrawals.length > 0 && (
                    <div className="px-4 py-2.5 flex items-center justify-between">
                      <span className="text-xs text-slate-500 flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                        Withdrawals ({metrics.withdrawals.length})
                      </span>
                      <span className="text-xs font-medium text-red-600">−{fmt(metrics.totalWithdrawals)} BIF</span>
                    </div>
                  )}

                  {/* Commission */}
                  <div className="px-4 py-2.5 flex items-center justify-between bg-slate-50">
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 inline-block" />
                      Commission Earned
                    </span>
                    <span className="text-xs font-medium text-indigo-700">{fmt(metrics.commissionEarned)} BIF</span>
                  </div>
                </div>
              ) : (
                <div className="px-4 py-6 text-center">
                  <p className="text-sm text-slate-400">No transactions recorded for this date.</p>
                  <p className="text-xs text-slate-400 mt-1">Expected cash will be 0 BIF.</p>
                </div>
              )}
            </section>

            {/* Cash count form */}
            <form onSubmit={handleSubmit} className="space-y-3">
              <section className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Cash Count</p>
                </div>

                <div className="px-4 py-4 space-y-4">
                  {/* Cash counted input */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                      Cash Counted <span className="text-slate-400">(BIF)</span>
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={cashCounted}
                      onChange={(e) => setCashCounted(e.target.value)}
                      placeholder="0"
                      required
                      className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-base font-semibold text-slate-800 placeholder-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                    />
                  </div>

                  {/* Live difference */}
                  {liveDifference !== null && (
                    <DifferenceRow
                      expected={metrics.cashExpected}
                      counted={cashCountedNum}
                      difference={liveDifference}
                    />
                  )}

                  {/* Notes */}
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1.5">
                      Notes <span className="text-slate-400">(optional)</span>
                    </label>
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Any discrepancies or comments…"
                      maxLength={500}
                      className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm text-slate-700 placeholder-slate-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                    />
                  </div>
                </div>
              </section>

              {submitError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <p className="text-sm text-red-600">{submitError}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={submitting || cashCounted === ""}
                className="w-full bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm py-3.5 rounded-2xl transition-colors flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                    </svg>
                    Submitting…
                  </>
                ) : (
                  "Submit Reconciliation"
                )}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  );
}

// ─── sub-components ──────────────────────────────────────────────────────────

function DifferenceRow({ expected, counted, difference }) {
  const isExact = difference === 0;
  const isOver = difference > 0;

  const colorClass = isExact
    ? "text-emerald-700 bg-emerald-50 border-emerald-200"
    : isOver
    ? "text-sky-700 bg-sky-50 border-sky-200"
    : "text-red-700 bg-red-50 border-red-200";

  const label = isExact ? "Exact match" : isOver ? "Overage" : "Shortage";
  const sign = isOver ? "+" : "";

  return (
    <div className={`border rounded-xl px-3.5 py-3 flex items-center justify-between ${colorClass}`}>
      <div>
        <p className="text-xs font-medium opacity-70">Difference ({label})</p>
        <p className="text-xs opacity-60 mt-0.5">
          Counted {Number(counted).toLocaleString()} − Expected {Number(expected).toLocaleString()}
        </p>
      </div>
      <p className="text-xl font-bold">
        {sign}{Number(difference).toLocaleString()}{" "}
        <span className="text-xs font-normal opacity-60">BIF</span>
      </p>
    </div>
  );
}

function SuccessView({ result, date, onResubmit }) {
  const isExact = result.difference === 0;
  const isOver = result.difference > 0;
  const sign = result.difference > 0 ? "+" : "";

  return (
    <div className="space-y-4">
      {/* Check mark */}
      <div className="flex flex-col items-center py-6 text-center">
        <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mb-3">
          <svg className="w-7 h-7 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-base font-semibold text-slate-800">Reconciliation Submitted</p>
        <p className="text-xs text-slate-400 mt-1">{formatDate(date)}</p>
      </div>

      {/* Result summary */}
      <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
        <SummaryRow label="Expected Cash" value={`${fmt(result.cashExpected)} BIF`} />
        <SummaryRow label="Cash Counted" value={`${fmt(result.cashCounted)} BIF`} />
        <SummaryRow
          label="Difference"
          value={`${sign}${fmt(result.difference)} BIF`}
          valueColor={isExact ? "text-emerald-700" : isOver ? "text-sky-700" : "text-red-600"}
        />
        <SummaryRow label="Commission Earned" value={`${fmt(result.commissionAccrued)} BIF`} />
        <SummaryRow
          label="Deposits / Withdrawals"
          value={`${result.depositCount} / ${result.withdrawCount}`}
        />
      </div>

      <button
        onClick={onResubmit}
        className="w-full text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl py-2.5 transition-colors"
      >
        Re-submit with corrections
      </button>
    </div>
  );
}

function AlreadySubmittedView({ reconc, date, onResubmit }) {
  const sign = reconc.difference > 0 ? "+" : "";
  const isExact = reconc.difference === 0;
  const isOver = reconc.difference > 0;
  const isReviewed = reconc.status === "reviewed";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-slate-100 rounded-2xl px-4 py-3">
        <svg className="w-5 h-5 text-slate-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-semibold text-slate-700">
            Already submitted for {formatDate(date)}
          </p>
          <p className="text-xs text-slate-500 mt-0.5 capitalize">
            Status: <span className="font-medium">{reconc.status}</span>
            {isReviewed && " — reviewed by admin"}
          </p>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100 overflow-hidden">
        <SummaryRow label="Expected Cash" value={`${fmt(reconc.cashExpected)} BIF`} />
        <SummaryRow label="Cash Counted" value={`${fmt(reconc.cashCounted)} BIF`} />
        <SummaryRow
          label="Difference"
          value={`${sign}${fmt(reconc.difference)} BIF`}
          valueColor={isExact ? "text-emerald-700" : isOver ? "text-sky-700" : "text-red-600"}
        />
        <SummaryRow label="Commission Earned" value={`${fmt(reconc.commissionAccrued)} BIF`} />
        {reconc.notes && (
          <div className="px-4 py-3">
            <p className="text-xs text-slate-500 mb-0.5">Notes</p>
            <p className="text-sm text-slate-700">{reconc.notes}</p>
          </div>
        )}
      </div>

      {!isReviewed && (
        <button
          onClick={onResubmit}
          className="w-full text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-xl py-2.5 transition-colors"
        >
          Re-submit with corrections
        </button>
      )}
    </div>
  );
}

function SummaryRow({ label, value, valueColor = "text-slate-800" }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-semibold ${valueColor}`}>{value}</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="h-3 w-40 bg-slate-200 rounded" />
        </div>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="px-4 py-3 flex justify-between">
            <div className="h-3 w-24 bg-slate-100 rounded" />
            <div className="h-3 w-20 bg-slate-100 rounded" />
          </div>
        ))}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <div className="h-3 w-24 bg-slate-200 rounded" />
        </div>
        <div className="px-4 py-4 space-y-3">
          <div className="h-10 bg-slate-100 rounded-xl" />
          <div className="h-16 bg-slate-100 rounded-xl" />
        </div>
      </div>
      <div className="h-12 bg-slate-200 rounded-2xl" />
    </div>
  );
}
