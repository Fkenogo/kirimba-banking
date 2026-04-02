import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const DEFAULT_FILTERS = {
  category: "",
  actionType: "",
  actorId: "",
  targetType: "",
  dateFrom: "",
  dateTo: "",
  query: "",
};

const CATEGORY_TONES = {
  institution_management: "border-indigo-200 bg-indigo-50 text-indigo-700",
  user_provisioning: "border-sky-200 bg-sky-50 text-sky-700",
  users_roles: "border-amber-200 bg-amber-50 text-amber-700",
  agents: "border-cyan-200 bg-cyan-50 text-cyan-700",
  pricing_rules: "border-violet-200 bg-violet-50 text-violet-700",
  fund_management: "border-emerald-200 bg-emerald-50 text-emerald-700",
  reconciliation_settlements: "border-rose-200 bg-rose-50 text-rose-700",
  groups: "border-orange-200 bg-orange-50 text-orange-700",
  governance: "border-slate-200 bg-slate-100 text-slate-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
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

function buildFallbackFilterOptions(entries) {
  const categoryCounts = new Map();
  const actionCounts = new Map();
  const actorCounts = new Map();
  const targetTypeCounts = new Map();

  for (const entry of entries || []) {
    if (entry.category) {
      const current = categoryCounts.get(entry.category) || { label: entry.categoryLabel || formatLabel(entry.category), count: 0 };
      current.count += 1;
      categoryCounts.set(entry.category, current);
    }
    if (entry.action) {
      const current = actionCounts.get(entry.action) || { label: entry.actionLabel || formatLabel(entry.action), count: 0 };
      current.count += 1;
      actionCounts.set(entry.action, current);
    }
    if (entry.actorId) {
      const current = actorCounts.get(entry.actorId) || { label: entry.actorName || entry.actorLabel || entry.actorId, count: 0 };
      current.count += 1;
      actorCounts.set(entry.actorId, current);
    }
    if (entry.targetType) {
      const current = targetTypeCounts.get(entry.targetType) || { label: formatLabel(entry.targetType), count: 0 };
      current.count += 1;
      targetTypeCounts.set(entry.targetType, current);
    }
  }

  function toOptions(map) {
    return [...map.entries()]
      .map(([value, meta]) => ({ value, label: meta.label, count: meta.count }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return {
    categories: toOptions(categoryCounts),
    actionTypes: toOptions(actionCounts),
    actors: toOptions(actorCounts),
    targetTypes: toOptions(targetTypeCounts),
  };
}

function toneClass(map, value) {
  return map[value] || map.default || "";
}

function FilterField({ label, children }) {
  return (
    <label className="flex min-w-[170px] flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Badge({ toneMap, value, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass(toneMap, value)}`}>
      {children}
    </span>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[160px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={mono ? "whitespace-pre-wrap break-all font-mono text-sm text-slate-700" : "whitespace-pre-wrap text-sm text-slate-700"}>{value || "—"}</dd>
    </div>
  );
}

function Drawer({ open, onClose, title, subtitle, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35">
      <button type="button" aria-label="Close audit detail" className="flex-1" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[720px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{subtitle}</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-950">{title}</h2>
            </div>
            <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-brand-50">
              Close
            </button>
          </div>
        </div>
        <div className="space-y-6 px-6 py-6">{children}</div>
      </aside>
    </div>
  );
}

export default function AuditLogScreen() {
  const navigate = useNavigate();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedEntryId, setSelectedEntryId] = useState("");

  useEffect(() => {
    void loadAuditLog(appliedFilters);
  }, [appliedFilters]);

  async function loadAuditLog(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getAuditLog");
      const response = await fn(nextFilters);
      const nextPayload = response.data || null;
      setPayload(nextPayload);

      const nextEntries = nextPayload?.entries || [];
      setSelectedEntryId((current) => {
        if (current && nextEntries.some((entry) => entry.id === current)) return current;
        return "";
      });
    } catch (loadError) {
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load the audit log right now."));
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

  const entries = payload?.entries || [];
  const backendFilterOptions = payload?.filterOptions || {};
  const fallbackFilterOptions = useMemo(() => buildFallbackFilterOptions(entries), [entries]);
  const filterOptions = {
    categories: backendFilterOptions.categories?.length ? backendFilterOptions.categories : fallbackFilterOptions.categories,
    actionTypes: backendFilterOptions.actionTypes?.length ? backendFilterOptions.actionTypes : fallbackFilterOptions.actionTypes,
    actors: backendFilterOptions.actors?.length ? backendFilterOptions.actors : fallbackFilterOptions.actors,
    targetTypes: backendFilterOptions.targetTypes?.length ? backendFilterOptions.targetTypes : fallbackFilterOptions.targetTypes,
  };
  const summary = payload?.summary || {};
  const selectedEntry = useMemo(
    () => entries.find((entry) => entry.id === selectedEntryId) || null,
    [entries, selectedEntryId]
  );
  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);

  return (
    <main className="px-8 py-7 bg-brand-50">
      <div className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              type="button"
              onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
            <p className="mt-0.5 max-w-3xl text-xs text-slate-400">
              Governance trail for admin and super admin actions across institutions, provisioning, user access, agents,
              pricing controls, fund management, and reconciliation work.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Visible entries</p>
              <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-950">{summary.visibleEntries ?? 0}</p>
              <p className="mt-1 text-[12px] text-slate-500">Scanned from the latest {summary.scannedEntries ?? 0} audit records</p>
            </div>
            <button
              type="button"
              onClick={() => loadAuditLog()}
              disabled={loading}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 disabled:opacity-60"
            >
              {loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>

        <form onSubmit={handleApply} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <FilterField label="Category">
              <select
                value={draftFilters.category}
                onChange={(event) => setDraftField("category", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">All categories</option>
                {(filterOptions.categories || []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Action Type">
              <select
                value={draftFilters.actionType}
                onChange={(event) => setDraftField("actionType", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">All action types</option>
                {(filterOptions.actionTypes || []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Actor">
              <select
                value={draftFilters.actorId}
                onChange={(event) => setDraftField("actorId", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">All actors</option>
                {(filterOptions.actors || []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="Target Type">
              <select
                value={draftFilters.targetType}
                onChange={(event) => setDraftField("targetType", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              >
                <option value="">All target types</option>
                {(filterOptions.targetTypes || []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </FilterField>

            <FilterField label="From">
              <input
                type="date"
                value={draftFilters.dateFrom}
                onChange={(event) => setDraftField("dateFrom", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              />
            </FilterField>

            <FilterField label="To">
              <input
                type="date"
                value={draftFilters.dateTo}
                onChange={(event) => setDraftField("dateTo", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
              />
            </FilterField>

            <FilterField label="Search">
              <input
                type="text"
                value={draftFilters.query}
                onChange={(event) => setDraftField("query", event.target.value)}
                placeholder="Actor, target, note, reference"
                className="min-w-[260px] rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400"
              />
            </FilterField>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
            <p className="text-xs text-slate-500">
              Filters stay intentionally compact so the screen stays operational rather than analytical.
            </p>
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

        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm font-medium text-rose-700">Audit log unavailable</p>
            <p className="mt-1 text-sm text-rose-600">{error}</p>
            <button
              type="button"
              onClick={() => loadAuditLog()}
              className="mt-3 rounded-xl border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-100"
            >
              Retry
            </button>
          </div>
        ) : null}

        {loading ? (
          <div className="space-y-3">
            {[...Array(7)].map((_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl border border-slate-200 bg-white" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-3xl border border-slate-200 bg-white px-6 py-16 text-center shadow-sm">
            <p className="text-lg font-semibold text-slate-900">
              {hasActiveFilters ? "No audit entries match the current filters." : "No audit entries are available yet."}
            </p>
            <p className="mt-2 text-sm text-slate-500">
              {hasActiveFilters
                ? "Clear or loosen the filters to widen the governance trail."
                : "This module shows only real backend audit writes. Entries appear as admin actions are performed."}
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-3xl border border-brand-100 bg-white shadow-card">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-sm">
                <thead className="bg-brand-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">When</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Actor</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Event</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Target</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Summary</th>
                    <th className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Source</th>
                    <th className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {entries.map((entry) => (
                    <tr key={entry.id} className="align-top hover:bg-brand-50/80">
                      <td className="px-4 py-4 text-xs text-slate-500 whitespace-nowrap">{formatDateTime(entry.createdAtMs)}</td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-slate-900">{entry.actorName || entry.actorId || "System"}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{formatLabel(entry.actorRole)}</p>
                        {entry.actorId ? <p className="mt-1 font-mono text-[11px] text-slate-400">{entry.actorId}</p> : null}
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-slate-900">{entry.actionLabel}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">{entry.action}</p>
                        <div className="mt-2">
                          <Badge toneMap={CATEGORY_TONES} value={entry.category}>{entry.categoryLabel}</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm font-medium text-slate-900">{entry.targetLabel || "—"}</p>
                        <p className="mt-1 text-[11px] text-slate-500">{formatLabel(entry.targetType)}</p>
                        <p className="mt-1 font-mono text-[11px] text-slate-400">{entry.targetReference || entry.targetId || "—"}</p>
                      </td>
                      <td className="max-w-[340px] px-4 py-4">
                        <p className="text-sm leading-6 text-slate-700">{entry.summary || "—"}</p>
                      </td>
                      <td className="px-4 py-4">
                        <p className="text-sm text-slate-700">{entry.sourceModule || "Governance"}</p>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedEntryId(entry.id)}
                          className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-brand-50"
                        >
                          Detail
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
              Showing {entries.length} real audit entries from the current backend result set.
            </div>
          </div>
        )}
      </div>

      <Drawer
        open={Boolean(selectedEntry)}
        onClose={() => setSelectedEntryId("")}
        title={selectedEntry?.actionLabel || "Audit detail"}
        subtitle={selectedEntry?.categoryLabel || "Audit Log"}
      >
        {selectedEntry ? (
          <>
            <section className="rounded-2xl border border-slate-200 bg-brand-50 p-5">
              <h3 className="text-sm font-semibold text-slate-900">Event detail</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Timestamp" value={formatDateTime(selectedEntry.createdAtMs)} />
                <DetailRow label="Action" value={selectedEntry.actionLabel} />
                <DetailRow label="Raw action" value={selectedEntry.action} mono />
                <DetailRow label="Category" value={selectedEntry.categoryLabel} />
                <DetailRow label="Source module" value={selectedEntry.sourceModule} />
                <DetailRow label="Summary" value={selectedEntry.summary} />
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">Actor and target</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Actor" value={selectedEntry.actorName || "Unknown actor"} />
                <DetailRow label="Actor uid" value={selectedEntry.actorId} mono />
                <DetailRow label="Actor role" value={formatLabel(selectedEntry.actorRole)} />
                <DetailRow label="Target type" value={formatLabel(selectedEntry.targetType)} />
                <DetailRow label="Target label" value={selectedEntry.targetLabel} />
                <DetailRow label="Target id" value={selectedEntry.targetId} mono />
                <DetailRow label="Reference" value={selectedEntry.targetReference} mono />
              </dl>
            </section>

            <section className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="text-sm font-semibold text-slate-900">Metadata and change context</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow
                  label="Before"
                  value={selectedEntry.meta?.before ? JSON.stringify(selectedEntry.meta.before, null, 2) : "—"}
                  mono
                />
                <DetailRow
                  label="After"
                  value={selectedEntry.meta?.after ? JSON.stringify(selectedEntry.meta.after, null, 2) : "—"}
                  mono
                />
                <DetailRow label="Reason / note" value={selectedEntry.meta?.reason || selectedEntry.meta?.note || selectedEntry.meta?.notes || "—"} />
                <DetailRow label="Metadata" value={JSON.stringify(selectedEntry.meta || {}, null, 2)} mono />
              </dl>
            </section>
          </>
        ) : null}
      </Drawer>
    </main>
  );
}
