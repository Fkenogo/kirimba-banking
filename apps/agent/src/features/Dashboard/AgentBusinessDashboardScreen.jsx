import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, query, Timestamp, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { getOfflineDeposits } from "../../services/offlineDeposits";
import { onPendingCountChange, getPendingCount } from "../../services/depositSyncService";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

function formatAmount(n) {
  return Number(n || 0).toLocaleString();
}

function formatTime(date) {
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default function AgentBusinessDashboardScreen({ user }) {
  const [deposits, setDeposits] = useState([]);
  const [offlineDeposits, setOfflineDeposits] = useState([]);
  const [ledgerEntries, setLedgerEntries] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefreshed, setLastRefreshed] = useState(null);

  const loadData = useCallback(async () => {
    if (!user?.uid) return;
    setLoading(true);
    setError(null);

    const todayMs = startOfToday().toMillis();

    try {
      // All three queries use single-field where (agentId) — no composite index needed.
      // Client-side filtering handles date range and type.
      const [txSnap, allOffline, ledgerSnap] = await Promise.all([
        getDocs(
          query(collection(db, "transactions"), where("agentId", "==", user.uid))
        ),
        getOfflineDeposits(),
        getDocs(
          query(collection(db, "agentLedgers"), where("agentId", "==", user.uid))
        ),
      ]);

      const todayDeposits = txSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter(
          (d) =>
            d.type === "deposit" &&
            (d.createdAt?.toMillis?.() ?? 0) >= todayMs
        );

      const myOffline = allOffline.filter((d) => d.agentId === user.uid);

      const todayLedger = ledgerSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((d) => (d.createdAt?.toMillis?.() ?? 0) >= todayMs);

      setDeposits(todayDeposits);
      setOfflineDeposits(myOffline);
      setLedgerEntries(todayLedger);
      setLastRefreshed(new Date());
    } catch (err) {
      setError(err.message || "Failed to load dashboard data.");
    } finally {
      setLoading(false);
    }
  }, [user?.uid]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Keep pending-sync badge in sync with the background sync service
  useEffect(() => {
    getPendingCount().then(setPendingCount);
    return onPendingCountChange(setPendingCount);
  }, []);

  // --- Derived metrics ---
  const totalDepositCount = deposits.length + offlineDeposits.length;

  const cashCollected =
    deposits.reduce((s, d) => s + Number(d.amount || 0), 0) +
    offlineDeposits.reduce((s, d) => s + Number(d.amount || 0), 0);

  const commissionEarned = ledgerEntries
    .filter((e) => e.type === "commission")
    .reduce((s, e) => s + Number(e.amount || 0), 0);

  const netRemit = cashCollected - commissionEarned;

  const today = new Date().toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Business Dashboard</h1>
            <p className="text-xs text-slate-400 mt-0.5">{today}</p>
          </div>
          <button
            onClick={loadData}
            disabled={loading}
            className="shrink-0 flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 disabled:opacity-40 transition-colors mt-0.5"
            aria-label="Refresh dashboard"
          >
            <RefreshIcon spinning={loading} />
            {lastRefreshed ? formatTime(lastRefreshed) : "Refresh"}
          </button>
        </div>
      </header>

      <div className="flex-1 max-w-md mx-auto w-full px-4 pt-5 pb-10 space-y-4">
        {/* Error banner */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        {/* 2-column metric grid */}
        <div className="grid grid-cols-2 gap-3">
          <MetricCard
            label="Deposits Today"
            value={loading ? null : totalDepositCount}
            unit={totalDepositCount === 1 ? "deposit" : "deposits"}
            accent="indigo"
            icon={<DepositIcon />}
            sub={
              offlineDeposits.length > 0
                ? `${offlineDeposits.length} offline`
                : `${deposits.length} synced`
            }
          />

          <MetricCard
            label="Pending Sync"
            value={loading ? null : pendingCount}
            unit={pendingCount === 1 ? "deposit" : "deposits"}
            accent={pendingCount > 0 ? "amber" : "slate"}
            icon={<SyncIcon />}
            sub={pendingCount > 0 ? "awaiting upload" : "all synced"}
            pulse={pendingCount > 0}
          />

          <MetricCard
            label="Commission Earned"
            value={loading ? null : `${formatAmount(commissionEarned)}`}
            unit="BIF"
            accent="emerald"
            icon={<CommissionIcon />}
            sub={`${ledgerEntries.filter((e) => e.type === "commission").length} entries`}
          />

          <MetricCard
            label="Cash Collected"
            value={loading ? null : `${formatAmount(cashCollected)}`}
            unit="BIF"
            accent="blue"
            icon={<CashIcon />}
            sub={`${totalDepositCount} member${totalDepositCount !== 1 ? "s" : ""}`}
          />
        </div>

        {/* Net Remit — full-width highlight card */}
        <div className="bg-slate-800 rounded-2xl px-5 py-5 shadow-sm">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
            Net Remit Estimate
          </p>
          {loading ? (
            <div className="h-9 w-36 bg-slate-700 rounded-lg animate-pulse mt-1" />
          ) : (
            <p className="text-3xl font-bold text-white tracking-tight">
              {formatAmount(netRemit)}{" "}
              <span className="text-lg font-normal text-slate-400">BIF</span>
            </p>
          )}
          <p className="text-xs text-slate-500 mt-2">
            Cash Collected − Commission ={" "}
            <span className="text-slate-400">
              {formatAmount(cashCollected)} − {formatAmount(commissionEarned)}
            </span>
          </p>
        </div>

        {/* Empty-state nudge when nothing recorded yet */}
        {!loading && totalDepositCount === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
              <svg className="w-6 h-6 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-3-3v6M3 12a9 9 0 1118 0A9 9 0 013 12z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-500">No activity recorded today</p>
            <p className="text-xs text-slate-400 mt-1">Deposits will appear here once recorded.</p>
          </div>
        )}
      </div>
    </main>
  );
}

