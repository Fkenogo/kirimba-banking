import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, limit,
  onSnapshot, orderBy, query, where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import TopHeader from "../../components/TopHeader";
import BottomNav from "../../components/BottomNav";

const BASE = "/app";

function formatBIF(amount) {
  return Number(amount || 0).toLocaleString("en-US");
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const TRANSACTION_LABELS = {
  deposit:     { label: "Deposit",          color: "text-brand-600", sign: "+" },
  withdrawal:  { label: "Withdrawal",       color: "text-red-500",   sign: "-" },
  loan_disburse:{ label: "Loan Disbursed",  color: "text-gold-600",  sign: "+" },
  loan_repay:  { label: "Loan Repayment",   color: "text-slate-600", sign: "-" },
};

const STATUS_STYLES = {
  confirmed:           { bg: "bg-brand-50",  text: "text-brand-700",  label: "Confirmed"   },
  pending_confirmation:{ bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"     },
  pending_approval:    { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"     },
  pending:             { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"     },
  submitted:           { bg: "bg-blue-50",   text: "text-blue-700",   label: "Submitted"   },
  active:              { bg: "bg-brand-50",  text: "text-brand-700",  label: "Active"      },
  rejected:            { bg: "bg-red-50",    text: "text-red-600",    label: "Rejected"    },
  flagged:             { bg: "bg-red-50",    text: "text-red-700",    label: "Flagged"     },
};

function StatusBadge({ status }) {
  const s = STATUS_STYLES[status] || { bg: "bg-slate-100", text: "text-slate-600", label: status };
  return (
    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── Savings progress bar card ────────────────────────────────────────────────
function SavingsBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-xs text-slate-500 font-medium">{label}</span>
        <span className="text-xs font-bold text-slate-700">{formatBIF(value)} BIF</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function MemberDashboardScreen({ user }) {
  const [wallet, setWallet]         = useState(null);
  const [activeLoan, setActiveLoan] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [group, setGroup]           = useState(null);
  const [userName, setUserName]     = useState("");
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    let unsubWallet;

    async function load() {
      try {
        // User name
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) setUserName(userSnap.data().fullName || "");

        // Wallet — real-time
        unsubWallet = onSnapshot(
          doc(db, "wallets", user.uid),
          (snap) => setWallet(snap.exists() ? snap.data() : null),
          (err) => setError(err.message)
        );

        // Active loan
        const loansSnap = await getDocs(
          query(collection(db, "loans"), where("userId", "==", user.uid), where("status", "in", ["active", "pending"]))
        );
        const loans = loansSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setActiveLoan(loans.find((l) => l.status === "active") || loans[0] || null);

        // Transactions
        const txSnap = await getDocs(
          query(collection(db, "transactions"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(10))
        );
        setTransactions(txSnap.docs.map((d) => ({ id: d.id, ...d.data() })));

        // Group
        let groupId = null;
        const gmSnap = await getDoc(doc(db, "groupMembers", user.uid));
        if (gmSnap.exists()) {
          groupId = gmSnap.data()?.groupId || null;
        } else {
          const uSnap = await getDoc(doc(db, "users", user.uid));
          if (uSnap.exists()) {
            const ud = uSnap.data() || {};
            groupId = ud.groupId || ud.ledGroupId || null;
          }
        }
        if (groupId) {
          const groupSnap = await getDoc(doc(db, "groups", groupId));
          if (groupSnap.exists()) setGroup({ id: groupSnap.id, ...groupSnap.data() });
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

  const confirmed   = Number(wallet?.balanceConfirmed || 0);
  const pending     = Number(wallet?.balancePending   || 0);
  const locked      = Number(wallet?.balanceLocked    || 0);
  const available   = Number(wallet?.availableBalance || 0);
  const creditLimit = Math.max(0, confirmed * 1.5 - locked);

  const hasNoSavings = confirmed === 0 && pending === 0;
  const hasNoActivity = transactions.length === 0 && confirmed === 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-brand-50 flex flex-col">
        <TopHeader title="Account" userName={userName} showNotif showProfile />
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
            <p className="text-sm text-slate-400 font-medium">Loading your account…</p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-brand-50 flex flex-col">
        <TopHeader title="Account" userName={userName} showNotif showProfile />
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="bg-red-50 border border-red-200 rounded-2xl px-5 py-4 max-w-sm w-full text-center">
            <p className="text-red-600 text-sm font-medium">{error}</p>
          </div>
        </div>
        <BottomNav />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col">
      <TopHeader title="Account" userName={userName} showNotif showProfile />

      <main className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">

          {/* ── Main balance card ── */}
          <div className="bg-brand-500 rounded-2xl px-5 py-6 text-white shadow-card-lg relative overflow-hidden">
            <div className="absolute -top-8 -right-8 w-32 h-32 bg-brand-400 rounded-full opacity-30" />
            <div className="absolute -bottom-6 -left-4 w-20 h-20 bg-gold-500 rounded-full opacity-20" />
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-100 mb-0.5">Available Balance</p>
            <p className="text-xs text-brand-200 mb-2">Money you can withdraw or use for loans</p>
            <p className="text-4xl font-extrabold tracking-tight">
              {formatBIF(available)}
              <span className="text-lg font-medium text-brand-200 ml-2">BIF</span>
            </p>
            <div className="mt-4 h-px bg-white bg-opacity-20" />
            <div className="mt-3 flex justify-between">
              <div>
                <p className="text-[10px] text-brand-200 uppercase tracking-wide">Credit Limit</p>
                <p className="text-base font-bold">{formatBIF(creditLimit)} BIF</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-brand-200 uppercase tracking-wide">Locked</p>
                <p className="text-base font-bold">{formatBIF(locked)} BIF</p>
              </div>
            </div>
          </div>

          {/* ── First deposit CTA (if no savings) ── */}
          {hasNoSavings && (
            <Link
              to={`${BASE}/deposit`}
              className="flex items-center gap-3 bg-gradient-to-r from-brand-50 to-brand-100 border-2 border-brand-200 rounded-2xl px-5 py-4 shadow-card hover:from-brand-100 hover:to-brand-150 active:scale-[0.98] transition-all"
            >
              <div className="w-11 h-11 bg-brand-400 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-brand-800 leading-tight">Make Your First Deposit</p>
                <p className="text-xs text-brand-600 mt-0.5">Start saving to unlock loans and group benefits</p>
              </div>
              <svg className="w-5 h-5 text-brand-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {/* ── Savings breakdown ── */}
          <div className="bg-white rounded-2xl border border-brand-100 px-5 py-4 shadow-card space-y-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Your Savings</p>
              <p className="text-xs text-slate-400 mt-1">How your total savings are allocated</p>
            </div>
            <SavingsBar
              label="Confirmed Savings"
              value={confirmed}
              max={Math.max(confirmed + pending, 1)}
              color="bg-brand-500"
            />
            <SavingsBar
              label="Pending Confirmation"
              value={pending}
              max={Math.max(confirmed + pending, 1)}
              color="bg-gold-400"
            />
            <SavingsBar
              label="Locked as Loan Collateral"
              value={locked}
              max={Math.max(confirmed, 1)}
              color="bg-red-400"
            />
            {locked > 0 && (
              <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-3 py-2">
                💡 Locked savings will be released when you repay your active loan
              </p>
            )}
          </div>

          {/* ── Active loan ── */}
          {activeLoan && (
            <div className="bg-white rounded-2xl border border-brand-100 px-5 py-4 shadow-card">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Active Loan</p>
                <StatusBadge status={activeLoan.status} />
              </div>
              <div className="space-y-2">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Loan Amount</span>
                  <span className="text-sm font-bold text-slate-800">{formatBIF(activeLoan.amount)} BIF</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Remaining Due</span>
                  <span className="text-sm font-bold text-red-500">{formatBIF(activeLoan.remainingDue)} BIF</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-500">Due Date</span>
                  <span className="text-sm font-semibold text-slate-800">{formatDate(activeLoan.dueDate)}</span>
                </div>
              </div>
              {/* Repayment progress */}
              <div className="mt-3">
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full"
                    style={{ width: `${Math.min(((activeLoan.paidAmount || 0) / activeLoan.totalDue) * 100, 100)}%` }}
                  />
                </div>
                <p className="text-[10px] text-slate-400 mt-1">
                  {formatBIF(activeLoan.paidAmount || 0)} of {formatBIF(activeLoan.totalDue)} BIF repaid
                </p>
              </div>
              <Link
                to={`${BASE}/loans/my`}
                className="mt-3 flex items-center justify-center gap-1 text-xs font-semibold text-brand-600 hover:text-brand-700"
              >
                View loan details →
              </Link>
            </div>
          )}

          {/* ── Group card ── */}
          {group ? (
            <div className="bg-white rounded-2xl border border-brand-100 px-5 py-4 shadow-card">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">My Group</p>
                <Link to={`${BASE}/group/my`} className="text-xs font-semibold text-brand-600 hover:text-brand-700">View →</Link>
              </div>
              <p className="text-base font-bold text-slate-800">{group.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">Group total savings: {formatBIF(group.totalSavings)} BIF</p>
            </div>
          ) : (
            <Link
              to={`${BASE}/group/my`}
              className="flex items-center gap-3 bg-white border-2 border-dashed border-slate-200 rounded-2xl px-5 py-4 hover:bg-slate-50 active:scale-[0.98] transition-all"
            >
              <div className="w-11 h-11 bg-slate-100 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-700 leading-tight">Join or Create a Group</p>
                <p className="text-xs text-slate-400 mt-0.5">Access group savings and higher loan limits</p>
              </div>
              <svg className="w-5 h-5 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {/* ── Recent transactions ── */}
          <div className="bg-white rounded-2xl border border-brand-100 shadow-card overflow-hidden">
            <div className="px-5 pt-4 pb-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Recent Activity</p>
                <p className="text-xs text-slate-400 mt-0.5">Last 10 transactions</p>
              </div>
            </div>

            {transactions.length === 0 ? (
              <div className="px-5 pb-6 flex flex-col items-center gap-3 text-center">
                <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-600">No activity yet</p>
                  <p className="text-xs text-slate-400 mt-1">Your deposits, withdrawals, and loan activity will appear here</p>
                </div>
                {hasNoActivity && (
                  <Link
                    to={`${BASE}/deposit`}
                    className="mt-2 px-4 py-2 bg-brand-500 text-white text-xs font-bold rounded-xl hover:bg-brand-600 transition-colors"
                  >
                    Make First Deposit
                  </Link>
                )}
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-50">
                  {transactions.map((tx) => {
                    const meta = TRANSACTION_LABELS[tx.type] || { label: tx.type, color: "text-slate-600", sign: "" };
                    return (
                      <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800">{meta.label}</p>
                          <p className="text-xs text-slate-400 mt-0.5">{formatDate(tx.createdAt)}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1.5 shrink-0">
                          <span className={`text-sm font-bold ${meta.color}`}>
                            {meta.sign}{formatBIF(tx.amount)} BIF
                          </span>
                          <StatusBadge status={tx.status} />
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="px-5 py-3 border-t border-slate-50">
                  <Link
                    to={`${BASE}/transactions`}
                    className="flex items-center justify-center gap-2 py-2 text-sm font-bold text-brand-600 hover:text-brand-700 transition-colors"
                  >
                    <span>View All Transactions</span>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </Link>
                </div>
              </>
            )}
          </div>

        </div>
      </main>

      <BottomNav />
    </div>
  );
}
