import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { getOfflineDeposits } from "../../services/offlineDeposits";
import { onPendingCountChange, getPendingCount } from "../../services/depositSyncService";
import { PageShell, Card, EmptyState } from "../../components/ui";
import { buildAgentDailyFinanceSummary, todayISO } from "../../utils/agentFinance";

function fmt(n)  { return Number(n || 0).toLocaleString(); }
function fmtTime(date) { return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }

export default function AgentBusinessDashboardScreen({ user }) {
  const [deposits,       setDeposits]      = useState([]);
  const [offlineDeposits,setOfflineDeposits]= useState([]);
  const [ledgerEntries,  setLedgerEntries] = useState([]);
  const [pendingCount,   setPendingCount]  = useState(0);
  const [loading,        setLoading]       = useState(true);
  const [error,          setError]         = useState(null);
  const [lastRefreshed,  setLastRefreshed] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);

    try {
      const [txSnap, allOffline, ledgerSnap] = await Promise.all([
        getDocs(query(collection(db, "transactions"), where("agentId", "==", user.uid))),
        getOfflineDeposits(),
        getDocs(query(collection(db, "agentLedgers"), where("agentId", "==", user.uid))),
      ]);

      const transactions = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const myOffline  = allOffline.filter((d) => d.agentId === user.uid);
      const ledgerEntries = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

      setDeposits(transactions);
      setOfflineDeposits(myOffline);
      setLedgerEntries(ledgerEntries);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    getPendingCount().then(setPendingCount);
    return onPendingCountChange(setPendingCount);
  }, []);

  /* ── Derived metrics ── */
  const financeSummary = buildAgentDailyFinanceSummary({
    transactions: deposits,
    ledgerEntries,
    dateStr: todayISO(),
  });
  const totalDepositCount = financeSummary.deposits.length + offlineDeposits.length;
  const customerFeesCollected = financeSummary.customerFeesCollected;
  const commissionEarned = financeSummary.agentCommissionEarned;
  const kirimbaRetainedFees = financeSummary.kirimbaRetainedFees;
  const remittanceDue = financeSummary.remittanceDue;

  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <PageShell title="Business Dashboard" showBack user={user}>

      {/* ── Date + refresh ── */}
      <div className="flex items-center justify-between px-1">
        <p className="text-xs text-slate-500 font-medium">{today}</p>
        <button
          onClick={loadData}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs font-bold text-brand-600 hover:text-brand-700 disabled:opacity-40 transition-colors"
        >
          <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {lastRefreshed ? fmtTime(lastRefreshed) : "Refresh"}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* ── Metrics grid ── */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          label="Deposits Received"
          value={loading ? null : fmt(financeSummary.totalDeposits)}
          unit="BIF"
          accent="brand"
          sub={offlineDeposits.length > 0 ? `${offlineDeposits.length} offline pending` : `${financeSummary.deposits.length} synced deposits`}
          pulse={offlineDeposits.length > 0}
        />
        <MetricCard
          label="Withdrawals Paid"
          value={loading ? null : fmt(financeSummary.totalWithdrawals)}
          unit="BIF"
          accent={financeSummary.totalWithdrawals > 0 ? "blue" : "slate"}
          sub={financeSummary.withdrawals.length > 0 ? `${financeSummary.withdrawals.length} confirmed withdrawals` : "no withdrawals yet"}
        />
      </div>

      {/* ── Net remit highlight ── */}
      <div className="bg-brand-800 rounded-2xl px-5 py-5 shadow-card-lg">
        <p className="text-xs font-bold uppercase tracking-widest text-brand-300 mb-1">Net Cash To Remit</p>
        {loading ? (
          <div className="h-9 w-36 bg-brand-700 rounded-lg animate-pulse mt-1" />
        ) : (
          <p className="text-3xl font-bold text-white tracking-tight">
            {fmt(remittanceDue)} <span className="text-lg font-normal text-brand-400">BIF</span>
          </p>
        )}
        <p className="text-xs text-brand-400 mt-2">
          Deposits Received − Withdrawals Paid ={" "}
          <span className="text-brand-300">{fmt(financeSummary.totalDeposits)} − {fmt(financeSummary.totalWithdrawals)}</span>
        </p>
        <p className="text-[11px] text-brand-300/80 mt-2">
          Posted fees and commission are tracked separately below and do not change physical cash remittance.
        </p>
      </div>

      <Card>
        <div className="px-5 py-4 border-b border-slate-50">
          <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Fee Revenue</p>
          <p className="mt-1 text-sm text-slate-500">Posted fee and commission reporting for today</p>
        </div>
        <div className="grid grid-cols-2 gap-3 p-4">
          <MetricCard
            label="Pending Sync"
            value={loading ? null : pendingCount}
            unit={pendingCount === 1 ? "deposit" : "deposits"}
            accent={pendingCount > 0 ? "gold" : "slate"}
            sub={pendingCount > 0 ? "awaiting upload" : "all synced"}
            pulse={pendingCount > 0}
          />
          <MetricCard
            label="Customer Fees Posted"
            value={loading ? null : fmt(customerFeesCollected)}
            unit="BIF"
            accent="brand"
            sub={financeSummary.feeEntries.length > 0 ? `${financeSummary.feeEntries.length} recorded fee entries` : "no fee entries yet"}
          />
          <MetricCard
            label="Agent Commission Earned"
            value={loading ? null : fmt(commissionEarned)}
            unit="BIF"
            accent="brand"
            sub={financeSummary.commissionEntries.length > 0 ? `${financeSummary.commissionEntries.length} accrued entries` : "no commission accrued"}
          />
          <MetricCard
            label="Kirimba Retained Fee Share"
            value={loading ? null : fmt(kirimbaRetainedFees)}
            unit="BIF"
            accent="slate"
            sub="Customer fees less agent commission"
          />
        </div>
      </Card>

      {/* ── Empty state ── */}
      {!loading && totalDepositCount === 0 && financeSummary.withdrawals.length === 0 && !error && (
        <Card>
          <EmptyState
            title="No activity recorded today"
            subtitle="Cash movement and fee reporting will appear here once transactions are recorded."
          />
        </Card>
      )}

    </PageShell>
  );
}

/* ── MetricCard ── */
function MetricCard({ label, value, unit, accent, sub, pulse = false }) {
  const styles = {
    brand: { bg: "bg-brand-50 border border-brand-100", val: "text-brand-800", dot: "bg-brand-500" },
    gold:  { bg: "bg-gold-50  border border-gold-100",  val: "text-gold-800",  dot: "bg-gold-500"  },
    blue:  { bg: "bg-blue-50  border border-blue-100",  val: "text-blue-800",  dot: "bg-blue-500"  },
    slate: { bg: "bg-white    border border-slate-100", val: "text-slate-800", dot: "bg-slate-400" },
  };
  const s = styles[accent] || styles.slate;

  return (
    <div className={`rounded-2xl px-4 py-4 flex flex-col gap-2 shadow-card ${s.bg}`}>
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">{label}</p>
        {pulse && (
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s.dot} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${s.dot}`} />
          </span>
        )}
      </div>
      {value === null ? (
        <div className="h-7 w-20 bg-slate-100 rounded-lg animate-pulse" />
      ) : (
        <p className={`text-2xl font-bold leading-tight ${s.val}`}>
          {value} <span className="text-xs font-normal text-slate-400">{unit}</span>
        </p>
      )}
      {sub && value !== null && (
        <p className="text-[11px] text-slate-400">{sub}</p>
      )}
    </div>
  );
}
