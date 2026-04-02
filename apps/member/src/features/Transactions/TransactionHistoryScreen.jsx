import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { PageShell, Card, StatusBadge, EmptyState, formatBIF, formatDate } from "../../components/ui";

const TYPE_CONFIG = {
  deposit:      { label: "Deposit",         color: "text-brand-600", sign: "+", dot: "bg-brand-500"  },
  withdrawal:   { label: "Withdrawal",      color: "text-red-500",   sign: "-", dot: "bg-red-400"    },
  loan_disburse:{ label: "Loan Disbursed",  color: "text-gold-600",  sign: "+", dot: "bg-gold-400"   },
  loan_repay:   { label: "Loan Repayment",  color: "text-slate-600", sign: "-", dot: "bg-slate-400"  },
};

const CHANNEL_LABELS = {
  agent:              "Via Agent",
  institution_branch: "Institution Branch",
  agent_qr:           "Agent (QR)",
};

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function TransactionHistoryScreen({ user }) {
  const [transactions, setTransactions] = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [selected,     setSelected]     = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const snap = await getDocs(query(
          collection(db, "transactions"),
          where("userId", "==", user.uid),
          orderBy("createdAt", "desc"),
          limit(50)
        ));
        setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.uid]);

  return (
    <PageShell title="Transactions" showBack backTo="/app/dashboard" backLabel="Back to Account">
      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map((i) => <div key={i} className="h-16 rounded-2xl bg-white border border-brand-100 animate-pulse" />)}
        </div>
      ) : error ? (
        <Card><div className="px-5 py-6 text-center text-sm text-red-500">{error}</div></Card>
      ) : transactions.length === 0 ? (
        <Card><EmptyState title="No transactions yet" subtitle="Your transaction history will appear here" /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-50">
            {transactions.map((tx) => {
              const cfg = TYPE_CONFIG[tx.type] || { label: tx.type, color: "text-slate-600", sign: "", dot: "bg-slate-300" };
              return (
                <button key={tx.id} onClick={() => setSelected(tx)}
                  className="w-full text-left flex items-center gap-4 px-5 py-3.5 hover:bg-brand-50 active:bg-brand-100 transition-colors">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-bold ${cfg.color}`}>{cfg.label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {formatDate(tx.createdAt)}
                      {tx.channel ? ` · ${CHANNEL_LABELS[tx.channel] || tx.channel}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className={`text-sm font-extrabold ${cfg.color}`}>{cfg.sign}{formatBIF(tx.amount)}</span>
                    <StatusBadge status={tx.status} />
                  </div>
                </button>
              );
            })}
          </div>
        </Card>
      )}

      {/* Detail bottom sheet */}
      {selected && <TransactionSheet tx={selected} onClose={() => setSelected(null)} />}
    </PageShell>
  );
}

function TransactionSheet({ tx, onClose }) {
  const cfg = TYPE_CONFIG[tx.type] || { label: tx.type, color: "text-slate-700" };
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-t-3xl shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 bg-slate-200 rounded-full" />
        </div>
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-3 pb-4 border-b border-brand-50">
          <div>
            <p className={`text-base font-extrabold ${cfg.color}`}>{cfg.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(tx.createdAt)}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Amount */}
        <div className="px-5 py-4 border-b border-brand-50">
          <p className="text-3xl font-extrabold text-slate-900">{formatBIF(tx.amount)}</p>
          <div className="mt-2"><StatusBadge status={tx.status} /></div>
        </div>
        {/* Details */}
        <div className="px-5 py-4 space-y-3">
          {[
            { label: "Receipt No",     value: tx.receiptNo },
            { label: "Transaction ID", value: tx.id },
            { label: "Channel",        value: CHANNEL_LABELS[tx.channel] || tx.channel },
            { label: "Balance Before", value: formatBIF(tx.balanceBefore) },
            { label: "Balance After",  value: formatBIF(tx.balanceAfter) },
            tx.notes && { label: "Notes", value: tx.notes },
          ].filter(Boolean).map(({ label, value }) => (
            <div key={label} className="flex justify-between items-start gap-4">
              <span className="text-xs text-slate-400 shrink-0">{label}</span>
              <span className="text-xs font-semibold text-slate-800 text-right break-all">{value || "—"}</span>
            </div>
          ))}
        </div>
        <div className="px-5 pb-6 pt-2">
          <button onClick={onClose} className="w-full py-3.5 rounded-2xl border-2 border-brand-100 text-brand-600 font-bold text-sm">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
