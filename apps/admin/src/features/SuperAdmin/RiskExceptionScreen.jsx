import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

const DEFAULT_FILTERS = {
  severity: "",
  exceptionType: "",
  entityType: "",
  status: "",
  institutionId: "",
  dateFrom: "",
  dateTo: "",
  query: "",
};

const SEVERITY_OPTIONS = [
  { value: "", label: "All severities" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];

const EXCEPTION_TYPE_OPTIONS = [
  { value: "", label: "All exception types" },
  { value: "flagged_batch", label: "Flagged batches" },
  { value: "flagged_reconciliation", label: "Flagged reconciliations" },
  { value: "defaulted_loan", label: "Defaulted loans" },
  { value: "suspended_user", label: "Suspended users" },
  { value: "suspended_group", label: "Suspended groups" },
  { value: "suspended_institution", label: "Suspended institutions" },
];

const ENTITY_TYPE_OPTIONS = [
  { value: "", label: "All entity types" },
  { value: "batch", label: "Batch" },
  { value: "reconciliation", label: "Reconciliation" },
  { value: "loan", label: "Loan" },
  { value: "group", label: "Group" },
  { value: "agent", label: "Agent" },
  { value: "admin", label: "Admin" },
  { value: "leader", label: "Leader" },
  { value: "member", label: "Member" },
  { value: "institution", label: "Institution" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "flagged", label: "Flagged" },
  { value: "defaulted", label: "Defaulted" },
  { value: "suspended", label: "Suspended" },
];

const ROLE_COPY = {
  [ADMIN_ROLES.SUPER_ADMIN]:
    "Unified intervention queue for flagged batches, defaulted lending exposure, suspended entities, and unresolved operational risk.",
  [ADMIN_ROLES.ADMIN]:
    "Read-first control surface for exceptions and suspensions. Intervention stays routed through the originating module where dedicated controls exist.",
};

const SEVERITY_STYLES = {
  high: "border-rose-200 bg-rose-50 text-rose-700",
  medium: "border-amber-200 bg-amber-50 text-amber-700",
  low: "border-sky-200 bg-sky-50 text-sky-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const STATUS_STYLES = {
  flagged: "border-amber-200 bg-amber-50 text-amber-700",
  defaulted: "border-rose-200 bg-rose-50 text-rose-700",
  suspended: "border-slate-300 bg-slate-100 text-slate-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatCurrency(value) {
  if (value == null || value === "") return "—";
  return `${formatNumber(value)} BIF`;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatDetailValue(key, value) {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    return /amount|due|principal|difference/i.test(key) ? formatCurrency(value) : formatNumber(value);
  }
  return value;
}

function toneClass(map, value) {
  return map[value] || map.default;
}

function describeCallableError(error, fallbackMessage) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  if (code && message) return `${fallbackMessage} (${code}: ${message})`;
  if (message) return `${fallbackMessage} (${message})`;
  return fallbackMessage;
}

function SummaryCard({ label, value, note, tone = "default" }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass(SEVERITY_STYLES, tone)}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {note ? <p className="mt-1.5 text-[12px] leading-5 text-slate-500">{note}</p> : null}
    </div>
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

