import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

const DEFAULT_FILTERS = {
  role: "",
  status: "",
  institutionId: "",
  accountType: "",
  query: "",
};

const STATUS_STYLES = {
  active: "border-emerald-200 bg-emerald-50 text-emerald-700",
  suspended: "border-rose-200 bg-rose-50 text-rose-700",
  pending_approval: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-slate-300 bg-slate-100 text-slate-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const ROLE_TONES = {
  super_admin: "border-indigo-200 bg-indigo-50 text-indigo-700",
  admin: "border-sky-200 bg-sky-50 text-sky-700",
  finance: "border-emerald-200 bg-emerald-50 text-emerald-700",
  institution_user: "border-amber-200 bg-amber-50 text-amber-700",
  umuco: "border-amber-200 bg-amber-50 text-amber-700",
  agent: "border-cyan-200 bg-cyan-50 text-cyan-700",
  leader: "border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700",
  member: "border-slate-200 bg-slate-100 text-slate-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const TONE_STYLES = {
  stable: "border-slate-200 bg-white",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70",
  danger: "border-rose-200 bg-rose-50/70",
};

const ROLE_COPY = {
  [ADMIN_ROLES.SUPER_ADMIN]:
    "Govern access oversight across platform users, admin roles, institution staff, field agents, and member-linked accounts from one console.",
  [ADMIN_ROLES.ADMIN]:
    "Read-first access oversight for platform accounts, roles, and status. Status controls remain reserved for super admins.",
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
      <button type="button" aria-label="Close user detail" className="flex-1" onClick={onClose} />
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

export default function AdminManagementScreen() {
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
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
      const fn = httpsCallable(functions, "getUsersRolesConsole");
      const response = await fn(nextFilters);
      const nextPayload = response.data || null;
      setPayload(nextPayload);

      const nextRows = nextPayload?.rows || [];
      setSelectedUserId((current) => {
        if (current && nextRows.some((row) => row.id === current)) return current;
        return "";
      });
    } catch (loadError) {
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load users and roles right now."));
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

  async function handleSuspendConfirm() {
    if (!suspendTarget || !suspendReason.trim()) return;
    setActionLoading(suspendTarget.id);
    setActionError("");
    try {
      const fn = httpsCallable(
        functions,
        suspendTarget.availableActions?.actionFamily === "admin" ? "suspendAdmin" : "suspendUser"
      );
      await fn({ userId: suspendTarget.id, reason: suspendReason.trim() });
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
      const fn = httpsCallable(
        functions,
        reactivateTarget.availableActions?.actionFamily === "admin" ? "reactivateAdmin" : "reactivateUser"
      );
      await fn({ userId: reactivateTarget.id });
      setReactivateTarget(null);
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Reactivation failed."));
    } finally {
      setActionLoading("");
    }
  }

  const rows = payload?.rows || [];
  const summary = payload?.summary || {};
  const role = payload?.role || ADMIN_ROLES.SUPER_ADMIN;
  const filterOptions = payload?.filterOptions || { roles: [], statuses: [], institutions: [], accountTypes: [] };
  const support = payload?.backendSupport || { statusActionsSupported: false, actionScope: "read_only" };
  const selectedUser = rows.find((row) => row.id === selectedUserId) || null;

  const summaryCards = useMemo(
    () => [
      {
        id: "total",
        label: "Total users in scope",
        value: formatNumber(summary.totalUsers),
        note: "Accounts currently visible in this console scope",
        tone: "stable",
      },
      {
        id: "active",
        label: "Active users",
        value: formatNumber(summary.activeUsers),
        note: "Accounts currently able to access their assigned surfaces",
        tone: "success",
      },
      {
        id: "suspended",
        label: "Suspended users",
        value: formatNumber(summary.suspendedUsers),
        note: "Accounts currently blocked from active access",
        tone: summary.suspendedUsers > 0 ? "danger" : "stable",
      },
      {
        id: "admins",
        label: "Admin accounts",
        value: formatNumber(summary.adminAccounts),
        note: "Super admin, admin, and finance roles",
        tone: "warning",
      },
      {
        id: "institution-users",
        label: "Institution users",
        value: formatNumber(summary.institutionUsers),
        note: "Partner institution operations access",
        tone: "stable",
      },
      {
        id: "agents",
        label: "Agents",
        value: formatNumber(summary.agents),
        note: "Field operations access footprint",
        tone: "stable",
      },
      {
        id: "members",
        label: "Members and leaders",
        value: formatNumber(summary.membersAndLeaders),
        note: "Member-facing accounts linked to groups",
        tone: "stable",
      },
    ],
    [summary]
  );

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const emptyTitle = hasActiveFilters
    ? "No user accounts match the current filters."
    : "No user accounts are currently available in this console scope.";
  const emptyHint = hasActiveFilters
    ? "Clear filters or widen the search to bring more accounts back into view."
    : "Accounts will appear here once users exist in the current environment.";

  return (
    <main className="px-8 py-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-5xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Administration / Users & Roles
              </p>
              <h1 className="mt-2.5 text-[30px] font-semibold tracking-tight text-slate-950">
                Access oversight for platform users, roles, and current account status
              </h1>
              <p className="mt-2.5 max-w-4xl text-sm leading-6 text-slate-600">
                {ROLE_COPY[role] || ROLE_COPY[ADMIN_ROLES.SUPER_ADMIN]}
              </p>
            </div>

            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Action model</p>
              <p className="mt-1.5 font-medium text-slate-900">
                {support.statusActionsSupported ? "Safe status controls enabled" : "Read-first oversight"}
              </p>
              <p className="mt-1.5 text-xs leading-5 text-slate-500">
                {support.statusActionsSupported
                  ? "Suspend and reactivate controls are available where existing backend protections already support them."
                  : "This view is read-only for your role. Status controls remain reserved for super admins."}
              </p>
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

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-7">
          {summaryCards.map((card) => (
            <SummaryCard key={card.id} {...card} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the access list by role, status, institution, account type, or direct search against name, email, phone, member ID, and UID.
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
              <FilterField label="Role">
                <select
                  value={draftFilters.role}
                  onChange={(event) => setDraftField("role", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">All roles</option>
                  {filterOptions.roles.map((option) => (
                    <option key={option.value} value={option.value}>
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
                  <option value="">All statuses</option>
                  {filterOptions.statuses.map((option) => (
                    <option key={option.value} value={option.value}>
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
                  {filterOptions.institutions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Account type">
                <select
                  value={draftFilters.accountType}
                  onChange={(event) => setDraftField("accountType", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                >
                  <option value="">All account types</option>
                  {filterOptions.accountTypes.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>

              <FilterField label="Search">
                <input
                  type="text"
                  value={draftFilters.query}
                  onChange={(event) => setDraftField("query", event.target.value)}
                  placeholder="Name, email, phone, member ID, or UID"
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
              <h2 className="text-lg font-semibold text-slate-950">Access queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Unified account list with role visibility, current status, linked institution or group context, and safe actions where supported.
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading users and roles…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto max-w-lg rounded-3xl border border-dashed border-slate-300 bg-brand-50 px-6 py-7">
                <p className="text-base font-semibold text-slate-800">{emptyTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyHint}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1540px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Institution / group</th>
                    <th className="px-5 py-3">Account type</th>
                    <th className="px-5 py-3">Updated</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {rows.map((row) => {
                    const actionBusy = actionLoading === row.id;
                    return (
                      <tr key={row.id} className="hover:bg-brand-50/80">
                        <td className="px-5 py-4 align-top">
                          <button
                            type="button"
                            onClick={() => setSelectedUserId(row.id)}
                            className="text-left"
                          >
                            <p className="font-medium text-slate-900">{row.fullName || "Unnamed user"}</p>
                            <p className="mt-1 text-xs text-slate-500">{row.email || row.phone || row.id}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400">{row.memberId || row.id}</p>
                          </button>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <Badge toneMap={ROLE_TONES} value={row.role}>{row.roleLabel}</Badge>
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
                          <p>{row.institutionName || "No institution link"}</p>
                          <p className="mt-1 text-xs text-slate-400">{row.groupName || "No group link"}</p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{row.accountTypeLabel}</p>
                          <p className="mt-1 text-xs text-slate-400">{row.roleNote || "No additional access note"}</p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{formatDateValue(row.updatedAt)}</p>
                          <p className="mt-1 text-xs text-slate-400">Created {formatDateValue(row.createdAt)}</p>
                        </td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            <ActionButton onClick={() => setSelectedUserId(row.id)}>Detail</ActionButton>
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
        open={Boolean(selectedUser)}
        onClose={() => setSelectedUserId("")}
        title={selectedUser?.fullName || "User detail"}
        subtitle={selectedUser?.email || selectedUser?.phone || selectedUser?.id || "Account"}
      >
        {selectedUser ? (
          <>
            <section className="grid gap-3 md:grid-cols-2">
              <SummaryCard
                label="Role"
                value={selectedUser.roleLabel}
                note={selectedUser.accountTypeLabel}
                tone="stable"
              />
              <SummaryCard
                label="Status"
                value={formatLabel(selectedUser.status)}
                note={selectedUser.suspendReason || "No current restriction note"}
                tone={selectedUser.status === "suspended" ? "danger" : "success"}
              />
              <SummaryCard
                label="Institution link"
                value={selectedUser.institutionName || "Unlinked"}
                note={selectedUser.groupName || "No linked group record"}
                tone="stable"
              />
              <SummaryCard
                label="Action availability"
                value={
                  selectedUser.availableActions?.canSuspend
                    ? "Suspend"
                    : selectedUser.availableActions?.canReactivate
                    ? "Reactivate"
                    : "Read only"
                }
                note={
                  support.statusActionsSupported
                    ? "Only existing safe status controls are available in this view."
                    : "This view is read-only for your role."
                }
                tone={selectedUser.availableActions?.canReactivate ? "warning" : "stable"}
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Role and status</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {support.statusActionsSupported
                      ? "Only existing safe status controls are available in this view."
                      : "Status changes are reserved for super admins."}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge toneMap={ROLE_TONES} value={selectedUser.role}>{selectedUser.roleLabel}</Badge>
                  <Badge value={selectedUser.status}>{formatLabel(selectedUser.status)}</Badge>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedUser.availableActions?.canSuspend ? (
                  <ActionButton
                    tone="danger"
                    disabled={actionLoading === selectedUser.id}
                    onClick={() => {
                      setSuspendTarget(selectedUser);
                      setSuspendReason("");
                    }}
                  >
                    {actionLoading === selectedUser.id ? "Working…" : "Suspend account"}
                  </ActionButton>
                ) : null}
                {selectedUser.availableActions?.canReactivate ? (
                  <ActionButton
                    tone="success"
                    disabled={actionLoading === selectedUser.id}
                    onClick={() => setReactivateTarget(selectedUser)}
                  >
                    {actionLoading === selectedUser.id ? "Working…" : "Reactivate account"}
                  </ActionButton>
                ) : null}
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Role note</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {selectedUser.roleNote || "No additional role-specific note is currently recorded for this account."}
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">User summary</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="User ID" value={selectedUser.id} mono />
                <DetailRow label="Email" value={selectedUser.email || "Not set"} />
                <DetailRow label="Phone" value={selectedUser.phone || "Not set"} />
                <DetailRow label="Member ID" value={selectedUser.memberId || "Not set"} mono />
                <DetailRow label="Role" value={selectedUser.roleLabel} />
                <DetailRow label="Account type" value={selectedUser.accountTypeLabel} />
                <DetailRow label="Status" value={formatLabel(selectedUser.status)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Institution and group linkage</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Institution" value={selectedUser.institutionName || "No linked institution"} />
                <DetailRow label="Institution ID" value={selectedUser.institutionId || "Not set"} mono />
                <DetailRow label="Group" value={selectedUser.groupName || "No linked group"} />
                <DetailRow label="Group ID" value={selectedUser.groupId || "Not set"} mono />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Audit-friendly timestamps</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Created" value={formatDateValue(selectedUser.createdAt)} />
                <DetailRow label="Updated" value={formatDateValue(selectedUser.updatedAt)} />
                <DetailRow label="Suspended" value={formatDateValue(selectedUser.suspendedAt)} />
                <DetailRow label="Reactivated" value={formatDateValue(selectedUser.reactivatedAt)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-brand-50 p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Scope of this view</h3>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <p>Account status controls are shown only where the current backend already supports them safely.</p>
                <p>New non-member accounts are issued through User Provisioning, while role edits remain outside this view.</p>
              </div>
            </section>
          </>
        ) : null}
      </Drawer>

      <ConfirmationDialog
        open={Boolean(suspendTarget)}
        title={`Suspend ${suspendTarget?.fullName || "account"}?`}
        body="A reason is required and will be recorded with the account status update."
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
            placeholder="Operational or governance reason for the suspension"
            className="rounded-2xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
          />
        </label>
      </ConfirmationDialog>

      <ConfirmationDialog
        open={Boolean(reactivateTarget)}
        title={`Reactivate ${reactivateTarget?.fullName || "account"}?`}
        body="This will return the account to active status and clear the current suspension reason."
        confirmLabel={actionLoading === reactivateTarget?.id ? "Reactivating…" : "Confirm reactivation"}
        confirmTone="dark"
        onCancel={() => setReactivateTarget(null)}
        onConfirm={() => void handleReactivateConfirm()}
        confirmDisabled={actionLoading === reactivateTarget?.id}
      />
    </main>
  );
}
