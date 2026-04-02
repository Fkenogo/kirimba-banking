import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES, ADMIN_ROUTES } from "../../config/console";

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatCurrency(value) {
  return `${formatNumber(value)} BIF`;
}

function percent(value) {
  if (value == null || Number.isNaN(value)) return "Unavailable";
  return `${(value * 100).toFixed(1)}%`;
}

function valueOrUnavailable(value, formatter = formatNumber) {
  if (value == null) return "Unavailable";
  return formatter(value);
}

const QUICK_LINKS_BY_ROLE = {
  [ADMIN_ROLES.SUPER_ADMIN]: [
    { label: "Transactions", to: "/admin/super/transactions" },
    { label: "Groups", to: "/admin/super/groups" },
    { label: "Loans", to: "/admin/loans" },
    { label: "Deposits & Batches", to: "/admin/deposits/pending" },
    { label: "Reconciliation & Settlements", to: ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS },
    { label: "Risk & Exceptions", to: ADMIN_ROUTES.RISK_EXCEPTIONS },
  ],
  [ADMIN_ROLES.ADMIN]: [
    { label: "Approvals", to: "/admin/approvals" },
    { label: "Loans", to: "/admin/loans" },
    { label: "Deposits & Batches", to: "/admin/deposits/pending" },
    { label: "Reconciliation & Settlements", to: ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS },
    { label: "Risk & Exceptions", to: ADMIN_ROUTES.RISK_EXCEPTIONS },
  ],
  [ADMIN_ROLES.FINANCE]: [
    { label: "Loans", to: "/admin/loans" },
    { label: "Portfolio Summary", to: "/admin/super/loans" },
    { label: "Deposits & Batches", to: "/admin/deposits/pending" },
    { label: "Reconciliation & Settlements", to: ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS },
  ],
};

function buildKpis(role, summary) {
  const kpis = summary?.kpis || {};

  const base = [
    {
      id: "total-members",
      label: "Total Members",
      value: valueOrUnavailable(kpis.totalMembers),
      helper: "Active approved members",
      tone: "slate",
      available: kpis.totalMembers != null,
    },
    {
      id: "active-groups",
      label: "Active Groups",
      value: valueOrUnavailable(kpis.activeGroups),
      helper: "Groups currently in service",
      tone: "teal",
      available: kpis.activeGroups != null,
    },
    {
      id: "confirmed-savings",
      label: "Confirmed Savings",
      value: valueOrUnavailable(kpis.confirmedSavings, formatCurrency),
      helper: "Current group savings base",
      tone: "emerald",
      available: kpis.confirmedSavings != null,
    },
    {
      id: "pending-savings",
      label: "Pending Savings",
      value: valueOrUnavailable(kpis.pendingSavings?.amount, formatCurrency),
      helper:
        kpis.pendingSavings?.count != null
          ? `${formatNumber(kpis.pendingSavings.count)} deposit records pending confirmation`
          : "Unavailable",
      tone: "amber",
      available: kpis.pendingSavings?.amount != null,
    },
    {
      id: "outstanding-loans",
      label: "Outstanding Loans",
      value: valueOrUnavailable(kpis.outstandingLoans, formatCurrency),
      helper: "Remaining balance across active loans",
      tone: "blue",
      available: kpis.outstandingLoans != null,
    },
    {
      id: "overdue-loans",
      label: "Overdue Loans",
      value: valueOrUnavailable(kpis.overdueLoans?.count),
      helper:
        kpis.overdueLoans?.amount != null
          ? `${formatCurrency(kpis.overdueLoans.amount)} at risk`
          : "Unavailable",
      tone: "amber",
      available: kpis.overdueLoans?.count != null,
    },
    {
      id: "defaulted-loans",
      label: "Defaulted Loans",
      value: valueOrUnavailable(kpis.defaultedLoans?.count),
      helper:
        kpis.defaultedLoans?.amount != null
          ? `${formatCurrency(kpis.defaultedLoans.amount)} already defaulted`
          : "Unavailable",
      tone: "rose",
      available: kpis.defaultedLoans?.count != null,
    },
    {
      id: "active-agents",
      label: "Active Agents",
      value: valueOrUnavailable(kpis.activeAgents),
      helper: "Field operations capacity",
      tone: "sky",
      available: kpis.activeAgents != null,
    },
    {
      id: "active-institutions",
      label: "Active Institutions",
      value: valueOrUnavailable(kpis.activeInstitutions),
      helper: "Institution network coverage",
      tone: "violet",
      available: kpis.activeInstitutions != null,
    },
  ];

  if (role === ADMIN_ROLES.ADMIN) {
    return [
      base[3],
      base[4],
      base[5],
      base[6],
      base[7],
      base[1],
    ];
  }

  if (role === ADMIN_ROLES.FINANCE) {
    return [
      base[2],
      base[3],
      base[4],
      base[5],
      base[6],
      base[8],
    ];
  }

  return base;
}

