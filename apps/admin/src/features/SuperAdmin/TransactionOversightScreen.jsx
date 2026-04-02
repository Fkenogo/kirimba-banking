import { useEffect, useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ADMIN_ROLES } from "../../config/console";

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "deposit", label: "Deposits" },
  { value: "withdrawal", label: "Withdrawals" },
  { value: "loan_disburse", label: "Loan disbursements" },
  { value: "loan_repay", label: "Repayments" },
];

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending_confirmation", label: "Pending confirmation" },
  { value: "confirmed", label: "Confirmed" },
  { value: "rejected", label: "Rejected" },
];

const DEFAULT_FILTERS = {
  dateFrom: "",
  dateTo: "",
  type: "",
  status: "",
  institutionId: "",
  groupQuery: "",
  agentQuery: "",
  memberQuery: "",
  reference: "",
  flaggedOnly: false,
};

const ROLE_COPY = {
  [ADMIN_ROLES.SUPER_ADMIN]: {
    title: "System-wide transaction oversight",
    subtitle:
      "Cross-system investigation view for deposits, withdrawals, lending flows, and flagged batch-linked activity.",
  },
  [ADMIN_ROLES.ADMIN]: {
    title: "Operations transaction oversight",
    subtitle:
      "Read-first operations view for queue investigation, transaction tracing, and exception handoff.",
  },
  [ADMIN_ROLES.FINANCE]: {
    title: "Finance transaction oversight",
    subtitle:
      "Finance-focused transaction review for confirmations, repayments, settlements, and reconciliation support.",
  },
};

const TYPE_STYLES = {
  deposit: "border-emerald-200 bg-emerald-50 text-emerald-700",
  withdrawal: "border-amber-200 bg-amber-50 text-amber-700",
  loan_disburse: "border-blue-200 bg-blue-50 text-blue-700",
  loan_repay: "border-teal-200 bg-teal-50 text-teal-700",
};

const STATUS_STYLES = {
  confirmed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  pending_confirmation: "border-amber-200 bg-amber-50 text-amber-700",
  rejected: "border-rose-200 bg-rose-50 text-rose-700",
};

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US");
}

