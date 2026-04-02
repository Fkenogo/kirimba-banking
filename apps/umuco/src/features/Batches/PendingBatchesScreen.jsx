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

export default function PendingBatchesScreen({ institutionId, institutionName }) {
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
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
          where("status", "==", "submitted"),
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

      setBatches(
        rows.map((b) => ({
          ...b,
          groupName: groupNames[b.groupId] || b.groupId || "Unknown Group",
          agentName: agentNames[b.agentId] || b.agentId || "—",
        }))
      );
    } catch (err) {
      setError(err.message || "Failed to load submitted batches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filterOptions = useMemo(() => buildBatchFilterOptions(batches), [batches]);
  const filteredBatches = useMemo(
    () => filterBatchRows(batches, filters, { dateField: "submittedAt" }),
    [batches, filters]
  );

  return (
    <PageShell title="Pending Batches" institutionName={institutionName}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          {!loading && `${filteredBatches.length} batch${filteredBatches.length !== 1 ? "es" : ""} awaiting decision`}
        </p>
        <PrimaryButton onClick={load} disabled={loading} variant="outline">
          {loading ? "Loading…" : "Refresh"}
        </PrimaryButton>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {!loading && batches.length > 0 && (
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
          <LoadingState label="Loading batches…" />
        ) : filteredBatches.length === 0 ? (
          <EmptyState
            title={batches.length === 0 ? "No pending batches" : "No batches match the current filters"}
            subtitle={batches.length === 0 ? "Batches submitted by agents will appear here for review." : "Try clearing one or more filters."}
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
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Submitted</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Batch ID</th>
                  <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredBatches.map((b) => (
                  <tr key={b.id} className="hover:bg-brand-50/50 transition-colors">
                    <td className="px-5 py-3.5 font-semibold text-slate-900">{b.groupName}</td>
                    <td className="px-5 py-3.5 text-slate-600">{b.agentName}</td>
                    <td className="px-5 py-3.5 text-right font-bold text-brand-700">
                      {formatBIF(b.totalAmount)}
                    </td>
                    <td className="px-5 py-3.5 text-center text-slate-700">
                      {Number(b.memberCount || 0)}
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                      {formatDate(b.submittedAt)}
                    </td>
                    <td className="px-5 py-3.5 font-mono text-xs text-slate-400">
                      {b.id.slice(0, 12)}…
                    </td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        to={`/umuco/batch/${b.id}`}
                        className="inline-flex items-center rounded-xl bg-brand-500 hover:bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                      >
                        Review
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </PageShell>
  );
}