function buildHealthCards(role, summary) {
  const { health = {}, kpis = {} } = summary || {};

  const cards = [
    {
      id: "coverage",
      title: "Savings coverage",
      value: percent(health.savingsCoverageRatio),
      note: "Outstanding loans as a share of confirmed savings",
      tone: health.savingsCoverageRatio != null && health.savingsCoverageRatio > 0.8 ? "amber" : "emerald",
    },
    {
      id: "backlog",
      title: "Operations backlog",
      value: valueOrUnavailable(health.operationsBacklog),
      note: "Queued approvals, batches, reconciliations, and settlements",
      tone: health.operationsBacklog > 0 ? "amber" : "slate",
    },
    {
      id: "loan-posture",
      title: "Lending posture",
      value: health.lendingPaused ? "Paused" : "Active",
      note: health.lendingPaused ? "New lending is currently paused" : "New loan flow is open",
      tone: health.lendingPaused ? "amber" : "emerald",
    },
    {
      id: "network",
      title: "Operating network",
      value:
        kpis.activeAgents != null && kpis.activeInstitutions != null
          ? `${formatNumber(kpis.activeAgents)} agents / ${formatNumber(kpis.activeInstitutions)} institutions`
          : "Unavailable",
      note: "Delivery footprint supporting operations",
      tone: "slate",
    },
  ];

  if (role === ADMIN_ROLES.ADMIN) {
    return [
      cards[1],
      {
        id: "review-load",
        title: "Review workload",
        value:
          summary?.roleView?.pendingApprovalsCount != null
            ? `${formatNumber(summary.roleView.pendingApprovalsCount)} approvals`
            : "Unavailable",
        note: "Pending approvals currently in the queue",
        tone: summary?.roleView?.pendingApprovalsCount > 0 ? "amber" : "slate",
      },
      {
        id: "batch-pressure",
        title: "Batch pressure",
        value:
          summary?.roleView?.submittedBatchCount != null
            ? `${formatNumber(summary.roleView.submittedBatchCount)} submitted`
            : "Unavailable",
        note: "Deposit batches waiting on confirmation",
        tone: summary?.roleView?.submittedBatchCount > 0 ? "amber" : "slate",
      },
    ];
  }

  if (role === ADMIN_ROLES.FINANCE) {
    return [
      cards[0],
      {
        id: "settlement-queue",
        title: "Settlement queue",
        value:
          summary?.roleView?.settlementRequestedCount != null
            ? `${formatNumber(summary.roleView.settlementRequestedCount)} requested`
            : "Unavailable",
        note: "Settlement requests awaiting finance review",
        tone: summary?.roleView?.settlementRequestedCount > 0 ? "amber" : "slate",
      },
      {
        id: "approval-to-pay",
        title: "Approved but unpaid",
        value:
          summary?.roleView?.settlementApprovedCount != null
            ? `${formatNumber(summary.roleView.settlementApprovedCount)} payouts`
            : "Unavailable",
        note: "Approved settlements still awaiting payment",
        tone: summary?.roleView?.settlementApprovedCount > 0 ? "amber" : "slate",
      },
    ];
  }

  return cards;
}

