import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES, ADMIN_ROUTES } from "../../config/console";

const DEFAULT_FILTERS = {
  dateFrom: "",
  dateTo: "",
  agentQuery: "",
  institutionId: "",
  reconciliationStatus: "",
  settlementStatus: "",
  exceptionOnly: false,
  reference: "",
};

const ROLE_COPY = {
  [ADMIN_ROLES.SUPER_ADMIN]:
    "Network-wide oversight for close-day variance, unreconciled submissions, settlement backlog, and payout traceability.",
  [ADMIN_ROLES.ADMIN]:
    "Operations review for close-day submissions, mismatch pressure, and settlement workflow without hidden financial overrides.",
  [ADMIN_ROLES.FINANCE]:
    "Finance-focused view of payout readiness, commission exposure, cash-control variance, and settlement completion state.",
};

const VIEW_OPTIONS = [
  {
    id: "overview",
    label: "Overview",
    description: "Cross-workflow summary.",
  },
  {
    id: "mismatch",
    label: "Mismatch Queue",
    description: "Reconciliation exceptions and review.",
  },
  {
    id: "settlement",
    label: "Settlement Queue",
    description: "Payout approval and payment flow.",
  },
];

const RECON_STATUS_OPTIONS = [
  { value: "", label: "All reconciliation states" },
  { value: "submitted", label: "Submitted" },
  { value: "reviewed", label: "Reviewed" },
  { value: "flagged", label: "Flagged" },
];

const SETTLEMENT_STATUS_OPTIONS = [
  { value: "", label: "All settlement states" },
  { value: "requested", label: "Requested" },
  { value: "approved", label: "Approved" },
  { value: "paid", label: "Paid" },
  { value: "rejected", label: "Rejected" },
];

const TONE_STYLES = {
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  red: "border-rose-200 bg-rose-50 text-rose-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
  default: "border-slate-200 bg-white text-slate-700",
};

function normalizeView(value) {
  return VIEW_OPTIONS.some((option) => option.id === value) ? value : null;
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatCurrency(value) {
  if (value == null) return "—";
  return `${formatNumber(value)} BIF`;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 24) return remainingMinutes ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days}d ${remainingHours}h` : `${days}d`;
}

function describeCallableError(error, fallbackMessage) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").trim();
  const cleanedMessage = message.replace(/^Firebase:\s*/i, "").trim();
  if (code && cleanedMessage) return `${fallbackMessage} (${code}: ${cleanedMessage})`;
  if (cleanedMessage) return `${fallbackMessage} (${cleanedMessage})`;
  return fallbackMessage;
}

function statusTone(status) {
  switch (status) {
    case "submitted":
    case "requested":
      return "amber";
    case "reviewed":
    case "approved":
      return "sky";
    case "paid":
      return "emerald";
    case "flagged":
    case "rejected":
      return "red";
    default:
      return "slate";
  }
}

function varianceTone(state) {
  if (state === "shortage") return "red";
  if (state === "overage") return "amber";
  if (state === "balanced") return "emerald";
  return "slate";
}

function varianceLabel(row) {
  if (row.kind !== "reconciliation") return "—";
  const amount = Number(row.difference || 0);
  if (amount === 0) return "Balanced";
  if (amount < 0) return `Short ${formatCurrency(Math.abs(amount))}`;
  return `Over ${formatCurrency(amount)}`;
}

function SummaryCard({ label, value, note, tone = "default" }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${TONE_STYLES[tone] || TONE_STYLES.default}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {note ? <p className="mt-1.5 text-[12px] leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function KpiGroup({ title, description, accent = "slate", children, muted = false }) {
  const accentMap = {
    amber: "border-amber-200 bg-amber-50/40",
    sky: "border-sky-200 bg-sky-50/40",
    slate: "border-slate-200 bg-brand-50/70",
  };

  return (
    <section
      className={`rounded-3xl border p-4 shadow-sm transition-opacity ${accentMap[accent] || accentMap.slate} ${
        muted ? "opacity-55" : "opacity-100"
      }`}
    >
      <div className="mb-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{title}</p>
        <p className="mt-1 text-sm text-slate-600">{description}</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ tone = "slate", children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${TONE_STYLES[tone] || TONE_STYLES.slate}`}>
      {children}
    </span>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[150px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm text-slate-700" : "text-sm text-slate-700"}>{value || "—"}</dd>
    </div>
  );
}

