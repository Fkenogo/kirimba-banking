import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, where, limit } from "firebase/firestore";
import { db } from "../../services/firebase";

function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE = {
  pending_confirmation: "bg-amber-100 text-amber-700",
  confirmed: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};
const STATUS_LABEL = {
  pending_confirmation: "Awaiting confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

export default function DepositRequestScreen({ user }) {
  const navigate = useNavigate();
  const [wallet, setWallet] = useState(null);
  const [deposits, setDeposits] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(
      doc(db, "wallets", user.uid),
      (snap) => setWallet(snap.exists() ? snap.data() : {}),
      (err) => console.error("[wallet]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "transactions"),
      where("userId", "==", user.uid),
      where("type", "==", "deposit"),
      orderBy("createdAt", "desc"),
      limit(10)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setDeposits(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[deposits]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-slate-900">Make a Deposit</h1>
          <p className="text-xs text-slate-400 mt-0.5">Add savings to your account via an agent</p>
        </div>

        {/* Savings summary */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Current Balance</h2>
          <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
            <Row label="Confirmed Savings" value={formatBIF(wallet?.balanceConfirmed)} />
            <Row label="Pending" value={formatBIF(wallet?.balancePending)} />
            <Row label="Available" value={formatBIF(wallet?.availableBalance)} highlight />
          </div>
        </section>

        {/* Find Agent CTA */}
        <section className="rounded-xl bg-indigo-50 border border-indigo-200 px-5 py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-indigo-900">Need an agent?</p>
            <p className="text-xs text-indigo-700 mt-0.5">Locate a KIRIMBA agent near you to make a cash deposit.</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/find-agent")}
            className="shrink-0 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 transition-colors"
          >
            Find Agent
          </button>
        </section>

        {/* How-to */}
        <section className="rounded-xl bg-blue-50 border border-blue-100 px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900">How to deposit</h2>
          <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
            <li>Find a KIRIMBA agent near you.</li>
            <li>Show them your <span className="font-semibold">QR code or member ID</span> below.</li>
            <li>Hand over the cash you want to deposit.</li>
            <li>The agent records it — it will show as <span className="font-semibold">Pending</span> here.</li>
            <li>Once the institution confirms the batch your balance updates automatically.</li>
          </ol>
        </section>

        {/* QR shortcut */}
        <button
          type="button"
          onClick={() => navigate("/app/my-qr")}
          className="w-full rounded-xl border-2 border-dashed border-blue-300 bg-white py-4 flex flex-col items-center gap-1 hover:bg-blue-50 transition-colors"
        >
          <span className="text-2xl">📲</span>
          <span className="text-sm font-semibold text-blue-700">Show My QR Code</span>
          <span className="text-xs text-slate-400">Tap to open your member QR for the agent</span>
        </button>

        {/* Member ID fallback */}
        {user?.uid && (
          <div className="rounded-xl bg-white border border-slate-200 px-4 py-3">
            <p className="text-xs text-slate-500 mb-1">Your Member ID (if QR unavailable)</p>
            <p className="font-mono text-xs text-slate-800 break-all">{user.uid}</p>
          </div>
        )}

        {/* Recent deposits */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Deposits</h2>
          {deposits === null ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-white border border-slate-200 animate-pulse" />
              ))}
            </div>
          ) : deposits.length === 0 ? (
            <div className="rounded-xl bg-white border border-slate-200 px-4 py-8 text-center">
              <p className="text-sm text-slate-400">No deposits yet. Visit an agent to get started.</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
              {deposits.map((dep) => (
                <div key={dep.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{formatBIF(dep.amount)}</p>
                    <p className="text-xs text-slate-400">{fmtDate(dep.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLE[dep.status] || "bg-slate-100 text-slate-600"}`}>
                    {STATUS_LABEL[dep.status] || dep.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="px-4 py-3 flex justify-between items-center">
      <span className={`text-sm ${highlight ? "font-medium text-slate-800" : "text-slate-500"}`}>{label}</span>
      <span className={`text-sm font-semibold ${highlight ? "text-blue-700" : "text-slate-900"}`}>{value}</span>
    </div>
  );
}