export default function AdminDashboardScreen() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [summary, setSummary] = useState(null);
  const [role, setRole] = useState(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setError("");
      try {
        const fn = httpsCallable(functions, "getAdminDashboardSummary");
        const res = await fn({});
        if (!mounted) return;
        setSummary(res.data || null);
        setRole(res.data?.roleView?.role || null);
      } catch (err) {
        if (!mounted) return;
        setError(err.message || "Failed to load dashboard summary.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  const currentRole = role || summary?.roleView?.role || ADMIN_ROLES.ADMIN;
  const kpis = useMemo(() => buildKpis(currentRole, summary), [currentRole, summary]);
  const healthCards = useMemo(() => buildHealthCards(currentRole, summary), [currentRole, summary]);
  const attentionItems = summary?.attention || [];
  const quickLinks = QUICK_LINKS_BY_ROLE[currentRole] || QUICK_LINKS_BY_ROLE[ADMIN_ROLES.ADMIN];

  return (
    <main className="px-8 py-8">
      <div className="mx-auto max-w-7xl space-y-7">
        <section className="rounded-3xl border border-brand-100 bg-gradient-to-b from-white to-brand-50 p-7 shadow-sm">
          <div className="flex items-end justify-between gap-6">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Executive Dashboard
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {currentRole === ADMIN_ROLES.SUPER_ADMIN
                  ? "Business health, risk, and workload at a glance"
                  : currentRole === ADMIN_ROLES.FINANCE
                  ? "Finance operations, settlement pressure, and liquidity signals"
                  : "Operational workload, queue pressure, and active risk"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Prioritized around current business state and action queues, with drill-down entry
                kept secondary to the signals that matter right now.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3 text-right">
              <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
                Dashboard mode
              </p>
              <p className="mt-2 text-sm font-semibold text-slate-900">
                {currentRole === ADMIN_ROLES.SUPER_ADMIN
                  ? "Executive view"
                  : currentRole === ADMIN_ROLES.FINANCE
                  ? "Finance view"
                  : "Operations view"}
              </p>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm text-amber-800">{error}</p>
          </section>
        )}

        <section className="space-y-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-950">Executive KPI strip</h2>
            <p className="mt-1 text-sm text-slate-500">
              Real-time dashboard summary built from current business entities and operational queues.
            </p>
          </div>
          <div className={`grid gap-4 ${currentRole === ADMIN_ROLES.SUPER_ADMIN ? "grid-cols-3 xl:grid-cols-5" : "grid-cols-2 xl:grid-cols-3"}`}>
            {kpis.map((item) => (
              <KpiCard key={item.id} item={item} loading={loading} />
            ))}
          </div>
        </section>

        <section className="grid grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] gap-6">
          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-semibold text-slate-950">Operational attention</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Queues and exceptions that currently need operator review.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3">
              {attentionItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.route)}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 px-5 py-4 text-left transition hover:border-slate-300 hover:bg-brand-50"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] ${tonePill(item.tone)}`}>
                        {item.tone === "red" ? "Urgent" : item.tone === "amber" ? "Attention" : "Normal"}
                      </span>
                      <p className="text-sm font-medium text-slate-900">{item.label}</p>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-500">{item.description}</p>
                  </div>
                  <div className="text-right">
                    <p className={`text-3xl font-semibold tracking-tight ${toneText(item.tone)}`}>
                      {formatNumber(item.count)}
                    </p>
                    <p className="mt-1 text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Open items
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-950">Business health</h2>
              <p className="mt-1 text-sm text-slate-500">
                Compact signals for risk, backlog, and operating posture.
              </p>

              <div className="mt-5 grid gap-3">
                {healthCards.map((card) => (
                  <div key={card.id} className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-slate-700">{card.title}</p>
                      <p className={`text-lg font-semibold ${toneText(card.tone)}`}>{card.value}</p>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-slate-500">{card.note}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-950">Quick drill-downs</h2>
              <p className="mt-1 text-sm text-slate-500">
                Lightweight entry points into the most relevant modules for this role.
              </p>
              <div className="mt-5 flex flex-wrap gap-2.5">
                {quickLinks.map((link) => (
                  <button
                    key={link.to}
                    type="button"
                    onClick={() => navigate(link.to)}
                    className="rounded-full border border-brand-200 bg-white px-4 py-2 text-sm font-medium text-brand-700 transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-800"
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

function KpiCard({ item, loading }) {
  return (
    <article className={`rounded-3xl border p-5 shadow-sm ${toneSurface(item.tone)}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-65">{item.label}</p>
      <div className="mt-4 min-h-[52px]">
        {loading ? (
          <div className="h-8 w-24 animate-pulse rounded bg-white/25" />
        ) : item.available ? (
          <p className="text-2xl font-semibold tracking-tight">{item.value}</p>
        ) : (
          <p className="text-sm font-medium text-slate-500">Unavailable</p>
        )}
      </div>
      <p className={`mt-3 text-xs leading-5 ${item.tone === "slate" ? "text-slate-300" : "text-slate-500"}`}>
        {item.helper}
      </p>
    </article>
  );
}

function toneSurface(tone) {
  return {
    slate: "border-slate-900 bg-brand-500 text-white",
    teal: "border-teal-200 bg-teal-50 text-teal-900",
    emerald: "border-emerald-200 bg-emerald-50 text-emerald-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    rose: "border-rose-200 bg-rose-50 text-rose-900",
    sky: "border-sky-200 bg-sky-50 text-sky-900",
    violet: "border-violet-200 bg-violet-50 text-violet-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";
}

function toneText(tone) {
  return {
    slate: "text-slate-900",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    blue: "text-blue-700",
    red: "text-rose-700",
    rose: "text-rose-700",
  }[tone] || "text-slate-700";
}

function tonePill(tone) {
  return {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-100 text-amber-700",
    red: "bg-rose-100 text-rose-700",
  }[tone] || "bg-slate-100 text-slate-600";
}
