import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { getOfflineDeposits } from "../../services/offlineDeposits";
import { PageShell, Card, SectionLabel, FormInput, FormTextarea, PrimaryButton, Alert } from "../../components/ui";
import { buildAgentDailyFinanceSummary, dayBoundsMs, todayISO, toMillis } from "../../utils/agentFinance";

/* ── helpers ── */
function fmt(n) { return Number(n || 0).toLocaleString(); }

function formatDate(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

export default function CloseDayScreen({ user }) {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(todayISO);

  const [allTxns,       setAllTxns]       = useState(null);
  const [allLedger,     setAllLedger]     = useState(null);
  const [offlinePending,setOfflinePending]= useState([]);
  const [dataLoading,   setDataLoading]   = useState(true);
  const [dataError,     setDataError]     = useState(null);

  const [existingReconc, setExistingReconc] = useState(undefined);
  const [reconcLoading,  setReconcLoading]  = useState(true);

  const [cashCounted,   setCashCounted]   = useState("");
  const [notes,         setNotes]         = useState("");
  const [submitting,    setSubmitting]    = useState(false);
  const [submitError,   setSubmitError]   = useState(null);
  const [submitResult,  setSubmitResult]  = useState(null);

  /* Load agent transactions + ledger once */
  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      setDataLoading(true);
      setDataError(null);
      try {
        const [txSnap, ledgerSnap, offline] = await Promise.all([
          getDocs(query(collection(db, "transactions"), where("agentId", "==", user.uid))),
          getDocs(query(collection(db, "agentLedgers"), where("agentId", "==", user.uid))),
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

  /* Load existing reconciliation when date changes */
  useEffect(() => {
    if (!user?.uid) return;
    setReconcLoading(true);
    setExistingReconc(undefined);
    setSubmitResult(null);
    setCashCounted("");
    setNotes("");
    setSubmitError(null);

    getDoc(doc(db, "agentReconciliations", `${user.uid}_${selectedDate}`))
      .then((snap) => setExistingReconc(snap.exists() ? snap.data() : null))
      .catch(() => setExistingReconc(null))
      .finally(() => setReconcLoading(false));
  }, [user?.uid, selectedDate]);

  /* Derive metrics for selected date */
  const metrics = useMemo(() => {
    if (!allTxns || !allLedger) return null;
    return buildAgentDailyFinanceSummary({
      transactions: allTxns,
      ledgerEntries: allLedger,
      dateStr: selectedDate,
    });
  }, [allTxns, allLedger, selectedDate]);

  const offlinePendingForDay = useMemo(() => {
    const { startMs, endMs } = dayBoundsMs(selectedDate);
    return offlinePending.filter((entry) => {
      const createdAtMs = toMillis(entry.createdAt);
      return createdAtMs >= startMs && createdAtMs < endMs;
    });
  }, [offlinePending, selectedDate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);
    const cashCountedNum = Number(cashCounted);
    if (!Number.isFinite(cashCountedNum) || cashCountedNum < 0) {
      setSubmitError("Please enter a valid non-negative cash amount.");
      return;
    }
    setSubmitting(true);
    try {
      const closeAgentDay = httpsCallable(functions, "closeAgentDay");
      const result = await closeAgentDay({
        dateYYYYMMDD: selectedDate,
        cashCounted: cashCountedNum,
        notes: notes.trim(),
        offlinePendingCount: offlinePendingForDay.length,
      });
      setSubmitResult(result.data);
    } catch (err) {
      setSubmitError(err.message || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  const isInitializing = dataLoading || reconcLoading;
  const cashCountedNum = cashCounted === "" ? null : Number(cashCounted);
  const liveDiff = cashCountedNum !== null && metrics ? cashCountedNum - metrics.expectedCashOnHand : null;
  const maxDate = todayISO();

  return (
    <PageShell title="Close Day" user={user}>

      {/* ── Date selector ── */}
      <Card>
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Date</p>
            <p className="text-sm font-semibold text-slate-800 mt-0.5">{formatDate(selectedDate)}</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate("/agent/close-day/history")}
              className="text-xs font-bold text-brand-600 border-2 border-brand-100 rounded-xl px-3 py-2 bg-white hover:bg-brand-50 transition-colors"
            >
              View History
            </button>
            <input
              type="date"
              max={maxDate}
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="text-xs text-slate-600 border-2 border-slate-100 rounded-xl px-3 py-2 bg-slate-50 focus:outline-none focus:border-brand-400 transition-colors"
            />
          </div>
        </div>
      </Card>

      {/* ── Data error ── */}
      {dataError && <Alert type="error">{dataError}</Alert>}

      {/* ── Offline warning ── */}
      {!dataLoading && offlinePendingForDay.length > 0 && (
        <Alert type="warning">
          <span className="font-semibold">{offlinePendingForDay.length} deposit{offlinePendingForDay.length !== 1 ? "s" : ""} pending sync</span>
          {" "}— these local-only deposits still need sync review before they appear in the reconciled backend totals.
        </Alert>
      )}

      {/* ── Loading ── */}
      {isInitializing && (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-14 bg-white rounded-2xl shadow-card" />
          ))}
        </div>
      )}

      {/* ── SUCCESS view ── */}
      {!isInitializing && submitResult && (
        <SuccessView
          result={submitResult}
          date={selectedDate}
          onResubmit={() => { setSubmitResult(null); setExistingReconc(null); }}
        />
      )}

      {/* ── ALREADY SUBMITTED view ── */}
      {!isInitializing && !submitResult && existingReconc && (
        <AlreadySubmittedView
          reconc={existingReconc}
          date={selectedDate}
          onResubmit={() => setExistingReconc(null)}
        />
      )}

      {/* ── FORM ── */}
      {!isInitializing && !submitResult && !existingReconc && (
        <>
          {/* Calculated summary */}
          <Card>
            <div className="px-5 py-3 border-b border-slate-50">
              <SectionLabel>Calculated from {formatDate(selectedDate)}</SectionLabel>
            </div>

            {metrics && (metrics.deposits.length > 0 || metrics.withdrawals.length > 0) ? (
              <div className="divide-y divide-slate-50">
                <div className="px-5 py-3.5 flex items-center justify-between">
                  <span className="text-sm font-bold text-slate-700">Expected Cash on Hand</span>
                  <span className="text-base font-bold text-slate-900">
                    {fmt(metrics.expectedCashOnHand)} <span className="text-xs font-normal text-slate-400">BIF</span>
                  </span>
                </div>
                <div className="px-5 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 inline-block" />
                    Deposits ({metrics.deposits.length})
                  </span>
                  <span className="text-xs font-semibold text-brand-700">+{fmt(metrics.totalDeposits)} BIF</span>
                </div>
                {metrics.withdrawals.length > 0 && (
                  <div className="px-5 py-2.5 flex items-center justify-between">
                    <span className="text-xs text-slate-500 flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />
                      Withdrawals ({metrics.withdrawals.length})
                    </span>
                    <span className="text-xs font-semibold text-red-600">−{fmt(metrics.totalWithdrawals)} BIF</span>
                  </div>
                )}
                <div className="px-5 py-2.5 flex items-center justify-between bg-brand-50">
                  <span className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-500 inline-block" />
                    Remittance due today
                  </span>
                  <span className="text-xs font-semibold text-brand-700">{fmt(metrics.remittanceDue)} BIF</span>
                </div>
              </div>
            ) : (
              <div className="px-5 py-6 text-center">
                <p className="text-sm text-slate-400">No transactions for this date.</p>
                <p className="text-xs text-slate-300 mt-1">Expected cash will be 0 BIF.</p>
              </div>
            )}
          </Card>

          <Card>
            <div className="px-5 py-3 border-b border-slate-50">
              <SectionLabel>Fee Reference</SectionLabel>
            </div>
            <div className="divide-y divide-slate-50">
              <div className="px-5 py-2.5 flex items-center justify-between">
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" />
                  Customer fees posted
                </span>
                <span className="text-xs font-semibold text-blue-700">{fmt(metrics?.customerFeesCollected)} BIF</span>
              </div>
              <div className="px-5 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-slate-500 flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-gold-400 inline-block" />
                    Agent commission earned
                  </span>
                  <span className="text-xs font-semibold text-gold-700">{fmt(metrics?.agentCommissionEarned)} BIF</span>
                </div>
              <div className="px-5 py-2.5 flex items-center justify-between bg-slate-50">
                <span className="text-xs text-slate-500 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400 inline-block" />
                  Kirimba retained fee share
                </span>
                <span className="text-xs font-semibold text-slate-700">{fmt(metrics?.kirimbaRetainedFees)} BIF</span>
              </div>
            </div>
          </Card>

          {/* Cash count form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <Card>
              <div className="px-5 pt-4 pb-5 space-y-4">
                <SectionLabel>Cash Count</SectionLabel>

                <FormInput
                  label="Cash Counted (BIF)"
                  type="number"
                  min="0"
                  value={cashCounted}
                  onChange={(e) => setCashCounted(e.target.value)}
                  placeholder="0"
                  required
                />

                {/* Live difference indicator */}
                {liveDiff !== null && (
                  <DifferenceRow expected={metrics.expectedCashOnHand} counted={cashCountedNum} difference={liveDiff} />
                )}

                <FormTextarea
                  label="Notes (optional)"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Any discrepancies or comments…"
                  rows={2}
                  maxLength={500}
                />
              </div>
            </Card>

            {submitError && <Alert type="error">{submitError}</Alert>}

            <PrimaryButton type="submit" loading={submitting} disabled={cashCounted === ""}>
              Submit Reconciliation
            </PrimaryButton>
          </form>
        </>
      )}

    </PageShell>
  );
}

/* ── DifferenceRow ── */
function DifferenceRow({ expected, counted, difference }) {
  const isExact = difference === 0;
  const isOver  = difference > 0;
  const cls = isExact
    ? "bg-brand-50 border-brand-200 text-brand-700"
    : isOver
    ? "bg-blue-50 border-blue-200 text-blue-700"
    : "bg-red-50 border-red-200 text-red-700";

  const label = isExact ? "Exact match ✓" : isOver ? "Overage" : "Shortage";
  const sign  = isOver ? "+" : "";

  return (
    <div className={`border-2 rounded-2xl px-4 py-3 flex items-center justify-between ${cls}`}>
      <div>
        <p className="text-xs font-bold opacity-80">{label}</p>
        <p className="text-xs opacity-60 mt-0.5">
          {Number(counted).toLocaleString()} − {Number(expected).toLocaleString()}
        </p>
      </div>
      <p className="text-xl font-bold">
        {sign}{Number(difference).toLocaleString()}
        <span className="text-xs font-normal opacity-60 ml-1">BIF</span>
      </p>
    </div>
  );
}

/* ── SuccessView ── */
function SuccessView({ result, date, onResubmit }) {
  const isExact = result.difference === 0;
  const isOver  = result.difference > 0;
  const sign    = result.difference > 0 ? "+" : "";

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-5 py-8 flex flex-col items-center text-center">
          <div className="w-14 h-14 bg-brand-100 rounded-full flex items-center justify-center mb-3">
            <svg className="w-7 h-7 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-base font-bold text-slate-800">Reconciliation Submitted</p>
          <p className="text-xs text-slate-400 mt-1">{formatDate(date)}</p>
        </div>
        <div className="divide-y divide-slate-50">
          <SummaryRow label="Expected Cash on Hand"  value={`${Number(result.expectedCashOnHand ?? result.cashExpected).toLocaleString()} BIF`} />
          <SummaryRow label="Remittance Due"  value={`${Number(result.remittanceDue ?? result.cashExpected).toLocaleString()} BIF`} />
          <SummaryRow label="Cash Counted"   value={`${Number(result.cashCounted).toLocaleString()} BIF`} />
          <SummaryRow
            label="Difference"
            value={`${sign}${Number(result.difference).toLocaleString()} BIF`}
            valueColor={isExact ? "text-brand-700" : isOver ? "text-blue-700" : "text-red-600"}
          />
          <SummaryRow label="Deposits Received" value={`${Number(result.totalDeposits || 0).toLocaleString()} BIF`} />
          <SummaryRow label="Withdrawals Paid" value={`${Number(result.totalWithdrawals || 0).toLocaleString()} BIF`} />
          <SummaryRow label="Customer Fees Posted" value={`${Number(result.customerFeesCollected || 0).toLocaleString()} BIF`} />
          <SummaryRow label="Agent Commission Earned" value={`${Number(result.commissionAccrued).toLocaleString()} BIF`} />
          <SummaryRow label="Kirimba Retained Fee Share" value={`${Number(result.kirimbaRetainedFees || 0).toLocaleString()} BIF`} />
        </div>
      </Card>
      <button
        onClick={onResubmit}
        className="w-full py-3 rounded-2xl border-2 border-slate-100 text-sm font-bold text-slate-400 hover:border-brand-200 hover:text-brand-600 transition-colors"
      >
        Re-submit with corrections
      </button>
    </div>
  );
}

/* ── AlreadySubmittedView ── */
function AlreadySubmittedView({ reconc, date, onResubmit }) {
  const sign      = reconc.difference > 0 ? "+" : "";
  const isExact   = reconc.difference === 0;
  const isOver    = reconc.difference > 0;
  const isReviewed = reconc.status === "reviewed";

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3 bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3">
        <svg className="w-5 h-5 text-brand-500 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <div>
          <p className="text-sm font-bold text-brand-800">Already submitted for {formatDate(date)}</p>
          <p className="text-xs text-brand-600 mt-0.5 capitalize">
            Status: <span className="font-bold">{reconc.status}</span>
            {isReviewed && " — reviewed by admin"}
          </p>
        </div>
      </div>

      <Card>
        <div className="divide-y divide-slate-50">
          <SummaryRow label="Expected Cash on Hand" value={`${Number(reconc.expectedCashOnHand ?? reconc.cashExpected).toLocaleString()} BIF`} />
          <SummaryRow label="Remittance Due" value={`${Number(reconc.remittanceDue ?? reconc.cashExpected).toLocaleString()} BIF`} />
          <SummaryRow label="Cash Counted"  value={`${Number(reconc.cashCounted).toLocaleString()} BIF`} />
          <SummaryRow
            label="Difference"
            value={`${sign}${Number(reconc.difference).toLocaleString()} BIF`}
            valueColor={isExact ? "text-brand-700" : isOver ? "text-blue-700" : "text-red-600"}
          />
          <SummaryRow label="Deposits Received" value={`${Number(reconc.totalDeposits || 0).toLocaleString()} BIF`} />
          <SummaryRow label="Withdrawals Paid" value={`${Number(reconc.totalWithdrawals || 0).toLocaleString()} BIF`} />
          <SummaryRow label="Customer Fees Posted" value={`${Number(reconc.customerFeesCollected || 0).toLocaleString()} BIF`} />
          <SummaryRow label="Agent Commission Earned" value={`${Number(reconc.commissionAccrued).toLocaleString()} BIF`} />
          <SummaryRow label="Kirimba Retained Fee Share" value={`${Number(reconc.kirimbaRetainedFees || 0).toLocaleString()} BIF`} />
          {reconc.notes && (
            <div className="px-5 py-3">
              <p className="text-xs text-slate-400 mb-0.5">Notes</p>
              <p className="text-sm text-slate-700">{reconc.notes}</p>
            </div>
          )}
        </div>
      </Card>

      {!isReviewed && (
        <button
          onClick={onResubmit}
          className="w-full py-3 rounded-2xl border-2 border-slate-100 text-sm font-bold text-slate-400 hover:border-brand-200 hover:text-brand-600 transition-colors"
        >
          Re-submit with corrections
        </button>
      )}
    </div>
  );
}

function SummaryRow({ label, value, valueColor = "text-slate-800" }) {
  return (
    <div className="px-5 py-3 flex items-center justify-between">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-bold ${valueColor}`}>{value}</span>
    </div>
  );
}
