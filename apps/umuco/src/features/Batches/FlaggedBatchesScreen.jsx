import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  collection, doc, getDoc, getDocs, orderBy, query, where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import {
  PageShell, Card, Alert, EmptyState, LoadingState,
  PrimaryButton, formatBIF, formatDate,
} from "../../components/ui";
import { buildBatchFilterOptions, filterBatchRows } from "./batchFilters";

export default function FlaggedBatchesScreen({ institutionId, institutionName }) {
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
          where("status", "==", "flagged"),
          orderBy("flaggedAt", "desc")
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
      setError(err.message || "Failed to load flagged batches.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filterOptions = useMemo(() => buildBatchFilterOptions(batches), [batches]);
  const filteredBatches = useMemo(
    () => filterBatchRows(batches, filters, { dateField: "flaggedAt" }),
    [batches, filters]
  );

  return (
    <PageShell title="Flagged Batches" institutionName={institutionName}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-slate-500">
          {!loading && (
            filteredBatches.length === 0
              ? "No flagged batches — all clear"
              : `${filteredBatches.length} batch${filteredBatches.length !== 1 ? "es" : ""} flagged for follow-up`
          )}
        </p>
        <PrimaryButton onClick={load} disabled={loading} variant="outline">
          {loading ? "Loading…" : "Refresh"}
        </PrimaryButton>
      </div>

      {error && <Alert type="error">{error}</Alert>}

      {!loading && batches.length > 0 && (
        <Alert type="warning">
          These batches were flagged due to discrepancies. Open each batch to review the issue and
          coordinate with the agent for resubmission or correction.
        </Alert>
      )}

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
          <LoadingState label="Loading flagged batches…" />
        ) : filteredBatches.length === 0 ? (
          <EmptyState
            title={batches.length === 0 ? "No flagged batches" : "No flagged batches match the current filters"}
            subtitle={batches.length === 0 ? "All submitted batches have been resolved." : "Try clearing one or more filters."}
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {filteredBatches.map((b) => (
              <div key={b.id} className="px-5 py-5">
                <div className="flex items-start justify-between gap-4">
                  {/* Left: group / agent info */}
                  <div className="min-w-0">
                    <p className="text-base font-semibold text-slate-900 truncate">{b.groupName}</p>
                    <p className="text-sm text-slate-500 mt-0.5">Agent: {b.agentName}</p>
                    <p className="mt-1 font-mono text-xs text-slate-400">{b.id.slice(0, 16)}…</p>
                  </div>

                  {/* Right: amount + action */}
                  <div className="text-right shrink-0 space-y-2">
                    <p className="text-lg font-bold text-brand-700">{formatBIF(b.totalAmount)}</p>
                    <p className="text-xs text-slate-500">{Number(b.memberCount || 0)} members</p>
                    <Link
                      to={`/umuco/batch/${b.id}`}
                      className="inline-flex items-center rounded-xl bg-brand-500 hover:bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors"
                    >
                      Open Batch
                    </Link>
                  </div>
                </div>

                {/* Flag reason */}
                {(b.institutionNotes || b.umucoNotes) && (
                  <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                    <p className="text-xs font-semibold text-red-700 mb-1">Flag Reason</p>
                    <p className="text-sm text-red-800">{b.institutionNotes || b.umucoNotes}</p>
                  </div>
                )}

                <p className="mt-2 text-xs text-slate-400">
                  Flagged {formatDate(b.flaggedAt)} · Submitted {formatDate(b.submittedAt)}
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </PageShell>
  );
}
