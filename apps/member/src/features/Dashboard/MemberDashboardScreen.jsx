import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../services/firebase";

function formatBIF(amount) {
  return `${Number(amount || 0).toLocaleString("en-US")} BIF`;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const TRANSACTION_LABELS = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  loan_disburse: "Loan Out",
  loan_repay: "Loan Repayment",
};

const STATUS_CLASSES = {
  confirmed: "text-green-700 bg-green-50",
  pending_confirmation: "text-yellow-700 bg-yellow-50",
  pending_approval: "text-yellow-700 bg-yellow-50",
  pending: "text-yellow-700 bg-yellow-50",
  submitted: "text-blue-700 bg-blue-50",
  active: "text-blue-700 bg-blue-50",
  rejected: "text-red-600 bg-red-50",
  flagged: "text-red-700 bg-red-50",
};

export default function MemberDashboardScreen({ user }) {
  const [wallet, setWallet] = useState(null);
  const [activeLoan, setActiveLoan] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    let unsubWallet;

    async function load() {
      try {
        // Wallet — real-time subscription
        unsubWallet = onSnapshot(
          doc(db, "wallets", user.uid),
          (snap) => setWallet(snap.exists() ? snap.data() : null),
          (err) => setError(err.message)
        );

        // Active / pending loans
        const loansSnap = await getDocs(
          query(
            collection(db, "loans"),
            where("userId", "==", user.uid),
            where("status", "in", ["active", "pending"])
          )
        );
        const loans = loansSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setActiveLoan(loans.find((l) => l.status === "active") || loans[0] || null);

        // Recent transactions
        const txSnap = await getDocs(
          query(
            collection(db, "transactions"),
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc"),
            limit(10)
          )
        );
        setTransactions(txSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Group membership with defensive fallback for legacy leader records.
        let groupId = null;
        const gmSnap = await getDoc(doc(db, "groupMembers", user.uid));
        if (gmSnap.exists()) {
          groupId = gmSnap.data()?.groupId || null;
        } else {
          const userSnap = await getDoc(doc(db, "users", user.uid));
          if (userSnap.exists()) {
            const userData = userSnap.data() || {};
            groupId = userData.groupId || userData.ledGroupId || null;
          }
        }

        if (groupId) {
          const groupSnap = await getDoc(doc(db, "groups", groupId));
          if (groupSnap.exists()) {
            setGroup({ id: groupSnap.id, ...groupSnap.data() });
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
    return () => unsubWallet?.();
  }, [user?.uid]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <p className="text-sm text-slate-500">Loading dashboard...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <p className="text-sm text-red-600">Error: {error}</p>
      </main>
    );
  }

  const creditLimit = Math.max(0, Number(wallet?.balanceConfirmed || 0) * 1.5 - Number(wallet?.balanceLocked || 0));

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Dashboard</h1>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{user.email}</p>
        </div>

        {/* Savings Cards */}
        <section className="mb-6">
          <SectionTitle>Savings</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <SavingsCard label="Confirmed" value={wallet?.balanceConfirmed} color="green" />
            <SavingsCard label="Pending" value={wallet?.balancePending} color="yellow" />
            <SavingsCard label="Locked" value={wallet?.balanceLocked} color="red" />
            <SavingsCard label="Available" value={wallet?.availableBalance} color="blue" />
          </div>
          <div className="mt-3 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 flex justify-between items-center">
            <span className="text-sm text-indigo-700 font-medium">Credit Limit</span>
            <span className="text-sm font-bold text-indigo-900">{formatBIF(creditLimit)}</span>
          </div>
        </section>

        {/* Active Loan */}
        {activeLoan && (
          <section className="mb-6">
            <SectionTitle>Active Loan</SectionTitle>
            <div className="rounded-xl bg-white border border-slate-200 px-4 py-4 space-y-2.5">
              <Row label="Amount" value={formatBIF(activeLoan.amount)} />
              <Row label="Remaining" value={formatBIF(activeLoan.remainingDue)} />
              <Row label="Due Date" value={formatDate(activeLoan.dueDate)} />
              <div className="pt-1">
                <StatusBadge status={activeLoan.status} />
              </div>
            </div>
          </section>
        )}

        {/* Group */}
        {group && (
          <section className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Group</h2>
              <Link
                to="/app/savings"
                className="text-xs text-blue-600 hover:text-blue-700 font-medium"
              >
                View savings goal →
              </Link>
            </div>
            <div className="rounded-xl bg-white border border-slate-200 px-4 py-4 space-y-2.5">
              <Row label="Name" value={group.name} />
              <Row label="Total Savings" value={formatBIF(group.totalSavings)} />
            </div>
          </section>
        )}

        {/* Recent Transactions */}
        <section className="mb-6">
          <SectionTitle>Recent Transactions</SectionTitle>
          {transactions.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No transactions yet.</p>
          ) : (
            <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
              {transactions.map((tx) => (
                <div key={tx.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {TRANSACTION_LABELS[tx.type] || tx.type}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(tx.createdAt)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <span className="text-sm font-semibold text-slate-900">{formatBIF(tx.amount)}</span>
                    <StatusBadge status={tx.status} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

      </div>
    </main>
  );
}

function SectionTitle({ children }) {
  return (
    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
      {children}
    </h2>
  );
}

function SavingsCard({ label, value, color }) {
  const colorMap = {
    green: "bg-green-50 border-green-100 text-green-900",
    yellow: "bg-yellow-50 border-yellow-100 text-yellow-900",
    red: "bg-red-50 border-red-100 text-red-900",
    blue: "bg-blue-50 border-blue-100 text-blue-900",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 ${colorMap[color]}`}>
      <p className="text-xs font-medium opacity-60 mb-1">{label}</p>
      <p className="text-xl font-bold leading-tight">
        {Number(value || 0).toLocaleString("en-US")}
      </p>
      <p className="text-xs opacity-50 mt-0.5">BIF</p>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-900">{value}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = STATUS_CLASSES[status] || "text-slate-600 bg-slate-100";
  const label = status?.replace(/_/g, " ") || "—";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${cls}`}>
      {label}
    </span>
  );
}
