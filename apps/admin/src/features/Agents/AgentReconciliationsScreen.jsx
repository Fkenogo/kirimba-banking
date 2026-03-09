import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, orderBy, query } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmt(n) {
  return Number(n || 0).toLocaleString();
}

function diffLabel(diff) {
  const n = Number(diff || 0);
  if (n === 0) return "0";
  return (n > 0 ? "+" : "") + n.toLocaleString();
}

function diffClass(diff) {
  const n = Number(diff || 0);
  if (n > 0) return "text-sky-700 font-semibold";
  if (n < 0) return "text-red-600 font-semibold";
  return "text-emerald-700 font-semibold";
}

const STATUS_STYLES = {
  submitted: "bg-amber-100 text-amber-700",
  reviewed: "bg-emerald-100 text-emerald-700",
  flagged: "bg-red-100 text-red-700",
};

function StatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        STATUS_STYLES[status] ?? "bg-slate-100 text-slate-600"
      }`}
    >
      {status}
    </span>
  );
}

// ─── main screen ─────────────────────────────────────────────────────────────

export default function AgentReconciliationsScreen() {
  const navigate = useNavigate();

  const [records, setRecords] = useState([]);
  const [agentNames, setAgentNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Per-row action state
  const [working, setWorking] = useState(new Set()); // docIds currently being updated
  const [actionErrors, setActionErrors] = useState({}); // docId → error string

  // Note editor (one open at a time)
  const [expandedNote, setExpandedNote] = useState(null); // docId or null
  const [noteText, setNoteText] = useState("");

  // ── Data loading ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Single orderBy on a single field — uses auto-created index, no composite needed
      const snap = await getDocs(
        query(collection(db, "agentReconciliations"), orderBy("date", "desc"))
      );
      const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setRecords(rows);

      // Batch-resolve agent names
      const agentIds = [...new Set(rows.map((r) => r.agentId).filter(Boolean))];
      if (agentIds.length > 0) {
        const snaps = await Promise.all(
          agentIds.map((uid) => getDoc(doc(db, "users", uid)))
        );
        const names = {};
        agentIds.forEach((uid, i) => {
          if (snaps[i].exists()) {
            const d = snaps[i].data();
            names[uid] = d.fullName ?? d.name ?? uid;
          }
        });
        setAgentNames(names);
      }
    } catch (err) {
      setError(err.message || "Failed to load reconciliations.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Generic action dispatcher ───────────────────────────────────────────────
  async function dispatch(docId, payload) {
    setWorking((prev) => new Set(prev).add(docId));
    setActionErrors((prev) => ({ ...prev, [docId]: null }));
    try {
      const fn = httpsCallable(functions, "adminUpdateReconciliation");
      await fn({ docId, ...payload });
      // Optimistic local update
      setRecords((prev) =>
        prev.map((r) =>
          r.id === docId ? { ...r, ...payload } : r
        )
      );
    } catch (err) {
      setActionErrors((prev) => ({
        ...prev,
        [docId]: err.message || "Action failed.",
      }));
    } finally {
      setWorking((prev) => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
    }
  }

  function handleMarkReviewed(docId) {
    dispatch(docId, { status: "reviewed" });
  }

  function handleMarkFlagged(docId) {
    dispatch(docId, { status: "flagged" });
  }

  function toggleNote(record) {
    if (expandedNote === record.id) {
      setExpandedNote(null);
    } else {
      setExpandedNote(record.id);
      setNoteText(record.adminNote ?? "");
    }
  }

  async function handleSaveNote(docId) {
    await dispatch(docId, { adminNote: noteText.trim() });
    setExpandedNote(null);
  }

  // ── Counts for header ───────────────────────────────────────────────────────
  const submitted = records.filter((r) => r.status === "submitted").length;
  const flagged = records.filter((r) => r.status === "flagged").length;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-5">

        {/* Header */}
        <div>
          <button
            type="button"
            onClick={() => navigate("/admin/dashboard")}
            className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
          >
            ← Back to Dashboard
          </button>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Agent Reconciliations</h1>
              {!loading && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {records.length} record{records.length !== 1 ? "s" : ""}
                  {submitted > 0 && (
                    <span className="ml-2 text-amber-600 font-medium">
                      {submitted} awaiting review
                    </span>
                  )}
                  {flagged > 0 && (
                    <span className="ml-2 text-red-600 font-medium">
                      {flagged} flagged
                    </span>
                  )}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
            >
              <svg
                className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 flex items-center justify-between">
            <p className="text-sm text-red-600">{error}</p>
            <button
              type="button"
              onClick={load}
              className="text-xs text-red-500 underline ml-4"
            >
              Retry
            </button>
          </div>
        )}

        {/* Table */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-400 animate-pulse">Loading reconciliations…</p>
            </div>
          ) : records.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-500">No reconciliations submitted yet.</p>
              <p className="text-xs text-slate-400 mt-1">
                Agents submit daily reconciliations from the agent app.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3">Date</th>
                    <th className="px-5 py-3 text-right">Expected</th>
                    <th className="px-5 py-3 text-right">Counted</th>
                    <th className="px-5 py-3 text-right">Difference</th>
                    <th className="px-5 py-3">Status</th>
                    <th className="px-5 py-3 text-center">Offline</th>
                    <th className="px-5 py-3">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((record) => (
                    <ReconciliationRow
                      key={record.id}
                      record={record}
                      agentName={agentNames[record.agentId] ?? record.agentId ?? "—"}
                      isWorking={working.has(record.id)}
                      actionError={actionErrors[record.id]}
                      isNoteOpen={expandedNote === record.id}
                      noteText={noteText}
                      onNoteTextChange={setNoteText}
                      onMarkReviewed={() => handleMarkReviewed(record.id)}
                      onMarkFlagged={() => handleMarkFlagged(record.id)}
                      onToggleNote={() => toggleNote(record)}
                      onSaveNote={() => handleSaveNote(record.id)}
                      onCancelNote={() => setExpandedNote(null)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </div>
    </main>
  );
}

// ─── row component ────────────────────────────────────────────────────────────

function ReconciliationRow({
  record,
  agentName,
  isWorking,
  actionError,
  isNoteOpen,
  noteText,
  onNoteTextChange,
  onMarkReviewed,
  onMarkFlagged,
  onToggleNote,
  onSaveNote,
  onCancelNote,
}) {
  const isReviewed = record.status === "reviewed";
  const isFlagged = record.status === "flagged";

  return (
    <>
      <tr className={`hover:bg-slate-50 ${isWorking ? "opacity-60" : ""}`}>
        {/* Agent */}
        <td className="px-5 py-3.5 font-medium text-slate-900 whitespace-nowrap">
          {agentName}
        </td>

        {/* Date */}
        <td className="px-5 py-3.5 text-slate-600 whitespace-nowrap font-mono text-xs">
          {record.date ?? "—"}
        </td>

        {/* Expected */}
        <td className="px-5 py-3.5 text-right text-slate-700 whitespace-nowrap">
          {fmt(record.cashExpected)}{" "}
          <span className="text-xs text-slate-400">BIF</span>
        </td>

        {/* Counted */}
        <td className="px-5 py-3.5 text-right text-slate-700 whitespace-nowrap">
          {fmt(record.cashCounted)}{" "}
          <span className="text-xs text-slate-400">BIF</span>
        </td>

        {/* Difference */}
        <td className={`px-5 py-3.5 text-right whitespace-nowrap ${diffClass(record.difference)}`}>
          {diffLabel(record.difference)}{" "}
          <span className="text-xs font-normal text-slate-400">BIF</span>
        </td>

        {/* Status */}
        <td className="px-5 py-3.5">
          <StatusBadge status={record.status} />
        </td>

        {/* Offline pending */}
        <td className="px-5 py-3.5 text-center">
          {record.offlinePendingCount > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700 bg-amber-50 rounded-full px-2 py-0.5">
              {record.offlinePendingCount}
            </span>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>

        {/* Actions */}
        <td className="px-5 py-3.5">
          <div className="flex items-center gap-1.5">
            {/* Mark Reviewed */}
            <ActionButton
              title={isReviewed ? "Already reviewed" : "Mark reviewed"}
              onClick={onMarkReviewed}
              disabled={isWorking || isReviewed}
              active={isReviewed}
              activeClass="bg-emerald-100 text-emerald-700 border-emerald-200"
              inactiveClass="border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-700 hover:bg-emerald-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              <span>{isReviewed ? "Reviewed" : "Review"}</span>
            </ActionButton>

            {/* Mark Flagged */}
            <ActionButton
              title={isFlagged ? "Already flagged" : "Mark flagged"}
              onClick={onMarkFlagged}
              disabled={isWorking || isFlagged}
              active={isFlagged}
              activeClass="bg-red-100 text-red-700 border-red-200"
              inactiveClass="border-slate-200 text-slate-500 hover:border-red-300 hover:text-red-700 hover:bg-red-50"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 21V5a2 2 0 012-2h14l-3 4 3 4H5v10" />
              </svg>
              <span>{isFlagged ? "Flagged" : "Flag"}</span>
            </ActionButton>

            {/* Note */}
            <ActionButton
              title={record.adminNote ? "Edit note" : "Add note"}
              onClick={onToggleNote}
              disabled={isWorking}
              active={isNoteOpen || !!record.adminNote}
              activeClass="bg-indigo-50 text-indigo-700 border-indigo-200"
              inactiveClass="border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-700 hover:bg-indigo-50"
            >
              <svg className="w-3.5 h-3.5" fill={record.adminNote ? "currentColor" : "none"} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Note</span>
            </ActionButton>
          </div>

          {/* Inline action error */}
          {actionError && (
            <p className="mt-1 text-xs text-red-600 max-w-xs">{actionError}</p>
          )}
        </td>
      </tr>

      {/* Expanded note editor */}
      {isNoteOpen && (
        <tr className="bg-indigo-50/40">
          <td colSpan={8} className="px-5 py-3 border-b border-indigo-100">
            <div className="flex items-start gap-3 max-w-2xl">
              <div className="flex-1 space-y-1.5">
                {record.adminNote && !isNoteOpen && (
                  <p className="text-xs text-slate-500">
                    <span className="font-medium">Current note:</span> {record.adminNote}
                  </p>
                )}
                <textarea
                  rows={2}
                  value={noteText}
                  onChange={(e) => onNoteTextChange(e.target.value)}
                  placeholder="Internal note visible to admins only…"
                  maxLength={500}
                  className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2 resize-none bg-white focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400"
                  autoFocus
                />
                <p className="text-xs text-slate-400">{noteText.length}/500</p>
              </div>
              <div className="flex flex-col gap-1.5 pt-0.5">
                <button
                  type="button"
                  onClick={onSaveNote}
                  disabled={isWorking}
                  className="rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 px-3 py-1.5 text-xs font-medium text-white transition-colors"
                >
                  {isWorking ? "Saving…" : "Save"}
                </button>
                <button
                  type="button"
                  onClick={onCancelNote}
                  className="rounded-lg border border-slate-200 bg-white hover:bg-slate-50 px-3 py-1.5 text-xs text-slate-600 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
            {record.adminNote && (
              <p className="mt-2 text-xs text-slate-500">
                <span className="font-medium">Existing note:</span> {record.adminNote}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── tiny shared button ───────────────────────────────────────────────────────

function ActionButton({
  children,
  onClick,
  disabled,
  active,
  activeClass,
  inactiveClass,
  title,
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        active ? activeClass : inactiveClass
      }`}
    >
      {children}
    </button>
  );
}
