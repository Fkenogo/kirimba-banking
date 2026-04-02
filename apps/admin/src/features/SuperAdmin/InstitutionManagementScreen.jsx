import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const DEFAULT_FILTERS = {
  status: "",
  institutionType: "",
  country: "",
  query: "",
};

const DEFAULT_CREATE_FORM = {
  name: "",
  code: "",
  institutionType: "",
  country: "BI",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  settlementReferencePrefix: "",
  notes: "",
  supportsDeposits: true,
  supportsWithdrawals: true,
  supportsLoans: false,
};

const STATUS_STYLES = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  suspended: "border-rose-200 bg-rose-50 text-rose-700",
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  onboarding: "border-amber-200 bg-amber-50 text-amber-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const TONE_STYLES = {
  stable: "border-slate-200 bg-white",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70",
  danger: "border-rose-200 bg-rose-50/70",
};

const COUNTRY_LABELS = {
  BI: "Burundi",
  RW: "Rwanda",
  UG: "Uganda",
  TZ: "Tanzania",
  KE: "Kenya",
  CD: "DR Congo",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatDateTime(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No timestamp";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatDateValue(value) {
  if (!value) return "No timestamp";
  if (typeof value === "string" || typeof value === "number") return formatDateTime(value);
  if (typeof value?.toMillis === "function") return formatDateTime(value.toMillis());
  if (typeof value?._seconds === "number") return formatDateTime(value._seconds * 1000);
  return "No timestamp";
}

function formatLabel(value) {
  return String(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function describeCallableError(error, fallbackMessage) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  if (code && message) return `${fallbackMessage} (${code}: ${message})`;
  if (message) return `${fallbackMessage} (${message})`;
  return fallbackMessage;
}

function toneClass(map, value) {
  return map[value] || map.default || "";
}

function SummaryCard({ label, value, note, tone = "stable" }) {
  return (
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass(TONE_STYLES, tone)}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{value}</p>
      {note ? <p className="mt-1.5 text-[12px] leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="flex min-w-[180px] flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Badge({ children, toneMap = STATUS_STYLES, value = "default" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass(toneMap, value)}`}>
      {children}
    </span>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[180px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm text-slate-700" : "text-sm text-slate-700"}>{value || "—"}</dd>
    </div>
  );
}

function Drawer({ open, onClose, title, subtitle, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35">
      <button type="button" aria-label="Close institution detail" className="flex-1" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[720px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
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

function Dialog({ open, title, body, onClose, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-3xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            {body ? <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-brand-50"
          >
            Close
          </button>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </div>
  );
}

function ConfirmationDialog({
  open,
  title,
  body,
  confirmLabel,
  confirmTone = "dark",
  onCancel,
  onConfirm,
  confirmDisabled = false,
  children,
}) {
  if (!open) return null;

  const confirmClass =
    confirmTone === "danger"
      ? "bg-rose-600 text-white hover:bg-rose-700"
      : "bg-brand-500 text-white hover:bg-brand-600";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-lg rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {body ? <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p> : null}
        <div className="mt-4">{children}</div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`rounded-xl px-4 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${confirmClass}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionButton({ tone = "neutral", children, ...props }) {
  const toneClasses =
    tone === "danger"
      ? "border-rose-300 text-rose-700 hover:bg-rose-50"
      : tone === "success"
      ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50"
      : "border-slate-300 text-slate-700 hover:bg-brand-50";

  return (
    <button
      type="button"
      {...props}
      className={`rounded-xl border px-3 py-2 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${toneClasses} ${props.className || ""}`}
    >
      {children}
    </button>
  );
}

export default function InstitutionManagementScreen() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedInstitutionId, setSelectedInstitutionId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [reactivateTarget, setReactivateTarget] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_CREATE_FORM);
  const [createError, setCreateError] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [freshInstitution, setFreshInstitution] = useState(null);

  useEffect(() => {
    void loadConsole(appliedFilters);
  }, [appliedFilters]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    resetCreateFlow();
    setCreateOpen(true);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("create");
    setSearchParams(nextParams, { replace: true });
  }, [searchParams, setSearchParams]);

  async function loadConsole(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getInstitutionsConsole");
      const response = await fn(nextFilters);
      const nextPayload = response.data || null;
      setPayload(nextPayload);

      const nextRows = nextPayload?.rows || [];
      setSelectedInstitutionId((current) => {
        if (current && nextRows.some((row) => row.id === current)) return current;
        return "";
      });
    } catch (loadError) {
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load institution records right now."));
    } finally {
      setLoading(false);
    }
  }

  function setDraftField(key, value) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  function setCreateField(key, value) {
    setCreateForm((current) => ({ ...current, [key]: value }));
  }

  function resetCreateFlow() {
    setCreateForm(DEFAULT_CREATE_FORM);
    setCreateError("");
    setCreateSubmitting(false);
    setFreshInstitution(null);
  }

  function handleApply(event) {
    event.preventDefault();
    setAppliedFilters(draftFilters);
  }

  function handleClear() {
    setDraftFilters(DEFAULT_FILTERS);
    setAppliedFilters(DEFAULT_FILTERS);
  }

  async function handleSuspendConfirm() {
    if (!suspendTarget || !suspendReason.trim()) return;
    setActionLoading(suspendTarget.id);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "suspendInstitution");
      await fn({ institutionId: suspendTarget.id, reason: suspendReason.trim() });
      setSuspendTarget(null);
      setSuspendReason("");
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Suspension failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function handleReactivateConfirm() {
    if (!reactivateTarget) return;
    setActionLoading(reactivateTarget.id);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "reactivateInstitution");
      await fn({ institutionId: reactivateTarget.id });
      setReactivateTarget(null);
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Reactivation failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function handleCreateInstitution(event) {
    event.preventDefault();
    setCreateSubmitting(true);
    setCreateError("");
    try {
      const fn = httpsCallable(functions, "createInstitution");
      const response = await fn({
        name: createForm.name.trim(),
        code: createForm.code.trim(),
        institutionType: createForm.institutionType.trim() || null,
        country: createForm.country,
        contactName: createForm.contactName.trim() || null,
        contactEmail: createForm.contactEmail.trim() || null,
        contactPhone: createForm.contactPhone.trim() || null,
        settlementReferencePrefix: createForm.settlementReferencePrefix.trim() || null,
        notes: createForm.notes.trim() || null,
        supportsDeposits: createForm.supportsDeposits,
        supportsWithdrawals: createForm.supportsWithdrawals,
        supportsLoans: createForm.supportsLoans,
      });
      setFreshInstitution({
        institutionId: response.data?.institutionId || "",
        name: createForm.name.trim(),
        code: createForm.code.trim().toUpperCase(),
        country: createForm.country,
        contactName: createForm.contactName.trim() || null,
        contactEmail: createForm.contactEmail.trim() || null,
        contactPhone: createForm.contactPhone.trim() || null,
      });
      await loadConsole();
    } catch (runError) {
      setCreateError(describeCallableError(runError, "Institution creation failed."));
    } finally {
      setCreateSubmitting(false);
    }
  }

  const rows = payload?.rows || [];
  const summary = payload?.summary || {};
  const filterOptions = payload?.filterOptions || { statuses: [], institutionTypes: [], countries: [] };
  const support = payload?.backendSupport || { missing: [], linkedOperationalMetrics: [] };
  const selectedInstitution = rows.find((row) => row.id === selectedInstitutionId) || null;
  const canCreateInstitution = support.createSupported !== false;

  const summaryCards = useMemo(() => {
    const cards = [
      {
        id: "total",
        label: "Total institutions",
        value: formatNumber(summary.totalInstitutions),
        note: "Current partner institution footprint",
        tone: "stable",
      },
      {
        id: "active",
        label: "Active institutions",
        value: formatNumber(summary.activeInstitutions),
        note: "Available for live operational use",
        tone: "success",
      },
      {
        id: "suspended",
        label: "Suspended institutions",
        value: formatNumber(summary.suspendedInstitutions),
        note: "Currently blocked from active service",
        tone: summary.suspendedInstitutions > 0 ? "danger" : "stable",
      },
      {
        id: "issues",
        label: "With open issues",
        value: formatNumber(summary.institutionsWithOpenOperationalIssues),
        note: "Derived from flagged batches, flagged reconciliations, and linked suspended actors",
        tone: summary.institutionsWithOpenOperationalIssues > 0 ? "warning" : "stable",
      },
    ];

    if (summary.pendingInstitutions > 0 || support.pendingStateSupported) {
      cards.splice(3, 0, {
        id: "pending",
        label: "Pending or onboarding",
        value: formatNumber(summary.pendingInstitutions),
        note: "Shown when institutions are still awaiting go-live status",
        tone: summary.pendingInstitutions > 0 ? "warning" : "stable",
      });
    }

    return cards;
  }, [summary, support.pendingStateSupported]);

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const emptyTitle = hasActiveFilters
    ? "No institutions match the current filters."
    : "No institution records are currently available.";
  const emptyHint = hasActiveFilters
    ? "Clear filters or broaden the search to bring records back into scope."
    : "Records will appear here once partner institutions are added.";

  return (
    <main className="px-8 py-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-5xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Administration / Institutions
              </p>
              <h1 className="mt-2.5 text-[30px] font-semibold tracking-tight text-slate-950">
                Partner institution management for operational status, metadata, and linked platform context
              </h1>
              <p className="mt-2.5 max-w-4xl text-sm leading-6 text-slate-600">
                Review institution status, core profile data, linked operating counts, and current issue signals from one administration surface.
              </p>
            </div>

            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Action model</p>
              <p className="mt-1.5 font-medium text-slate-900">Create records, then invite institution users</p>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                Create new institution records here, then continue into User Provisioning when the institution is ready for its first linked user.
              </p>
              {canCreateInstitution ? (
                <button
                  type="button"
                  onClick={() => {
                    resetCreateFlow();
                    setCreateOpen(true);
                  }}
                  className="mt-3 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Create institution
                </button>
              ) : null}
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </section>
        ) : null}

        {actionError ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{actionError}</p>
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {summaryCards.map((card) => (
            <SummaryCard key={card.id} {...card} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the directory by status, institution type, country, or direct search against institution name, code, ID, and contact metadata.
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

          <form className="mt-4 space-y-3" onSubmit={handleApply} autoComplete="off">
            <div className="flex flex-wrap gap-3">
              <FilterField label="Status">
                <select
                  value={draftFilters.status}
                  onChange={(event) => setDraftField("status", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">All statuses</option>
                  {filterOptions.statuses.map((option) => (
                    <option key={option.value} value={option.value}>
                      {formatLabel(option.label)}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Institution type">
                <select
                  value={draftFilters.institutionType}
                  onChange={(event) => setDraftField("institutionType", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">All types</option>
                  {filterOptions.institutionTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {formatLabel(option.label)}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Country">
                <select
                  value={draftFilters.country}
                  onChange={(event) => setDraftField("country", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">All countries</option>
                  {filterOptions.countries.map((option) => (
                    <option key={option.value} value={option.value}>
                      {COUNTRY_LABELS[option.value] || option.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Search">
                <input
                  type="text"
                  value={draftFilters.query}
                  onChange={(event) => setDraftField("query", event.target.value)}
                  placeholder="Institution name, code, ID, or contact"
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
              <h2 className="text-lg font-semibold text-slate-950">Institution queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Unified institution table with status, profile, linked operational counts, and available actions.
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading institution records…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto max-w-lg rounded-3xl border border-dashed border-slate-300 bg-brand-50 px-6 py-7">
                <p className="text-base font-semibold text-slate-800">{emptyTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyHint}</p>
                {canCreateInstitution ? (
                  <button
                    type="button"
                    onClick={() => {
                      resetCreateFlow();
                      setCreateOpen(true);
                    }}
                    className="mt-4 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                  >
                    Create institution
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1480px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">Institution</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Type / region</th>
                    <th className="px-5 py-3">Linked operations</th>
                    <th className="px-5 py-3">Capabilities</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {rows.map((row) => {
                    const openIssues = row.metrics?.openOperationalIssues || 0;
                    const actionBusy = actionLoading === row.id;
                    return (
                      <tr key={row.id} className="hover:bg-brand-50/80">
                        <td className="px-5 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => setSelectedInstitutionId(row.id)}
                            className="text-left"
                          >
                            <p className="font-medium text-slate-900">{row.name || "Unnamed institution"}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400">{row.code || row.id}</p>
                            <p className="mt-1 text-xs text-slate-500">{row.contactEmail || row.contactPhone || row.id}</p>
                          </button>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="space-y-2">
                            <Badge value={row.status}>{formatLabel(row.status)}</Badge>
                            <p className="text-xs text-slate-500">
                              {row.suspendReason ? `Reason: ${row.suspendReason}` : "No current restriction note"}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{row.institutionType ? formatLabel(row.institutionType) : "Unspecified"}</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {(COUNTRY_LABELS[row.country] || row.country || "No country")} · {row.currency || "No currency"}
                          </p>
                          <p className="mt-2 text-xs text-slate-500">
                            Settlement prefix: <span className="font-mono">{row.settlementReferencePrefix || "—"}</span>
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{formatNumber(row.metrics?.groupCount)} groups</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {formatNumber(row.metrics?.agentCount)} agents · {formatNumber(row.metrics?.institutionUserCount)} institution users
                          </p>
                          <p className={`mt-2 text-xs font-medium ${openIssues > 0 ? "text-amber-700" : "text-slate-500"}`}>
                            {openIssues > 0 ? `${formatNumber(openIssues)} open operational issues` : "No linked open issue signals"}
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <div className="flex flex-wrap gap-1.5">
                            <Badge value={row.supportsDeposits ? "active" : "default"}>{row.supportsDeposits ? "Deposits on" : "Deposits off"}</Badge>
                            <Badge value={row.supportsWithdrawals ? "active" : "default"}>{row.supportsWithdrawals ? "Withdrawals on" : "Withdrawals off"}</Badge>
                            <Badge value={row.supportsLoans ? "active" : "default"}>{row.supportsLoans ? "Loans on" : "Loans off"}</Badge>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{formatDateTime(row.updatedAtMs)}</p>
                          <p className="mt-1 text-xs text-slate-400">Created {formatDateValue(row.createdAt)}</p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            <ActionButton onClick={() => setSelectedInstitutionId(row.id)}>Detail</ActionButton>
                            {row.availableActions?.canSuspend ? (
                              <ActionButton
                                tone="danger"
                                disabled={actionBusy}
                                onClick={() => {
                                  setSuspendTarget(row);
                                  setSuspendReason("");
                                }}
                              >
                                {actionBusy ? "Working…" : "Suspend"}
                              </ActionButton>
                            ) : null}
                            {row.availableActions?.canReactivate ? (
                              <ActionButton
                                tone="success"
                                disabled={actionBusy}
                                onClick={() => setReactivateTarget(row)}
                              >
                                {actionBusy ? "Working…" : "Reactivate"}
                              </ActionButton>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <Drawer
        open={Boolean(selectedInstitution)}
        onClose={() => setSelectedInstitutionId("")}
        title={selectedInstitution?.name || "Institution detail"}
        subtitle={selectedInstitution?.code || selectedInstitution?.id || "Institution"}
      >
        {selectedInstitution ? (
          <>
            <section className="grid gap-3 md:grid-cols-2">
              <SummaryCard
                label="Linked groups"
                value={formatNumber(selectedInstitution.metrics?.groupCount)}
                note={`${formatNumber(selectedInstitution.metrics?.activeGroupCount)} active · ${formatNumber(selectedInstitution.metrics?.suspendedGroupCount)} suspended`}
                tone={selectedInstitution.metrics?.suspendedGroupCount > 0 ? "warning" : "stable"}
              />
              <SummaryCard
                label="Staffing footprint"
                value={formatNumber((selectedInstitution.metrics?.agentCount || 0) + (selectedInstitution.metrics?.institutionUserCount || 0))}
                note={`${formatNumber(selectedInstitution.metrics?.agentCount)} agents · ${formatNumber(selectedInstitution.metrics?.institutionUserCount)} institution users`}
                tone="stable"
              />
              <SummaryCard
                label="Flagged operations"
                value={formatNumber((selectedInstitution.metrics?.flaggedBatchCount || 0) + (selectedInstitution.metrics?.flaggedReconciliationCount || 0))}
                note={`${formatNumber(selectedInstitution.metrics?.flaggedBatchCount)} flagged batches · ${formatNumber(selectedInstitution.metrics?.flaggedReconciliationCount)} flagged reconciliations`}
                tone={selectedInstitution.metrics?.openOperationalIssues > 0 ? "warning" : "stable"}
              />
              <SummaryCard
                label="Action availability"
                value={
                  selectedInstitution.availableActions?.canSuspend
                    ? "Suspend"
                    : selectedInstitution.availableActions?.canReactivate
                    ? "Reactivate"
                    : "Read only"
                }
                note="Only safe status controls are available in this view."
                tone={selectedInstitution.availableActions?.canReactivate ? "warning" : "stable"}
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Status and action lane</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Only safe status controls are available in this view.
                  </p>
                </div>
                <Badge value={selectedInstitution.status}>{formatLabel(selectedInstitution.status)}</Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedInstitution.availableActions?.canSuspend ? (
                  <ActionButton
                    tone="danger"
                    disabled={actionLoading === selectedInstitution.id}
                    onClick={() => {
                      setSuspendTarget(selectedInstitution);
                      setSuspendReason("");
                    }}
                  >
                    {actionLoading === selectedInstitution.id ? "Working…" : "Suspend institution"}
                  </ActionButton>
                ) : null}
                {selectedInstitution.availableActions?.canReactivate ? (
                  <ActionButton
                    tone="success"
                    disabled={actionLoading === selectedInstitution.id}
                    onClick={() => setReactivateTarget(selectedInstitution)}
                  >
                    {actionLoading === selectedInstitution.id ? "Working…" : "Reactivate institution"}
                  </ActionButton>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Restrictions and notes</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">{selectedInstitution.suspendReason || selectedInstitution.notes || "No restriction or operational note is currently recorded."}</p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Institution summary</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Institution ID" value={selectedInstitution.id} mono />
                <DetailRow label="Code" value={selectedInstitution.code} mono />
                <DetailRow label="Type" value={selectedInstitution.institutionType ? formatLabel(selectedInstitution.institutionType) : "Unspecified"} />
                <DetailRow label="Country" value={COUNTRY_LABELS[selectedInstitution.country] || selectedInstitution.country || "Unspecified"} />
                <DetailRow label="Currency" value={selectedInstitution.currency || "Unspecified"} />
                <DetailRow label="Settlement prefix" value={selectedInstitution.settlementReferencePrefix || "Not set"} mono />
                <DetailRow label="Contact name" value={selectedInstitution.contactName || "Not set"} />
                <DetailRow label="Contact email" value={selectedInstitution.contactEmail || "Not set"} />
                <DetailRow label="Contact phone" value={selectedInstitution.contactPhone || "Not set"} />
                <DetailRow label="Capabilities" value={`${selectedInstitution.supportsDeposits ? "Deposits" : "No deposits"} · ${selectedInstitution.supportsWithdrawals ? "Withdrawals" : "No withdrawals"} · ${selectedInstitution.supportsLoans ? "Loans" : "No loans"}`} />
                <DetailRow label="Backfilled record" value={selectedInstitution.isBackfilled ? "Yes" : "No"} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Linked operational metadata</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Groups" value={`${formatNumber(selectedInstitution.metrics?.groupCount)} total · ${formatNumber(selectedInstitution.metrics?.activeGroupCount)} active · ${formatNumber(selectedInstitution.metrics?.suspendedGroupCount)} suspended`} />
                <DetailRow label="Agents" value={`${formatNumber(selectedInstitution.metrics?.agentCount)} total · ${formatNumber(selectedInstitution.metrics?.suspendedAgentCount)} suspended`} />
                <DetailRow label="Institution users" value={`${formatNumber(selectedInstitution.metrics?.institutionUserCount)} total · ${formatNumber(selectedInstitution.metrics?.suspendedInstitutionUserCount)} suspended`} />
                <DetailRow label="Flagged deposit batches" value={formatNumber(selectedInstitution.metrics?.flaggedBatchCount)} />
                <DetailRow label="Flagged reconciliations" value={formatNumber(selectedInstitution.metrics?.flaggedReconciliationCount)} />
                <DetailRow label="Open operational issues" value={formatNumber(selectedInstitution.metrics?.openOperationalIssues)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Audit-friendly timestamps</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Created" value={formatDateValue(selectedInstitution.createdAt)} />
                <DetailRow label="Updated" value={formatDateValue(selectedInstitution.updatedAt)} />
                <DetailRow label="Suspended" value={formatDateValue(selectedInstitution.suspendedAt)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-brand-50 p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Scope of this view</h3>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <p>Linked groups and agents are currently shown as summary counts.</p>
                <p>Institution editing and linked record navigation will expand here as more admin support is added.</p>
              </div>
            </section>
          </>
        ) : null}
      </Drawer>

      <Dialog
        open={createOpen}
        title={freshInstitution ? "Institution created" : "Create institution"}
        body={
          freshInstitution
            ? "The institution record is now live in the directory. Continue into User Provisioning when you are ready to invite the first institution user."
            : "Create a new partner institution record. User invitations stay in the separate User Provisioning workflow."
        }
        onClose={() => {
          setCreateOpen(false);
          resetCreateFlow();
        }}
      >
        {freshInstitution ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              New institutions currently start in <span className="font-semibold">active</span> status.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Institution record</p>
              <p className="mt-2 text-sm font-medium text-slate-900">{freshInstitution.name}</p>
              <p className="mt-1 font-mono text-xs text-slate-500">{freshInstitution.code}</p>
              <p className="mt-2 text-sm text-slate-600">
                {COUNTRY_LABELS[freshInstitution.country] || freshInstitution.country} · {freshInstitution.contactEmail || freshInstitution.contactPhone || "No contact saved"}
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Next step</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Invite the first institution user from User Provisioning with this institution already selected.
              </p>
              <div className="mt-4 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCreateOpen(false);
                    resetCreateFlow();
                  }}
                  className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                >
                  Stay in Institutions
                </button>
                <button
                  type="button"
                  onClick={() => {
                    navigate(
                      `/admin/super/provisioning?role=institution_user&institution=${encodeURIComponent(freshInstitution.institutionId)}&launch=create`
                    );
                  }}
                  className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Invite first institution user
                </button>
              </div>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleCreateInstitution} autoComplete="off">
            <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3 text-sm text-slate-600">
              New institutions are created as active records in V1. Institution user invitations happen in the next step.
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <FilterField label="Institution name">
                <input
                  type="text"
                  required
                  value={createForm.name}
                  onChange={(event) => setCreateField("name", event.target.value)}
                  placeholder="Partner institution name"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Code">
                <input
                  type="text"
                  required
                  value={createForm.code}
                  onChange={(event) => setCreateField("code", event.target.value.toUpperCase())}
                  placeholder="Short code"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-700"
                />
              </FilterField>

              <FilterField label="Institution type">
                <input
                  type="text"
                  value={createForm.institutionType}
                  onChange={(event) => setCreateField("institutionType", event.target.value)}
                  placeholder="Microfinance, SACCO, bank"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Country">
                <select
                  value={createForm.country}
                  onChange={(event) => setCreateField("country", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  {Object.entries(COUNTRY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Contact name">
                <input
                  type="text"
                  value={createForm.contactName}
                  onChange={(event) => setCreateField("contactName", event.target.value)}
                  placeholder="Primary contact"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Contact email">
                <input
                  type="email"
                  value={createForm.contactEmail}
                  onChange={(event) => setCreateField("contactEmail", event.target.value)}
                  placeholder="Optional contact email"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Contact phone">
                <input
                  type="tel"
                  value={createForm.contactPhone}
                  onChange={(event) => setCreateField("contactPhone", event.target.value)}
                  placeholder="+25766123456"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>

              <FilterField label="Settlement prefix">
                <input
                  type="text"
                  value={createForm.settlementReferencePrefix}
                  onChange={(event) => setCreateField("settlementReferencePrefix", event.target.value.toUpperCase())}
                  placeholder="Optional prefix"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-mono text-slate-700"
                />
              </FilterField>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Capabilities</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-slate-700">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.supportsDeposits}
                    onChange={(event) => setCreateField("supportsDeposits", event.target.checked)}
                  />
                  Deposits
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.supportsWithdrawals}
                    onChange={(event) => setCreateField("supportsWithdrawals", event.target.checked)}
                  />
                  Withdrawals
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={createForm.supportsLoans}
                    onChange={(event) => setCreateField("supportsLoans", event.target.checked)}
                  />
                  Loans
                </label>
              </div>
            </div>

            <FilterField label="Notes">
              <textarea
                value={createForm.notes}
                onChange={(event) => setCreateField("notes", event.target.value)}
                rows={4}
                placeholder="Operational notes"
                className="rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              />
            </FilterField>

            {createError ? <p className="text-sm text-rose-600">{createError}</p> : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCreateOpen(false);
                  resetCreateFlow();
                }}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={createSubmitting}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
              >
                {createSubmitting ? "Creating…" : "Create institution"}
              </button>
            </div>
          </form>
        )}
      </Dialog>

      <ConfirmationDialog
        open={Boolean(suspendTarget)}
        title={`Suspend ${suspendTarget?.name || "institution"}?`}
        body="A reason is required and will be recorded with the institution status update."
        confirmLabel={actionLoading === suspendTarget?.id ? "Suspending…" : "Confirm suspension"}
        confirmTone="danger"
        onCancel={() => {
          setSuspendTarget(null);
          setSuspendReason("");
        }}
        onConfirm={() => void handleSuspendConfirm()}
        confirmDisabled={!suspendReason.trim() || actionLoading === suspendTarget?.id}
      >
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Suspension reason</span>
          <textarea
            value={suspendReason}
            onChange={(event) => setSuspendReason(event.target.value)}
            rows={4}
            placeholder="Operational or compliance reason for the suspension"
            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
          />
        </label>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={Boolean(reactivateTarget)}
        title={`Reactivate ${reactivateTarget?.name || "institution"}?`}
        body="This will return the institution to active status and clear the current suspension reason."
        confirmLabel={actionLoading === reactivateTarget?.id ? "Reactivating…" : "Confirm reactivation"}
        confirmTone="dark"
        onCancel={() => setReactivateTarget(null)}
        onConfirm={() => void handleReactivateConfirm()}
        confirmDisabled={actionLoading === reactivateTarget?.id}
      />
    </main>
  );
}
