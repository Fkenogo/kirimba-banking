import { useNavigate } from "react-router-dom";
import { PageShell, Card } from "../../components/ui";

export default function ScanHubScreen({ user }) {
  const navigate = useNavigate();

  const actions = [
    {
      title: "Record Deposit",
      subtitle: "Scan member QR and record cash deposit",
      route: "/agent/scan-deposit",
      icon: <DepositIcon />,
      accent: "brand",
    },
    {
      title: "Process Withdrawal",
      subtitle: "Scan member QR and disburse cash",
      route: "/agent/withdrawals",
      icon: <WithdrawIcon />,
      accent: "slate",
    },
    {
      title: "Disburse Loan",
      subtitle: "Scan member QR and pay out approved loan",
      route: "/agent/loans/disburse",
      icon: <DisburseIcon />,
      accent: "gold",
    },
    {
      title: "Repay Loan",
      subtitle: "Scan member QR and record repayment",
      route: "/agent/loans/repay",
      icon: <RepayIcon />,
      accent: "slate",
    },
  ];

  return (
    <PageShell title="Scan" user={user}>
      <p className="text-center text-sm text-slate-500 mb-2">
        Select a transaction type
      </p>

      <div className="grid grid-cols-2 gap-3">
        {actions.map((action) => (
          <ActionCard
            key={action.route}
            title={action.title}
            subtitle={action.subtitle}
            icon={action.icon}
            accent={action.accent}
            onClick={() => navigate(action.route)}
          />
        ))}
      </div>
    </PageShell>
  );
}

/* ── Action Card Component ── */

function ActionCard({ title, subtitle, icon, accent, onClick }) {
  const accentClasses = {
    brand: "bg-brand-500 text-white",
    gold: "bg-gold-500 text-white",
    slate: "bg-white text-slate-800 border border-slate-100",
  };

  const iconBg = {
    brand: "bg-white/20",
    gold: "bg-white/20",
    slate: "bg-brand-50",
  };

  const iconColor = {
    brand: "text-white",
    gold: "text-white",
    slate: "text-brand-500",
  };

  const subtitleColor = {
    brand: "text-brand-100",
    gold: "text-gold-100",
    slate: "text-slate-400",
  };

  const cls = accentClasses[accent] || accentClasses.slate;
  const iBg = iconBg[accent] || iconBg.slate;
  const iColor = iconColor[accent] || iconColor.slate;
  const sColor = subtitleColor[accent] || subtitleColor.slate;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full rounded-2xl px-4 py-5 text-left shadow-card active:scale-[0.98] transition-transform ${cls}`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${iBg}`}>
        <span className={iColor}>{icon}</span>
      </div>
      <p className="text-sm font-bold leading-tight mb-1">{title}</p>
      <p className={`text-xs leading-snug ${sColor}`}>{subtitle}</p>
    </button>
  );
}

/* ── Icons ── */

function DepositIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
    </svg>
  );
}

function WithdrawIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function DisburseIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

function RepayIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  );
}
