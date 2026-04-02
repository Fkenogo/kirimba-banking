import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, where, limit } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, SectionLabel, BalanceCard, Alert, PrimaryButton, FormInput, FormTextarea, EmptyState, formatBIF, formatDate } from "../../components/ui";

const memberRequestWithdrawal = httpsCallable(functions, "memberRequestWithdrawal");
const MIN_BALANCE    = 5000;
const LARGE_THRESHOLD = 50000;

const WD_STATUS = {
  pending_agent:    { bg: "bg-blue-50",   text: "text-blue-700",   label: "At Agent"  },
  pending_approval: { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"   },
  approved:         { bg: "bg-brand-50",  text: "text-brand-700",  label: "Approved"  },
  rejected:         { bg: "bg-red-50",    text: "text-red-600",    label: "Rejected"  },
};
const TXN_STATUS = {
  confirmed:            { bg: "bg-brand-50", text: "text-brand-700", label: "Completed" },
  pending_confirmation: { bg: "bg-gold-50",  text: "text-gold-700",  label: "Pending"   },
  rejected:             { bg: "bg-red-50",   text: "text-red-600",   label: "Rejected"  },
};

export default function WithdrawalRequestScreen({ user }) {
  const navigate = useNavigate();
  const [wallet,      setWallet]      = useState(null);
  const [withdrawals, setWithdrawals] = useState(null);
  const [recentTxns,  setRecentTxns]  = useState(null);
  const [showForm,    setShowForm]    = useState(false);
  const [amount,      setAmount]      = useState("");
  const [notes,       setNotes]       = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [formError,   setFormError]   = useState(null);
  const [formSuccess, setFormSuccess] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "wallets", user.uid), (snap) => setWallet(snap.exists() ? snap.data() : {}));
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "withdrawalRequests"), where("userId", "==", user.uid), orderBy("createdAt", "desc"), limit(5));
    const unsub = onSnapshot(q, (snap) => setWithdrawals(snap.docs.map((d) => ({ id: d.id, ...d.data() }))), () => setWithdrawals([]));
    return () => unsub();
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "transactions"), where("userId", "==", user.uid), where("type", "==", "withdrawal"), orderBy("createdAt", "desc"), limit(5));
    const unsub = onSnapshot(q, (snap) => setRecentTxns(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user?.uid]);

  const availableBalance = Number(wallet?.availableBalance || 0);
  const maxWithdrawal    = Math.max(0, availableBalance - MIN_BALANCE);
  const parsedAmount     = Number(amount);
  const amountValid      = Number.isFinite(parsedAmount) && parsedAmount >= 100;
  const isLarge          = parsedAmount >= LARGE_THRESHOLD;

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null); setFormSuccess(null);
    if (!amountValid) { setFormError("Minimum withdrawal is 100 BIF."); return; }
    if (parsedAmount > maxWithdrawal) {
      setFormError(`Maximum is ${formatBIF(maxWithdrawal)} (${formatBIF(MIN_BALANCE)} must remain).`);
      return;
    }
    setSubmitting(true);
    try {
      await memberRequestWithdrawal({ amount: parsedAmount, notes: notes.trim() });
      setFormSuccess(`Request for ${formatBIF(parsedAmount)} submitted. Visit an agent to collect cash.`);
      setAmount(""); setNotes(""); setShowForm(false);
    } catch (err) {
      setFormError(err.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PageShell title="Withdraw Savings" showBack backTo="/app/dashboard" backLabel="Back to Account">

      {/* Balance card */}
      <BalanceCard label="Available to Withdraw" amount={availableBalance}>
        <div className="mt-3 text-xs text-brand-200">
          Min. balance {formatBIF(MIN_BALANCE)} must remain · Max: {formatBIF(maxWithdrawal)}
        </div>
      </BalanceCard>

      {formSuccess && <Alert type="success">{formSuccess}</Alert>}

      {/* Request button or form */}
      {!showForm ? (
        <PrimaryButton onClick={() => { setFormError(null); setFormSuccess(null); setShowForm(true); }} disabled={maxWithdrawal <= 0}>
          Request Withdrawal
        </PrimaryButton>
      ) : (
        <Card>
          <form onSubmit={handleSubmit} noValidate className="px-5 py-5 space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-slate-800">Withdrawal Request</p>
              <button type="button" onClick={() => setShowForm(false)} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
                Cancel
              </button>
            </div>

            <FormInput
              label="Amount (BIF)"
              type="number"
              inputMode="numeric"
              min="100"
              step="1"
              value={amount}
              onChange={(e) => { setFormError(null); setAmount(e.target.value); }}
              placeholder="e.g. 10,000"
              hint={`Max: ${formatBIF(maxWithdrawal)} (${formatBIF(MIN_BALANCE)} must remain)`}
            />

            {amountValid && isLarge && (
              <Alert type="warning">
                Amounts ≥ {formatBIF(LARGE_THRESHOLD)} require admin approval before an agent can process them.
              </Alert>
            )}

            <FormTextarea
              label="Notes (optional)"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for withdrawal…"
            />

            {formError && <Alert type="error">{formError}</Alert>}

            <PrimaryButton type="submit" loading={submitting} disabled={!amountValid || parsedAmount > maxWithdrawal}>
              Submit Withdrawal Request
            </PrimaryButton>
            <p className="text-xs text-slate-400 text-center">Visit any Kirimba agent to collect your cash after submitting.</p>
          </form>
        </Card>
      )}

      {/* How it works */}
      <Card>
        <div className="px-5 pt-4 pb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How Withdrawals Work</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Submit your withdrawal request above" },
              { step: "2", text: `Small amounts (under ${formatBIF(LARGE_THRESHOLD)}) — agent processes immediately` },
              { step: "3", text: `Large amounts — submitted for approval, check status here` },
              { step: "4", text: "Show your QR code to the agent when collecting" },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {step}
                </div>
                <p className="text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* QR shortcut */}
      <button onClick={() => navigate("/app/my-qr")}
        className="w-full bg-white border-2 border-dashed border-brand-300 rounded-2xl py-4 flex flex-col items-center gap-1.5 hover:bg-brand-50 transition-colors active:scale-95">
        <svg className="w-7 h-7 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
        </svg>
        <span className="text-sm font-bold text-brand-600">Show My QR Code</span>
        <span className="text-xs text-slate-400">Tap to open your member QR for the agent</span>
      </button>

      {/* Pending requests */}
      {withdrawals && withdrawals.length > 0 && (
        <>
          <SectionLabel>Withdrawal Requests</SectionLabel>
          <Card>
            <div className="divide-y divide-slate-50">
              {withdrawals.map((wd) => {
                const s = WD_STATUS[wd.status] || { bg: "bg-slate-100", text: "text-slate-500", label: wd.status };
                return (
                  <div key={wd.id} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-sm font-bold text-slate-800">{formatBIF(wd.amount)}</p>
                      <p className="text-xs text-slate-400">{formatDate(wd.createdAt)}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${s.bg} ${s.text}`}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          </Card>
        </>
      )}

      {/* Recent completed */}
      <SectionLabel>Recent Withdrawals</SectionLabel>
      {recentTxns === null ? (
        <div className="space-y-2">{[1,2].map((i) => <div key={i} className="h-14 rounded-2xl bg-white border border-brand-100 animate-pulse" />)}</div>
      ) : recentTxns.length === 0 ? (
        <Card><EmptyState title="No withdrawals yet" subtitle="Your withdrawal history will appear here" /></Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-50">
            {recentTxns.map((t) => {
              const s = TXN_STATUS[t.status] || { bg: "bg-slate-100", text: "text-slate-500", label: t.status };
              return (
                <div key={t.id} className="flex items-center justify-between px-5 py-3.5">
                  <div>
                    <p className="text-sm font-bold text-slate-800">{formatBIF(t.amount)}</p>
                    <p className="text-xs text-slate-400">{formatDate(t.createdAt)}</p>
                  </div>
                  <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${s.bg} ${s.text}`}>{s.label}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </PageShell>
  );
}