function formatCurrency(value) {
  return `${formatNumber(value)} BIF`;
}

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatType(value) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatStatus(value) {
  if (!value) return "Unknown";
  return value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function statusBadge(status) {
  return STATUS_STYLES[status] || "border-slate-200 bg-slate-100 text-slate-700";
}

function typeBadge(type) {
  return TYPE_STYLES[type] || "border-slate-200 bg-slate-100 text-slate-700";
}

function toCsvValue(value) {
  const text = String(value ?? "");
  if (text.includes(",") || text.includes('"') || text.includes("\n")) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

function exportRowsToCsv(rows) {
  const headers = [
    "Transaction ID",
    "Created At",
    "Type",
    "Amount BIF",
    "Status",
    "Member",
    "Member ID",
    "Group",
    "Group ID",
    "Agent",
    "Agent ID",
    "Institution",
    "Institution ID",
    "Reference",
    "Receipt",
    "Batch ID",
    "Loan ID",
    "Channel",
    "Source",
    "Flagged",
    "Notes",
  ];

  const lines = rows.map((row) => [
    row.txnId,
    row.createdAtMs ? new Date(row.createdAtMs).toISOString() : "",
    row.type,
    row.amount,
    row.status,
    row.memberName || "",
    row.memberId || "",
    row.groupName || "",
    row.groupId || "",
    row.agentName || "",
    row.agentId || "",
    row.institutionName || "",
    row.institutionId || "",
    row.reference || "",
    row.receiptNo || "",
    row.batchId || "",
    row.loanId || "",
    row.channel || "",
    row.source || "",
    row.flagged ? "yes" : "no",
    row.notes || row.batchInstitutionNotes || "",
  ]);

  const csv = [headers, ...lines].map((line) => line.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `kirimba-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildSummaryCards(summary) {
  return [
    { id: "total", label: "Total transactions", value: summary?.totalTransactions ?? 0 },
    { id: "deposit", label: "Deposits", value: summary?.deposits ?? 0 },
    { id: "withdrawal", label: "Withdrawals", value: summary?.withdrawals ?? 0 },
    { id: "loan-disburse", label: "Loan disbursements", value: summary?.loanDisbursements ?? 0 },
    { id: "repayments", label: "Repayments", value: summary?.repayments ?? 0 },
    { id: "flagged", label: "Flagged batch-linked", value: summary?.flagged ?? 0, tone: "rose" },
  ];
}

function sortRows(rows, sortConfig) {
  const items = [...rows];
  items.sort((left, right) => {
    const leftValue = left[sortConfig.key];
    const rightValue = right[sortConfig.key];

    if (leftValue == null && rightValue == null) return 0;
    if (leftValue == null) return 1;
    if (rightValue == null) return -1;

    if (typeof leftValue === "number" && typeof rightValue === "number") {
      return sortConfig.direction === "asc" ? leftValue - rightValue : rightValue - leftValue;
    }

    const compare = String(leftValue).localeCompare(String(rightValue), undefined, {
      sensitivity: "base",
      numeric: true,
    });
    return sortConfig.direction === "asc" ? compare : -compare;
  });
  return items;
}

function FilterField({ label, children }) {
  return (
    <label className="flex min-w-[150px] flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function DetailRow({ label, value, mono = false }) {
  return (
    <div className="grid grid-cols-[140px_minmax(0,1fr)] gap-4">
      <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">{label}</dt>
      <dd className={`text-sm text-slate-700 ${mono ? "font-mono text-xs" : ""}`}>{value || "—"}</dd>
    </div>
  );
}

function DrawerBadge({ children, className }) {
  return (
    <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${className}`}>
      {children}
    </span>
  );
}

export default function TransactionOversightScreen() {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sortConfig, setSortConfig] = useState({ key: "createdAtMs", direction: "desc" });
  const [page, setPage] = useState(1);
  const [selectedTxnId, setSelectedTxnId] = useState(null);

  useEffect(() => {
    void loadTransactions(DEFAULT_FILTERS);
  }, []);

  async function loadTransactions(nextFilters) {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "queryTransactionsOversight");
      const response = await fn({ ...nextFilters, limit: 150 });
      setResult(response.data || null);
      setSelectedTxnId(null);
      setPage(1);
    } catch (err) {
      setError(err.message || "Failed to load transactions.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  function handleFilterChange(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event) {
    event.preventDefault();
    void loadTransactions(filters);
  }

  function handleReset() {
    setFilters(DEFAULT_FILTERS);
    void loadTransactions(DEFAULT_FILTERS);
  }

  function handleSort(key) {
    setSortConfig((current) =>
      current.key === key
        ? { key, direction: current.direction === "asc" ? "desc" : "asc" }
        : { key, direction: key === "amount" ? "desc" : "asc" }
    );
  }

  const role = result?.role || ADMIN_ROLES.SUPER_ADMIN;
  const copy = ROLE_COPY[role] || ROLE_COPY[ADMIN_ROLES.SUPER_ADMIN];
  const rows = result?.rows || [];
  const summaryCards = useMemo(() => buildSummaryCards(result?.summary), [result?.summary]);
  const sortedRows = useMemo(() => sortRows(rows, sortConfig), [rows, sortConfig]);
  const pageSize = 25;
  const totalPages = Math.max(1, Math.ceil(sortedRows.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const pagedRows = sortedRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const selectedRow = sortedRows.find((row) => row.txnId === selectedTxnId) || null;

  return (
    <main className="px-8 py-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="rounded-[28px] border border-slate-200 bg-[linear-gradient(180deg,_#ffffff,_#f8fafc)] px-7 py-6 shadow-sm">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-4xl">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                Transactions Oversight
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{copy.title}</h1>
              <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{copy.subtitle}</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Mode</p>
              <p className="mt-2 font-medium text-slate-900">
                {role === ADMIN_ROLES.SUPER_ADMIN
                  ? "Executive investigation"
                  : role === ADMIN_ROLES.FINANCE
                  ? "Finance review"
                  : "Operations review"}
              </p>
              <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
                Read-only surface for tracing activity, confirming scope, and escalating issues to the correct workflow.
              </p>
            </div>
          </div>
        </section>

        {error && (
          <section className="rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4">
            <p className="text-sm text-rose-700">{error}</p>
          </section>
        )}

        <section className="grid gap-4 xl:grid-cols-6">
          {summaryCards.map((card) => (
            <div
              key={card.id}
              className={`rounded-2xl border bg-white px-5 py-4 shadow-sm ${
                card.tone === "rose" ? "border-rose-200" : "border-slate-200"
              }`}
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{card.label}</p>
              <p className={`mt-3 text-3xl font-semibold tracking-tight ${card.tone === "rose" ? "text-rose-700" : "text-slate-950"}`}>
                {loading ? "…" : formatNumber(card.value)}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Filters</h2>
              <p className="mt-1 text-sm text-slate-500">
                Narrow the current investigation scope by date, entity, status, or transaction reference.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-brand-50 px-4 py-3 text-xs leading-5 text-slate-500">
              Export downloads the currently loaded filtered rows only.
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div className="grid gap-3 xl:grid-cols-5">
              <FilterField label="Date from">
                <input
                  type="date"
                  value={filters.dateFrom}
                  onChange={(event) => handleFilterChange("dateFrom", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                />
              </FilterField>
              <FilterField label="Date to">
                <input
                  type="date"
                  value={filters.dateTo}
                  onChange={(event) => handleFilterChange("dateTo", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                />
              </FilterField>
              <FilterField label="Transaction type">
                <select
                  value={filters.type}
                  onChange={(event) => handleFilterChange("type", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                >
                  {TYPE_OPTIONS.map((option) => (
                    <option key={option.value || "all"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </FilterField>
              <FilterField label="Status">
                <select
                  value={filters.status}
                  onChange={(event) => handleFilterChange("status", event.target.value)}
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
                  onChange={(event) => handleFilterChange("institutionId", event.target.value)}
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                >
                  <option value="">All institutions</option>
                  {(result?.filterOptions?.institutions || []).map((institution) => (
                    <option key={institution.id} value={institution.id}>
                      {institution.name}
                    </option>
                  ))}
                </select>
              </FilterField>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <FilterField label="Group">
                <input
                  type="text"
                  value={filters.groupQuery}
                  onChange={(event) => handleFilterChange("groupQuery", event.target.value)}
                  placeholder="Group name or ID"
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                />
              </FilterField>
              <FilterField label="Agent">
                <input
                  type="text"
                  value={filters.agentQuery}
                  onChange={(event) => handleFilterChange("agentQuery", event.target.value)}
                  placeholder="Agent name or ID"
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                />
              </FilterField>
              <FilterField label="Member">
                <input
                  type="text"
                  value={filters.memberQuery}
                  onChange={(event) => handleFilterChange("memberQuery", event.target.value)}
                  placeholder="Member name or ID"
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                />
              </FilterField>
              <FilterField label="Reference / transaction ID">
                <input
                  type="text"
                  value={filters.reference}
                  onChange={(event) => handleFilterChange("reference", event.target.value)}
                  placeholder="Receipt, batch, loan, or transaction ID"
                  className="rounded-xl border border-slate-300 px-3 py-2.5 text-sm text-slate-700 outline-none transition focus:border-slate-900"
                />
              </FilterField>
              <div className="flex items-end">
                <label className="inline-flex min-h-[46px] items-center gap-3 rounded-xl border border-slate-300 px-4 py-2.5 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={filters.flaggedOnly}
                    onChange={(event) => handleFilterChange("flaggedOnly", event.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-slate-900"
                  />
                  Flagged only
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-4">
              <p className="text-xs leading-5 text-slate-500">
                Reversed and failed transactions are not tracked as consistent first-class statuses in the current model.
              </p>
              <div className="flex flex-wrap gap-2.5">
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-brand-50"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => exportRowsToCsv(sortedRows)}
                  disabled={!sortedRows.length}
                  className="rounded-xl border border-slate-300 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Export CSV
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="rounded-xl bg-brand-500 px-4 py-2.5 text-sm font-medium text-white hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {loading ? "Loading…" : "Apply filters"}
                </button>
              </div>
            </div>
          </form>
        </section>

        <section className="rounded-3xl border border-brand-100 bg-white shadow-card">
          <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Results</h2>
              <p className="mt-1 text-sm text-slate-500">
                {loading
                  ? "Refreshing current investigation scope…"
                  : `${formatNumber(rows.length)} filtered rows loaded for review`}
              </p>
            </div>
            {result?.meta && (
              <div className="text-right text-xs leading-5 text-slate-500">
                <p>Scanned {formatNumber(result.meta.scannedTransactions)} recent transactions.</p>
                {result.meta.appliedToLatest ? (
                  <p>The query is scoped to the latest available transaction window for this filter set.</p>
                ) : (
                  <p>All matching transactions in the scanned window are shown.</p>
                )}
              </div>
            )}
          </div>

          {loading ? (
            <div className="space-y-3 px-5 py-5">
              {Array.from({ length: 10 }).map((_, index) => (
                <div key={index} className="h-12 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          ) : !rows.length ? (
            <div className="px-5 py-20 text-center">
              <p className="text-base font-medium text-slate-900">No transactions match the current filters.</p>
              <p className="mt-2 text-sm text-slate-500">
                Adjust the search scope, remove one of the entity filters, or broaden the date range.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-brand-50">
                    <tr className="border-b border-slate-200 text-left">
                      <SortableHeader label="Timestamp" sortKey="createdAtMs" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Type" sortKey="type" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Amount" sortKey="amount" sortConfig={sortConfig} onSort={handleSort} align="right" />
                      <SortableHeader label="Status" sortKey="status" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Member" sortKey="memberName" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Group" sortKey="groupName" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Agent" sortKey="agentName" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Institution" sortKey="institutionName" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Reference" sortKey="reference" sortConfig={sortConfig} onSort={handleSort} />
                      <SortableHeader label="Channel" sortKey="channel" sortConfig={sortConfig} onSort={handleSort} />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-50">
                    {pagedRows.map((row) => (
                      <tr
                        key={row.txnId}
                        className="cursor-pointer hover:bg-brand-50"
                        onClick={() => setSelectedTxnId(row.txnId)}
                      >
                        <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDateTime(row.createdAtMs)}</td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${typeBadge(row.type)}`}>
                            {formatType(row.type)}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right font-medium text-slate-900">{formatCurrency(row.amount)}</td>
                        <td className="px-5 py-3">
                          <div className="flex flex-wrap gap-2">
                            <span className={`inline-flex rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusBadge(row.status)}`}>
                              {formatStatus(row.status)}
                            </span>
                            {row.flagged && (
                              <span className="inline-flex rounded-full border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] font-semibold text-rose-700">
                                Flagged batch
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{row.memberName || "Unknown member"}</p>
                          <p className="font-mono text-[11px] text-slate-400">{row.memberId || "—"}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{row.groupName || "—"}</p>
                          <p className="font-mono text-[11px] text-slate-400">{row.groupId || "—"}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{row.agentName || "—"}</p>
                          <p className="font-mono text-[11px] text-slate-400">{row.agentId || "—"}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-medium text-slate-900">{row.institutionName || "—"}</p>
                          <p className="font-mono text-[11px] text-slate-400">{row.institutionId || "—"}</p>
                        </td>
                        <td className="px-5 py-3">
                          <p className="font-mono text-xs text-slate-700">{row.reference || row.txnId}</p>
                          <p className="font-mono text-[11px] text-slate-400">{row.txnId}</p>
                        </td>
                        <td className="px-5 py-3 text-slate-600">{row.channel || row.source || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-slate-200 px-5 py-4">
                <p className="text-sm text-slate-500">
                  Page {currentPage} of {totalPages}
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    disabled={currentPage === 1}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    disabled={currentPage === totalPages}
                    className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {selectedRow && (
        <div className="fixed inset-0 z-30 flex justify-end bg-slate-950/20 backdrop-blur-[1px]">
          <button
            type="button"
            aria-label="Close transaction details"
            className="flex-1 cursor-default"
            onClick={() => setSelectedTxnId(null)}
          />
          <aside className="h-full w-full max-w-[520px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 border-b border-slate-200 bg-white px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                    Transaction detail
                  </p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">{formatType(selectedRow.type)}</h2>
                  <p className="mt-2 font-mono text-xs text-slate-500">{selectedRow.txnId}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTxnId(null)}
                  className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-brand-50"
                >
                  Close
                </button>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <DrawerBadge className={statusBadge(selectedRow.status)}>{formatStatus(selectedRow.status)}</DrawerBadge>
                <DrawerBadge className={typeBadge(selectedRow.type)}>{formatType(selectedRow.type)}</DrawerBadge>
                {selectedRow.flagged && (
                  <DrawerBadge className="border-rose-200 bg-rose-50 text-rose-700">Flagged batch-linked</DrawerBadge>
                )}
              </div>
            </div>

            <div className="space-y-6 px-6 py-6">
              <section className="rounded-2xl border border-slate-200 bg-brand-50 p-5">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">Financial scope</p>
                <p className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">{formatCurrency(selectedRow.amount)}</p>
                <p className="mt-2 text-sm text-slate-500">
                  Recorded {formatDateTime(selectedRow.createdAtMs)}
                </p>
              </section>

              <section className="space-y-4 rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Identifiers</h3>
                <dl className="space-y-3">
                  <DetailRow label="Transaction ID" value={selectedRow.txnId} mono />
                  <DetailRow label="Reference" value={selectedRow.reference} mono />
                  <DetailRow label="Receipt" value={selectedRow.receiptNo} mono />
                  <DetailRow label="Batch ID" value={selectedRow.batchId} mono />
                  <DetailRow label="Loan ID" value={selectedRow.loanId} mono />
                </dl>
              </section>

              <section className="space-y-4 rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Timeline</h3>
                <dl className="space-y-3">
                  <DetailRow label="Created" value={formatDateTime(selectedRow.createdAtMs)} />
                  <DetailRow label="Confirmed" value={formatDateTime(selectedRow.confirmedAtMs || selectedRow.batchConfirmedAtMs)} />
                  <DetailRow label="Rejected" value={formatDateTime(selectedRow.rejectedAtMs)} />
                  <DetailRow label="Flagged" value={formatDateTime(selectedRow.batchFlaggedAtMs)} />
                </dl>
              </section>

              <section className="space-y-4 rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Related parties</h3>
                <dl className="space-y-3">
                  <DetailRow label="Member" value={selectedRow.memberName || selectedRow.memberId} />
                  <DetailRow label="Member ID" value={selectedRow.memberId} mono />
                  <DetailRow label="Group" value={selectedRow.groupName || selectedRow.groupId} />
                  <DetailRow label="Group ID" value={selectedRow.groupId} mono />
                  <DetailRow label="Agent" value={selectedRow.agentName || selectedRow.agentId} />
                  <DetailRow label="Agent ID" value={selectedRow.agentId} mono />
                  <DetailRow label="Institution" value={selectedRow.institutionName || selectedRow.institutionId} />
                  <DetailRow label="Institution ID" value={selectedRow.institutionId} mono />
                </dl>
              </section>

              <section className="space-y-4 rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-slate-400">Channel and notes</h3>
                <dl className="space-y-3">
                  <DetailRow label="Channel" value={selectedRow.channel} />
                  <DetailRow label="Source" value={selectedRow.source} />
                  <DetailRow label="Transaction notes" value={selectedRow.notes} />
                  <DetailRow label="Batch notes" value={selectedRow.batchInstitutionNotes} />
                </dl>
              </section>
            </div>
          </aside>
        </div>
      )}
    </main>
  );
}

function SortableHeader({ label, sortKey, sortConfig, onSort, align = "left" }) {
  const active = sortConfig.key === sortKey;
  const marker = !active ? "↕" : sortConfig.direction === "asc" ? "↑" : "↓";

  return (
    <th className={`px-5 py-3 ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${
          active ? "text-slate-900" : "text-slate-500"
        }`}
      >
        {label}
        <span className="text-slate-400">{marker}</span>
      </button>
    </th>
  );
}
