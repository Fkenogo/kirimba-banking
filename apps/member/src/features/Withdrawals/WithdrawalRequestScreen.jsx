import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

const memberRequestWithdrawal = httpsCallable(functions, "memberRequestWithdrawal");

const MIN_BALANCE = 5000;
const LARGE_THRESHOLD = 50000;

function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const WD_STATUS_STYLE = {
  pending_agent: "bg-blue-100 text-blue-700",
  pending_approval: "bg-amber-100 text-amber-700",
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};
const WD_STATUS_LABEL = {
  pending_agent: "Pending agent",
  pending_approval: "Awaiting approval",
  approved: "Approved",
  rejected: "Rejected",
};
const TXN_STATUS_STYLE = {
  confirmed: "bg-green-100 text-green-700",
  pending_confirmation: "bg-amber-100 text-amber-700",
  rejected: "bg-red-100 text-red-700",
};

export default function WithdrawalRequestScreen({ user }) {
  const navigate = useNavigate();

  const [wallet, setWallet] = useState(null);
  const [withdrawals, setWithdrawals] = useState(null);
  const [recentTxns, setRecentTxns] = useState(null);

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

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
      collection(db, "withdrawalRequests"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(5)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.warn("[withdrawalRequests]", err.message);
        setWithdrawals([]);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "transactions"),
      where("userId", "==", user.uid),
      where("type", "==", "withdrawal"),
      orderBy("createdAt", "desc"),
      limit(5)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setRecentTxns(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[withdrawalTxns]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  const availableBalance = Number(wallet?.availableBalance || 0);
  const maxWithdrawal = Math.max(0, availableBalance - MIN_BALANCE);
  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 100;
  const isLarge = parsedAmount >= LARGE_THRESHOLD;

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setFormSuccess(null);

    if (!amountValid) {
      setFormError("Minimum withdrawal amount is 100 BIF.");
      return;
    }
    if (parsedAmount > maxWithdrawal) {
      setFormError(`Maximum withdrawal is ${formatBIF(maxWithdrawal)} (${formatBIF(MIN_BALANCE)} minimum balance must remain).`);
      return;
    }

    setSubmitting(true);
    try {
      await memberRequestWithdrawal({ amount: parsedAmount, notes: notes.trim() });
      setFormSuccess(`Withdrawal request for ${formatBIF(parsedAmount)} submitted. Visit an agent to collect your cash.`);
      setAmount("");
      setNotes("");
      setShowForm(false);
    } catch (err) {
      setFormError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">

        <div>
          <h1 className="text-xl font-bold text-slate-900">Withdraw Savings</h1>
          <p className="text-xs text-slate-400 mt-0.5">Cash out via a KIRIMBA agent</p>
        </div>

        {/* Balance */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Account Overview</h2>
          <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
            <Row label="Confirmed Savings" value={formatBIF(wallet?.balanceConfirmed)} />
            <Row label="Locked (Collateral)" value={formatBIF(wallet?.balanceLocked)} />
            <Row label="Available to Withdraw" value={formatBIF(availableBalance)} highlight />
          </div>
        </section>

        {/* Success banner */}
        {formSuccess && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
            <p className="text-sm text-green-800">{formSuccess}</p>
          </div>
        )}

        {/* Request Withdrawal CTA or Form */}
        {!showForm ? (
          <button
            type="button"
            onClick={() => { setFormError(null); setFormSuccess(null); setShowForm(true); }}
            disabled={maxWithdrawal <= 0}
            className="w-full rounded-xl bg-indigo-600 text-white font-semibold py-3 text-sm hover:bg-indigo-700 transition-colors disabled:opacity-50"
          >
            Request Withdrawal
          </button>
        ) : (
          <form onSubmit={handleSubmit} noValidate className="rounded-xl bg-white border border-slate-200 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-800">Withdrawal Request</h2>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                Cancel
              </button>
            </div>

            <div>
              <label htmlFor="wd-amount" className="block text-sm font-medium text-slate-700 mb-1.5">
                Amount (BIF)
              </label>
              <input
                id="wd-amount"
                type="number"
                inputMode="numeric"
                min="100"
                step="1"
                value={amount}
                onChange={(e) => { setFormError(null); setAmount(e.target.value); }}
                placeholder="e.g. 10 000"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1">
                Maximum: {formatBIF(maxWithdrawal)} ({formatBIF(MIN_BALANCE)} minimum balance required)
              </p>
            </div>

            {/* Large withdrawal notice */}
            {amountValid && isLarge && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-800">Large withdrawal</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Amounts of {formatBIF(LARGE_THRESHOLD)} or more require admin approval before an agent can process them.
                </p>
              </div>
            )}

            <div>
              <label htmlFor="wd-notes" className="block text-sm font-medium text-slate-700 mb-1.5">
                Notes (optional)
              </label>
              <textarea
                id="wd-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason for withdrawal…"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
            </div>

            {formError && (
              <p className="rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
                {formError}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !amountValid || parsedAmount > maxWithdrawal}
              className="w-full rounded-xl bg-indigo-600 text-white font-semibold py-3 text-sm disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit Request"}
            </button>

            <p className="text-xs text-slate-400 text-center">
              Your request will be logged. Visit any KIRIMBA agent to collect your cash.
            </p>
          </form>
        )}

        {/* How-to */}
        <section className="rounded-xl bg-blue-50 border border-blue-100 px-5 py-4 space-y-3">
          <h2 className="text-sm font-semibold text-blue-900">How withdrawals work</h2>
          <ol className="text-sm text-blue-800 space-y-2 list-decimal list-inside">
            <li>Submit your withdrawal request above.</li>
            <li>Show your <span className="font-semibold">QR code or member ID</span> to a KIRIMBA agent.</li>
            <li>
              <span className="font-semibold">Small amounts</span> (under {formatBIF(LARGE_THRESHOLD)}) are processed immediately by the agent.
            </li>
            <li>
              <span className="font-semibold">Larger amounts</span> are submitted for approval — you will see the status here.
            </li>
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

        {/* Pending withdrawal requests */}
        {withdrawals && withdrawals.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Withdrawal Requests</h2>
            <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
              {withdrawals.map((wd) => (
                <div key={wd.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{formatBIF(wd.amount)}</p>
                    <p className="text-xs text-slate-400">{fmtDate(wd.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${WD_STATUS_STYLE[wd.status] || "bg-slate-100 text-slate-600"}`}>
                    {WD_STATUS_LABEL[wd.status] || wd.status}
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Recent completed withdrawals */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Recent Withdrawals</h2>
          {recentTxns === null ? (
            <div className="space-y-2">
              {[...Array(2)].map((_, i) => (
                <div key={i} className="h-14 rounded-xl bg-white border border-slate-200 animate-pulse" />
              ))}
            </div>
          ) : recentTxns.length === 0 ? (
            <div className="rounded-xl bg-white border border-slate-200 px-4 py-8 text-center">
              <p className="text-sm text-slate-400">No withdrawals on record.</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
              {recentTxns.map((t) => (
                <div key={t.id} className="px-4 py-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">{formatBIF(t.amount)}</p>
                    <p className="text-xs text-slate-400">{fmtDate(t.createdAt)}</p>
                  </div>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${TXN_STATUS_STYLE[t.status] || "bg-slate-100 text-slate-600"}`}>
                    {t.status === "confirmed" ? "Completed" : t.status}
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