// --- Sub-components ---

function MetricCard({ label, value, unit, accent, icon, sub, pulse = false }) {
  const accentStyles = {
    indigo: {
      bg: "bg-indigo-50",
      icon: "text-indigo-500",
      value: "text-indigo-900",
      dot: "bg-indigo-500",
    },
    amber: {
      bg: "bg-amber-50",
      icon: "text-amber-500",
      value: "text-amber-900",
      dot: "bg-amber-500",
    },
    emerald: {
      bg: "bg-emerald-50",
      icon: "text-emerald-600",
      value: "text-emerald-900",
      dot: "bg-emerald-500",
    },
    blue: {
      bg: "bg-blue-50",
      icon: "text-blue-500",
      value: "text-blue-900",
      dot: "bg-blue-500",
    },
    slate: {
      bg: "bg-slate-50",
      icon: "text-slate-400",
      value: "text-slate-700",
      dot: "bg-slate-400",
    },
  };

  const s = accentStyles[accent] ?? accentStyles.slate;

  return (
    <div className={`${s.bg} rounded-2xl px-4 py-4 flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className={`${s.icon} w-5 h-5`}>{icon}</span>
        {pulse && (
          <span className="relative flex h-2 w-2">
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${s.dot} opacity-60`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${s.dot}`} />
          </span>
        )}
      </div>
      <div>
        <p className="text-[11px] font-medium text-slate-500 leading-tight">{label}</p>
        {value === null ? (
          <div className="h-7 w-20 bg-slate-200 rounded animate-pulse mt-1" />
        ) : (
          <p className={`text-2xl font-bold ${s.value} leading-tight mt-0.5`}>
            {value}{" "}
            <span className="text-xs font-normal text-slate-400">{unit}</span>
          </p>
        )}
        {sub && value !== null && (
          <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
        )}
      </div>
    </div>
  );
}

function RefreshIcon({ spinning }) {
  return (
    <svg
      className={`w-3.5 h-3.5 ${spinning ? "animate-spin" : ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function DepositIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
}

function SyncIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}

function CommissionIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CashIcon() {
  return (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}
