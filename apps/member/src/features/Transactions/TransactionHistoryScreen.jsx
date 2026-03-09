import { useEffect, useState } from "react";
import { collection, getDocs, limit, orderBy, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";

// ─── Constants ───────────────────────────────────────────────────────────────

const TYPE_CONFIG = {
  deposit:      { label: "Deposit",          colorClass: "border-green-400",  textClass: "text-green-700",  bgClass: "bg-green-50"  },
  withdrawal:   { label: "Withdrawal",        colorClass: "border-red-400",    textClass: "text-red-700",    bgClass: "bg-red-50"    },
  loan_disburse:{ label: "Loan Out",          colorClass: "border-blue-400",   textClass: "text-blue-700",   bgClass: "bg-blue-50"   },
  loan_repay:   { label: "Loan Repayment",    colorClass: "border-purple-400", textClass: "text-purple-700", bgClass: "bg-purple-50" },
};

const STATUS_CLASSES = {
  confirmed:            "text-green-700 bg-green-50",
  pending_confirmation: "text-yellow-700 bg-yellow-50",
  rejected:             "text-red-600 bg-red-50",
};

const CHANNEL_LABELS = {
  agent:        "Agent",
  umuco_branch: "Institution Branch",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatBIF(amount) {
  if (amount === undefined || amount === null) return "—";
  return `${Number(amount).toLocaleString("en-US")} BIF`;
}

function formatLedgerImpact(impact) {
  if (impact === undefined || impact === null) return "—";
  const n = Number(impact);
  if (n > 0) return `+${n.toLocaleString("en-US")} BIF`;
  if (n < 0) return `${n.toLocaleString("en-US")} BIF`;
  return "0 BIF";
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatDateTime(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const cls = STATUS_CLASSES[status] || "text-slate-600 bg-slate-100";
  return (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${cls}`}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="flex justify-between items-start gap-4 py-2 border-b border-slate-100 last:border-0">
      <span className="text-xs text-slate-500 shrink-0">{label}</span>
      <span className="text-xs font-medium text-slate-900 text-right break-all">{value ?? "—"}</span>
    </div>
  );
}

function TransactionModal({ tx, onClose }) {
  const config = TYPE_CONFIG[tx.type] || { label: tx.type, textClass: "text-slate-700" };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-slate-100">
          <div>
            <p className={`text-sm font-bold ${config.textClass}`}>{config.label}</p>
            <p className="text-xs text-slate-400 mt-0.5">{formatDateTime(tx.createdAt)}</p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-xl leading-none p-1"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Amount */}
        <div className="px-5 py-4 border-b border-slate-100">
          <p className="text-2xl font-bold text-slate-900">{formatBIF(tx.amount)}</p>
          <div className="mt-1.5">
            <StatusBadge status={tx.status} />
          </div>
        </div>

        {/* Detail rows */}
        <div className="px-5 py-3">
          <DetailRow label="Transaction ID" value={tx.id} />
          <DetailRow label="Receipt No"     value={tx.receiptNo} />
          <DetailRow label="Type"           value={config.label} />
          <DetailRow label="Status"         value={tx.status?.replace(/_/g, " ")} />
          <DetailRow label="Group ID"       value={tx.groupId} />
          <DetailRow label="Channel"        value={CHANNEL_LABELS[tx.channel] || tx.channel} />
          <DetailRow label="Wallet ID"      value={tx.walletId} />
          <DetailRow label="Ledger Impact"  value={formatLedgerImpact(tx.ledgerImpact)} />
          <DetailRow label="Balance Before" value={formatBIF(tx.balanceBefore)} />
          <DetailRow label="Balance After"  value={formatBIF(tx.balanceAfter)} />
          {tx.notes && <DetailRow label="Notes" value={tx.notes} />}
          <DetailRow label="Date"           value={formatDateTime(tx.createdAt)} />
        </div>

        <div className="px-5 pb-6 pt-2">
          <button
            onClick={onClose}
            className="w-full rounded-xl border border-slate-200 text-slate-600 text-sm font-medium py-2.5"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function TransactionHistoryScreen({ user }) {
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        const snap = await getDocs(
          query(
            collection(db, "transactions"),
            where("userId", "==", user.uid),
            orderBy("createdAt", "desc"),
            limit(50)
          )
        );
        setTransactions(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading transactions…</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-sm text-red-600">Error: {error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Transactions</h1>
          <p className="text-xs text-slate-400 mt-0.5">Last {transactions.length} transactions</p>
        </div>

        {/* List */}
        {transactions.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-16">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => {
              const config = TYPE_CONFIG[tx.type] || {
                label: tx.type,
                colorClass: "border-slate-300",
                textClass: "text-slate-700",
                bgClass: "bg-slate-50",
              };

              return (
                <button
                  key={tx.id}
                  onClick={() => setSelected(tx)}
                  className={`w-full text-left rounded-xl bg-white border-l-4 ${config.colorClass} border border-slate-200 px-4 py-3 flex items-center justify-between gap-3 active:opacity-70 transition-opacity`}
                >
                  <div className="min-w-0">
                    <p className={`text-sm font-semibold ${config.textClass}`}>{config.label}</p>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(tx.createdAt)}</p>
                    {tx.channel && (
                      <p className="text-xs text-slate-400">
                        {CHANNEL_LABELS[tx.channel] || tx.channel}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <span className="text-sm font-bold text-slate-900">{formatBIF(tx.amount)}</span>
                    <StatusBadge status={tx.status} />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selected && (
        <TransactionModal tx={selected} onClose={() => setSelected(null)} />
      )}
    </main>
  );
}