function Badge({ map, value, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass(map, value)}`}>
      {children}
    </span>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm text-slate-700" : "text-sm text-slate-700"}>{value || "—"}</dd>
    </div>
  );
}

function Drawer({ open, onClose, title, subtitle, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35">
      <button type="button" aria-label="Close risk detail" className="flex-1" onClick={onClose} />
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

export default function RiskExceptionScreen() {
  const navigate = useNavigate();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);

  useEffect(() => {
    void loadConsole(appliedFilters);
  }, [appliedFilters]);

  async function loadConsole(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getRiskExceptionsConsole");
      const response = await fn(nextFilters);
      setPayload(response.data || null);
    } catch (loadError) {
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load risk and exception data right now."));
    } finally {
      setLoading(false);
    }
  }

  function setDraftField(key, value) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function handleApply(event) {
    event.preventDefault();
    setAppliedFilters(draftFilters);
  }

  function handleClear() {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  const role = payload?.role || ADMIN_ROLES.SUPER_ADMIN;
  const rows = payload?.rows || [];
  const institutions = payload?.filterOptions?.institutions || [];
  const summary = payload?.summary || {};
  const support = payload?.backendSupport || { actionsSupported: false, missing: [] };
  const readOnlyNote = support.actionsSupported
    ? null
    : "Read-only risk surface. Direct review and resolve actions remain in the source modules for now.";
  const coverageFootnote = support.missing?.[1] || "";

  const summaryCards = useMemo(
    () => [
      {
        id: "open",
        label: "Open exceptions",
        value: summary.openExceptions ?? 0,
        note: "Current filtered intervention queue",
        tone: "high",
      },
      {
        id: "flagged-batches",
        label: "Flagged batches",
        value: summary.flaggedBatches ?? 0,
        note: "Deposit batches held for review",
        tone: "medium",
      },
      {
        id: "suspended-groups",
        label: "Suspended groups",
        value: summary.suspendedGroups ?? 0,
        note: "Governance blocks requiring follow-up",
        tone: "high",
      },
      {
        id: "suspended-agents",
        label: "Suspended agents",
        value: summary.suspendedAgents ?? 0,
        note: "Field capacity currently unavailable",
        tone: "medium",
      },
      {
        id: "high-severity",
        label: "High severity",
        value: summary.highSeverityItems ?? 0,
        note: "Derived from defaults, suspensions, and flagged exposure",
        tone: "high",
      },
      {
        id: "flagged-reconciliations",
        label: "Flagged reconciliations",
        value: summary.flaggedReconciliations ?? 0,
        note: "Mismatches escalated for follow-up",
        tone: "medium",
      },
    ],
    [summary]
  );

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const emptyState = hasActiveFilters
    ? "No risk items match the current filters."
    : "No open risk or exception items are currently in backend scope.";
  const emptyHint = hasActiveFilters
    ? "Clear filters or widen the date range to broaden the queue."
    : "Flagged activity, suspensions, and unresolved exceptions will appear here as they enter scope.";

  return (
    <main className="px-8 py-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-5xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Risk & Exceptions
              </p>
              <h1 className="mt-2.5 text-[30px] font-semibold tracking-tight text-slate-950">
                Operational control surface for flagged activity, suspensions, and unresolved intervention items
              </h1>
              <p className="mt-2.5 max-w-4xl text-sm leading-6 text-slate-600">
                {ROLE_COPY[role] || ROLE_COPY[ADMIN_ROLES.SUPER_ADMIN]}
              </p>
            </div>

            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Action model</p>
              <p className="mt-1.5 font-medium text-slate-900">Read-first risk queue</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Intervention stays in the source module until dedicated review and resolve actions are wired for this console.
              </p>
              {readOnlyNote ? <p className="mt-2 text-[11px] leading-5 text-slate-400">{readOnlyNote}</p> : null}
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {summaryCards.map((card) => (
            <SummaryCard key={card.id} {...card} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the intervention queue by severity, exception type, entity, institution, status, date window, or reference.
              </p>
              <p className="mt-1 text-xs text-slate-400">Date filters are optional. Blank fields keep the full callable scope in view.</p>
            </div>
            <button
              type="button"
              onClick={() => void loadConsole()}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
            >
              Refresh
            </button>
          </div>

          <form className="mt-4 space-y-3" onSubmit={handleApply} autoComplete="off">
            <div className="flex flex-wrap gap-3">
              <FilterField label="Severity">
                <select
                  value={draftFilters.severity}
                  onChange={(event) => setDraftField("severity", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {SEVERITY_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Exception type">
                <select
                  value={draftFilters.exceptionType}
                  onChange={(event) => setDraftField("exceptionType", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {EXCEPTION_TYPE_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Entity type">
                <select
                  value={draftFilters.entityType}
                  onChange={(event) => setDraftField("entityType", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {ENTITY_TYPE_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Status">
                <select
                  value={draftFilters.status}
                  onChange={(event) => setDraftField("status", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
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

              <FilterField label="Date from">
                <input
                  type="date"
                  value={draftFilters.dateFrom}
                  onChange={(event) => setDraftField("dateFrom", event.target.value)}
                  autoComplete="off"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Date to">
                <input
                  type="date"
                  value={draftFilters.dateTo}
                  onChange={(event) => setDraftField("dateTo", event.target.value)}
                  autoComplete="off"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Search / reference">
                <input
                  type="text"
                  value={draftFilters.query}
                  onChange={(event) => setDraftField("query", event.target.value)}
                  placeholder="Entity name, ID, phone, or reference"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>
            </div>

            <div className="flex items-center justify-end gap-2">
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
          </form>
        </section>

        <section className="rounded-3xl border border-brand-100 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Intervention queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Unified queue of flagged activity, defaults, and suspensions requiring review or handoff.
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading risk and exception records…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto max-w-lg rounded-3xl border border-dashed border-slate-300 bg-brand-50 px-6 py-7">
                <p className="text-base font-semibold text-slate-800">{emptyState}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyHint}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1450px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">Issue type</th>
                    <th className="px-5 py-3">Entity</th>
                    <th className="px-5 py-3">Severity</th>
                    <th className="px-5 py-3">Source</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3">Handoff</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-brand-50/80">
                      <td className="px-5 py-4 align-top">
                        <button
                          type="button"
                          onClick={() => setSelectedRow(row)}
                          className="text-left"
                        >
                          <p className="font-medium text-slate-900">{row.title}</p>
                          <p className="mt-1 text-xs text-slate-500">{row.sourceRecordType || row.exceptionType}</p>
                          <p className="mt-2 font-mono text-[11px] text-slate-400">{row.reference}</p>
                        </button>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-700">
                        <p>{row.affectedEntity || "—"}</p>
                        <p className="mt-1 text-xs text-slate-400">{row.institutionName || "Unlinked"}</p>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <Badge map={SEVERITY_STYLES} value={row.severity}>{row.severity}</Badge>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-700">
                        <p>{row.sourceModule}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">{row.sourceRecordId || "—"}</p>
                      </td>
                      <td className="px-5 py-4 align-top">
                        <Badge map={STATUS_STYLES} value={row.status}>{row.statusLabel || row.status}</Badge>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-700">{formatDateTime(row.updatedAtMs || row.createdAtMs)}</td>
                      <td className="px-5 py-4 align-top text-slate-700">
                        {row.handoffTarget ? (
                          <>
                            <p className="text-sm font-medium text-slate-900">{row.handoffTarget}</p>
                            <p className="mt-1 text-xs text-slate-400">{row.handoffLabel || "Open source module"}</p>
                          </>
                        ) : (
                          <span className="text-xs text-slate-400">No clean deep link yet</span>
                        )}
                      </td>
                      <td className="px-5 py-4 align-top text-right">
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setSelectedRow(row)}
                            className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-brand-50"
                          >
                            Detail
                          </button>
                          {row.sourceRoute ? (
                            <button
                              type="button"
                              onClick={() => navigate(row.sourceRoute)}
                              className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600"
                            >
                              {row.handoffLabel || "Open source"}
                            </button>
                          ) : (
                            <span className="inline-flex items-center rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-400">
                              No route
                            </span>
                          )}
                        </div>
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
        onClose={() => setSelectedRow(null)}
        title={selectedRow?.title || "Risk detail"}
        subtitle={selectedRow?.sourceModule || "Risk & Exceptions"}
      >
        {selectedRow ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-brand-50 px-5 py-4">
              <p className="text-sm text-slate-700">{selectedRow.summary}</p>
              <p className="mt-3 text-sm font-medium text-slate-900">Why this is in risk scope</p>
              <p className="mt-1 text-sm text-slate-600">{selectedRow.riskReason || "This item currently meets the console's risk or exception criteria."}</p>
              <p className="mt-3 text-sm font-medium text-slate-900">Recommended next action</p>
              <p className="mt-1 text-sm text-slate-600">{selectedRow.recommendedAction || "Review this item in the originating module."}</p>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
              <dl className="space-y-4">
                <DetailRow label="Reference" value={selectedRow.reference} mono />
                <DetailRow label="Source module" value={selectedRow.sourceModule} />
                <DetailRow label="Source record type" value={selectedRow.sourceRecordType} />
                <DetailRow label="Source record ID" value={selectedRow.sourceRecordId} mono />
                <DetailRow label="Source reference" value={selectedRow.sourceReference} mono={Boolean(selectedRow.sourceReference)} />
                <DetailRow label="Entity" value={selectedRow.affectedEntity} />
                <DetailRow label="Entity type" value={selectedRow.entityType} />
                <DetailRow label="Severity" value={selectedRow.severity} />
                <DetailRow label="Status" value={selectedRow.statusLabel || selectedRow.status} />
                <DetailRow label="Institution" value={selectedRow.institutionName} />
                <DetailRow label="Amount / exposure" value={formatCurrency(selectedRow.amount)} />
                <DetailRow label="Created" value={formatDateTime(selectedRow.createdAtMs)} />
                <DetailRow label="Updated" value={formatDateTime(selectedRow.updatedAtMs || selectedRow.createdAtMs)} />
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Context</p>
              <dl className="mt-4 space-y-4">
                {Object.entries(selectedRow.detail || {}).map(([key, value]) => (
                  <DetailRow
                    key={key}
                    label={key.replace(/([A-Z])/g, " $1").replace(/^./, (char) => char.toUpperCase())}
                    value={formatDetailValue(key, value)}
                    mono={/id/i.test(key)}
                  />
                ))}
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white px-5 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-900">Source module handoff</p>
                  <p className="mt-1 text-sm text-slate-500">
                    Go to the owning module to review or act on this record.
                  </p>
                  <p className="mt-2 text-sm text-slate-700">
                    {selectedRow.handoffTarget
                      ? `Next place to act: ${selectedRow.handoffTarget}`
                      : "No direct route is available yet for this item type."}
                  </p>
                </div>
                {selectedRow.sourceRoute ? (
                  <button
                    type="button"
                    onClick={() => navigate(selectedRow.sourceRoute)}
                    className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    {selectedRow.handoffLabel || "Open source module"}
                  </button>
                ) : (
                  <span className="text-sm text-slate-400">No direct route available</span>
                )}
              </div>
              {coverageFootnote ? <p className="mt-3 text-[11px] leading-5 text-slate-400">{coverageFootnote}</p> : null}
            </section>
          </>
        ) : null}
      </Drawer>
    </main>
  );
}
