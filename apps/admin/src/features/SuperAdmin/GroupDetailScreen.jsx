import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }
function fmtBIF(n) { return `${fmt(n)} BIF`; }

function StatusBadge({ status }) {
  const cls = status === "active" ? "bg-green-100 text-green-700"
    : status === "suspended" ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {status || "—"}
    </span>
  );
}

export default function GroupDetailScreen() {
  const navigate = useNavigate();
  const { groupId } = useParams();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState("");

  async function load() {
    if (!groupId) return;
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getGroupDetail");
      const res = await fn({ groupId });
      setGroup(res.data?.group || null);
    } catch (err) {
      setError(err.message || "Failed to load group detail.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [groupId]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleToggleBorrowPause() {
    if (!group) return;
    setActionLoading(true);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "adminSetGroupBorrowPause");
      await fn({ groupId, isPaused: !group.borrowingPaused });
      setGroup((prev) => prev ? { ...prev, borrowingPaused: !prev.borrowingPaused } : prev);
    } catch (err) {
      setActionError(err.message || "Failed to update borrow pause.");
    } finally {
      setActionLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/super/groups")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to All Groups
            </button>
            <h1 className="text-xl font-semibold text-slate-900">
              {loading ? "Group Detail" : (group?.name || "Group Detail")}
            </h1>
            {group && (
              <p className="text-xs text-slate-400 mt-0.5 font-mono">{groupId}</p>
            )}
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {actionError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
        )}

        {loading ? (
          <>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4 space-y-3 animate-pulse">
              <div className="h-4 w-28 rounded bg-slate-200" />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex justify-between gap-3">
                    <div className="h-3.5 w-24 rounded bg-slate-100" />
                    <div className="h-3.5 w-32 rounded bg-slate-200" />
                  </div>
                ))}
              </div>
            </section>
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden animate-pulse">
              <div className="px-5 py-4 border-b border-slate-100">
                <div className="h-4 w-32 rounded bg-slate-200" />
              </div>
              <div className="px-5 py-4 space-y-2">
                {[...Array(4)].map((_, i) => <div key={i} className="h-8 rounded bg-slate-100" />)}
              </div>
            </section>
          </>
        ) : !group ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">Group not found.</p>
          </div>
        ) : (
          <>
            {/* Group summary */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm px-5 py-4 space-y-4">
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div className="flex items-center gap-3 flex-wrap">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Group Info</h2>
                  <StatusBadge status={group.status} />
                  {group.borrowingPaused && (
                    <span className="inline-block rounded-full px-2 py-0.5 text-xs font-semibold bg-orange-100 text-orange-700">
                      Borrowing Paused
                    </span>
                  )}
                </div>
                {group.status === "active" && (
                  <button type="button" onClick={handleToggleBorrowPause} disabled={actionLoading}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium disabled:opacity-60 ${
                      group.borrowingPaused
                        ? "border-green-300 text-green-700 hover:bg-green-50"
                        : "border-orange-300 text-orange-700 hover:bg-orange-50"
                    }`}>
                    {actionLoading ? "..." : group.borrowingPaused ? "Unpause Borrowing" : "Pause Borrowing"}
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Row label="Name" value={group.name} />
                <Row label="Group Code" value={group.groupCode} mono />
                <Row label="Institution" value={group.institutionName || group.institutionId || "—"} />
                <Row label="Umuco Account" value={group.umucoAccountNo || "—"} mono />
                <Row label="Member Count" value={fmt(group.memberCount)} />
                <Row label="Total Savings" value={fmtBIF(group.totalSavings)} />
                <Row label="Active Loans" value={fmt(group.activeLoansCount)} />
                <Row label="Outstanding" value={fmtBIF(group.activeOutstandingBIF)} />
              </div>
              {group.leader && (
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-500 mb-1">Leader</p>
                  <p className="text-sm font-medium text-slate-900">{group.leader.fullName || group.leader.name || "—"}</p>
                  <p className="text-xs text-slate-500">{group.leader.phone || "—"}</p>
                </div>
              )}
            </section>

            {/* Member list */}
            <section className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
              <div className="px-5 py-4 border-b border-slate-100">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  Members ({(group.memberList || []).length})
                </h2>
              </div>
              {!group.memberList || group.memberList.length === 0 ? (
                <div className="px-5 py-10 text-sm text-slate-500">No members found.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        <th className="px-5 py-3">Name</th>
                        <th className="px-5 py-3">Phone</th>
                        <th className="px-5 py-3 text-right">Savings</th>
                        <th className="px-5 py-3 text-right">Locked</th>
                        <th className="px-5 py-3 text-right">Credit Limit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {group.memberList.map((m) => (
                        <tr key={m.userId} className="hover:bg-slate-50">
                          <td className="px-5 py-3 font-medium text-slate-900">{m.fullName || m.name || "—"}</td>
                          <td className="px-5 py-3 text-slate-600">{m.phone || "—"}</td>
                          <td className="px-5 py-3 text-right text-slate-700">{fmtBIF(m.personalSavings)}</td>
                          <td className="px-5 py-3 text-right text-slate-700">{fmtBIF(m.lockedSavings)}</td>
                          <td className="px-5 py-3 text-right text-slate-700">{fmtBIF(m.creditLimit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, mono }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`font-medium text-slate-900 text-right ${mono ? "font-mono text-xs" : ""}`}>
        {value || "—"}
      </span>
    </div>
  );
}
