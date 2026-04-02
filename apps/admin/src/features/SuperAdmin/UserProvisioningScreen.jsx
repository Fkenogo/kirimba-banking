import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

const DEFAULT_FILTERS = { role: "", status: "", institutionId: "", query: "" };
const DEFAULT_FORM = { role: "", targetName: "", targetPhone: "", targetEmail: "", institutionId: "" };

const STATUS_TONES = {
  pending: "border-amber-200 bg-amber-50 text-amber-700",
  accepted: "border-emerald-200 bg-emerald-50 text-emerald-700",
  expired: "border-slate-300 bg-slate-100 text-slate-700",
  revoked: "border-rose-200 bg-rose-50 text-rose-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const ROLE_TONES = {
  admin: "border-sky-200 bg-sky-50 text-sky-700",
  finance: "border-emerald-200 bg-emerald-50 text-emerald-700",
  institution_user: "border-amber-200 bg-amber-50 text-amber-700",
  agent: "border-cyan-200 bg-cyan-50 text-cyan-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const METHOD_TONES = {
  link: "border-indigo-200 bg-indigo-50 text-indigo-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

const CARD_TONES = {
  stable: "border-slate-200 bg-white",
  success: "border-emerald-200 bg-emerald-50/70",
  warning: "border-amber-200 bg-amber-50/70",
  danger: "border-rose-200 bg-rose-50/70",
};

const ROLE_COPY = {
  [ADMIN_ROLES.SUPER_ADMIN]:
    "Provision institution users, agents, and admin accounts through secure invitations. Access activates only after the invitee accepts and sets their own PIN.",
  [ADMIN_ROLES.ADMIN]:
    "Provision institution users and agents through secure invitations. Admin-role invitations remain reserved for super admins.",
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

function Badge({ children, toneMap, value = "default" }) {
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
      <button type="button" aria-label="Close invitation detail" className="flex-1" onClick={onClose} />
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

export default function UserProvisioningScreen() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [selectedInvitationId, setSelectedInvitationId] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(DEFAULT_FORM);
  const [createError, setCreateError] = useState("");
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [freshDelivery, setFreshDelivery] = useState(null);
  const [copiedField, setCopiedField] = useState("");
  const [queryPrefillApplied, setQueryPrefillApplied] = useState("");

  useEffect(() => {
    void loadConsole(appliedFilters);
  }, [appliedFilters]);

  async function loadConsole(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "listUserInvitations");
      const response = await fn(nextFilters);
      const nextPayload = response.data || null;
      setPayload(nextPayload);

      const nextRows = nextPayload?.rows || [];
      setSelectedInvitationId((current) => {
        if (current && nextRows.some((row) => row.id === current)) return current;
        return "";
      });
    } catch (loadError) {
      setPayload(null);
      setError(describeCallableError(loadError, "We couldn't load invitations right now."));
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
    setCreateForm(DEFAULT_FORM);
    setCreateError("");
    setCreateSubmitting(false);
    setFreshDelivery(null);
    setCopiedField("");
  }

  async function handleCreate(event) {
    event.preventDefault();
    setCreateError("");
    setCreateSubmitting(true);
    try {
      const fn = httpsCallable(functions, "createUserInvitation");
      const response = await fn({
        role: createForm.role,
        targetName: createForm.targetName.trim(),
        targetPhone: createForm.targetPhone.trim(),
        targetEmail: createForm.targetEmail.trim() || null,
        institutionId: createForm.institutionId || null,
      });
      setFreshDelivery(response.data || null);
      await loadConsole();
    } catch (runError) {
      setCreateError(describeCallableError(runError, "Invitation creation failed."));
    } finally {
      setCreateSubmitting(false);
    }
  }

  async function handleCopy(label, value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(label);
      window.setTimeout(() => setCopiedField(""), 1800);
    } catch {
      setCopiedField("");
    }
  }

  async function handleRevoke(row) {
    setActionLoading(row.id);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "revokeUserInvitation");
      await fn({ invitationId: row.id });
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Revocation failed."));
    } finally {
      setActionLoading("");
    }
  }

  async function handleRegenerate(row) {
    setActionLoading(row.id);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "regenerateUserInvitation");
      const response = await fn({ invitationId: row.id });
      setFreshDelivery(response.data || null);
      setCreateOpen(true);
      await loadConsole();
    } catch (runError) {
      setActionError(describeCallableError(runError, "Link reissue failed."));
    } finally {
      setActionLoading("");
    }
  }

  const rows = payload?.rows || [];
  const summary = payload?.summary || {};
  const filterOptions = payload?.filterOptions || { roles: [], statuses: [], institutions: [] };
  const createOptions = payload?.createOptions || { roles: [], institutions: [] };
  const role = payload?.role || ADMIN_ROLES.SUPER_ADMIN;
  const selectedInvitation = rows.find((row) => row.id === selectedInvitationId) || null;
  const selectedRoleConfig = createOptions.roles.find((option) => option.value === createForm.role) || null;
  const createRoleRequiresInstitution = Boolean(selectedRoleConfig?.requiresInstitution);
  const hasInstitutions = createOptions.institutions.length > 0;

  useEffect(() => {
    if (!createOptions.roles.length) return;
    const roleParam = String(searchParams.get("role") || "").trim();
    const institutionParam = String(searchParams.get("institution") || "").trim();
    const launchParam = String(searchParams.get("launch") || "").trim();
    const key = `${roleParam}|${institutionParam}|${launchParam}`;
    if (!roleParam && !institutionParam && !launchParam) return;
    if (queryPrefillApplied === key) return;

    const matchedRole = createOptions.roles.find((option) => option.value === roleParam) || null;
    const matchedInstitution = createOptions.institutions.find((option) => option.id === institutionParam) || null;

    if (matchedRole) {
      setDraftFilters((current) => ({
        ...current,
        role: matchedRole.value,
        institutionId: matchedRole.requiresInstitution && matchedInstitution ? matchedInstitution.id : current.institutionId,
      }));
      setAppliedFilters((current) => ({
        ...current,
        role: matchedRole.value,
        institutionId: matchedRole.requiresInstitution && matchedInstitution ? matchedInstitution.id : current.institutionId,
      }));
      setCreateForm((current) => ({
        ...current,
        role: matchedRole.value,
        institutionId: matchedRole.requiresInstitution && matchedInstitution ? matchedInstitution.id : "",
      }));
    }

    if (launchParam === "create") {
      setCreateOpen(true);
    }

    setQueryPrefillApplied(key);
  }, [createOptions.institutions, createOptions.roles, queryPrefillApplied, searchParams]);

  function clearLaunchParam() {
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete("launch");
    setSearchParams(nextParams, { replace: true });
  }

  const summaryCards = useMemo(
    () => [
      { id: "pending", label: "Pending invitations", value: formatNumber(summary.pendingInvitations), note: "Awaiting acceptance before access is created", tone: "warning" },
      { id: "accepted", label: "Accepted invitations", value: formatNumber(summary.acceptedInvitations), note: "Accounts activated through invite acceptance", tone: "success" },
      { id: "expired", label: "Expired invitations", value: formatNumber(summary.expiredInvitations), note: "Links timed out before acceptance", tone: summary.expiredInvitations > 0 ? "danger" : "stable" },
      { id: "revoked", label: "Revoked invitations", value: formatNumber(summary.revokedInvitations), note: "Manually withdrawn before activation", tone: summary.revokedInvitations > 0 ? "danger" : "stable" },
    ],
    [summary]
  );

  const hasActiveFilters = Object.values(appliedFilters).some(Boolean);
  const emptyTitle = hasActiveFilters ? "No invitations match the current filters." : "No user invitations have been created yet.";
  const emptyHint = hasActiveFilters
    ? "Clear filters or widen the search to bring more invitations back into view."
    : "Create the first secure invitation to start provisioning institution users, agents, or admin accounts.";

  return (
    <main className="px-8 py-7">
      <div className="mx-auto max-w-[1700px] space-y-4">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-6 py-5 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-5xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Administration / User Provisioning</p>
              <h1 className="mt-2.5 text-[30px] font-semibold tracking-tight text-slate-950">
                Secure invitation flow for non-member platform accounts
              </h1>
              <p className="mt-2.5 max-w-4xl text-sm leading-6 text-slate-600">
                {ROLE_COPY[role] || ROLE_COPY[ADMIN_ROLES.SUPER_ADMIN]}
              </p>
            </div>

            <div className="flex max-w-sm flex-col items-end gap-3">
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Provisioning model</p>
                <p className="mt-1.5 font-medium text-slate-900">Invitation first, access after acceptance</p>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">
                  Admins issue secure links here. Invitees set their own PIN during acceptance, and access activates only after that step completes.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  resetCreateFlow();
                  setCreateOpen(true);
                  clearLaunchParam();
                }}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600"
              >
                Create invitation
              </button>
            </div>
          </div>
        </section>

        {error ? <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4"><p className="text-sm text-rose-700">{error}</p></section> : null}
        {actionError ? <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4"><p className="text-sm text-rose-700">{actionError}</p></section> : null}
        {!hasInstitutions ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm text-amber-800">
              Institution-linked invitations need an institution record first. Create the institution in{" "}
              <Link to="/admin/super/institutions?create=1" className="font-medium underline underline-offset-2">
                Institutions
              </Link>{" "}
              before issuing institution user or agent invites.
            </p>
          </section>
        ) : null}

        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {summaryCards.map((card) => <SummaryCard key={card.id} {...card} />)}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the invitation list by role, invitation status, institution, or direct search against invitee, phone, email, invitation code, and creator.
              </p>
            </div>
            <button type="button" onClick={() => void loadConsole()} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50">
              Refresh
            </button>
          </div>

          <form className="mt-4 space-y-3" onSubmit={(event) => { event.preventDefault(); setAppliedFilters(draftFilters); }} autoComplete="off">
            <div className="flex flex-wrap gap-3">
              <FilterField label="Role">
                <select value={draftFilters.role} onChange={(event) => setDraftField("role", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <option value="">All roles</option>
                  {filterOptions.roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FilterField>

              <FilterField label="Status">
                <select value={draftFilters.status} onChange={(event) => setDraftField("status", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <option value="">All statuses</option>
                  {filterOptions.statuses.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FilterField>

              <FilterField label="Institution">
                <select value={draftFilters.institutionId} onChange={(event) => setDraftField("institutionId", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <option value="">All institutions</option>
                  {filterOptions.institutions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                </select>
              </FilterField>

              <FilterField label="Search">
                <input type="text" value={draftFilters.query} onChange={(event) => setDraftField("query", event.target.value)} placeholder="Invitee, phone, email, code, or creator" className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" />
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
              <h2 className="text-lg font-semibold text-slate-950">Invitation queue</h2>
              <p className="mt-1 text-sm text-slate-500">
                Track the invitation lifecycle, linkage context, expiry, and safe actions for non-member account provisioning.
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading invitations…</div>
          ) : rows.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <div className="mx-auto max-w-lg rounded-3xl border border-dashed border-slate-300 bg-brand-50 px-6 py-7">
                <p className="text-base font-semibold text-slate-800">{emptyTitle}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">{emptyHint}</p>
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1600px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">Invitee</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3">Linkage</th>
                    <th className="px-5 py-3">Method</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created by</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3">Expiry</th>
                    <th className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {rows.map((row) => {
                    const busy = actionLoading === row.id;
                    return (
                      <tr key={row.id} className="hover:bg-brand-50/80">
                        <td className="px-5 py-4 align-top">
                          <button type="button" onClick={() => setSelectedInvitationId(row.id)} className="text-left">
                            <p className="font-medium text-slate-900">{row.inviteeName}</p>
                            <p className="mt-1 text-xs text-slate-500">{row.inviteePhone || row.inviteeEmail || row.id}</p>
                            <p className="mt-1 font-mono text-[11px] text-slate-400">{row.inviteCode}</p>
                          </button>
                        </td>
                        <td className="px-5 py-4 align-top"><Badge toneMap={ROLE_TONES} value={row.role}>{row.roleLabel}</Badge></td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{row.institutionName || "No institution link"}</p>
                          <p className="mt-1 text-xs text-slate-400">{row.groupName || row.accountTypeLabel}</p>
                        </td>
                        <td className="px-5 py-4 align-top"><Badge toneMap={METHOD_TONES} value={row.inviteMethod}>{formatLabel(row.inviteMethod)}</Badge></td>
                        <td className="px-5 py-4 align-top">
                          <div className="space-y-2">
                            <Badge toneMap={STATUS_TONES} value={row.status}>{formatLabel(row.status)}</Badge>
                            <p className="text-xs text-slate-500">
                              {row.status === "accepted"
                                ? `Accepted ${formatDateValue(row.acceptedAt)}`
                                : row.status === "expired"
                                ? "Expired before acceptance"
                                : row.status === "revoked"
                                ? `Revoked ${formatDateValue(row.revokedAt)}`
                                : "Awaiting acceptance"}
                            </p>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">
                          <p>{row.createdByName}</p>
                          <p className="mt-1 text-xs text-slate-400">{row.createdBy || "Unknown creator"}</p>
                        </td>
                        <td className="px-5 py-4 align-top text-slate-700">{formatDateValue(row.createdAt)}</td>
                        <td className="px-5 py-4 align-top text-slate-700">{formatDateValue(row.expiresAt)}</td>
                        <td className="px-5 py-4 align-top">
                          <div className="flex justify-end gap-2">
                            <ActionButton onClick={() => setSelectedInvitationId(row.id)}>Detail</ActionButton>
                            {row.availableActions?.canRegenerate ? <ActionButton tone="accent" disabled={busy} onClick={() => void handleRegenerate(row)}>{busy ? "Working…" : "Reissue link"}</ActionButton> : null}
                            {row.availableActions?.canRevoke ? <ActionButton tone="danger" disabled={busy} onClick={() => void handleRevoke(row)}>{busy ? "Working…" : "Revoke"}</ActionButton> : null}
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

      <Drawer open={Boolean(selectedInvitation)} onClose={() => setSelectedInvitationId("")} title={selectedInvitation?.inviteeName || "Invitation detail"} subtitle={selectedInvitation?.inviteCode || selectedInvitation?.id || "Invitation"}>
        {selectedInvitation ? (
          <>
            <section className="grid gap-3 md:grid-cols-2">
              <SummaryCard label="Invitation status" value={formatLabel(selectedInvitation.status)} note={selectedInvitation.availableActions?.canRevoke ? "Safe lifecycle controls available" : "Status is no longer mutable from this view"} tone={selectedInvitation.status === "accepted" ? "success" : selectedInvitation.status === "pending" ? "warning" : "stable"} />
              <SummaryCard label="Role" value={selectedInvitation.roleLabel} note={selectedInvitation.accountTypeLabel} tone="stable" />
              <SummaryCard label="Linkage" value={selectedInvitation.institutionName || "Unlinked"} note={selectedInvitation.groupName || "No linked group record"} tone="stable" />
              <SummaryCard label="Delivery" value={formatLabel(selectedInvitation.inviteMethod)} note="Secure links are issued on create or reissue. Invite code remains visible for tracking." tone="stable" />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Invitation lifecycle</h3>
                  <p className="mt-1 text-sm text-slate-500">Access is created only after the invitee accepts and sets a PIN.</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge toneMap={ROLE_TONES} value={selectedInvitation.role}>{selectedInvitation.roleLabel}</Badge>
                  <Badge toneMap={STATUS_TONES} value={selectedInvitation.status}>{formatLabel(selectedInvitation.status)}</Badge>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                {selectedInvitation.availableActions?.canRegenerate ? <ActionButton tone="accent" disabled={actionLoading === selectedInvitation.id} onClick={() => void handleRegenerate(selectedInvitation)}>{actionLoading === selectedInvitation.id ? "Working…" : "Reissue secure link"}</ActionButton> : null}
                {selectedInvitation.availableActions?.canRevoke ? <ActionButton tone="danger" disabled={actionLoading === selectedInvitation.id} onClick={() => void handleRevoke(selectedInvitation)}>{actionLoading === selectedInvitation.id ? "Working…" : "Revoke invitation"}</ActionButton> : null}
              </div>

              <div className="mt-4 rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Invite code</p>
                <p className="mt-2 font-mono text-sm text-slate-700">{selectedInvitation.inviteCode}</p>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  Share the secure link generated at creation or reissue time. Use the invite code as a support reference when tracking the invitation.
                </p>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Invitation summary</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Invitation ID" value={selectedInvitation.id} mono />
                <DetailRow label="Invitee" value={selectedInvitation.inviteeName} />
                <DetailRow label="Phone" value={selectedInvitation.inviteePhone || "Not set"} />
                <DetailRow label="Email" value={selectedInvitation.inviteeEmail || "Not set"} />
                <DetailRow label="Role" value={selectedInvitation.roleLabel} />
                <DetailRow label="Account type" value={selectedInvitation.accountTypeLabel} />
                <DetailRow label="Invite method" value={formatLabel(selectedInvitation.inviteMethod)} />
                <DetailRow label="Login surface" value={formatLabel(selectedInvitation.loginSurface)} />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Linkage and audit</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Institution" value={selectedInvitation.institutionName || "No linked institution"} />
                <DetailRow label="Institution ID" value={selectedInvitation.institutionId || "Not set"} mono />
                <DetailRow label="Group" value={selectedInvitation.groupName || "No linked group"} />
                <DetailRow label="Group ID" value={selectedInvitation.groupId || "Not set"} mono />
                <DetailRow label="Created by" value={selectedInvitation.createdByName} />
                <DetailRow label="Creator ID" value={selectedInvitation.createdBy || "Unknown"} mono />
                <DetailRow label="Created" value={formatDateValue(selectedInvitation.createdAt)} />
                <DetailRow label="Expires" value={formatDateValue(selectedInvitation.expiresAt)} />
                <DetailRow label="Accepted" value={formatDateValue(selectedInvitation.acceptedAt)} />
                <DetailRow label="Accepted user" value={selectedInvitation.acceptedUserId || "Not accepted"} mono />
              </dl>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-brand-50 p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Scope of this view</h3>
              <div className="mt-3 space-y-2 text-sm leading-6 text-slate-600">
                <p>Admins do not set PINs in this workflow. Invitees set their own PIN during acceptance.</p>
                <p>Member and group-leader self-registration remains unchanged outside this module.</p>
              </div>
            </section>
          </>
        ) : null}
      </Drawer>

      <Dialog open={createOpen} onClose={() => { setCreateOpen(false); resetCreateFlow(); clearLaunchParam(); }} title={freshDelivery ? "Invitation ready to share" : "Create user invitation"} body={freshDelivery ? "A secure invitation has been issued. Share the acceptance link with the invitee through your approved delivery channel." : "Create a secure invitation for an institution user, agent, or admin-type account. Access will activate only after acceptance."}>
        {freshDelivery ? (
          <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              The invitation is pending and expires on {formatDateValue(freshDelivery.expiresAt)}.
            </div>

            <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Invite code</p>
              <p className="mt-2 font-mono text-sm break-all text-slate-700">{freshDelivery.inviteCode}</p>
              <div className="mt-3">
                <ActionButton onClick={() => void handleCopy("inviteCode", freshDelivery.inviteCode)}>{copiedField === "inviteCode" ? "Copied" : "Copy code"}</ActionButton>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-400">Acceptance link</p>
              <p className="mt-2 break-all text-sm text-slate-700">{freshDelivery.acceptanceLink}</p>
              <div className="mt-3">
                <ActionButton onClick={() => void handleCopy("acceptanceLink", freshDelivery.acceptanceLink)}>{copiedField === "acceptanceLink" ? "Copied" : "Copy link"}</ActionButton>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setCreateOpen(false); resetCreateFlow(); clearLaunchParam(); }} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
                Close
              </button>
            </div>
          </div>
        ) : (
          <form className="space-y-4" onSubmit={handleCreate} autoComplete="off">
            <div className="grid gap-4 md:grid-cols-2">
              <FilterField label="Role">
                <select required value={createForm.role} onChange={(event) => setCreateForm((current) => ({ ...current, role: event.target.value, institutionId: "" }))} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                  <option value="">Select invitation role</option>
                  {createOptions.roles.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </FilterField>

              <FilterField label="Invitee name">
                <input type="text" required value={createForm.targetName} onChange={(event) => setCreateField("targetName", event.target.value)} placeholder="Full name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" />
              </FilterField>

              <FilterField label="Phone">
                <input type="tel" required value={createForm.targetPhone} onChange={(event) => setCreateField("targetPhone", event.target.value)} placeholder="+25766123456" className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" />
              </FilterField>

              <FilterField label="Email">
                <input type="email" value={createForm.targetEmail} onChange={(event) => setCreateField("targetEmail", event.target.value)} placeholder="Optional contact email" className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700" />
              </FilterField>

              {createRoleRequiresInstitution ? (
                <FilterField label="Institution">
                  {hasInstitutions ? (
                    <select required value={createForm.institutionId} onChange={(event) => setCreateField("institutionId", event.target.value)} className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700">
                      <option value="">Select institution</option>
                      {createOptions.institutions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
                    </select>
                  ) : (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
                      No institutions are available yet. Create the institution record in <Link to="/admin/super/institutions?create=1" className="font-medium underline underline-offset-2">Institutions</Link>, then return here to issue the invitation.
                    </div>
                  )}
                </FilterField>
              ) : null}
            </div>

            {selectedRoleConfig ? (
              <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-900">{selectedRoleConfig.label}</p>
                <p className="mt-1.5 leading-6">
                  This role uses the {formatLabel(selectedRoleConfig.loginSurface)}. The invitee will set a six-digit PIN during acceptance.
                </p>
              </div>
            ) : null}

            {createError ? <p className="text-sm text-rose-600">{createError}</p> : null}

            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setCreateOpen(false); resetCreateFlow(); clearLaunchParam(); }} className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50">
                Cancel
              </button>
              <button type="submit" disabled={createSubmitting || (createRoleRequiresInstitution && !hasInstitutions)} className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60">
                {createSubmitting ? "Creating…" : "Create invitation"}
              </button>
            </div>
          </form>
        )}
      </Dialog>
    </main>
  );
}
