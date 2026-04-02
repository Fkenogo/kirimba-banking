import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

const DEFAULT_FILTERS = {
  dateFrom: "",
  dateTo: "",
  institutionId: "",
  groupQuery: "",
  agentQuery: "",
  status: "",
  reference: "",
  flaggedOnly: false,
};

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending_queue", label: "Pending queues" },
  { value: "submitted", label: "Submitted" },
  { value: "confirmed", label: "Confirmed" },
  { value: "flagged", label: "Flagged" },
];

const ROLE_COPY = {
  [ADMIN_ROLES.SUPER_ADMIN]:
    "Cross-network oversight for pending queues, institution batches, confirmation lag, and exception pressure.",
  [ADMIN_ROLES.ADMIN]:
    "Operational review of deposit queues, submitted batches, and flagged issues without taking over institution confirmation.",
  [ADMIN_ROLES.FINANCE]:
    "Finance-oriented view of liquidity flow, confirmation timing, and flagged batches. This console stays read-first.",
};

const STATUS_STYLES = {
  pending_queue: "border-amber-200 bg-amber-50 text-amber-700",
  submitted: "border-sky-200 bg-sky-50 text-sky-700",
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  flagged: "border-rose-200 bg-rose-50 text-rose-700",
  default: "border-slate-200 bg-slate-100 text-slate-700",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatCurrency(value) {
  return `${formatNumber(value)} BIF`;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", { dateStyle: "medium" });
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

function toneClass(status) {
  return STATUS_STYLES[status] || STATUS_STYLES.default;
}

function SummaryCard({ label, value, note, tone = "default" }) {
  return (
    <div className={`rounded-2xl border px-5 py-4 shadow-sm ${toneClass(tone)}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</p>
      <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
      {note ? <p className="mt-2 text-xs leading-5 text-slate-500">{note}</p> : null}
    </div>
  );
}

function FilterField({ label, children }) {
  return (
    <label className="flex min-w-[140px] flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function StatusBadge({ status, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${toneClass(status)}`}>
      {children}
    </span>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={mono ? "break-all font-mono text-sm text-slate-700" : "text-sm text-slate-700"}>{value || "—"}</dd>
    </div>
  );
}

function Drawer({ open, title, subtitle, onClose, children }) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-950/35">
      <button type="button" aria-label="Close batch detail" className="flex-1" onClick={onClose} />
      <aside className="relative h-full w-full max-w-[640px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
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

export default function PendingDepositsScreen() {
  const [draftFilters, setDraftFilters] = useState(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] = useState(DEFAULT_FILTERS);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedRow, setSelectedRow] = useState(null);
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  useEffect(() => {
    void loadConsole(appliedFilters);
  }, [appliedFilters]);

  async function loadConsole(nextFilters = appliedFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getDepositsBatchesConsole");
      const response = await fn(nextFilters);
      setPayload(response.data || null);
    } catch (loadError) {
      setPayload(null);
      setError("We couldn't load deposits and batches right now.");
    } finally {
      setLoading(false);
    }
  }

  async function openDetail(row) {
    setSelectedRow(row);
    setDetail(null);
    setDetailError("");
    setDetailLoading(true);
    try {
      const fn = httpsCallable(functions, "getDepositBatchDetail");
      const response = await fn({
        kind: row.kind,
        batchId: row.batchId,
        groupId: row.groupId,
        agentId: row.agentId,
      });
      setDetail(response.data?.detail || null);
    } catch (loadError) {
      setDetail(null);
      setDetailError("We couldn't load that batch detail right now.");
    } finally {
      setDetailLoading(false);
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

  const summaryCards = useMemo(
    () => [
      {
        id: "pending",
        label: "Pending queues",
        value: summary.pendingQueues ?? 0,
        note: "Grouped deposit records not yet submitted as a batch",
        tone: "pending_queue",
      },
      {
        id: "submitted",
        label: "Submitted batches",
        value: summary.submittedBatches ?? 0,
        note: "Awaiting institution confirmation",
        tone: "submitted",
      },
      {
        id: "confirmed",
        label: "Confirmed batches",
        value: summary.confirmedBatches ?? 0,
        note: summary.averageConfirmationLagMs
          ? `Avg confirmation lag ${formatDuration(summary.averageConfirmationLagMs)}`
          : "Confirmation lag unavailable in current scope",
        tone: "confirmed",
      },
      {
        id: "flagged",
        label: "Flagged batches",
        value: summary.flaggedBatches ?? 0,
        note: "Requires investigation or institution follow-up",
        tone: "flagged",
      },
      {
        id: "oldest",
        label: "Oldest open age",
        value: summary.oldestOpenAgeMs ? formatDuration(summary.oldestOpenAgeMs) : "—",
        note: "Longest wait across pending, submitted, or flagged work",
      },
      {
        id: "amount",
        label: "Amount in scope",
        value: formatCurrency(summary.totalAmountInScope ?? 0),
        note: "Current filtered results only",
      },
    ],
    [summary]
  );

  return (
    <main className="px-8 py-8">
      <div className="mx-auto max-w-[1640px] space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-7 py-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Deposits & Batches Control
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
                Oversight for pending deposit queues, institution batches, confirmations, and flagged issues
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{ROLE_COPY[role]}</p>
            </div>

            <div className="max-w-sm rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Operating model</p>
              <p className="mt-2 font-medium text-slate-900">Investigation and escalation only</p>
              <p className="mt-2 text-xs leading-5 text-slate-500">
                Institution users still own cash confirmation. This console does not expose admin confirmation actions or ledger edits.
              </p>
            </div>
          </div>
        </section>

        {error ? (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </section>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-6">
          {summaryCards.map((card) => (
            <SummaryCard key={card.id} {...card} />
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the operational scope by institution, queue state, batch status, and time window.
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

          <form className="mt-5 space-y-4" onSubmit={handleApply}>
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
              <FilterField label="Group">
                <input
                  type="text"
                  value={draftFilters.groupQuery}
                  onChange={(event) => setDraftField("groupQuery", event.target.value)}
                  placeholder="Group name or ID"
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
              <FilterField label="Reference">
                <input
                  type="text"
                  value={draftFilters.reference}
                  onChange={(event) => setDraftField("reference", event.target.value)}
                  placeholder="Batch or queue reference"
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </FilterField>
            </div>

            <div className="flex items-center justify-between gap-4">
              <label className="inline-flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={draftFilters.flaggedOnly}
                  onChange={(event) => setDraftField("flaggedOnly", event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                />
                Flagged only
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
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-5">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Batch results</h2>
              <p className="mt-1 text-sm text-slate-500">
                Review queues, submitted batches, confirmation history, and flagged items from one desktop table.
              </p>
            </div>
            <div className="text-sm text-slate-500">{loading ? "Loading…" : `${rows.length} results`}</div>
          </div>

          {loading ? (
            <div className="px-6 py-20 text-center text-sm text-slate-400">Loading deposits and batches…</div>
          ) : rows.length === 0 ? (
            <div className="px-6 py-20 text-center">
              <p className="text-sm text-slate-600">No deposit queues or batches match the current filters.</p>
              <p className="mt-2 text-xs text-slate-400">Adjust the date range, status, or search filters to widen the result set.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1320px] text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-brand-50 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                    <th className="px-5 py-3">Reference</th>
                    <th className="px-5 py-3">Institution</th>
                    <th className="px-5 py-3">Group</th>
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3">Created / submitted</th>
                    <th className="px-5 py-3">Confirmed</th>
                    <th className="px-5 py-3">Age / lag</th>
                    <th className="px-5 py-3">Flags</th>
                    <th className="px-5 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-brand-50">
                      <td className="px-5 py-4 align-top">
                        <div className="font-medium text-slate-900">{row.reference}</div>
                        <div className="mt-1 text-xs text-slate-400">
                          {row.kind === "pending_queue" ? `${row.transactionCount} deposits in queue` : `${row.transactionCount} deposits`}
                        </div>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-700">{row.institutionName || "Unlinked"}</td>
                      <td className="px-5 py-4 align-top text-slate-700">{row.groupName || "Unlinked"}</td>
                      <td className="px-5 py-4 align-top text-slate-700">{row.agentName || "Unassigned"}</td>
                      <td className="px-5 py-4 align-top text-right font-semibold text-slate-900">{formatCurrency(row.amount)}</td>
                      <td className="px-5 py-4 align-top">
                        <StatusBadge status={row.status}>{row.statusLabel}</StatusBadge>
                      </td>
                      <td className="px-5 py-4 align-top text-slate-600">
                        {row.kind === "pending_queue" ? formatDateTime(row.oldestPendingAtMs || row.createdAtMs) : formatDateTime(row.submittedAtMs || row.createdAtMs)}
                      </td>
                      <td className="px-5 py-4 align-top text-slate-600">{formatDateTime(row.confirmedAtMs)}</td>
                      <td className="px-5 py-4 align-top text-slate-600">
                        {row.confirmationLagMs
                          ? `Lag ${formatDuration(row.confirmationLagMs)}`
                          : row.status === "pending_queue"
                          ? `Open ${formatDuration(Date.now() - (row.oldestPendingAtMs || row.createdAtMs || Date.now()))}`
                          : `Open ${formatDuration(Date.now() - (row.submittedAtMs || row.createdAtMs || Date.now()))}`}
                      </td>
                      <td className="px-5 py-4 align-top">
                        {row.flagged ? (
                          <StatusBadge status="flagged">Flagged</StatusBadge>
                        ) : (
                          <span className="text-xs text-slate-400">No flag</span>
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
        title={detail?.reference || selectedRow?.reference || "Batch detail"}
        subtitle="Batch investigation"
        onClose={() => {
          setSelectedRow(null);
          setDetail(null);
          setDetailError("");
        }}
      >
        {detailLoading ? (
          <div className="rounded-2xl border border-slate-200 bg-brand-50 px-5 py-8 text-center text-sm text-slate-500">
            Loading batch detail…
          </div>
        ) : detailError ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">{detailError}</div>
        ) : detail ? (
          <>
            <section className="rounded-3xl border border-slate-200 bg-brand-50 px-5 py-5">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge status={detail.status}>{detail.statusLabel}</StatusBadge>
                {detail.kind === "pending_queue" ? (
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs text-slate-600">
                    Pending queue
                  </span>
                ) : null}
              </div>
              <p className="mt-4 text-sm leading-6 text-slate-600">{detail.operationsNote}</p>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <SummaryCard label="Amount" value={formatCurrency(detail.amount)} note="Current batch or queue scope" />
              <SummaryCard
                label="Member count"
                value={detail.memberCount}
                note={`${detail.transactionCount} constituent deposits`}
              />
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Identity</h3>
              <dl className="mt-4 space-y-3">
                <DetailRow label="Reference" value={detail.reference} mono />
                <DetailRow label="Institution" value={detail.institutionName} />
                <DetailRow label="Group" value={detail.groupName} />
                <DetailRow label="Agent" value={detail.agentName} />
                <DetailRow label="Created" value={formatDateTime(detail.createdAtMs)} />
                <DetailRow label="Submitted" value={formatDateTime(detail.submittedAtMs)} />
                <DetailRow label="Confirmed" value={formatDateTime(detail.confirmedAtMs)} />
                <DetailRow label="Flagged" value={formatDateTime(detail.flaggedAtMs)} />
                <DetailRow
                  label="Confirmation lag"
                  value={detail.confirmationLagMs ? formatDuration(detail.confirmationLagMs) : "Not confirmed"}
                />
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
                <p className="mt-4 text-sm text-slate-500">No batch-level status history is available.</p>
              )}
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <h3 className="text-base font-semibold text-slate-950">Institution notes and reconciliation context</h3>
              <div className="mt-4 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-700">Institution note</p>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{detail.institutionNotes || "No institution note recorded."}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-4">
                  <p className="text-sm font-medium text-slate-700">Recent reconciliation context</p>
                  {detail.relatedReconciliations?.length ? (
                    <ul className="mt-3 space-y-2">
                      {detail.relatedReconciliations.map((item) => (
                        <li key={item.id} className="flex items-center justify-between text-sm text-slate-600">
                          <span>{item.date || item.id}</span>
                          <span className="text-slate-400">{item.status || "submitted"}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-sm text-slate-500">
                      No direct batch-to-reconciliation link is stored, so only recent agent reconciliation context can be surfaced when present.
                    </p>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-slate-950">Constituent deposits</h3>
                  <p className="mt-1 text-sm text-slate-500">Read-only deposit records that make up this queue or batch.</p>
                </div>
                <div className="flex items-center gap-2">
                  {detail.relatedTransactionsRoute ? (
                    <Link
                      to={detail.relatedTransactionsRoute}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                    >
                      Transactions
                    </Link>
                  ) : null}
                  {detail.relatedGroupRoute ? (
                    <Link
                      to={detail.relatedGroupRoute}
                      className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                    >
                      Group
                    </Link>
                  ) : null}
                </div>
              </div>

              {detail.constituentDeposits?.length ? (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-[0.14em] text-slate-500">
                        <th className="px-3 py-3">Reference</th>
                        <th className="px-3 py-3">Member</th>
                        <th className="px-3 py-3 text-right">Amount</th>
                        <th className="px-3 py-3">Created</th>
                        <th className="px-3 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-brand-50">
                      {detail.constituentDeposits.map((item) => (
                        <tr key={item.transactionId}>
                          <td className="px-3 py-3 font-mono text-xs text-slate-600">{item.reference}</td>
                          <td className="px-3 py-3 text-slate-700">{item.memberName || item.memberId || "Unknown member"}</td>
                          <td className="px-3 py-3 text-right font-semibold text-slate-900">{formatCurrency(item.amount)}</td>
                          <td className="px-3 py-3 text-slate-600">{formatDateTime(item.createdAtMs)}</td>
                          <td className="px-3 py-3">
                            <StatusBadge status={item.status === "confirmed" ? "confirmed" : item.status === "flagged" ? "flagged" : "pending_queue"}>
                              {item.status || "pending_confirmation"}
                            </StatusBadge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="mt-4 text-sm text-slate-500">No constituent deposit rows are available.</p>
              )}
            </section>
          </>
        ) : null}
      </Drawer>
    </main>
  );
}
