import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

const recordDeposit = httpsCallable(functions, "recordDeposit");

function formatBIF(amount) {
  return `${Number(amount || 0).toLocaleString("en-US")} BIF`;
}

export default function DepositRequestScreen({ user }) {
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [receipt, setReceipt] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(
      doc(db, "wallets", user.uid),
      (snap) => setWallet(snap.exists() ? snap.data() : null),
      (err) => console.error("[wallet]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed < 100) {
      setError("Minimum deposit amount is 100 BIF.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await recordDeposit({
        userId: user.uid,
        amount: parsed,
        channel: "agent",
        notes: "",
      });
      setReceipt(result.data);
      setAmount("");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Request Deposit</h1>
          <p className="text-xs text-slate-400 mt-0.5">Add savings to your account</p>
        </div>

        {/* Wallet Summary */}
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Savings Overview
          </h2>
          <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
            <WalletRow label="Confirmed Savings" value={wallet?.balanceConfirmed} />
            <WalletRow label="Pending Savings" value={wallet?.balancePending} />
            <WalletRow label="Available Balance" value={wallet?.availableBalance} highlight />
          </div>
        </section>

        {/* Info Banner */}
        <div className="mb-6 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 flex gap-3 items-start">
          <span className="text-blue-400 text-base mt-0.5">ℹ</span>
          <p className="text-sm text-blue-700">
            Deposits are confirmed after partner institution verification. Your balance will update once the batch is approved.
          </p>
        </div>

        {/* Success State */}
        {receipt ? (
          <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-6 text-center space-y-3">
            <div className="text-3xl">✓</div>
            <h3 className="text-base font-bold text-green-800">Deposit Recorded</h3>
            <div className="text-sm text-green-700 space-y-1">
              <p>Amount: <span className="font-semibold">{formatBIF(receipt.amount)}</span></p>
              {receipt.receiptNo && (
                <p>Receipt: <span className="font-semibold">{receipt.receiptNo}</span></p>
              )}
              <p className="text-green-600 mt-2">Status: Awaiting partner institution verification</p>
            </div>
            <button
              onClick={() => setReceipt(null)}
              className="mt-2 text-sm font-medium text-green-700 underline underline-offset-2"
            >
              Record another deposit
            </button>
          </div>
        ) : (
          /* Deposit Form */
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <label
                htmlFor="amount"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Deposit Amount (BIF)
              </label>
              <input
                id="amount"
                type="number"
                inputMode="numeric"
                min="100"
                step="1"
                value={amount}
                onChange={(e) => {
                  setError(null);
                  setAmount(e.target.value);
                }}
                placeholder="e.g. 5000"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1.5">Minimum: 100 BIF</p>
            </div>

            {error && (
              <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || !amount}
              className="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 text-sm transition-opacity disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Request Deposit"}
            </button>
          </form>
        )}

      </div>
    </main>
  );
}

function WalletRow({ label, value, highlight }) {
  return (
    <div className="px-4 py-3 flex justify-between items-center">
      <span className={`text-sm ${highlight ? "font-medium text-slate-800" : "text-slate-500"}`}>
        {label}
      </span>
      <span className={`text-sm font-semibold ${highlight ? "text-blue-700" : "text-slate-900"}`}>
        {formatBIF(value)}
      </span>
    </div>
  );
}
