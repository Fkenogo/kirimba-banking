import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { getOfflineDeposits } from "../../services/offlineDeposits";
import { onPendingCountChange } from "../../services/depositSyncService";
import { PageShell, Card, SectionLabel, Alert, EmptyState } from "../../components/ui";
import { buildAgentActivityFeed, dayBoundsMs, todayISO, toMillis } from "../../utils/agentFinance";

function shiftISODate(dateStr, deltaDays) {
  const next = new Date(`${dateStr}T00:00:00`);
  next.setDate(next.getDate() + deltaDays);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function formatDateHeading(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateCompact(dateStr) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

function fmt(n) { return Number(n || 0).toLocaleString(); }

function formatTime(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AgentDailySummaryScreen({ user }) {
  const navigate = useNavigate();
  const [selectedDate, setSelectedDate] = useState(todayISO);
  const [transactions, setTransactions] = useState([]);
  const [allOfflineDeposits, setAllOfflineDeposits] = useState([]);
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [submittingGroup, setSubmittingGroup] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);

  const today = todayISO();
  const isTodaySelected = selectedDate === today;
  const canMoveForward = selectedDate < today;
  const dateHeading = formatDateHeading(selectedDate);
  const dateCompact = formatDateCompact(selectedDate);

  async function loadOfflineActivity() {
    if (!user?.uid) return;
    try {
      const all = await getOfflineDeposits();
      setAllOfflineDeposits(all.filter((deposit) => deposit.agentId === user.uid));
    } catch {}
  }

  async function loadActivity() {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);
    try {
      const [txSnap, batchSnap] = await Promise.all([
        getDocs(query(collection(db, "transactions"), where("agentId", "==", user.uid))),
        getDocs(query(collection(db, "depositBatches"), where("agentId", "==", user.uid))),
      ]);

      const { startMs, endMs } = dayBoundsMs(selectedDate);
      const nextTransactions = txSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((row) => {
          const createdAtMs = toMillis(row.createdAt);
          return createdAtMs >= startMs && createdAtMs < endMs;
        })
        .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
      setTransactions(nextTransactions);

      const nextBatches = batchSnap.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((batch) => {
          const activityMs = toMillis(batch.submittedAt) || toMillis(batch.createdAt);
          return activityMs >= startMs && activityMs < endMs;
        });
      nextBatches.sort((a, b) => (toMillis(b.submittedAt) || toMillis(b.createdAt)) - (toMillis(a.submittedAt) || toMillis(a.createdAt)));
      setBatches(nextBatches);
    } catch (err) {
      setError(err.message || "Failed to load activity data.");
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
      await loadActivity();
    } catch (err) {
      setSubmitError(err.message || "Failed to submit batch.");
    } finally {
      setSubmittingGroup(null);
    }
  }

  useEffect(() => {
    loadActivity();
  }, [user?.uid, selectedDate]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadOfflineActivity();
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return onPendingCountChange(() => {
      loadOfflineActivity();
    });
  }, [user?.uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const offlineDeposits = useMemo(() => {
    const { startMs, endMs } = dayBoundsMs(selectedDate);
    return allOfflineDeposits
      .filter((deposit) => {
        const createdAtMs = toMillis(deposit.createdAt);
        return createdAtMs >= startMs && createdAtMs < endMs;
      })
      .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
  }, [allOfflineDeposits, selectedDate]);

  const deposits = useMemo(
    () => transactions.filter((row) => row.type === "deposit"),
    [transactions]
  );
  const withdrawals = useMemo(
    () => transactions.filter((row) => row.type === "withdrawal"),
    [transactions]
  );
  const repayments = useMemo(
    () => transactions.filter((row) => row.type === "loan_repay"),
    [transactions]
  );
  const activityFeed = useMemo(
    () => buildAgentActivityFeed({ transactions, batches, dateStr: selectedDate }),
    [transactions, batches, selectedDate]
  );

  const onlineTotal = deposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const offlineTotal = offlineDeposits.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
  const grandTotal = onlineTotal + offlineTotal;

  const unbatchedByGroup = deposits
    .filter((deposit) => !deposit.batchId && deposit.status === "pending_confirmation")
    .reduce((acc, deposit) => {
      if (!deposit.groupId) return acc;
      if (!acc[deposit.groupId]) acc[deposit.groupId] = [];
      acc[deposit.groupId].push(deposit);
      return acc;
    }, {});
  const groupsWithUnbatched = Object.keys(unbatchedByGroup);

  const flaggedBatches = batches.filter((batch) => batch.status === "flagged");
  const submittedBatches = batches.filter((batch) => batch.status === "submitted");
  const confirmedBatches = batches.filter((batch) => batch.status === "confirmed");
  const hasAnyActivity = transactions.length > 0 || offlineDeposits.length > 0 || batches.length > 0;

  return (
    <PageShell title="Activity" user={user}>
      <Card>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Selected date</p>
              <p className="mt-1 text-base font-bold text-slate-900">{dateHeading}</p>
              <p className="mt-1 text-xs text-slate-500">
                {isTodaySelected ? "Live operational activity for today." : "Historical activity is review-only."}
              </p>
            </div>
            <input
              type="date"
              max={today}
              value={selectedDate}
              onChange={(event) => setSelectedDate(event.target.value)}
              className="text-xs text-slate-600 border-2 border-slate-100 rounded-xl px-3 py-2 bg-slate-50 focus:outline-none focus:border-brand-400 transition-colors"
            />
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setSelectedDate((current) => shiftISODate(current, -1))}
              className="rounded-2xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              disabled={isTodaySelected}
              className="rounded-2xl border-2 border-brand-100 bg-white px-3 py-2.5 text-sm font-bold text-brand-600 transition-colors hover:bg-brand-50 disabled:opacity-50"
            >
              Today
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate((current) => shiftISODate(current, 1))}
              disabled={!canMoveForward}
              className="rounded-2xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </Card>

      {!loading && !isTodaySelected ? (
        <Alert type="warning">
          Historical activity is review-only. Batch submission is available only for today&apos;s deposits.
        </Alert>
      ) : null}

      {!loading && (
        <div className="space-y-2">
          <SectionLabel>{isTodaySelected ? "Today&apos;s Summary" : `Summary for ${dateCompact}`}</SectionLabel>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard
              label="Deposits"
              value={deposits.length + offlineDeposits.length}
              sublabel={`${fmt(grandTotal)} BIF`}
              accent={deposits.length > 0 || offlineDeposits.length > 0 ? "brand" : "slate"}
            />
            <SummaryCard
              label="Pending Sync"
              value={offlineDeposits.length}
              sublabel={offlineDeposits.length === 1 ? "deposit" : "deposits"}
              accent={offlineDeposits.length > 0 ? "gold" : "slate"}
            />
            <SummaryCard
              label="Withdrawals"
              value={withdrawals.length}
              sublabel={withdrawals.length === 1 ? "confirmed payout" : "confirmed payouts"}
              accent={withdrawals.length > 0 ? "blue" : "slate"}
            />
            <SummaryCard
              label="Ready to Submit"
              value={groupsWithUnbatched.length}
              sublabel={groupsWithUnbatched.length === 1 ? "batch" : "batches"}
              accent={groupsWithUnbatched.length > 0 ? "brand" : "slate"}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <SummaryCard
              label="Awaiting Confirm"
              value={submittedBatches.length}
              sublabel={submittedBatches.length === 1 ? "batch" : "batches"}
              accent={submittedBatches.length > 0 ? "blue" : "slate"}
            />
            <SummaryCard
              label="Repayments"
              value={repayments.length}
              sublabel={repayments.length === 1 ? "loan repayment" : "loan repayments"}
              accent={repayments.length > 0 ? "gold" : "slate"}
            />
          </div>
        </div>
      )}

      {error ? <Alert type="error">{error}</Alert> : null}

      {submitError ? (
        <Alert type="error">
          <div className="flex justify-between gap-2">
            <span>{submitError}</span>
            <button onClick={() => setSubmitError(null)} className="shrink-0 text-red-400">×</button>
          </div>
        </Alert>
      ) : null}

      {submitSuccess ? (
        <Alert type="success">
          <div className="flex justify-between gap-2">
            <span>Batch submitted! ID: <span className="font-mono text-xs">{submitSuccess.batchId?.slice(0, 12)}…</span></span>
            <button onClick={() => setSubmitSuccess(null)} className="shrink-0 text-brand-400">×</button>
          </div>
        </Alert>
      ) : null}

      {!loading && (flaggedBatches.length > 0 || groupsWithUnbatched.length > 0) ? (
        <div className="space-y-3">
          <SectionLabel>{isTodaySelected ? "Action Required" : "Review Notes"}</SectionLabel>

          {flaggedBatches.map((batch) => (
            <div key={batch.id} className="bg-red-50 border border-red-200 rounded-2xl px-4 py-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <p className="text-sm font-bold text-red-800">Batch Flagged by Institution</p>
                <span className="text-[10px] font-mono text-red-400">{batch.id.slice(0, 8)}…</span>
              </div>
              <p className="text-xs text-red-600">{fmt(batch.totalAmount)} BIF · {batch.memberCount} member{batch.memberCount !== 1 ? "s" : ""}</p>
              {(batch.institutionNotes || batch.umucoNotes) ? (
                <p className="text-xs text-red-700 bg-white border border-red-100 rounded-xl px-3 py-2 mt-2">
                  {batch.institutionNotes || batch.umucoNotes}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => navigate(`/agent/activity/batches/${batch.id}`)}
                className="mt-3 text-xs font-bold text-red-700 border border-red-200 bg-white rounded-xl px-3 py-2 hover:bg-red-100 transition-colors"
              >
                View Batch Detail
              </button>
            </div>
          ))}

          {groupsWithUnbatched.map((groupId) => {
            const transactions = unbatchedByGroup[groupId];
            const total = transactions.reduce((sum, deposit) => sum + Number(deposit.amount || 0), 0);
            const isBusy = submittingGroup === groupId;
            return (
              <Card key={groupId}>
                <div className="px-4 py-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-slate-800">
                      {transactions.length} deposit{transactions.length !== 1 ? "s" : ""} {isTodaySelected ? "ready" : "recorded"}
                    </p>
                    <p className="text-xs font-mono text-brand-600 truncate mt-0.5">{groupId}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {fmt(total)} BIF
                      {!isTodaySelected ? " · Review only" : ""}
                    </p>
                  </div>
                  {isTodaySelected ? (
                    <button
                      type="button"
                      disabled={isBusy || !!submittingGroup}
                      onClick={() => handleSubmitBatch(groupId, transactions.map((transaction) => transaction.id))}
                      className="shrink-0 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-colors"
                    >
                      {isBusy ? "Submitting…" : "Submit Batch"}
                    </button>
                  ) : (
                    <span className="shrink-0 text-[10px] font-bold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-full uppercase tracking-wide">
                      Review Only
                    </span>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      ) : null}

      {!loading && (submittedBatches.length > 0 || confirmedBatches.length > 0) ? (
        <div className="space-y-3">
          <SectionLabel>Deposit Batches</SectionLabel>

          {submittedBatches.map((batch) => (
            <div key={batch.id} className="bg-blue-50 border border-blue-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-blue-900">{fmt(batch.totalAmount)} BIF · {batch.memberCount} member{batch.memberCount !== 1 ? "s" : ""}</p>
                <p className="text-[10px] font-mono text-blue-400 mt-0.5">{batch.id.slice(0, 12)}…</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/agent/activity/batches/${batch.id}`)}
                  className="text-[10px] font-bold bg-white text-blue-700 px-2.5 py-1.5 rounded-full uppercase tracking-wide border border-blue-200"
                >
                  Detail
                </button>
                <span className="text-[10px] font-bold bg-blue-100 text-blue-600 px-2.5 py-1 rounded-full uppercase tracking-wide">Pending</span>
              </div>
            </div>
          ))}

          {confirmedBatches.map((batch) => (
            <div key={batch.id} className="bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-brand-900">{fmt(batch.totalAmount)} BIF · {batch.memberCount} member{batch.memberCount !== 1 ? "s" : ""}</p>
                <p className="text-[10px] font-mono text-brand-400 mt-0.5">{batch.id.slice(0, 12)}…</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/agent/activity/batches/${batch.id}`)}
                  className="text-[10px] font-bold bg-white text-brand-700 px-2.5 py-1.5 rounded-full uppercase tracking-wide border border-brand-200"
                >
                  Detail
                </button>
                <span className="text-[10px] font-bold bg-brand-100 text-brand-600 px-2.5 py-1 rounded-full uppercase tracking-wide">Confirmed</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && (deposits.length > 0 || offlineDeposits.length > 0) ? (
        <div className="space-y-3">
          <SectionLabel>Deposit Records</SectionLabel>

          {deposits.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-wide px-1">Synced Deposits ({deposits.length})</p>
              <Card>
                <div className="divide-y divide-slate-50">
                  {deposits.map((deposit) => (
                    <TransactionRow
                      key={deposit.id}
                      name={deposit.memberName ?? deposit.memberId ?? deposit.userId}
                      memberId={deposit.memberId}
                      amount={deposit.amount}
                      time={formatTime(deposit.createdAt)}
                      type="deposit"
                      offline={false}
                    />
                  ))}
                </div>
              </Card>
            </div>
          ) : null}

          {offlineDeposits.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-bold text-gold-500 uppercase tracking-wide px-1">Pending Sync ({offlineDeposits.length})</p>
              <Card>
                <div className="divide-y divide-slate-50">
                  {offlineDeposits.map((deposit) => (
                    <TransactionRow
                      key={deposit.localId}
                      name={deposit.memberId}
                      memberId={deposit.memberId}
                      amount={deposit.amount}
                      time={deposit.createdAt ? new Date(deposit.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}
                      type="deposit"
                      offline
                    />
                  ))}
                </div>
              </Card>
            </div>
          ) : null}
        </div>
      ) : null}

      {!loading && activityFeed.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Daily Activity Feed</SectionLabel>
          <Card>
            <div className="divide-y divide-slate-50">
              {activityFeed.map((entry) => (
                <ActivityFeedRow key={entry.id} entry={entry} />
              ))}
            </div>
          </Card>
        </div>
      ) : null}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          <div className="grid grid-cols-2 gap-3">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-20 bg-white rounded-2xl shadow-card" />
            ))}
          </div>
          {[...Array(3)].map((_, index) => (
            <div key={index} className="h-16 bg-white rounded-2xl shadow-card" />
          ))}
        </div>
      ) : null}

      {!loading && !hasAnyActivity ? (
        <Card>
          <EmptyState
            title={isTodaySelected ? "No activity today" : `No activity on ${dateCompact}`}
            subtitle={
              isTodaySelected
                ? "Transactions you record will appear here."
                : "There were no recorded transactions or batches for this date."
            }
          />
        </Card>
      ) : null}

      {!loading && (deposits.length > 0 || offlineDeposits.length > 0) ? (
        <div className="fixed bottom-16 left-0 right-0 z-30 px-4 pb-2">
          <div className="max-w-lg mx-auto bg-brand-500 rounded-2xl px-5 py-3 shadow-card-lg">
            <div className="flex items-center justify-between">
              <div>
                {offlineDeposits.length > 0 ? (
                  <div className="flex gap-3 text-xs text-brand-100 mb-0.5">
                    <span>Synced: {fmt(onlineTotal)}</span>
                    <span>· Offline: {fmt(offlineTotal)}</span>
                  </div>
                ) : null}
                <p className="text-xs text-brand-200 font-medium">{isTodaySelected ? "Total Today" : `Total for ${dateCompact}`}</p>
              </div>
              <p className="text-xl font-bold text-white">
                {fmt(grandTotal)} <span className="text-sm font-normal text-brand-200">BIF</span>
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function SummaryCard({ label, value, sublabel, accent = "slate" }) {
  const bgClass = {
    brand: "bg-brand-50 border-brand-100",
    gold: "bg-gold-50 border-gold-200",
    blue: "bg-blue-50 border-blue-100",
    slate: "bg-slate-50 border-slate-100",
  }[accent];

  const valueClass = {
    brand: "text-brand-600",
    gold: "text-gold-600",
    blue: "text-blue-600",
    slate: "text-slate-500",
  }[accent];

  const labelClass = {
    brand: "text-brand-700",
    gold: "text-gold-700",
    blue: "text-blue-700",
    slate: "text-slate-500",
  }[accent];

  return (
    <div className={`${bgClass} border rounded-2xl px-4 py-3 text-center`}>
      <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
      <p className={`text-xs font-semibold ${labelClass} mt-0.5`}>{label}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>
    </div>
  );
}

function TransactionRow({ name, memberId, amount, time, type, offline }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
          {offline ? (
            <span className="text-[9px] font-bold bg-gold-100 text-gold-600 px-1.5 py-0.5 rounded-full uppercase">
              Offline
            </span>
          ) : null}
        </div>
        {memberId && memberId !== name ? (
          <p className="text-xs font-mono text-brand-600 mt-0.5">{memberId}</p>
        ) : null}
        <p className="text-xs text-slate-400 mt-0.5">{time}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-slate-800">
          {fmt(amount)} <span className="text-xs font-normal text-slate-400">BIF</span>
        </p>
        <p className="text-[10px] text-slate-400 uppercase tracking-wide mt-0.5">{type}</p>
      </div>
    </div>
  );
}

function ActivityFeedRow({ entry }) {
  const toneClasses = {
    brand: "bg-brand-50 text-brand-700 border-brand-100",
    blue: "bg-blue-50 text-blue-700 border-blue-100",
    gold: "bg-gold-50 text-gold-700 border-gold-100",
    red: "bg-red-50 text-red-700 border-red-100",
    slate: "bg-slate-50 text-slate-600 border-slate-100",
  };
  const tone = toneClasses[entry.tone] || toneClasses.slate;

  return (
    <div className="px-5 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tone}`}>
            {entry.label}
          </span>
          {entry.status ? (
            <span className="text-[10px] uppercase tracking-wide text-slate-400">{String(entry.status).replace(/_/g, " ")}</span>
          ) : null}
        </div>
        <p className="mt-1 text-sm font-semibold text-slate-800 truncate">{entry.memberName}</p>
        <p className="mt-0.5 text-xs text-slate-400">{entry.reference}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-slate-900">
          {fmt(entry.amount)} <span className="text-xs font-normal text-slate-400">BIF</span>
        </p>
        <p className="mt-0.5 text-xs text-slate-400">{formatTime(entry.createdAt)}</p>
      </div>
    </div>
  );
}
