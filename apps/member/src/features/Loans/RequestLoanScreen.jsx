import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

const requestLoan = httpsCallable(functions, "requestLoan");

function formatBIF(amount) {
  return `${Number(amount || 0).toLocaleString("en-US")} BIF`;
}

function formatDate(timestamp) {
  if (!timestamp) return "—";
  const date = timestamp._seconds
    ? new Date(timestamp._seconds * 1000)
    : timestamp.toDate
    ? timestamp.toDate()
    : new Date(timestamp);
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const TERM_OPTIONS = [
  { days: 7, label: "7 days", rate: 0.06, rateLabel: "6%" },
  { days: 14, label: "14 days", rate: 0.05, rateLabel: "5%" },
  { days: 30, label: "30 days", rate: 0.04, rateLabel: "4%" },
];

function calcRepayment(amount, termDays) {
  const opt = TERM_OPTIONS.find((o) => o.days === termDays);
  if (!opt || !amount || !Number.isFinite(amount) || amount <= 0) return null;
  const fee = Math.round(amount * opt.rate);
  return { rate: opt.rate, rateLabel: opt.rateLabel, fee, total: amount + fee };
}

export default function RequestLoanScreen({ user }) {
  const [wallet, setWallet] = useState(null);
  const [activeLoans, setActiveLoans] = useState(null);
  const [amount, setAmount] = useState("");
  const [termDays, setTermDays] = useState(14);
  const [purpose, setPurpose] = useState("");
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

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "loans"),
      where("userId", "==", user.uid),
      where("status", "in", ["active", "pending"])
    );
    const unsub = onSnapshot(
      q,
      (snap) => setActiveLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[loans]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  const loading = wallet === null || activeLoans === null;

  // Credit limit = 1.5× confirmed savings − locked collateral (aligned with backend)
  const balanceConfirmed = Number(wallet?.balanceConfirmed || 0);
  const balanceLocked = Number(wallet?.balanceLocked || 0);
  const creditLimit = Math.max(0, balanceConfirmed * 1.5 - balanceLocked);

  const hasActiveLoan = activeLoans && activeLoans.length > 0;
  const parsedAmount = Number(amount);
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount >= 1000;
  const amountExceedsLimit = amountValid && parsedAmount > creditLimit && creditLimit > 0;
  const repayment = amountValid && !amountExceedsLimit ? calcRepayment(parsedAmount, termDays) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!amountValid) {
      setError("Minimum loan amount is 1,000 BIF.");
      return;
    }
    if (amountExceedsLimit) {
      setError(`Amount exceeds your credit limit of ${formatBIF(creditLimit)}.`);
      return;
    }
    if (!purpose.trim() || purpose.trim().length < 10) {
      setError("Please describe the loan purpose (at least 10 characters).");
      return;
    }

    setSubmitting(true);
    try {
      const res = await requestLoan({ amount: parsedAmount, termDays, purpose: purpose.trim() });
      setResult(res.data);
      setAmount("");
      setPurpose("");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6">

        <div className="mb-6">
          <h1 className="text-xl font-bold text-slate-900">Request a Loan</h1>
          <p className="text-xs text-slate-400 mt-0.5">Borrow against your confirmed savings</p>
        </div>

        {/* Credit Summary */}
        <section className="mb-6">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
            Credit Overview
          </h2>
          <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
            <SummaryRow label="Confirmed Savings" value={formatBIF(balanceConfirmed)} />
            {balanceLocked > 0 && (
              <SummaryRow label="Locked (Collateral)" value={formatBIF(balanceLocked)} />
            )}
            <SummaryRow label="Credit Limit (1.5×)" value={formatBIF(creditLimit)} highlight />
          </div>
        </section>

        {hasActiveLoan ? (
          <BlockedBanner loans={activeLoans} />
        ) : result ? (
          <ResultCard result={result} onReset={() => setResult(null)} />
        ) : (
          <form onSubmit={handleSubmit} noValidate>
            {/* Amount */}
            <div className="mb-4">
              <label htmlFor="amount" className="block text-sm font-medium text-slate-700 mb-1.5">
                Loan Amount (BIF)
              </label>
              <input
                id="amount"
                type="number"
                inputMode="numeric"
                min="100"
                step="1"
                value={amount}
                onChange={(e) => { setError(null); setAmount(e.target.value); }}
                placeholder="e.g. 10 000"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              />
              <p className="text-xs text-slate-400 mt-1.5">
                Minimum: 100 BIF · Maximum: {formatBIF(creditLimit)}
              </p>
            </div>

            {/* Term */}
            <div className="mb-4">
              <p className="block text-sm font-medium text-slate-700 mb-1.5">Loan Term</p>
              <div className="grid grid-cols-3 gap-2">
                {TERM_OPTIONS.map((opt) => (
                  <button
                    key={opt.days}
                    type="button"
                    onClick={() => setTermDays(opt.days)}
                    className={`rounded-xl border py-2.5 text-sm font-medium transition-colors ${
                      termDays === opt.days
                        ? "border-indigo-500 bg-indigo-50 text-indigo-800"
                        : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="block">{opt.label}</span>
                    <span className="block text-xs font-normal opacity-60">{opt.rateLabel} fee</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Live repayment summary */}
            {repayment && (
              <div className="mb-4 rounded-xl bg-indigo-50 border border-indigo-100 px-4 py-3 space-y-1.5">
                <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">Repayment Summary</p>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                  <span className="text-slate-500">Principal</span>
                  <span className="text-right font-medium text-slate-900">{formatBIF(parsedAmount)}</span>
                  <span className="text-slate-500">Fee ({repayment.rateLabel})</span>
                  <span className="text-right font-medium text-slate-900">{formatBIF(repayment.fee)}</span>
                  <span className="text-slate-700 font-medium">Total repayment</span>
                  <span className="text-right font-bold text-indigo-800">{formatBIF(repayment.total)}</span>
                </div>
              </div>
            )}

            {/* Purpose */}
            <div className="mb-4">
              <label htmlFor="purpose" className="block text-sm font-medium text-slate-700 mb-1.5">
                Purpose
              </label>
              <textarea
                id="purpose"
                rows={3}
                value={purpose}
                onChange={(e) => { setError(null); setPurpose(e.target.value); }}
                placeholder="Describe what this loan is for…"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-none"
              />
              <p className="text-xs text-slate-400 mt-1">Minimum 10 characters</p>
            </div>

            {amountExceedsLimit && !error && (
              <p className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-700">
                Amount exceeds your credit limit of {formatBIF(creditLimit)}.
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
                Loans are automatically approved if you have sufficient credit and no outstanding balance.
                Your savings will be locked as collateral until repayment.
              </p>
            </div>

            <button
              type="submit"
              disabled={submitting || !amountValid || amountExceedsLimit || purpose.trim().length < 10}
              className="w-full rounded-xl bg-indigo-600 text-white font-semibold py-3 text-sm transition-opacity disabled:opacity-50"
            >
              {submitting ? "Submitting…" : "Submit Loan Request"}
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
      <span className={`text-sm font-semibold ${highlight ? "text-indigo-700" : "text-slate-900"}`}>
        {value}
      </span>
    </div>
  );
}

function BlockedBanner({ loans }) {
  const loan = loans[0];
  const isPending = loan?.status === "pending";

  return (
    <div className="rounded-xl bg-amber-50 border border-amber-200 px-5 py-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-amber-500 text-lg">⚠</span>
        <h3 className="text-base font-bold text-amber-800">
          {isPending ? "Loan Request Pending" : "Active Loan Outstanding"}
        </h3>
      </div>
      <p className="text-sm text-amber-700">
        {isPending
          ? "You have a loan request awaiting disbursement. You cannot submit a new request until it is resolved."
          : "You have an active loan that must be fully repaid before requesting a new one."}
      </p>
      {loan && (
        <div className="rounded-lg bg-white border border-amber-100 divide-y divide-amber-50 text-sm">
          <DetailRow label="Amount" value={`${Number(loan.amount || 0).toLocaleString("en-US")} BIF`} />
          {loan.remainingDue != null && (
            <DetailRow label="Remaining" value={`${Number(loan.remainingDue).toLocaleString("en-US")} BIF`} />
          )}
          {loan.dueDate && (
            <DetailRow label="Due Date" value={formatDate(loan.dueDate)} />
          )}
          <div className="px-4 py-2.5 flex justify-between items-center">
            <span className="text-slate-500">Status</span>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
              isPending ? "bg-yellow-100 text-yellow-700" : "bg-blue-100 text-blue-700"
            }`}>
              {loan.status}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

function ResultCard({ result, onReset }) {
  // Backend returns { approved: true, loanId, amount, ... } or { approved: false, reason, loanId }
  const isApproved = result?.approved === true;

  return (
    <div className={`rounded-xl border px-5 py-6 space-y-4 ${
      isApproved ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
    }`}>
      <div className="text-center">
        <div className="text-3xl mb-2">{isApproved ? "✓" : "✗"}</div>
        <h3 className={`text-base font-bold ${isApproved ? "text-green-800" : "text-red-800"}`}>
          {isApproved ? "Loan Request Submitted" : "Loan Request Rejected"}
        </h3>
      </div>

      <div className={`rounded-lg bg-white border divide-y text-sm ${
        isApproved ? "border-green-100 divide-green-50" : "border-red-100 divide-red-50"
      }`}>
        <DetailRow label="Status" value={isApproved ? "Pending disbursement" : "Rejected"} />
        {result?.loanId && (
          <DetailRow label="Reference" value={result.loanId.slice(0, 12) + "…"} />
        )}
        {!isApproved && result?.reason && (
          <div className="px-4 py-2.5">
            <p className="text-xs text-slate-500 mb-0.5">Reason</p>
            <p className="text-sm text-red-700 font-medium">{result.reason}</p>
          </div>
        )}
        {isApproved && result?.totalDue && (
          <DetailRow label="Total Repayment" value={`${Number(result.totalDue).toLocaleString("en-US")} BIF`} />
        )}
      </div>

      {isApproved && (
        <div className="rounded-lg bg-white border border-green-100 px-4 py-3 space-y-1.5">
          <p className="text-xs font-semibold text-green-800 uppercase tracking-wide">Next Steps</p>
          <ol className="text-sm text-green-700 space-y-1 list-decimal list-inside">
            <li>Wait for an agent to contact you for cash disbursement.</li>
            <li>Present your ID when collecting the funds.</li>
            <li>Repay before the due date to maintain your credit standing.</li>
          </ol>
        </div>
      )}

      <button
        onClick={onReset}
        className={`w-full text-sm font-medium underline underline-offset-2 text-center ${
          isApproved ? "text-green-700" : "text-red-700"
        }`}
      >
        {isApproved ? "Back" : "Try again"}
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
