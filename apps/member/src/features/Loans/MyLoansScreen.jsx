import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { PageShell, Card, StatusBadge, PrimaryButton, formatBIF, formatDate } from "../../components/ui";

const TABS = [
  { key: "active", label: "Active / Pending" },
  { key: "all",    label: "All Loans" },
];

const STATUS_COLORS = {
  pending:   { bar: "bg-gold-400",  text: "text-gold-700"  },
  active:    { bar: "bg-brand-500", text: "text-brand-700" },
  repaid:    { bar: "bg-brand-400", text: "text-brand-600" },
  defaulted: { bar: "bg-red-500",   text: "text-red-700"   },
  rejected:  { bar: "bg-slate-300", text: "text-slate-500" },
};

export default function MyLoansScreen({ user, notifCount = 0 }) {
  const navigate = useNavigate();
  const [loans, setLoans]   = useState(null);
  const [wallet, setWallet] = useState(null);
  const [tab, setTab]       = useState("active");

  // Fetch loans
  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "loans"), where("userId", "==", user.uid), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(q, (snap) => setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [user?.uid]);

  // Fetch wallet for credit limit
  useEffect(() => {
    if (!user?.uid) return;
    const unsub = onSnapshot(doc(db, "wallets", user.uid), (snap) => {
      setWallet(snap.exists() ? snap.data() : null);
    });
    return () => unsub();
  }, [user?.uid]);

  const displayed = tab === "active"
    ? (loans || []).filter((l) => l.status === "active" || l.status === "pending")
    : (loans || []);

  const hasLoans = loans && loans.length > 0;
  const hasNoLoans = loans && loans.length === 0;

  // Calculate summary stats
  const activeCount = loans ? loans.filter((l) => l.status === "active" || l.status === "pending").length : 0;
  const totalBorrowed = loans ? loans.filter((l) => l.status !== "rejected").reduce((sum, l) => sum + (l.amount || 0), 0) : 0;
  const totalRepaid = loans ? loans.reduce((sum, l) => sum + (l.paidAmount || 0), 0) : 0;

  // Credit limit calculation
  const balanceConfirmed = Number(wallet?.balanceConfirmed || 0);
  const balanceLocked = Number(wallet?.balanceLocked || 0);
  const creditLimit = Math.max(0, balanceConfirmed * 1.5 - balanceLocked);

  return (
    <PageShell title="Loans" notifCount={notifCount}>

      {/* Loan Summary (only if has loans) */}
      {hasLoans && (
        <div className="bg-brand-500 rounded-2xl px-5 py-4 text-white shadow-card-lg relative overflow-hidden">
          <div className="absolute -top-6 -right-6 w-20 h-20 bg-brand-400 rounded-full opacity-30" />
          <div className="relative">
            <p className="text-xs text-brand-200 uppercase tracking-wide mb-3">Loan Summary</p>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-[10px] text-brand-200 uppercase tracking-wide mb-0.5">Active</p>
                <p className="text-xl font-bold">{activeCount}</p>
              </div>
              <div>
                <p className="text-[10px] text-brand-200 uppercase tracking-wide mb-0.5">Borrowed</p>
                <p className="text-xl font-bold">{formatBIF(totalBorrowed)}</p>
              </div>
              <div>
                <p className="text-[10px] text-brand-200 uppercase tracking-wide mb-0.5">Repaid</p>
                <p className="text-xl font-bold text-gold-300">{formatBIF(totalRepaid)}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Request Loan CTA (contextual) */}
      {hasLoans && (
        <PrimaryButton onClick={() => navigate("/app/loans/request")}>
          + Request Another Loan
        </PrimaryButton>
      )}

      {/* Tab switcher (only if has loans) */}
      {hasLoans && (
        <div className="flex bg-white rounded-2xl border border-brand-100 p-1 gap-1 shadow-card">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              className={`flex-1 rounded-xl py-2.5 text-xs font-bold transition-all ${
                tab === t.key ? "bg-brand-500 text-white shadow-sm" : "text-slate-500 hover:text-brand-600"
              }`}>
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Loan list or empty state */}
      {loans === null ? (
        <div className="space-y-3">
          {[1,2].map((i) => <div key={i} className="h-32 rounded-2xl bg-white border border-brand-100 animate-pulse" />)}
        </div>
      ) : hasNoLoans ? (
        <FirstLoanEmptyState creditLimit={creditLimit} navigate={navigate} />
      ) : displayed.length === 0 ? (
        <Card>
          <div className="px-5 py-10 text-center space-y-3">
            <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-bold text-slate-800">No {tab === "active" ? "active" : ""} loans</p>
              <p className="text-xs text-slate-400 mt-1">
                {tab === "active"
                  ? "You have no pending or active loans right now"
                  : "Switch to 'All Loans' to see your complete history"}
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {displayed.map((loan) => <LoanCard key={loan.id} loan={loan} />)}
        </div>
      )}
    </PageShell>
  );
}

// First-loan empty state with comprehensive guidance
function FirstLoanEmptyState({ creditLimit, navigate }) {
  return (
    <>
      {/* Hero banner */}
      <div className="bg-gradient-to-br from-brand-500 to-brand-600 rounded-2xl px-5 py-6 text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-8 -right-8 w-28 h-28 bg-brand-400 rounded-full opacity-20" />
        <div className="absolute -bottom-4 -left-4 w-20 h-20 bg-gold-400 rounded-full opacity-20" />
        <div className="relative text-center space-y-3">
          <div className="w-16 h-16 bg-brand-400 rounded-2xl flex items-center justify-center mx-auto">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-extrabold">Get Your First Loan</p>
            <p className="text-sm text-brand-100 mt-1">Fast, simple loans backed by your savings</p>
          </div>
        </div>
      </div>

      {/* Credit limit card */}
      <Card>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Your Credit Limit</p>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-brand-600">{formatBIF(creditLimit)}</span>
              <span className="text-sm text-slate-400">BIF</span>
            </div>
            <p className="text-xs text-slate-500 mt-2">
              You can borrow up to this amount based on your confirmed savings (1.5× your balance)
            </p>
          </div>

          {creditLimit === 0 && (
            <div className="bg-gold-50 border border-gold-200 rounded-xl px-3 py-3">
              <p className="text-xs text-gold-700 font-medium">
                💡 Make a deposit first to unlock your borrowing power
              </p>
            </div>
          )}
        </div>
      </Card>

      {/* How it works */}
      <Card>
        <div className="px-5 pt-4 pb-5 space-y-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">How Loans Work</p>
          <div className="space-y-3">
            {[
              { icon: "✓", label: "Request instantly", desc: "Choose amount and term (7, 14, or 30 days)" },
              { icon: "⚡", label: "Auto-approved", desc: "No waiting if within your credit limit" },
              { icon: "💰", label: "Collect from agent", desc: "Present QR code to receive cash" },
              { icon: "📅", label: "Repay on time", desc: "Avoid late fees and build credit" },
            ].map(({ icon, label, desc }) => (
              <div key={label} className="flex gap-3">
                <div className="w-8 h-8 bg-brand-50 rounded-xl flex items-center justify-center shrink-0 text-sm">
                  {icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{label}</p>
                  <p className="text-xs text-slate-500">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* CTA */}
      <PrimaryButton
        onClick={() => navigate("/app/loans/request")}
        disabled={creditLimit === 0}
      >
        {creditLimit === 0 ? "Deposit First to Unlock Loans" : "Request Your First Loan"}
      </PrimaryButton>

      {creditLimit === 0 && (
        <button
          onClick={() => navigate("/app/deposit")}
          className="w-full py-3 rounded-2xl border-2 border-brand-100 text-brand-600 font-bold text-sm hover:bg-brand-50 transition-colors"
        >
          Make a Deposit
        </button>
      )}
    </>
  );
}

function LoanCard({ loan }) {
  const isActive  = loan.status === "active";
  const isPending = loan.status === "pending";
  const isRepaid  = loan.status === "repaid";
  const isDefaulted = loan.status === "defaulted";
  const isRejected = loan.status === "rejected";

  const pct = isActive && loan.totalDue > 0
    ? Math.min(100, Math.round(((loan.paidAmount || 0) / loan.totalDue) * 100))
    : null;
  const colors = STATUS_COLORS[loan.status] || STATUS_COLORS.rejected;

  return (
    <Card>
      <div className="px-5 pt-4 pb-4 space-y-3">
        {/* Top row */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-2xl font-extrabold text-slate-900">{formatBIF(loan.amount)} <span className="text-sm font-normal text-slate-400">BIF</span></p>
            <p className="text-xs text-slate-500 mt-0.5">
              {loan.termDays}-day term · {((loan.interestRate || 0) * 100).toFixed(0)}% interest
            </p>
          </div>
          <StatusBadge status={loan.status} />
        </div>

        {/* Details grid */}
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          <Detail label="Total Due"  value={formatBIF(loan.totalDue)} />
          <Detail label="Paid"       value={formatBIF(loan.paidAmount)} />
          {isActive && (
            <>
              <Detail label="Remaining" value={formatBIF(loan.remainingDue)} valueClass="font-extrabold text-brand-600" />
              <Detail label="Due Date"  value={formatDate(loan.dueDate)} valueClass="font-bold" />
            </>
          )}
          {isPending && <Detail label="Requested" value={formatDate(loan.createdAt)} />}
          {isRepaid    && <Detail label="Repaid On"  value={formatDate(loan.repaidAt)} valueClass="text-brand-600" />}
          {isDefaulted && <Detail label="Defaulted"  value={formatDate(loan.defaultedAt)} valueClass="text-red-600 font-bold" />}
        </div>

        {/* Rejection reason */}
        {isRejected && loan.rejectionReason && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-red-500 uppercase tracking-wide font-bold mb-0.5">Rejection Reason</p>
            <p className="text-xs text-red-700 font-medium">{loan.rejectionReason}</p>
          </div>
        )}

        {/* Repayment progress bar */}
        {pct !== null && (
          <div>
            <div className="flex justify-between text-[10px] text-slate-400 mb-1.5">
              <span>Repayment Progress</span>
              <span className="font-bold text-brand-600">{pct}%</span>
            </div>
            <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
              <div className={`h-full ${colors.bar} rounded-full transition-all`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}

        {/* Status-specific guidance */}
        {isPending && (
          <div className="bg-gold-50 border border-gold-200 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-gold-600 uppercase tracking-wide font-bold mb-1">What's Next</p>
            <p className="text-xs text-gold-700 font-medium">
              Your loan is approved! Visit any agent and present your QR code to collect {formatBIF(loan.amount)} BIF.
            </p>
          </div>
        )}

        {isActive && loan.remainingDue > 0 && (
          <div className="bg-brand-50 border border-brand-200 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-brand-600 uppercase tracking-wide font-bold mb-1">How to Repay</p>
            <p className="text-xs text-brand-700 font-medium">
              Visit any agent with cash. Remaining due: <span className="font-extrabold">{formatBIF(loan.remainingDue)} BIF</span>
            </p>
          </div>
        )}

        {isRepaid && (
          <div className="bg-brand-50 border border-brand-200 rounded-xl px-3 py-2.5 flex items-center gap-2">
            <span className="text-base">✓</span>
            <p className="text-xs text-brand-700 font-medium">
              Loan fully repaid. Your collateral has been released!
            </p>
          </div>
        )}

        {isDefaulted && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <p className="text-[10px] text-red-600 uppercase tracking-wide font-bold mb-1">Action Required</p>
            <p className="text-xs text-red-700 font-medium">
              This loan is overdue. Contact support or visit an agent to resolve payment.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function Detail({ label, value, valueClass = "text-slate-800" }) {
  return (
    <div>
      <p className="text-[11px] text-slate-400 mb-0.5">{label}</p>
      <p className={`text-sm font-bold ${valueClass}`}>{value}</p>
    </div>
  );
}
