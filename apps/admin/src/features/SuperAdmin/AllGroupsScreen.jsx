import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

const DEFAULT_FILTERS = {
  search: "",
  status: "",
  institutionId: "",
  risk: "",
  lendingState: "",
  leader: "",
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "active", label: "Active" },
  { value: "suspended", label: "Paused" },
  { value: "pending_approval", label: "Pending approval" },
];

const RISK_OPTIONS = [
  { value: "", label: "All risk states" },
  { value: "under_review", label: "Under review" },
  { value: "high_risk", label: "High risk" },
  { value: "loan_exposure", label: "Loan exposure" },
  { value: "stable", label: "Stable" },
];

const LENDING_OPTIONS = [
  { value: "", label: "All lending states" },
  { value: "active", label: "Lending active" },
  { value: "paused", label: "Lending paused" },
];

const TONE_STYLES = {
  emerald: "border-emerald-200 bg-emerald-50 text-emerald-700",
  amber: "border-amber-200 bg-amber-50 text-amber-700",
  rose: "border-rose-200 bg-rose-50 text-rose-700",
  sky: "border-sky-200 bg-sky-50 text-sky-700",
  slate: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatCurrency(value) {
  return `${formatNumber(value)} BIF`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" });
}

function toneClass(tone) {
  return TONE_STYLES[tone] || TONE_STYLES.slate;
}

function deriveRiskFilter(row) {
  if (row.reviewStatus === "under_review") return "under_review";
  if (row.highRisk) return "high_risk";
  if (row.riskBadge === "Loan exposure") return "loan_exposure";
  return "stable";
}

function buildSummaryCards(summary) {
  return [
    { id: "total", label: "Total groups", value: summary?.totalGroups ?? 0 },
    { id: "active", label: "Active groups", value: summary?.activeGroups ?? 0 },
    { id: "paused", label: "Paused groups", value: summary?.pausedGroups ?? 0 },
    { id: "flagged", label: "Flagged groups", value: summary?.flaggedGroups ?? 0, tone: "amber" },
    { id: "pending", label: "Pending groups", value: summary?.pendingGroups ?? 0 },
    { id: "loans", label: "Groups with loans", value: summary?.groupsWithOutstandingLoans ?? 0, tone: "sky" },
    { id: "risk", label: "High-risk groups", value: summary?.highRiskGroups ?? 0, tone: "rose" },
  ];
}

function FilterField({ label, children }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Modal({ title, body, confirmLabel, confirmTone = "slate", onCancel, onConfirm, confirmDisabled = false }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/35 px-4">
      <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-2xl">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        <div className="mt-4">{body}</div>
        <div className="mt-5 flex justify-end gap-2.5">
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
            className={`rounded-xl px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60 ${
              confirmTone === "rose"
                ? "bg-rose-600 hover:bg-rose-700"
                : confirmTone === "amber"
                ? "bg-amber-600 hover:bg-amber-700"
                : "bg-brand-500 hover:bg-brand-600"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AllGroupsScreen() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [reviewDraft, setReviewDraft] = useState({ groupId: "", note: "" });
  const [suspendDraft, setSuspendDraft] = useState({ groupId: "", note: "" });

  useEffect(() => {
    void loadConsole();
  }, []);

  async function loadConsole() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getGroupsGovernanceConsole");
      const response = await fn({});
      setPayload(response.data || null);
    } catch (loadError) {
      setError("We couldn't load group governance data right now.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  async function runAction(groupId, actionKey, callback) {
    setActionLoading(`${actionKey}:${groupId}`);
    setActionError("");
    try {
      await callback();
      await loadConsole();
    } catch (actionErr) {
      setActionError("That governance action could not be completed right now.");
    } finally {
      setActionLoading("");
    }
  }

  function setFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  async function handleSuspend(groupId, reason) {
    await runAction(groupId, "suspend", async () => {
      const fn = httpsCallable(functions, "suspendGroup");
      await fn({ groupId, reason });
    });
  }

  async function handleReactivate(groupId) {
    await runAction(groupId, "reactivate", async () => {
      const fn = httpsCallable(functions, "reactivateGroup");
      await fn({ groupId });
    });
  }

  async function handleToggleLending(groupId, paused) {
    await runAction(groupId, "lending", async () => {
      const fn = httpsCallable(functions, "adminSetGroupBorrowPause");
      await fn({
        groupId,
        paused: !paused,
        reason: paused ? "" : "Paused from the group governance console pending review.",
      });
    });
  }

  async function handleReview(groupId, underReview, note) {
    await runAction(groupId, "review", async () => {
      const fn = httpsCallable(functions, "setGroupGovernanceReviewState");
      await fn({ groupId, underReview, note });
    });
  }

  const role = payload?.role || ADMIN_ROLES.SUPER_ADMIN;
  const rows = payload?.rows || [];
  const filteredRows = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    const leader = filters.leader.trim().toLowerCase();

    return rows.filter((row) => {
      if (search) {
        const haystack = [row.name, row.groupCode].join(" ").toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (leader && !(row.leaderName || "").toLowerCase().includes(leader)) return false;
      if (filters.status && row.status !== filters.status) return false;
      if (filters.institutionId && row.institutionId !== filters.institutionId) return false;
      if (filters.lendingState && row.lendingState !== filters.lendingState) return false;
      if (filters.risk && deriveRiskFilter(row) !== filters.risk) return false;
      return true;
    });
  }, [filters, rows]);

  const summaryCards = buildSummaryCards(payload?.summary);
  const isSuperAdmin = role === ADMIN_ROLES.SUPER_ADMIN;

  return (
    <main className="px-8 py-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-7 py-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Group Governance
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Governance oversight for savings groups, lending posture, and review state
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Focused on group health, exposure, and governance actions. Member financial details stay out of this console.
              </p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Access</p>
              <p className="mt-2 font-medium text-slate-900">
                {isSuperAdmin ? "Super admin governance controls" : "Operations governance controls"}
              </p>
              <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
                Suspend and reactivate stay reserved for super admins. Operational admins can still manage lending state and review status.
              </p>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </section>
        )}
        {actionError && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{actionError}</p>
          </section>
        )}

        <section className="grid gap-4 xl:grid-cols-7">
          {summaryCards.map((card) => (
            <div
              key={card.id}
              className={`rounded-2xl border bg-white px-5 py-4 shadow-sm ${card.tone ? toneClass(card.tone) : "border-slate-200"}`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{loading ? "…" : formatNumber(card.value)}</p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Search by group or leader, then narrow the governance list by institution, risk, status, or lending posture.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadConsole()}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 disabled:opacity-60"
            >
              Refresh
            </button>
          </div>

          <div className="mt-5 grid gap-3 xl:grid-cols-6">
            <FilterField label="Group name or code">
              <input
                type="text"
                value={filters.search}
                onChange={(event) => setFilter("search", event.target.value)}
                placeholder="Search groups"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
              />
            </FilterField>
            <FilterField label="Leader">
              <input
                type="text"
                value={filters.leader}
                onChange={(event) => setFilter("leader", event.target.value)}
                placeholder="Leader name"
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
              />
            </FilterField>
            <FilterField label="Status">
              <select
                value={filters.status}
                onChange={(event) => setFilter("status", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
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
                value={filters.institutionId}
                onChange={(event) => setFilter("institutionId", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
              >
                <option value="">All institutions</option>
                {(payload?.filterOptions?.institutions || []).map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.name}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Risk">
              <select
                value={filters.risk}
                onChange={(event) => setFilter("risk", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
              >
                {RISK_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>
            <FilterField label="Lending">
              <select
                value={filters.lendingState}
                onChange={(event) => setFilter("lendingState", event.target.value)}
                className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
              >
                {LENDING_OPTIONS.map((option) => (
                  <option key={option.value || "all"} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FilterField>
          </div>
        </section>

        <section className="rounded-3xl border border-brand-100 bg-white shadow-card">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Groups</h2>
              <p className="mt-1 text-sm text-slate-500">
                {loading ? "Refreshing governance list…" : `${formatNumber(filteredRows.length)} groups in the current scope`}
              </p>
            </div>
          </div>

          {loading ? (
            <div className="space-y-3 px-5 py-5">
              {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : !filteredRows.length ? (
            <div className="px-5 py-20 text-center">
              <p className="text-base font-medium text-slate-900">No groups match the current filters.</p>
              <p className="mt-2 text-sm text-slate-500">Clear one of the filters or broaden the search to continue.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-brand-50 text-left">
                  <tr className="border-b border-slate-200">
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Group</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Code</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Leader</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Institution</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Members</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Savings</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Outstanding loans</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Status</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Lending</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Governance / risk</th>
                    <th className="px-5 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Created</th>
                    <th className="px-5 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {filteredRows.map((row) => (
                    <tr key={row.groupId} className="hover:bg-brand-50">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-900">{row.name}</p>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-slate-600">{row.groupCode || "—"}</td>
                      <td className="px-5 py-3 text-slate-700">{row.leaderName}</td>
                      <td className="px-5 py-3 text-slate-700">{row.institutionName}</td>
                      <td className="px-5 py-3 text-right text-slate-700">{formatNumber(row.memberCount)}</td>
                      <td className="px-5 py-3 text-right text-slate-700">{formatCurrency(row.totalSavings)}</td>
                      <td className="px-5 py-3 text-right text-slate-700">{formatCurrency(row.totalOutstandingLoans)}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${row.status === "active" ? toneClass("emerald") : row.status === "suspended" ? toneClass("slate") : toneClass("amber")}`}>
                          {row.status === "pending_approval" ? "Pending approval" : row.status}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${row.lendingState === "paused" ? toneClass("amber") : toneClass("emerald")}`}>
                          {row.lendingState === "paused" ? "Paused" : "Active"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex flex-col gap-1">
                          <span className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(row.riskTone)}`}>
                            {row.riskBadge}
                          </span>
                          {row.reviewNote ? <span className="text-xs text-slate-500">{row.reviewNote}</span> : null}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-slate-600">{formatDate(row.createdAtMs)}</td>
                      <td className="px-5 py-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            to={`/admin/super/groups/${row.groupId}`}
                            className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-medium text-white hover:bg-brand-600"
                          >
                            Open
                          </Link>
                          {row.status === "active" && (
                            <button
                              type="button"
                              onClick={() => void handleToggleLending(row.groupId, row.lendingState === "paused")}
                              disabled={actionLoading === `lending:${row.groupId}`}
                              className="rounded-xl border border-amber-300 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-50 disabled:opacity-60"
                            >
                              {actionLoading === `lending:${row.groupId}`
                                ? "Working…"
                                : row.lendingState === "paused"
                                ? "Resume lending"
                                : "Pause lending"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() =>
                              row.reviewStatus === "under_review"
                                ? void handleReview(row.groupId, false, "")
                                : setReviewDraft({ groupId: row.groupId, note: "" })
                            }
                            disabled={actionLoading === `review:${row.groupId}`}
                            className={`rounded-xl border px-3 py-2 text-xs font-medium disabled:opacity-60 ${
                              row.reviewStatus === "under_review"
                                ? "border-slate-300 text-slate-700 hover:bg-brand-50"
                                : "border-sky-300 text-sky-700 hover:bg-sky-50"
                            }`}
                          >
                            {actionLoading === `review:${row.groupId}`
                              ? "Working…"
                              : row.reviewStatus === "under_review"
                              ? "Clear review"
                              : "Force review"}
                          </button>
                          {isSuperAdmin && row.status === "active" && (
                            <button
                              type="button"
                              onClick={() => setSuspendDraft({ groupId: row.groupId, note: "" })}
                              disabled={actionLoading === `suspend:${row.groupId}`}
                              className="rounded-xl border border-rose-300 px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-60"
                            >
                              Suspend
                            </button>
                          )}
                          {isSuperAdmin && row.status === "suspended" && (
                            <button
                              type="button"
                              onClick={() => void handleReactivate(row.groupId)}
                              disabled={actionLoading === `reactivate:${row.groupId}`}
                              className="rounded-xl border border-emerald-300 px-3 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-60"
                            >
                              {actionLoading === `reactivate:${row.groupId}` ? "Working…" : "Reactivate"}
                            </button>
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

      {reviewDraft.groupId ? (
        <Modal
          title="Mark group for review"
          confirmLabel="Mark for review"
          confirmTone="amber"
          confirmDisabled={!reviewDraft.note.trim() || !!actionLoading}
          onCancel={() => setReviewDraft({ groupId: "", note: "" })}
          onConfirm={async () => {
            const { groupId, note } = reviewDraft;
            setReviewDraft({ groupId: "", note: "" });
            await handleReview(groupId, true, note.trim());
          }}
          body={
            <label className="block text-sm text-slate-700">
              Review note
              <textarea
                rows={4}
                value={reviewDraft.note}
                onChange={(event) => setReviewDraft((current) => ({ ...current, note: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-900"
                placeholder="Describe why this group needs governance review."
              />
            </label>
          }
        />
      ) : null}

      {suspendDraft.groupId ? (
        <Modal
          title="Pause group"
          confirmLabel="Suspend group"
          confirmTone="rose"
          confirmDisabled={!suspendDraft.note.trim() || !!actionLoading}
          onCancel={() => setSuspendDraft({ groupId: "", note: "" })}
          onConfirm={async () => {
            const { groupId, note } = suspendDraft;
            setSuspendDraft({ groupId: "", note: "" });
            await handleSuspend(groupId, note.trim());
          }}
          body={
            <label className="block text-sm text-slate-700">
              Suspension reason
              <textarea
                rows={4}
                value={suspendDraft.note}
                onChange={(event) => setSuspendDraft((current) => ({ ...current, note: event.target.value }))}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-900"
                placeholder="State why the group is being paused."
              />
            </label>
          }
        />
      ) : null}
    </main>
  );
}
