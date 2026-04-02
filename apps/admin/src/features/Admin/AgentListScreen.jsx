import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const DEFAULT_FILTERS = {
  status: "",
  institutionId: "",
  query: "",
};

const STATUS_TONES = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  suspended: "border-rose-200 bg-rose-50 text-rose-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const CARD_TONES = {
  stable: "border-slate-200 bg-white",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70",
  danger: "border-rose-200 bg-rose-50/70",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatLabel(value) {
  return String(value || "Unknown")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDateTime(value) {
  if (!value) return "No timestamp";
  const date = typeof value === "number" ? new Date(value) : new Date(value);
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
    <div className={`rounded-2xl border px-4 py-3 shadow-sm ${toneClass(CARD_TONES, tone)}`}>
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

function Badge({ children, toneMap = STATUS_TONES, value = "default" }) {
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
      <button type="button" aria-label="Close agent detail" className="flex-1" onClick={onClose} />
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

function Dialog({ open, title, body, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
      <div className="w-full max-w-2xl rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
            {body ? <p className="mt-2 text-sm leading-6 text-slate-600">{body}</p> : null}
          </div>
          <button type="button" onClick={onClose} className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-brand-50">
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
      : tone === "accent"
      ? "border-indigo-300 text-indigo-700 hover:bg-indigo-50"
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

export default function AgentListScreen() {
  const navigate = useNavigate();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendReason, setSuspendReason] = useState("");
  const [reactivateTarget, setReactivateTarget] = useState(null);

  useEffect(() => {
    void loadConsole(appliedFilters);
  }, [appliedFilters]);

  async function loadConsole(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getAgentsConsole");
      const response = await fn(nextFilters);
      const nextPayload = response.data || null;
      setPayload(nextPayload);

      const nextRows = nextPayload?.rows || [];
      setSelectedAgentId((current) => {
        if (current && nextRows.some((row) => row.id === current)) return current;
        return "";
      });
    } catch (loadError) {
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load agent records right now."));
    } finally {
      setLoading(false);
    }
  }

  async function handleSuspendConfirm() {
    if (!suspendTarget || !suspendReason.trim()) return;
    setActionLoading(suspendTarget.id);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "suspendAgent");
      await fn({ agentId: suspendTarget.id, reason: suspendReason.trim() });
      setSuspendTarget(null);
      setSuspendReason("");
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Agent suspension failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function handleReactivateConfirm() {
    if (!reactivateTarget) return;
    setActionLoading(reactivateTarget.id);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "reactivateAgent");
      await fn({ agentId: reactivateTarget.id });
      setReactivateTarget(null);
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Agent reactivation failed."));
    } finally {
      setActionLoading("");
    }
  }

  function setDraftField(key, value) {
    setDraftFilters((current) => ({ ...current, [key]: value }));
  }

  const rows = payload?.rows || [];
  const summary = payload?.summary || {};
  const filterOptions = payload?.filterOptions || { statuses: [], institutions: [] };
  const selectedAgent = rows.find((row) => row.id === selectedAgentId) || null;

  const summaryCards = useMemo(
    () => [
      { id: "total", label: "Total agents", value: formatNumber(summary.totalAgents), note: "Field access records in scope", tone: "stable" },
      { id: "active", label: "Active agents", value: formatNumber(summary.activeAgents), note: "Available for operational work", tone: "success" },
      { id: "suspended", label: "Suspended agents", value: formatNumber(summary.suspendedAgents), note: "Lifecycle controls are available in this module", tone: summary.suspendedAgents > 0 ? "danger" : "stable" },
      { id: "linked", label: "Institution linked", value: formatNumber(summary.institutionLinkedAgents), note: "Agents tied to a partner institution", tone: "stable" },
      { id: "issues", label: "With open issues", value: formatNumber(summary.agentsWithOpenIssues), note: "Flagged reconciliation or status review needed", tone: summary.agentsWithOpenIssues > 0 ? "warning" : "stable" },
    ],
    [summary]
  );

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const emptyTitle = hasActiveFilters ? "No agents match the current filters." : "No agent records are currently available.";
  const emptyHint = hasActiveFilters
    ? "Clear filters or widen the search to bring agent records back into scope."
    : "Provision the first agent through User Provisioning, then return here for directory and lifecycle work.";

  return (
    <main className="px-8 py-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-5xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Operations / Agents</p>
              <h1 className="mt-2.5 text-[30px] font-semibold tracking-tight text-slate-950">
                Agent directory and institution linkage
              </h1>
              <p className="mt-2.5 max-w-4xl text-sm leading-6 text-slate-600">
                Review field agent status, institution linkage, and issue signals. Agents are not group-assigned — they serve any member at their linked institution.
              </p>
            </div>

            <div className="flex max-w-sm flex-col items-end gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Action model</p>
                <p className="mt-1.5 font-medium text-slate-900">Directory and assignment controls</p>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                  Agent creation stays in User Provisioning. This module focuses on directory visibility and lifecycle controls within the institution linkage model.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate("/admin/super/provisioning?role=agent&launch=create")}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                Invite agent
              </button>
            </div>
          </div>
        </section>

        {error ? <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4"><p className="text-sm text-rose-700">{error}</p></section> : null}
        {actionError ? <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4"><p className="text-sm text-rose-700">{actionError}</p></section> : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
          {summaryCards.map((card) => <SummaryCard key={card.id} {...card} />)}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the directory by status, institution, or direct search against agent name, phone, email, UID, and code.
              </p>
            </div>
            <button type="button" onClick={() => void loadConsole()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50">
              Refresh
            </button>
          </div>

          <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); setAppliedFilters(draftFilters); }} autoComplete="off">
            <div className="flex flex-wrap gap-3">
              <FilterField label="Status">
                <select value={draftFilters.status} onChange={(event) => setDraftField("status", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <option value="">All statuses</option>
                  {filterOptions.statuses.map((option) => <option key={option.value} value={option.value}>{formatLabel(option.label)}</option>)}
                </select>
              </FilterField>

              <FilterField label="Institution">
                <select value={draftFilters.institutionId} onChange={(event) => setDraftField("institutionId", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <option value="">All institutions</option>
                  {filterOptions.institutions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </FilterField>

              <FilterField label="Search">
                <input type="text" value={draftFilters.query} onChange={(event) => setDraftField("query", event.target.value)} placeholder="Agent name, phone, email, UID, or code" className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" />
              </FilterField>
            </div>

            <div className="flex items-center justify-end gap-2">
              <button type="button" onClick={() => { setDraftFilters(DEFAULT_FILTERS); setAppliedFilters(DEFAULT_FILTERS); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50">
                Clear
              </button>
              <button type="submit" className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
                Apply filters
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-brand-100 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Agent queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Unified agent directory with status, institution linkage, reconciliation signals, and safe lifecycle actions.
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading agent records…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto max-w-lg rounded-3xl border border-dashed border-slate-300 bg-brand-50 px-6 py-7">
                <p className="text-base font-semibold text-slate-800">{emptyTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyHint}</p>
                <button
                  type="button"
                  onClick={() => navigate("/admin/super/provisioning?role=agent&launch=create")}
                  className="mt-4 rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
                >
                  Invite agent
                </button>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Institution</th>
                    <th className="px-5 py-3">Open issues</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {rows.map((row) => {
                    const busy = actionLoading === row.id;
                    return (
                      <tr key={row.id} className="hover:bg-brand-50/80">
                        <td className="px-5 py-4 align-top">
                          <button type="button" onClick={() => setSelectedAgentId(row.id)} className="text-left">
                            <p className="font-medium text-slate-900">{row.fullName || "Unnamed agent"}</p>
                            <p className="mt-1 text-xs text-slate-500">{row.phone || row.email || row.uid}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400">{row.agentCode || row.uid}</p>
                          </button>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="space-y-2">
                            <Badge value={row.status}>{formatLabel(row.status)}</Badge>
                            <p className="text-xs text-slate-500">
                              {row.statusMismatch
                                ? "Status records need review before access changes."
                                : row.notes || "No current restriction note"}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{row.institutionName || "No institution link"}</p>
                          <p className="mt-1 text-xs text-slate-400">{row.institutionId || "Unlinked"}</p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{formatNumber(row.metrics?.openIssues)} signals</p>
                          <p className="mt-1 text-xs text-slate-400">
                            {formatNumber(row.metrics?.flaggedReconciliationCount)} flagged reconciliations
                          </p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{formatDateTime(row.updatedAtMs)}</p>
                          <p className="mt-1 text-xs text-slate-400">Created {formatDateValue(row.createdAt)}</p>
                        </td>
                      <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            <ActionButton onClick={() => setSelectedAgentId(row.id)}>Detail</ActionButton>
                            {row.availableActions?.canSuspend ? (
                              <ActionButton
                                tone="danger"
                                disabled={busy}
                                onClick={() => {
                                  setSuspendTarget(row);
                                  setSuspendReason("");
                                }}
                              >
                                {busy ? "Working…" : "Suspend"}
                              </ActionButton>
                            ) : null}
                            {row.availableActions?.canReactivate ? (
                              <ActionButton
                                tone="success"
                                disabled={busy}
                                onClick={() => setReactivateTarget(row)}
                              >
                                {busy ? "Working…" : "Reactivate"}
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

      <Drawer open={Boolean(selectedAgent)} onClose={() => setSelectedAgentId("")} title={selectedAgent?.fullName || "Agent detail"} subtitle={selectedAgent?.agentCode || selectedAgent?.uid || "Agent"}>
        {selectedAgent ? (
          <>
            <section className="grid gap-3 md:grid-cols-2">
              <SummaryCard label="Agent status" value={formatLabel(selectedAgent.status)} note={selectedAgent.statusMismatch ? "Status records need review before access changes." : "Suspend and reactivate controls are available when records are aligned."} tone={selectedAgent.status === "suspended" ? "danger" : "success"} />
              <SummaryCard label="Institution" value={selectedAgent.institutionName || "Unlinked"} note={selectedAgent.institutionId || "No institution record linked"} tone="stable" />
              <SummaryCard label="Flagged reconciliations" value={formatNumber(selectedAgent.metrics?.flaggedReconciliationCount)} note="Reconciliation records flagged for review" tone={selectedAgent.metrics?.flaggedReconciliationCount > 0 ? "warning" : "stable"} />
              <SummaryCard
                label="Action availability"
                value={
                  selectedAgent.availableActions?.canSuspend
                    ? "Suspend"
                    : selectedAgent.availableActions?.canReactivate
                    ? "Reactivate"
                    : "Read only"
                }
                note="Safe lifecycle controls only"
                tone={selectedAgent.availableActions?.canSuspend || selectedAgent.availableActions?.canReactivate ? "success" : "stable"}
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Status and action lane</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    Suspend and reactivate controls are available when status records are aligned.
                  </p>
                </div>
                <Badge value={selectedAgent.status}>{formatLabel(selectedAgent.status)}</Badge>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedAgent.availableActions?.canSuspend ? (
                  <ActionButton
                    tone="danger"
                    disabled={actionLoading === selectedAgent.id}
                    onClick={() => {
                      setSuspendTarget(selectedAgent);
                      setSuspendReason("");
                    }}
                  >
                    {actionLoading === selectedAgent.id ? "Working…" : "Suspend agent"}
                  </ActionButton>
                ) : null}
                {selectedAgent.availableActions?.canReactivate ? (
                  <ActionButton
                    tone="success"
                    disabled={actionLoading === selectedAgent.id}
                    onClick={() => setReactivateTarget(selectedAgent)}
                  >
                    {actionLoading === selectedAgent.id ? "Working…" : "Reactivate agent"}
                  </ActionButton>
                ) : null}
                <ActionButton onClick={() => navigate("/admin/super/provisioning?role=agent&launch=create")}>
                  Invite another agent
                </ActionButton>
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Restrictions and notes</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selectedAgent.statusMismatch
                    ? "This agent has conflicting status records and should be reviewed before access changes are made."
                    : selectedAgent.notes || "No restriction or operational note is currently recorded."}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Agent summary</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Agent UID" value={selectedAgent.uid} mono />
                <DetailRow label="Agent code" value={selectedAgent.agentCode || "Not set"} mono />
                <DetailRow label="Phone" value={selectedAgent.phone || "Not set"} />
                <DetailRow label="Email" value={selectedAgent.email || "Not set"} />
                <DetailRow label="Institution" value={selectedAgent.institutionName || "No linked institution"} />
                <DetailRow label="Institution ID" value={selectedAgent.institutionId || "Not set"} mono />
                <DetailRow label="User status record" value={selectedAgent.userStatus ? formatLabel(selectedAgent.userStatus) : "Not set"} />
                <DetailRow label="Agent status record" value={selectedAgent.agentStatus ? formatLabel(selectedAgent.agentStatus) : "Not set"} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Issue signals and timestamps</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Flagged reconciliations" value={formatNumber(selectedAgent.metrics?.flaggedReconciliationCount)} />
                <DetailRow label="Open issue signals" value={formatNumber(selectedAgent.metrics?.openIssues)} />
                <DetailRow label="Created" value={formatDateValue(selectedAgent.createdAt)} />
                <DetailRow label="Updated" value={formatDateValue(selectedAgent.updatedAt)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-brand-50 p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Scope of this view</h3>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <p>Agent creation stays in User Provisioning.</p>
                <p>Agents are not group-assigned. They are linked to an institution and can serve any member at that institution.</p>
              </div>
            </section>
          </>
        ) : null}
      </Drawer>

      <ConfirmationDialog
        open={Boolean(suspendTarget)}
        title={`Suspend ${suspendTarget?.fullName || "agent"}?`}
        body="A reason is required and will be recorded on both agent records."
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
        title={`Reactivate ${reactivateTarget?.fullName || "agent"}?`}
        body="This will restore the agent to active status across both access records."
        confirmLabel={actionLoading === reactivateTarget?.id ? "Reactivating…" : "Confirm reactivation"}
        confirmTone="dark"
        onCancel={() => setReactivateTarget(null)}
        onConfirm={() => void handleReactivateConfirm()}
        confirmDisabled={actionLoading === reactivateTarget?.id}
      />
    </main>
  );
}
