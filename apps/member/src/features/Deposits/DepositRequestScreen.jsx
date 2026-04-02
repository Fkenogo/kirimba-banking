import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, where, limit } from "firebase/firestore";
import { db } from "../../services/firebase";
import { PageShell, Card, SectionLabel, BalanceCard, StatusBadge, EmptyState, InfoRow, Divider, formatBIF, formatDate } from "../../components/ui";

const STATUS_STYLE = {
  pending_confirmation: { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"   },
  confirmed:            { bg: "bg-brand-50",  text: "text-brand-700",  label: "Confirmed" },
  rejected:             { bg: "bg-red-50",    text: "text-red-600",    label: "Rejected"  },
};

export default function DepositRequestScreen({ user }) {
  const navigate = useNavigate();
  const [wallet,   setWallet]   = useState(null);
  const [deposits, setDeposits] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "wallets", user.uid), (snap) => setWallet(snap.exists() ? snap.data() : {}));
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "transactions"), where("userId", "==", user.uid), where("type", "==", "deposit"), orderBy("createdAt", "desc"), limit(10));
    const unsub = onSnapshot(q, (snap) => setDeposits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user?.uid]);

  return (
    <PageShell title="Make a Deposit" showBack backTo="/app/dashboard" backLabel="Back to Account">

      {/* Balance card */}
      <BalanceCard label="Available Balance" amount={wallet?.availableBalance}>
        <div className="mt-4 pt-4 border-t border-white border-opacity-20 grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-brand-200 uppercase tracking-wide">Confirmed</p>
            <p className="text-base font-bold">{formatBIF(wallet?.balanceConfirmed)}</p>
          </div>
          <div>
            <p className="text-[10px] text-brand-200 uppercase tracking-wide">Pending</p>
            <p className="text-base font-bold text-gold-300">{formatBIF(wallet?.balancePending)}</p>
          </div>
        </div>
      </BalanceCard>

      {/* How it works */}
      <Card>
        <div className="px-5 pt-4 pb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How to Deposit</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Find a Kirimba agent near you" },
              { step: "2", text: "Show them your QR code or Member ID" },
              { step: "3", text: "Hand over the cash you want to save" },
              { step: "4", text: "Balance updates once the batch is confirmed" },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0">
                  {step}
                </div>
                <p className="text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Find Agent CTA */}
      <button onClick={() => navigate("/app/find-agent")}
        className="w-full bg-gold-500 hover:bg-gold-600 text-white font-bold py-4 rounded-2xl text-base transition-all active:scale-95 shadow-card flex items-center justify-center gap-2">
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        Find an Agent Near Me
      </button>

      {/* QR shortcut */}
      <button onClick={() => navigate("/app/my-qr")}
        className="w-full bg-white border-2 border-dashed border-brand-300 rounded-2xl py-4 flex flex-col items-center gap-1.5 hover:bg-brand-50 transition-colors active:scale-95">
        <svg className="w-7 h-7 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
        <span className="text-sm font-bold text-brand-600">Show My QR Code</span>
        <span className="text-xs text-slate-400">Tap to open your member QR for the agent</span>
      </button>

      {/* Member ID fallback */}
      {user?.uid && (
        <Card>
          <div className="px-5 py-3">
            <p className="text-xs text-slate-400 mb-1">Member ID (if QR unavailable)</p>
            <p className="font-mono text-xs text-brand-700 break-all">{user.uid}</p>
          </div>
        </Card>
      )}

      {/* Recent deposits */}
      <SectionLabel>Recent Deposits</SectionLabel>
      {deposits === null ? (
        <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 rounded-2xl bg-white border border-brand-100 animate-pulse" />)}</div>
      ) : deposits.length === 0 ? (
        <Card><EmptyState title="No deposits yet" subtitle="Visit an agent to make your first deposit" /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-50">
            {deposits.map((dep) => {
              const s = STATUS_STYLE[dep.status] || { bg: "bg-slate-100", text: "text-slate-500", label: dep.status };
              return (
                <div key={dep.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{formatBIF(dep.amount)}</p>
                    <p className="text-xs text-slate-400">{formatDate(dep.createdAt)}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${s.bg} ${s.text}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </PageShell>
  );
}
