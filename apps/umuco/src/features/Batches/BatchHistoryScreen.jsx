import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, orderBy, query, where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import {
  PageShell, Card, Alert, EmptyState, LoadingState,
  StatusBadge, PrimaryButton, formatBIF, formatDate,
} from "../../components/ui";
import { buildBatchFilterOptions, filterBatchRows } from "./batchFilters";

const STATUS_TABS = [
  { key: "all",       label: "All" },
  { key: "confirmed", label: "Confirmed" },
  { key: "flagged",   label: "Flagged" },
];

export default function BatchHistoryScreen({ institutionId, institutionName }) {
  const [allBatches, setAllBatches] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [filters, setFilters] = useState({
    query: "",
    groupId: "",
    agentId: "",
    dateFrom: "",
    dateTo: "",
  });

  async function load() {
    if (!institutionId) { setLoading(false); return; }
    setLoading(true);
    setError("");
    try {
      const snap = await getDocs(
        query(
          collection(db, "depositBatches"),
          where("institutionId", "==", institutionId),
          where("status", "in", ["confirmed", "flagged"]),
          orderBy("submittedAt", "desc")
        )
      );

      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      const groupIds = [...new Set(rows.map((b) => b.groupId).filter(Boolean))];
      const agentIds = [...new Set(rows.map((b) => b.agentId).filter(Boolean))];

      const [groupSnaps, agentSnaps] = await Promise.all([
        Promise.all(groupIds.map((id) => getDoc(doc(db, "groups", id)))),
        Promise.all(agentIds.map((id) => getDoc(doc(db, "users", id)))),
      ]);

      const groupNames = {};
      groupIds.forEach((id, i) => {
        if (groupSnaps[i].exists()) groupNames[id] = groupSnaps[i].data().name || id;
      });

      const agentNames = {};
      agentIds.forEach((id, i) => {
        if (agentSnaps[i].exists()) {
          const d = agentSnaps[i].data();
          agentNames[id] = d.fullName || d.name || id;
        }
      });

      setAllBatches(
        rows.map((b) => ({
          ...b,
          groupName: groupNames[b.groupId] || b.groupId || "Unknown Group",
          agentName: agentNames[b.agentId] || b.agentId || "—",
        }))
      );
    } catch (err) {
      setError(err.message || "Failed to load batch history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const statusRows = useMemo(
    () => (statusFilter === "all" ? allBatches : allBatches.filter((b) => b.status === statusFilter)),
    [allBatches, statusFilter]
  );
  const filterOptions = useMemo(() => buildBatchFilterOptions(allBatches), [allBatches]);
  const batches = useMemo(
    () => filterBatchRows(statusRows, filters, { dateField: "submittedAt" }),
    [statusRows, filters]
  );

  return (
    <PageShell title="Batch History" institutionName={institutionName}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Filter tabs */}
        <div className="flex gap-1.5 bg-white rounded-xl border border-brand-100 p-1">
          {STATUS_TABS.map((tab) => {
            const count = tab.key === "all"
              ? allBatches.length
              : allBatches.filter((b) => b.status === tab.key).length;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === tab.key
                    ? "bg-brand-500 text-white shadow-sm"
                    : "text-slate-600 hover:text-brand-600 hover:bg-brand-50"
                }`}
              >
                {tab.label}
                {!loading && (
                  <span className={`ml-1.5 ${statusFilter === tab.key ? "opacity-80" : "opacity-50"}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <PrimaryButton onClick={load} disabled={loading} variant="outline">
          {loading ? "Loading…" : "Refresh"}
        </PrimaryButton>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {!loading && allBatches.length > 0 && (
        <Card className="px-5 py-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-3">
            <input
              type="text"
              value={filters.query}
              onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
              placeholder="Search batch, group, agent, reference"
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400"
            />
            <select
              value={filters.groupId}
              onChange={(event) => setFilters((current) => ({ ...current, groupId: event.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900"
            >
              <option value="">All groups</option>
              {filterOptions.groups.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <select
              value={filters.agentId}
              onChange={(event) => setFilters((current) => ({ ...current, agentId: event.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900"
            >
              <option value="">All agents</option>
              {filterOptions.agents.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
            </select>
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(event) => setFilters((current) => ({ ...current, dateFrom: event.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900"
            />
            <input
              type="date"
              value={filters.dateTo}
              onChange={(event) => setFilters((current) => ({ ...current, dateTo: event.target.value }))}
              className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900"
            />
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <LoadingState label="Loading history…" />
        ) : batches.length === 0 ? (
          <EmptyState
            title="No batches found"
            subtitle={statusFilter !== "all" ? `No ${statusFilter} batches to display.` : "No batch history yet."}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-brand-100 bg-brand-50 text-left">
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Group</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Agent</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700 text-right">Amount</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700 text-center">Members</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Status</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Submitted</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Decision</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Notes</th>
                  <th className="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {batches.map((b) => {
                  const decisionTs = b.confirmedAt || b.flaggedAt || null;
                  return (
                    <tr key={b.id} className="hover:bg-brand-50/50 transition-colors">
                      <td className="px-5 py-3 font-semibold text-slate-900">{b.groupName}</td>
                      <td className="px-5 py-3 text-slate-600">{b.agentName}</td>
                      <td className="px-5 py-3 text-right font-bold text-brand-700">
                        {formatBIF(b.totalAmount)}
                      </td>
                      <td className="px-5 py-3 text-center text-slate-700">
                        {Number(b.memberCount || 0)}
                      </td>
                      <td className="px-5 py-3">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                        {formatDate(b.submittedAt)}
                      </td>
                      <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                        {formatDate(decisionTs)}
                      </td>
                      <td className="px-5 py-3 text-slate-600 max-w-[180px] truncate">
                        {b.institutionNotes || b.umucoNotes || "—"}
                      </td>
                      <td className="px-5 py-3 text-right">
                        <Link
                          to={`/umuco/batch/${b.id}`}
                          className="text-xs font-semibold text-brand-600 hover:text-brand-700 hover:underline"
                        >
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  );
}
