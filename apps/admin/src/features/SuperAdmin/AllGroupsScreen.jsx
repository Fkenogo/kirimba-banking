import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db, functions } from "../../services/firebase";
import { Link } from "react-router-dom";

const TABS = ["all", "active", "suspended", "pending_approval"];
const TAB_LABELS = { all: "All", active: "Active", suspended: "Suspended", pending_approval: "Pending" };

function fmt(n) { return Number(n || 0).toLocaleString("en-US"); }

export default function AllGroupsScreen() {
  const navigate = useNavigate();
  const [tab, setTab] = useState("all");
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [actionError, setActionError] = useState("");
  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendReason, setSuspendReason] = useState("");

  async function load() {
    setLoading(true);
    setError("");
    try {
      let q;
      if (tab === "all") {
        q = query(collection(db, "groups"), orderBy("createdAt", "desc"));
      } else {
        q = query(collection(db, "groups"), where("status", "==", tab), orderBy("createdAt", "desc"));
      }
      const snap = await getDocs(q);
      setGroups(snap.docs.map((d) => ({ groupId: d.id, ...d.data() })));
    } catch (err) {
      setError(err.message || "Failed to load groups.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSuspend(e) {
    e.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    setActionLoading(suspendTarget);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "suspendGroup");
      await fn({ groupId: suspendTarget, reason: suspendReason.trim() });
      setSuspendTarget(null);
      setSuspendReason("");
      await load();
    } catch (err) {
      setActionError(err.message || "Failed to suspend group.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleReactivate(groupId) {
    setActionLoading(groupId);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "reactivateGroup");
      await fn({ groupId });
      await load();
    } catch (err) {
      setActionError(err.message || "Failed to reactivate group.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleToggleBorrowPause(groupId, currentlyPaused) {
    setActionLoading(groupId);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "adminSetGroupBorrowPause");
      await fn({ groupId, isPaused: !currentlyPaused });
      setGroups((prev) =>
        prev.map((g) => g.groupId === groupId ? { ...g, borrowingPaused: !currentlyPaused } : g)
      );
    } catch (err) {
      setActionError(err.message || "Failed to update borrow pause.");
    } finally {
      setActionLoading("");
    }
  }

  const filtered = search.trim()
    ? groups.filter((g) =>
        (g.name || "").toLowerCase().includes(search.toLowerCase()) ||
        (g.groupCode || "").toLowerCase().includes(search.toLowerCase())
      )
    : groups;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">All Groups</h1>
            <p className="text-xs text-slate-400 mt-0.5">View, suspend, and reactivate all savings groups</p>
          </div>
          <button type="button" onClick={load} disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
            Refresh
          </button>
        </div>

        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
        {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm text-red-700">{actionError}</p></div>}

        {/* Search */}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or code…"
          className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-400"
        />

        {/* Suspend modal */}
        {suspendTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form onSubmit={handleSuspend}
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
              <h2 className="text-base font-semibold text-slate-900">Suspend Group</h2>
              <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                rows={3} required placeholder="Reason for suspension..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setSuspendTarget(null); setSuspendReason(""); }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={!!actionLoading}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                  {actionLoading ? "..." : "Suspend"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-2">{[...Array(5)].map((_, i) => <div key={i} className="h-16 rounded-xl border border-slate-200 bg-white animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">{search ? "No groups match your search." : "No groups found."}</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Group</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Code</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Members</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Savings</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((g) => (
                  <tr key={g.groupId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{g.name}</p>
                      <p className="text-xs text-slate-400">{g.groupId.slice(0, 10)}…</p>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{g.groupCode || "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(g.memberCount)}</td>
                    <td className="px-4 py-3 text-right text-slate-700">{fmt(g.totalSavings)} BIF</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        <StatusBadge status={g.status} />
                        {g.borrowingPaused && (
                          <span className="inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-orange-100 text-orange-700">Borrowing Paused</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-1 justify-end flex-wrap">
                        <Link
                          to={`/admin/super/groups/${g.groupId}`}
                          className="rounded-md bg-slate-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-black"
                        >
                          Open
                        </Link>
                        {g.status === "active" && (
                          <button type="button"
                            onClick={() => handleToggleBorrowPause(g.groupId, g.borrowingPaused)}
                            disabled={actionLoading === g.groupId}
                            className={`rounded-md border px-3 py-1 text-xs disabled:opacity-60 ${
                              g.borrowingPaused
                                ? "border-green-300 text-green-700 hover:bg-green-50"
                                : "border-orange-300 text-orange-700 hover:bg-orange-50"
                            }`}>
                            {actionLoading === g.groupId ? "..." : g.borrowingPaused ? "Unpause" : "Pause Loans"}
                          </button>
                        )}
                        {g.status === "suspended" ? (
                          <button type="button" onClick={() => handleReactivate(g.groupId)}
                            disabled={actionLoading === g.groupId}
                            className="rounded-md border border-green-300 px-3 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-60">
                            {actionLoading === g.groupId ? "..." : "Reactivate"}
                          </button>
                        ) : g.status === "active" ? (
                          <button type="button" onClick={() => setSuspendTarget(g.groupId)}
                            disabled={!!actionLoading}
                            className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60">
                            Suspend
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </main>
  );
}

function StatusBadge({ status }) {
  const cls = status === "active" ? "bg-green-100 text-green-700"
    : status === "suspended" ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{status}</span>;
}
