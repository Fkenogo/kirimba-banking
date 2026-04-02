import { useEffect, useState } from "react";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, SectionLabel, Alert, PrimaryButton, FormInput, FormTextarea, InfoRow, Divider, StatusBadge, formatBIF } from "../../components/ui";

const requestLoan = httpsCallable(functions, "requestLoan");

const TERM_OPTIONS = [
  { days: 7,  label: "7 Days",  rate: 0.06, rateLabel: "6% fee" },
  { days: 14, label: "14 Days", rate: 0.05, rateLabel: "5% fee" },
  { days: 30, label: "30 Days", rate: 0.04, rateLabel: "4% fee" },
];

function calcRepayment(amount, termDays) {
  const opt = TERM_OPTIONS.find((o) => o.days === termDays);
  if (!opt || !amount || !Number.isFinite(amount) || amount <= 0) return null;
  const fee = Math.round(amount * opt.rate);
  return { rateLabel: opt.rateLabel, fee, total: amount + fee };
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function RequestLoanScreen({ user }) {
  const [wallet,      setWallet]      = useState(null);
  const [activeLoans, setActiveLoans] = useState(null);
  const [amount,      setAmount]      = useState("");
  const [termDays,    setTermDays]    = useState(14);
  const [purpose,     setPurpose]     = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [error,       setError]       = useState(null);
  const [result,      setResult]      = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "wallets", user.uid), (snap) => setWallet(snap.exists() ? snap.data() : null));
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "loans"), where("userId", "==", user.uid), where("status", "in", ["active", "pending"]));
    const unsub = onSnapshot(q, (snap) => setActiveLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user?.uid]);

  const balanceConfirmed = Number(wallet?.balanceConfirmed || 0);
  const balanceLocked    = Number(wallet?.balanceLocked    || 0);
  const creditLimit      = Math.max(0, balanceConfirmed * 1.5 - balanceLocked);
  const hasActiveLoan    = activeLoans && activeLoans.length > 0;
  const parsedAmount     = Number(amount);
  const amountValid      = Number.isFinite(parsedAmount) && parsedAmount >= 1000;
  const amountExceeds    = amountValid && parsedAmount > creditLimit && creditLimit > 0;
  const repayment        = amountValid && !amountExceeds ? calcRepayment(parsedAmount, termDays) : null;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (!amountValid) { setError("Minimum loan amount is 1,000 BIF."); return; }
    if (amountExceeds) { setError(`Amount exceeds your credit limit of ${formatBIF(creditLimit)}.`); return; }
    if (!purpose.trim() || purpose.trim().length < 10) { setError("Please describe the purpose (at least 10 characters)."); return; }

    setSubmitting(true);
    try {
      const res = await requestLoan({ amount: parsedAmount, termDays, purpose: purpose.trim() });
      setResult(res.data);
      setAmount(""); setPurpose("");
    } catch (err) {
      setError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (wallet === null || activeLoans === null) {
    return (
      <PageShell title="Request Loan" showBack backTo="/app/loans/my" backLabel="Back to Loans">
        <div className="flex justify-center py-12">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell title="Request a Loan" showBack backTo="/app/loans/my" backLabel="Back to Loans">

      {/* Credit overview card */}
      <div className="bg-brand-500 rounded-2xl px-5 py-5 text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-brand-400 rounded-full opacity-30" />
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-100 mb-3">Your Credit Overview</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[10px] text-brand-200 uppercase tracking-wide">Confirmed Savings</p>
            <p className="text-lg font-bold">{formatBIF(balanceConfirmed)}</p>
          </div>
          <div>
            <p className="text-[10px] text-brand-200 uppercase tracking-wide">Credit Limit (1.5×)</p>
            <p className="text-lg font-bold text-gold-300">{formatBIF(creditLimit)}</p>
          </div>
        </div>
      </div>

      {/* Blocked — has active loan */}
      {hasActiveLoan ? (
        <BlockedBanner loan={activeLoans[0]} />
      ) : result ? (
        <ResultCard result={result} onReset={() => setResult(null)} />
      ) : (
        <form onSubmit={handleSubmit} noValidate className="space-y-4">

          {/* Amount */}
          <FormInput
            label="Loan Amount (BIF)"
            type="number"
            inputMode="numeric"
            min="1000"
            step="1"
            value={amount}
            onChange={(e) => { setError(null); setAmount(e.target.value); }}
            placeholder="e.g. 10,000"
            hint={`Minimum: 1,000 BIF · Maximum: ${formatBIF(creditLimit)}`}
          />

          {/* Term selector */}
          <div className="space-y-2">
            <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Loan Term</p>
            <div className="grid grid-cols-3 gap-2">
              {TERM_OPTIONS.map((opt) => (
                <button key={opt.days} type="button" onClick={() => setTermDays(opt.days)}
                  className={`rounded-2xl border-2 py-3 text-center transition-all ${
                    termDays === opt.days
                      ? "border-brand-500 bg-brand-500 text-white"
                      : "border-brand-100 bg-white text-slate-700 hover:border-brand-300"
                  }`}>
                  <p className="text-sm font-bold">{opt.label}</p>
                  <p className={`text-xs mt-0.5 ${termDays === opt.days ? "text-brand-100" : "text-slate-400"}`}>{opt.rateLabel}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Live repayment summary */}
          {repayment && (
            <Card>
              <div className="px-5 py-4">
                <p className="text-xs font-bold uppercase tracking-widest text-brand-600 mb-3">Repayment Summary</p>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Principal</span>
                    <span className="font-semibold text-slate-800">{formatBIF(parsedAmount)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-500">Fee ({repayment.rateLabel})</span>
                    <span className="font-semibold text-slate-800">{formatBIF(repayment.fee)}</span>
                  </div>
                  <div className="h-px bg-brand-50" />
                  <div className="flex justify-between text-sm">
                    <span className="font-bold text-slate-800">Total Repayment</span>
                    <span className="font-extrabold text-brand-600">{formatBIF(repayment.total)}</span>
                  </div>
                </div>
              </div>
            </Card>
          )}

          {/* Purpose */}
          <FormTextarea
            label="Purpose"
            rows={3}
            value={purpose}
            onChange={(e) => { setError(null); setPurpose(e.target.value); }}
            placeholder="Describe what this loan is for…"
            hint="Minimum 10 characters"
          />

          {amountExceeds && !error && (
            <Alert type="warning">Amount exceeds your credit limit of {formatBIF(creditLimit)}.</Alert>
          )}
          {error && <Alert type="error">{error}</Alert>}

          <Alert type="info">
            Loans are auto-approved if you have sufficient credit. Your savings are locked as collateral until repayment.
          </Alert>

          <PrimaryButton
            type="submit"
            loading={submitting}
            disabled={!amountValid || amountExceeds || purpose.trim().length < 10}>
            Submit Loan Request
          </PrimaryButton>
        </form>
      )}
    </PageShell>
  );
}

function BlockedBanner({ loan }) {
  const isPending = loan?.status === "pending";
  return (
    <Card>
      <div className="px-5 py-5 space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-gold-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-bold text-slate-800">{isPending ? "Loan Pending Disbursement" : "Active Loan Outstanding"}</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {isPending ? "Awaiting agent disbursement." : "Repay your current loan first."}
            </p>
          </div>
        </div>
        <div className="bg-brand-50 rounded-xl divide-y divide-brand-100">
          <InfoRow label="Amount"    value={formatBIF(loan.amount)} />
          {loan.remainingDue != null && <InfoRow label="Remaining" value={formatBIF(loan.remainingDue)} valueClass="text-red-500" />}
          {loan.dueDate && <InfoRow label="Due Date" value={(() => { const ts = loan.dueDate; const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts); return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); })()} />}
          <div className="flex justify-between items-center px-5 py-3">
            <span className="text-sm text-slate-500">Status</span>
            <StatusBadge status={loan.status} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function ResultCard({ result, onReset }) {
  const isApproved = result?.approved === true;
  return (
    <Card>
      <div className="px-5 py-6 space-y-4 text-center">
        <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto ${isApproved ? "bg-brand-100" : "bg-red-100"}`}>
          {isApproved ? (
            <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          ) : (
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </div>
        <div>
          <p className={`text-lg font-extrabold ${isApproved ? "text-brand-700" : "text-red-700"}`}>
            {isApproved ? "Loan Request Submitted!" : "Request Rejected"}
          </p>
          <p className="text-sm text-slate-500 mt-1">
            {isApproved ? "An agent will disburse your cash. Present your ID when collecting." : result?.reason || "Please check your credit limit and try again."}
          </p>
        </div>
        {isApproved && result?.totalDue && (
          <div className="bg-brand-50 rounded-xl px-4 py-3 text-left">
            <p className="text-xs text-brand-600 font-bold uppercase tracking-wide mb-1">Repayment Due</p>
            <p className="text-xl font-extrabold text-brand-800">{formatBIF(result.totalDue)}</p>
          </div>
        )}
        <button onClick={onReset} className="w-full py-3 rounded-2xl border-2 border-brand-100 text-brand-600 font-bold text-sm">
          {isApproved ? "Done" : "Try Again"}
        </button>
      </div>
    </Card>
  );
}
