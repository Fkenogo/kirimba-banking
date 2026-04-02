import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

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

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatPercent(value) {
  if (value == null) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function toneClass(tone) {
  return TONE_STYLES[tone] || TONE_STYLES.slate;
}

function MetricCard({ label, value, note, tone = "slate" }) {
  return (
    <div className={`rounded-2xl border px-5 py-4 shadow-sm ${toneClass(tone)}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className="text-sm text-slate-700">{value || "—"}</dd>
    </div>
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

export default function GroupDetailScreen() {
  const navigate = useNavigate();
  const { groupId } = useParams();
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [reviewDraft, setReviewDraft] = useState("");
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [suspendDraft, setSuspendDraft] = useState("");
  const [showSuspendModal, setShowSuspendModal] = useState(false);

  useEffect(() => {
    if (groupId) {
      void loadDetail();
    }
  }, [groupId]);

  async function loadDetail() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getGroupGovernanceDetail");
      const response = await fn({ groupId });
      setPayload(response.data || null);
    } catch (loadError) {
      setError("We couldn't load this group right now.");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  async function runAction(actionKey, callback) {
    setActionLoading(actionKey);
    setActionError("");
    try {
      await callback();
      await loadDetail();
    } catch (actionErr) {
      setActionError("That governance action could not be completed right now.");
    } finally {
      setActionLoading("");
    }
  }

  const role = payload?.role || ADMIN_ROLES.SUPER_ADMIN;
  const group = payload?.group || null;
  const isSuperAdmin = role === ADMIN_ROLES.SUPER_ADMIN;

  const exposureCards = useMemo(() => {
    if (!group) return [];
    return [
      {
        id: "savings",
        label: "Total savings",
        value: formatCurrency(group.totalSavings),
        note: "Confirmed group savings base",
        tone: "emerald",
      },
      {
        id: "pending",
        label: "Pending savings",
        value: formatCurrency(group.pendingSavings),
        note: "Deposits still awaiting confirmation",
        tone: group.pendingSavings > 0 ? "amber" : "slate",
      },
      {
        id: "loans",
        label: "Outstanding loans",
        value: formatCurrency(group.outstandingLoans),
        note: `${formatNumber(group.overdueLoanCount)} overdue · ${formatNumber(group.defaultedLoanCount)} defaulted`,
        tone: group.defaultedLoanCount > 0 ? "rose" : group.outstandingLoans > 0 ? "sky" : "slate",
      },
      {
        id: "coverage",
        label: "Savings coverage",
        value: formatPercent(group.coverageRatio),
        note: "Outstanding loans as a share of group savings",
        tone: group.coverageRatio >= 0.75 ? "amber" : "slate",
      },
    ];
  }, [group]);

  return (
    <main className="px-8 py-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-7 py-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div>
              <button
                type="button"
                onClick={() => navigate("/admin/super/groups")}
                className="inline-flex items-center gap-2 rounded-full border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-brand-50"
              >
                Back to Groups
              </button>
              <p className="mt-5 text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Group Governance Detail
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                {loading ? "Loading group…" : group?.name || "Group detail"}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">
                Governance-safe view of identity, exposure, member roster, and recent control actions.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadDetail()}
              disabled={loading}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 disabled:opacity-60"
            >
              Refresh
            </button>
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

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-3xl bg-slate-100" />
            ))}
          </div>
        ) : !group ? (
          <section className="rounded-3xl border border-slate-200 bg-white px-6 py-20 text-center shadow-sm">
            <p className="text-base font-medium text-slate-900">This group could not be found.</p>
          </section>
        ) : (
          <>
            <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_360px]">
              <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${group.status === "active" ? toneClass("emerald") : group.status === "suspended" ? toneClass("slate") : toneClass("amber")}`}>
                    {group.status === "pending_approval" ? "Pending approval" : group.status}
                  </span>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${group.lendingPaused ? toneClass("amber") : toneClass("emerald")}`}>
                    {group.lendingPaused ? "Lending paused" : "Lending active"}
                  </span>
                  <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${toneClass(group.riskTone)}`}>
                    {group.riskBadge}
                  </span>
                </div>

                <dl className="mt-5 grid gap-4 sm:grid-cols-2">
                  <DetailRow label="Group code" value={group.groupCode} />
                  <DetailRow label="Institution" value={group.institutionName} />
                  <DetailRow label="Leader" value={group.leaderName} />
                  <DetailRow label="Members" value={formatNumber(group.memberCount)} />
                  <DetailRow label="Created" value={formatDate(group.createdAtMs)} />
                  <DetailRow label="Exceptions" value={formatNumber(group.exceptionCount)} />
                </dl>
              </div>

              <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">Governance actions</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Governance controls only. No direct financial edits are available from this screen.
                </p>

                <div className="mt-5 grid gap-2.5">
                  <button
                    type="button"
                    onClick={() =>
                      void runAction("lending", async () => {
                        const fn = httpsCallable(functions, "adminSetGroupBorrowPause");
                        await fn({
                          groupId,
                          paused: !group.lendingPaused,
                          reason: group.lendingPaused
                            ? ""
                            : "Paused from the governance detail screen pending review.",
                        });
                      })
                    }
                    disabled={actionLoading === "lending" || group.status !== "active"}
                    className="rounded-xl border border-amber-300 px-4 py-3 text-left text-sm font-medium text-amber-700 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {group.lendingPaused ? "Resume lending" : "Pause lending"}
                  </button>

                  <button
                    type="button"
                    onClick={() =>
                      group.reviewStatus === "under_review"
                        ? void runAction("review", async () => {
                            const fn = httpsCallable(functions, "setGroupGovernanceReviewState");
                            await fn({ groupId, underReview: false, note: "" });
                          })
                        : setShowReviewModal(true)
                    }
                    disabled={actionLoading === "review"}
                    className="rounded-xl border border-sky-300 px-4 py-3 text-left text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {group.reviewStatus === "under_review" ? "Clear review state" : "Force review"}
                  </button>

                  {isSuperAdmin ? (
                    group.status === "suspended" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void runAction("reactivate", async () => {
                            const fn = httpsCallable(functions, "reactivateGroup");
                            await fn({ groupId });
                          })
                        }
                        disabled={actionLoading === "reactivate"}
                        className="rounded-xl border border-emerald-300 px-4 py-3 text-left text-sm font-medium text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Reactivate group
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setShowSuspendModal(true)}
                        disabled={actionLoading === "suspend" || group.status !== "active"}
                        className="rounded-xl border border-rose-300 px-4 py-3 text-left text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Pause group
                      </button>
                    )
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3 text-sm text-slate-500">
                      Suspend and reactivate remain reserved for super admins.
                    </div>
                  )}
                </div>
              </aside>
            </section>

            <section className="grid gap-4 xl:grid-cols-4">
              {exposureCards.map((card) => (
                <MetricCard key={card.id} {...card} />
              ))}
            </section>

            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_380px]">
              <div className="space-y-6">
                <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-lg font-semibold text-slate-950">Governance and risk summary</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                      <p className="text-sm font-medium text-slate-700">Review state</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">
                        {group.reviewStatus === "under_review" ? "Under review" : "No active review"}
                      </p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">{group.reviewNote || "No governance note recorded."}</p>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                      <p className="text-sm font-medium text-slate-700">Exposure posture</p>
                      <p className="mt-2 text-lg font-semibold text-slate-950">{group.riskBadge}</p>
                      <p className="mt-2 text-xs leading-5 text-slate-500">
                        {group.defaultedLoanCount > 0
                          ? `${formatNumber(group.defaultedLoanCount)} defaulted loans in the portfolio`
                          : group.overdueLoanCount > 0
                          ? `${formatNumber(group.overdueLoanCount)} overdue active loans need attention`
                          : "No overdue or defaulted group-level lending exposure right now."}
                      </p>
                    </div>
                  </div>
                </section>

                <section className="rounded-3xl border border-brand-100 bg-white shadow-card">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h2 className="text-lg font-semibold text-slate-950">Group members</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      Privacy-safe directory only. No balances, loans, wallet data, or transaction history are shown here.
                    </p>
                  </div>
                  {!group.members?.length ? (
                    <div className="px-6 py-10 text-sm text-slate-500">No members are linked to this group yet.</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="bg-brand-50 text-left">
                          <tr className="border-b border-slate-200">
                            <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Member</th>
                            <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Role</th>
                            <th className="px-6 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">Joined</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-brand-50">
                          {group.members.map((member) => (
                            <tr key={member.userId} className="hover:bg-brand-50">
                              <td className="px-6 py-3 font-medium text-slate-900">{member.fullName}</td>
                              <td className="px-6 py-3 text-slate-700">{member.role}</td>
                              <td className="px-6 py-3 text-slate-600">{formatDate(member.joinedAtMs)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>

              <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-lg font-semibold text-slate-950">Recent governance actions</h2>
                <p className="mt-1 text-sm text-slate-500">Most recent governance controls and review events recorded for this group.</p>
                <div className="mt-5 space-y-3">
                  {group.recentActions?.length ? (
                    group.recentActions.map((entry) => (
                      <div key={entry.id} className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                        <p className="text-sm font-medium text-slate-900">{entry.action.replaceAll("_", " ")}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.14em] text-slate-400">{entry.actorRole || "unknown role"}</p>
                        <p className="mt-2 text-xs text-slate-500">{formatDateTime(entry.createdAtMs)}</p>
                        {entry.note ? <p className="mt-2 text-sm text-slate-600">{entry.note}</p> : null}
                      </div>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4 text-sm text-slate-500">
                      No recent governance actions are recorded for this group yet.
                    </div>
                  )}
                </div>
              </aside>
            </section>
          </>
        )}
      </div>

      {showReviewModal ? (
        <Modal
          title="Force review"
          confirmLabel="Mark for review"
          confirmTone="amber"
          confirmDisabled={!reviewDraft.trim() || !!actionLoading}
          onCancel={() => {
            setShowReviewModal(false);
            setReviewDraft("");
          }}
          onConfirm={async () => {
            const note = reviewDraft.trim();
            setShowReviewModal(false);
            setReviewDraft("");
            await runAction("review", async () => {
              const fn = httpsCallable(functions, "setGroupGovernanceReviewState");
              await fn({ groupId, underReview: true, note });
            });
          }}
          body={
            <label className="block text-sm text-slate-700">
              Review note
              <textarea
                rows={4}
                value={reviewDraft}
                onChange={(event) => setReviewDraft(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-900"
                placeholder="Explain why this group is being escalated for governance review."
              />
            </label>
          }
        />
      ) : null}

      {showSuspendModal ? (
        <Modal
          title="Pause group"
          confirmLabel="Suspend group"
          confirmTone="rose"
          confirmDisabled={!suspendDraft.trim() || !!actionLoading}
          onCancel={() => {
            setShowSuspendModal(false);
            setSuspendDraft("");
          }}
          onConfirm={async () => {
            const reason = suspendDraft.trim();
            setShowSuspendModal(false);
            setSuspendDraft("");
            await runAction("suspend", async () => {
              const fn = httpsCallable(functions, "suspendGroup");
              await fn({ groupId, reason });
            });
          }}
          body={
            <label className="block text-sm text-slate-700">
              Suspension reason
              <textarea
                rows={4}
                value={suspendDraft}
                onChange={(event) => setSuspendDraft(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-slate-900"
                placeholder="State why the group should be paused."
              />
            </label>
          }
        />
      ) : null}
    </main>
  );
}