function Drawer({ open, title, subtitle, onClose, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35">
      <button type="button" aria-label="Close detail drawer" className="flex-1" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[680px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{subtitle}</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-brand-50"
            >
              Close
            </button>
          </div>
        </div>
        <div className="space-y-6 px-6 py-6">{children}</div>
      </aside>
    </div>
  );
}

function ActionButton({ children, className = "", ...props }) {
  return (
    <button
      type="button"
      className={`rounded-xl px-3 py-2 text-sm font-medium ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export default function ReconciliationSettlementsCenter({ defaultView = "overview" }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [approveDraft, setApproveDraft] = useState({ amount: "", notes: "" });
  const [payDraft, setPayDraft] = useState({ amount: "", reference: "", notes: "" });
  const view = normalizeView(searchParams.get("focus")) || defaultView;

  useEffect(() => {
    void loadConsole(appliedFilters);
  }, [appliedFilters]);

  async function loadConsole(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getReconciliationSettlementsConsole");
      const response = await fn(nextFilters);
      setPayload(response.data || null);
    } catch (loadError) {
      console.error("[ReconciliationSettlementsCenter] console load failed", loadError);
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load reconciliation and settlement data right now."));
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(row) {
    setSelectedRow(row);
    setDetail(null);
    setDetailError("");
    setActionError("");
    setDetailLoading(true);
    try {
      const fn = httpsCallable(functions, "getReconciliationSettlementDetail");
      const response = await fn({ kind: row.kind, itemId: row.id });
      const nextDetail = response.data?.detail || null;
      setDetail(nextDetail);
      setNoteDraft(nextDetail?.adminNote || "");
      setApproveDraft({
        amount: String(nextDetail?.approvedAmount || nextDetail?.commissionAmount || ""),
        notes: nextDetail?.approvalNotes || "",
      });
      setPayDraft({
        amount: String(nextDetail?.paidAmount || nextDetail?.approvedAmount || nextDetail?.commissionAmount || ""),
        reference: nextDetail?.paymentReference || "",
        notes: nextDetail?.paymentNotes || "",
      });
    } catch (loadError) {
      console.error("[ReconciliationSettlementsCenter] detail load failed", loadError);
      setDetail(null);
      setDetailError(describeCallableError(loadError, "We couldn't load that operational detail right now."));
    } finally {
      setDetailLoading(false);
    }
  }

  async function refreshDetail(row = selectedRow) {
    if (!row) return;
    try {
      const fn = httpsCallable(functions, "getReconciliationSettlementDetail");
      const response = await fn({ kind: row.kind, itemId: row.id });
      const nextDetail = response.data?.detail || null;
      setDetail(nextDetail);
      setSelectedRow((current) => ({ ...(current || row), ...nextDetail }));
      setNoteDraft(nextDetail?.adminNote || "");
      setApproveDraft({
        amount: String(nextDetail?.approvedAmount || nextDetail?.commissionAmount || ""),
        notes: nextDetail?.approvalNotes || "",
      });
      setPayDraft({
        amount: String(nextDetail?.paidAmount || nextDetail?.approvedAmount || nextDetail?.commissionAmount || ""),
        reference: nextDetail?.paymentReference || "",
        notes: nextDetail?.paymentNotes || "",
      });
    } catch (loadError) {
      console.error("[ReconciliationSettlementsCenter] detail refresh failed", loadError);
      setDetailError(describeCallableError(loadError, "We couldn't refresh that operational detail right now."));
    }
  }

  async function performAction(runAction) {
    setActionLoading(true);
    setActionError("");
    try {
      await runAction();
      await loadConsole();
      await refreshDetail();
    } catch (runError) {
      console.error("[ReconciliationSettlementsCenter] action failed", runError);
      setActionError(describeCallableError(runError, "The action could not be completed."));
    } finally {
      setActionLoading(false);
    }
  }

  function setDraftField(key, value) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function updateView(nextView) {
    const normalized = normalizeView(nextView) || defaultView;
    const nextParams = new URLSearchParams(searchParams);
    if (normalized === defaultView) {
      nextParams.delete("focus");
    } else {
      nextParams.set("focus", normalized);
    }
    setSearchParams(nextParams, { replace: true });
  }

  function handleApply(event) {
    event.preventDefault();
    setAppliedFilters(draftFilters);
  }

  function handleClear() {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
    updateView(defaultView);
  }

  const role = payload?.role || ADMIN_ROLES.SUPER_ADMIN;
  const institutions = payload?.filterOptions?.institutions || [];
  const rows = payload?.rows || [];

  const visibleRows = useMemo(() => {
    if (view === "mismatch") {
      return rows.filter((row) => row.kind === "reconciliation" && row.mismatch);
    }
    if (view === "settlement") {
      return rows.filter((row) => row.kind === "settlement");
    }
    return rows;
  }, [rows, view]);

  const summary = useMemo(() => {
    const source = view === "overview" ? payload?.summary || {} : {
      pendingReconciliations: visibleRows.filter((row) => row.kind === "reconciliation" && row.reconciliationStatus === "submitted").length,
      approvedReconciliations: visibleRows.filter((row) => row.kind === "reconciliation" && row.reconciliationStatus === "reviewed").length,
      unreconciledSubmissions: visibleRows.filter((row) => row.kind === "reconciliation" && (row.reconciliationStatus === "submitted" || row.reconciliationStatus === "flagged")).length,
      shortages: visibleRows.filter((row) => row.kind === "reconciliation" && row.varianceState === "shortage").length,
      overages: visibleRows.filter((row) => row.kind === "reconciliation" && row.varianceState === "overage").length,
      pendingSettlements: visibleRows.filter((row) => row.kind === "settlement" && row.settlementStatus === "requested").length,
      approvedNotPaidSettlements: visibleRows.filter((row) => row.kind === "settlement" && row.settlementStatus === "approved").length,
      paidSettlements: visibleRows.filter((row) => row.kind === "settlement" && row.settlementStatus === "paid").length,
      totalCommissionInScope: visibleRows.reduce((sum, row) => sum + Number(row.commissionAmount || 0), 0),
      oldestUnreconciledAgeMs: visibleRows
        .filter((row) => row.kind === "reconciliation" && (row.reconciliationStatus === "submitted" || row.reconciliationStatus === "flagged"))
        .reduce((maxAge, row) => Math.max(maxAge, row.sortAtMs ? Date.now() - row.sortAtMs : 0), 0) || null,
    };
    return source;
  }, [payload?.summary, view, visibleRows]);

  const reconciliationHealthCards = [
    {
      id: "pending-reconciliations",
      label: "Pending reconciliations",
      value: summary.pendingReconciliations ?? 0,
      note: "Close-day submissions still waiting for review",
      tone: "amber",
    },
    {
      id: "unreconciled",
      label: "Unreconciled",
      value: summary.unreconciledSubmissions ?? 0,
      note: summary.oldestUnreconciledAgeMs
        ? `Oldest open for ${formatDuration(summary.oldestUnreconciledAgeMs)}`
        : "No aging signal in current scope",
      tone: "amber",
    },
    {
      id: "shortages",
      label: "Shortages",
      value: summary.shortages ?? 0,
      note: "Declared cash came in below expected cash",
      tone: "red",
    },
    {
      id: "overages",
      label: "Overages",
      value: summary.overages ?? 0,
      note: "Declared cash exceeded expected cash",
      tone: "amber",
    },
  ];

  const settlementPipelineCards = [
    {
      id: "pending-settlements",
      label: "Pending settlements",
      value: summary.pendingSettlements ?? 0,
      note: "Requested payouts awaiting approval",
      tone: "amber",
    },
    {
      id: "approved-not-paid",
      label: "Approved not paid",
      value: summary.approvedNotPaidSettlements ?? 0,
      note: "Approved payouts still waiting for payment confirmation",
      tone: "sky",
    },
    {
      id: "paid",
      label: "Paid settlements",
      value: summary.paidSettlements ?? 0,
      note: "Settlements fully completed in current scope",
      tone: "emerald",
    },
  ];

  const financialSummaryCards = [
    {
      id: "commission",
      label: "Commission in scope",
      value: formatCurrency(summary.totalCommissionInScope ?? 0),
      note: "Requested, accrued, approved, or paid commission across visible rows",
      tone: "slate",
    },
  ];

  const hasActiveFilters = Object.values(appliedFilters).some((value) =>
    typeof value === "boolean" ? value : Boolean(String(value || "").trim())
  );

  const emptyState = useMemo(() => {
    if (view === "settlement") {
      return hasActiveFilters
        ? "No settlement items match this lane and filter set."
        : "No settlement items are in scope yet.";
    }
    if (view === "mismatch") {
      return hasActiveFilters
        ? "No reconciliation mismatches match this filter set."
        : "No reconciliation mismatches are open right now.";
    }
    return hasActiveFilters
      ? "No reconciliation or settlement items match this filter set."
      : "No reconciliation or settlement activity is in scope yet.";
  }, [hasActiveFilters, view]);

  const emptyStateHint = hasActiveFilters
    ? "Adjust the date range or clear filters to widen the queue."
    : "Items will appear here as close-day and payout activity enters scope.";

  const queueTitle =
    view === "mismatch"
      ? "Mismatch queue"
      : view === "settlement"
      ? "Settlement queue"
      : "Operational queue";

  const queueDescription =
    view === "mismatch"
      ? "Focused reconciliation lane for shortages, overages, and unreconciled submissions that need review."
      : view === "settlement"
      ? "Focused settlement lane for payout readiness, approval follow-through, and payment completion."
      : "Unified review of close-day submissions and settlement records with reconciliation mismatch visibility.";

  const showReconciliationGroup = view !== "settlement";
  const showSettlementGroup = view !== "mismatch";
  const reconciliationMuted = view === "overview" ? false : view !== "mismatch";
  const settlementMuted = view === "overview" ? false : view !== "settlement";

  return (
    <main className="px-8 py-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-5xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Reconciliation & Settlements Center
              </p>
              <h1 className="mt-2.5 text-[30px] font-semibold tracking-tight text-slate-950">
                Operating center for close-day submissions, mismatch pressure, settlement review, and payout traceability
              </h1>
              <p className="mt-2.5 max-w-4xl text-sm leading-6 text-slate-600">{ROLE_COPY[role]}</p>
            </div>

            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Operating model</p>
              <p className="mt-1.5 font-medium text-slate-900">Review with auditability</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Actions record actor and timestamps. This center does not expose silent overrides or ledger rewrites.
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </section>
        ) : null}

        <section className="rounded-3xl border border-slate-200 bg-white p-2 shadow-sm">
          <div className="grid gap-2 lg:grid-cols-3">
            {VIEW_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => updateView(option.id)}
                className={`rounded-[20px] border px-4 py-3 text-left transition-all ${
                  view === option.id
                    ? "border-slate-900 bg-brand-500 text-white shadow-sm"
                    : "border-slate-200 bg-brand-50 text-slate-700 hover:border-slate-300 hover:bg-white"
                }`}
              >
                <p className="text-[15px] font-semibold tracking-tight">{option.label}</p>
                <p className={`mt-1 text-xs leading-5 ${view === option.id ? "text-slate-200" : "text-slate-500"}`}>
                  {option.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          {showReconciliationGroup ? (
            <KpiGroup
              title="Reconciliation Health"
              description="Backlog and exception pressure across close-day review."
              accent="amber"
              muted={reconciliationMuted}
            >
              {reconciliationHealthCards.map((card) => (
                <SummaryCard key={card.id} {...card} />
              ))}
            </KpiGroup>
          ) : null}

          {showSettlementGroup ? (
            <KpiGroup
              title="Settlement Pipeline"
              description="Current payout throughput from request through payment completion."
              accent="sky"
              muted={settlementMuted}
            >
              {settlementPipelineCards.map((card) => (
                <SummaryCard key={card.id} {...card} />
              ))}
            </KpiGroup>
          ) : null}

          <KpiGroup
            title="Financial Summary"
            description="Financial scope across the currently visible operational lane."
            accent="slate"
          >
            {financialSummaryCards.map((card) => (
              <SummaryCard key={card.id} {...card} />
            ))}
          </KpiGroup>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the queue by agent, institution, review state, payout state, exceptions, and time window.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadConsole()}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
            >
              Refresh
            </button>
          </div>

          <form className="mt-4 space-y-3" onSubmit={handleApply}>
            <div className="flex flex-wrap gap-3">
              <FilterField label="Date from">
                <input
                  type="date"
                  value={draftFilters.dateFrom}
                  onChange={(event) => setDraftField("dateFrom", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>
              <FilterField label="Date to">
                <input
                  type="date"
                  value={draftFilters.dateTo}
                  onChange={(event) => setDraftField("dateTo", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>
              <FilterField label="Agent">
                <input
                  type="text"
                  value={draftFilters.agentQuery}
                  onChange={(event) => setDraftField("agentQuery", event.target.value)}
                  placeholder="Agent name or ID"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>
              <FilterField label="Institution">
                <select
                  value={draftFilters.institutionId}
                  onChange={(event) => setDraftField("institutionId", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">All institutions</option>
                  {institutions.map((institution) => (
                    <option key={institution.id} value={institution.id}>
                      {institution.name}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Reconciliation state">
                <select
                  value={draftFilters.reconciliationStatus}
                  onChange={(event) => setDraftField("reconciliationStatus", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {RECON_STATUS_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Settlement state">
                <select
                  value={draftFilters.settlementStatus}
                  onChange={(event) => setDraftField("settlementStatus", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {SETTLEMENT_STATUS_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Reference">
                <input
                  type="text"
                  value={draftFilters.reference}
                  onChange={(event) => setDraftField("reference", event.target.value)}
                  placeholder="Settlement ID or reconciliation ID"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={draftFilters.exceptionOnly}
                  onChange={(event) => setDraftField("exceptionOnly", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Exceptions only
              </label>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClear}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                >
                  Clear
                </button>
                <button
                  type="submit"
                  className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Apply filters
                </button>
              </div>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-brand-100 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">{queueTitle}</h2>
              <p className="mt-1 text-sm text-slate-500">
                {queueDescription}
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${visibleRows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading reconciliation and settlement records…</div>
          ) : visibleRows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto max-w-lg rounded-3xl border border-dashed border-slate-300 bg-brand-50 px-6 py-7">
                <p className="text-base font-semibold text-slate-800">{emptyState}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyStateHint}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1500px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3">Date / period</th>
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3">Institution</th>
                    <th className="px-5 py-3 text-right">Expected</th>
                    <th className="px-5 py-3 text-right">Declared</th>
                    <th className="px-5 py-3">Variance</th>
                    <th className="px-5 py-3">Reconciliation</th>
                    <th className="px-5 py-3">Settlement</th>
                    <th className="px-5 py-3 text-right">Commission</th>
                    <th className="px-5 py-3">Exceptions</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {visibleRows.map((row) => (
                    <tr key={`${row.kind}-${row.id}`} className="hover:bg-brand-50">
                      <td className="px-5 py-4 align-top">
                        <StatusBadge tone={row.kind === "settlement" ? "sky" : "slate"}>
                          {row.kind === "settlement" ? "Settlement" : "Reconciliation"}
                        </StatusBadge>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-700">
                        <div>{row.kind === "settlement" ? `${row.periodStart || "—"} to ${row.periodEnd || "—"}` : row.operationalDate || "—"}</div>
                        <div className="mt-1 text-xs text-slate-400">{formatDateTime(row.sortAtMs)}</div>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-700">{row.agentName}</td>
                      <td className="px-5 py-4 align-top text-slate-700">{row.institutionName || "Unlinked"}</td>
                      <td className="px-5 py-4 align-top text-right text-slate-700">{formatCurrency(row.expectedCash)}</td>
                      <td className="px-5 py-4 align-top text-right text-slate-700">{formatCurrency(row.declaredCash)}</td>
                      <td className="px-5 py-4 align-top">
                        <StatusBadge tone={varianceTone(row.varianceState)}>{varianceLabel(row)}</StatusBadge>
                      </td>
                      <td className="px-5 py-4 align-top">
                        {row.reconciliationStatus ? (
                          <StatusBadge tone={statusTone(row.reconciliationStatus)}>{row.reconciliationStatus}</StatusBadge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-top">
                        {row.settlementStatus ? (
                          <StatusBadge tone={statusTone(row.settlementStatus)}>{row.settlementStatus}</StatusBadge>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-top text-right font-semibold text-slate-900">{formatCurrency(row.commissionAmount)}</td>
                      <td className="px-5 py-4 align-top">
                        {row.mismatch ? (
                          <StatusBadge tone="red">
                            {row.kind === "reconciliation" ? "Mismatch" : "Follow up"}
                          </StatusBadge>
                        ) : (
                          <span className="text-xs text-slate-400">No exception</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        <button
                          type="button"
                          onClick={() => void openDetail(row)}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Drawer
        open={Boolean(selectedRow)}
        title={detail?.reference || selectedRow?.reference || "Operational detail"}
        subtitle="Operational detail"
        onClose={() => {
          setSelectedRow(null);
          setDetail(null);
          setDetailError("");
          setActionError("");
        }}
      >
        {detailLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-brand-50 px-5 py-8 text-center text-sm text-slate-500">
            Loading operational detail…
          </div>
        ) : detailError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{detailError}</div>
        ) : detail ? (
          <>
            <section className="rounded-3xl border border-slate-200 bg-brand-50 px-5 py-5">
              <div className="flex flex-wrap items-center gap-2">
                {detail.kind === "reconciliation" ? (
                  <StatusBadge tone={statusTone(detail.reconciliationStatus)}>{detail.reconciliationStatus}</StatusBadge>
                ) : (
                  <StatusBadge tone={statusTone(detail.settlementStatus)}>{detail.settlementStatus}</StatusBadge>
                )}
                <StatusBadge tone={detail.kind === "reconciliation" ? varianceTone(detail.varianceState) : "slate"}>
                  {detail.kind === "reconciliation" ? varianceLabel(detail) : "Payout workflow"}
                </StatusBadge>
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{detail.nextStepGuidance}</p>
            </section>

            {actionError ? (
              <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
                {actionError}
              </section>
            ) : null}

            <section className="grid gap-4 sm:grid-cols-3">
              <SummaryCard label="Expected cash" value={formatCurrency(detail.expectedCash)} note="Expected cash for the close-day submission" />
              <SummaryCard label="Declared cash" value={formatCurrency(detail.declaredCash)} note="Declared cash submitted by the agent" />
              <SummaryCard label="Commission" value={formatCurrency(detail.commissionAmount)} note="Commission accrued or requested in scope" />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Identity</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Reference" value={detail.reference} mono />
                <DetailRow label="Agent" value={detail.agentName} />
                <DetailRow label="Institution" value={detail.institutionName} />
                {detail.kind === "reconciliation" ? (
                  <>
                    <DetailRow label="Operational date" value={detail.operationalDate} />
                    <DetailRow label="Deposits" value={detail.depositCount} />
                    <DetailRow label="Withdrawals" value={detail.withdrawCount} />
                    <DetailRow label="Offline pending" value={detail.offlinePendingCount} />
                  </>
                ) : (
                  <>
                    <DetailRow label="Period" value={`${detail.periodStart || "—"} to ${detail.periodEnd || "—"}`} />
                    <DetailRow label="Approved amount" value={formatCurrency(detail.approvedAmount)} />
                    <DetailRow label="Paid amount" value={formatCurrency(detail.paidAmount)} />
                    <DetailRow label="Payment ref" value={detail.paymentReference} mono />
                  </>
                )}
                <DetailRow label="Created" value={formatDateTime(detail.createdAtMs)} />
                <DetailRow label="Approved / reviewed" value={formatDateTime(detail.approvedAtMs || detail.reviewedAtMs)} />
                <DetailRow label="Paid" value={formatDateTime(detail.paidAtMs)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Status history</h3>
              {detail.statusHistory?.length ? (
                <ul className="mt-4 space-y-3">
                  {detail.statusHistory.map((item) => (
                    <li key={`${item.label}-${item.atMs}`} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
                      <span className="text-sm font-medium text-slate-700">{item.label}</span>
                      <span className="text-sm text-slate-500">{formatDateTime(item.atMs)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No status history is available.</p>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Related operational context</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Linked records surfaced from the current data model without exposing hidden financial edits.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Link
                    to="/admin/deposits/pending"
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                  >
                    Deposits
                  </Link>
                  <Link
                    to={ADMIN_ROUTES.DASHBOARD}
                    className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                  >
                    Dashboard
                  </Link>
                </div>
              </div>

              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-700">
                    {detail.kind === "reconciliation" ? "Related settlements" : "Related reconciliations"}
                  </p>
                  {detail.kind === "reconciliation" ? (
                    detail.relatedSettlements?.length ? (
                      <ul className="mt-3 space-y-2">
                        {detail.relatedSettlements.map((item) => (
                          <li key={item.id} className="flex items-center justify-between text-sm text-slate-600">
                            <span>{item.period}</span>
                            <span>{item.status} · {formatCurrency(item.amount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">No settlement request currently overlaps this operational date.</p>
                    )
                  ) : detail.relatedReconciliations?.length ? (
                    <ul className="mt-3 space-y-2">
                      {detail.relatedReconciliations.map((item) => (
                        <li key={item.id} className="flex items-center justify-between text-sm text-slate-600">
                          <span>{item.date}</span>
                          <span>{item.status} · {formatCurrency(item.difference)}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">No related reconciliation submissions were found for this payout period.</p>
                  )}
                </div>

                <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-700">
                    {detail.kind === "reconciliation" ? "Related deposit batches" : "Notes"}
                  </p>
                  {detail.kind === "reconciliation" ? (
                    detail.relatedBatches?.length ? (
                      <ul className="mt-3 space-y-2">
                        {detail.relatedBatches.map((item) => (
                          <li key={item.id} className="flex items-center justify-between text-sm text-slate-600">
                            <span>{item.id}</span>
                            <span>{item.status} · {formatCurrency(item.totalAmount)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 text-sm text-slate-500">No same-day deposit batch context was found for this agent.</p>
                    )
                  ) : (
                    <div className="mt-3 space-y-3 text-sm text-slate-600">
                      <p><span className="font-medium text-slate-700">Request note:</span> {detail.notes || "No request note recorded."}</p>
                      <p><span className="font-medium text-slate-700">Approval note:</span> {detail.approvalNotes || "No approval note recorded."}</p>
                      <p><span className="font-medium text-slate-700">Payment note:</span> {detail.paymentNotes || "No payment note recorded."}</p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Actions</h3>
              <p className="mt-1 text-sm text-slate-500">
                Only workflow-safe actions are exposed here. Every status change records actor and timestamp.
              </p>

              {detail.kind === "reconciliation" ? (
                <div className="mt-4 space-y-4">
                  <label className="block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                    Review note
                    <textarea
                      rows={3}
                      value={noteDraft}
                      onChange={(event) => setNoteDraft(event.target.value)}
                      className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-700"
                      placeholder="Add internal review context or escalation notes"
                    />
                  </label>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionButton
                      disabled={actionLoading || detail.reconciliationStatus === "reviewed"}
                      onClick={() =>
                        void performAction(async () => {
                          const fn = httpsCallable(functions, "adminUpdateReconciliation");
                          await fn({ docId: detail.id, status: "reviewed", adminNote: noteDraft.trim() || undefined });
                        })
                      }
                      className="bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60"
                    >
                      {actionLoading ? "Working…" : "Mark reviewed"}
                    </ActionButton>
                    <ActionButton
                      disabled={actionLoading || detail.reconciliationStatus === "flagged"}
                      onClick={() =>
                        void performAction(async () => {
                          const fn = httpsCallable(functions, "adminUpdateReconciliation");
                          await fn({ docId: detail.id, status: "flagged", adminNote: noteDraft.trim() || undefined });
                        })
                      }
                      className="bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-60"
                    >
                      {actionLoading ? "Working…" : "Flag for follow-up"}
                    </ActionButton>
                  </div>
                </div>
              ) : detail.settlementStatus === "requested" ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Approved amount
                      <input
                        type="number"
                        min="0"
                        value={approveDraft.amount}
                        onChange={(event) => setApproveDraft((current) => ({ ...current, amount: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-700"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Approval note
                      <input
                        type="text"
                        value={approveDraft.notes}
                        onChange={(event) => setApproveDraft((current) => ({ ...current, notes: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-700"
                        placeholder="Internal payout note"
                      />
                    </label>
                  </div>
                  <ActionButton
                    disabled={actionLoading}
                    onClick={() =>
                      void performAction(async () => {
                        const fn = httpsCallable(functions, "approveSettlement");
                        await fn({
                          settlementId: detail.id,
                          approvedAmount: approveDraft.amount ? Number(approveDraft.amount) : undefined,
                          notes: approveDraft.notes.trim() || undefined,
                        });
                      })
                    }
                    className="bg-sky-700 text-white hover:bg-sky-800 disabled:opacity-60"
                  >
                    {actionLoading ? "Working…" : "Approve settlement"}
                  </ActionButton>
                </div>
              ) : detail.settlementStatus === "approved" ? (
                <div className="mt-4 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-3">
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Paid amount
                      <input
                        type="number"
                        min="0"
                        value={payDraft.amount}
                        onChange={(event) => setPayDraft((current) => ({ ...current, amount: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-700"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Payment reference
                      <input
                        type="text"
                        value={payDraft.reference}
                        onChange={(event) => setPayDraft((current) => ({ ...current, reference: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-700"
                        placeholder="Receipt or transfer reference"
                      />
                    </label>
                    <label className="block text-xs font-medium uppercase tracking-[0.14em] text-slate-400">
                      Payment note
                      <input
                        type="text"
                        value={payDraft.notes}
                        onChange={(event) => setPayDraft((current) => ({ ...current, notes: event.target.value }))}
                        className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-3 text-sm text-slate-700"
                        placeholder="Optional payout context"
                      />
                    </label>
                  </div>
                  <ActionButton
                    disabled={actionLoading || !payDraft.reference.trim()}
                    onClick={() =>
                      void performAction(async () => {
                        const fn = httpsCallable(functions, "markSettlementPaid");
                        await fn({
                          settlementId: detail.id,
                          paidAmount: payDraft.amount ? Number(payDraft.amount) : undefined,
                          paymentReference: payDraft.reference.trim(),
                          notes: payDraft.notes.trim() || undefined,
                        });
                      })
                    }
                    className="bg-brand-500 text-white hover:bg-brand-600 disabled:opacity-60"
                  >
                    {actionLoading ? "Working…" : "Mark settlement paid"}
                  </ActionButton>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4 text-sm text-slate-500">
                  No further safe action is available for the current status.
                </div>
              )}
            </section>
          </>
        ) : null}
      </Drawer>
    </main>
  );
}
