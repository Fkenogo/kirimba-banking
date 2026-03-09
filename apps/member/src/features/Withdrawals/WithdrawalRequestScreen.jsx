import { useEffect, useState } from "react";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

const recordWithdrawal = httpsCallable(functions, "recordWithdrawal");

function formatBIF(amount) {
  return `${Number(amount || 0).toLocaleString("en-US")} BIF`;
}

export default function WithdrawalRequestScreen({ user }) {
  const [wallet, setWallet] = useState(null);
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(
      doc(db, "wallets", user.uid),
      (snap) => setWallet(snap.exists() ? snap.data() : null),
      (err) => console.error("[wallet]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  const available = Number(wallet?.availableBalance || 0);
  const parsedAmount = Number(amount);
  const exceedsAvailable =
    Number.isFinite(parsedAmount) && parsedAmount > available && available > 0;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!Number.isFinite(parsedAmount) || parsedAmount < 100) {
      setError("Minimum withdrawal amount is 100 BIF.");
      return;
    }
    if (parsedAmount > available) {
      setError(`Amount exceeds your available balance of ${formatBIF(available)}.`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await recordWithdrawal({ amount: parsedAmount });
      setResult(res.data);
      setAmount("");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (wallet === null) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6">

        {/* Header */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Withdraw Savings</h1>
          <p className="text-xs text-slate-400 mt-0.5">Request a cash withdrawal from your account</p>
        </div>

        {/* Wallet Summary */}
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Account Overview
          </h2>
          <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
            <SummaryRow label="Confirmed Savings" value={formatBIF(wallet.balanceConfirmed)} />
            <SummaryRow label="Locked (Collateral)" value={formatBIF(wallet.balanceLocked)} />
            <SummaryRow label="Available to Withdraw" value={formatBIF(wallet.availableBalance)} highlight />
          </div>
        </section>

        {result ? (
          <SuccessCard result={result} onReset={() => setResult(null)} />
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-4">
              <label
                htmlFor="amount"
                className="block text-sm font-medium text-slate-700 mb-1.5"
              >
                Withdrawal Amount (BIF)
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
                placeholder="e.g. 5 000"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                Minimum: 100 BIF · Maximum: {formatBIF(available)}
              </p>
            </div>

            {exceedsAvailable && !error && (
              <p className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-700">
                Amount exceeds your available balance of {formatBIF(available)}.
              </p>
            )}

            {error && (
              <p className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-2.5 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mb-5 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3 flex gap-3 items-start">
              <span className="text-blue-400 text-base mt-0.5">ℹ</span>
              <p className="text-sm text-blue-700">
                Small withdrawals are processed immediately. Larger amounts may require
                additional review before funds are released.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting || !amount || exceedsAvailable}
              className="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 text-sm transition-opacity disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Request Withdrawal"}
            </button>
          </form>
        )}

      </div>
    </main>
  );
}

function SummaryRow({ label, value, highlight }) {
  return (
    <div className="px-4 py-3 flex justify-between items-center">
      <span className={`text-sm ${highlight ? "font-medium text-slate-800" : "text-slate-500"}`}>
        {label}
      </span>
      <span className={`text-sm font-semibold ${highlight ? "text-blue-700" : "text-slate-900"}`}>
        {value}
      </span>
    </div>
  );
}

function SuccessCard({ result, onReset }) {
  const isPending = result?.status !== "confirmed";

  return (
    <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-6 space-y-4">
      <div className="text-center">
        <div className="text-3xl mb-2">✓</div>
        <h3 className="text-base font-bold text-green-800">Withdrawal Requested</h3>
      </div>

      <div className="rounded-lg bg-white border border-green-100 divide-y divide-green-50 text-sm">
        {result?.receiptNo && (
          <DetailRow label="Receipt" value={result.receiptNo} />
        )}
        <DetailRow
          label="Status"
          value={
            isPending ? "Pending confirmation" : "Confirmed"
          }
        />
      </div>

      {isPending && (
        <div className="rounded-lg bg-white border border-green-100 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Next Steps</p>
          <ol className="text-sm text-green-700 space-y-1 list-decimal list-inside">
            <li>An agent will contact you to arrange cash collection.</li>
            <li>Present your ID when collecting the funds.</li>
          </ol>
        </div>
      )}

      <button
        onClick={onReset}
        className="w-full text-sm font-medium text-green-700 underline underline-offset-2 text-center"
      >
        Request another withdrawal
      </button>
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="px-4 py-2.5 flex justify-between items-center">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900">{value}</span>
    </div>
  );
}
