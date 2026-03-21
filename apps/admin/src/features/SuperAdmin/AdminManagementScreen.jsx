import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

export default function AdminManagementScreen() {
  const navigate = useNavigate();
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [actionError, setActionError] = useState("");
  const [suspendReason, setSuspendReason] = useState("");
  const [suspendTarget, setSuspendTarget] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getAdmins");
      const res = await fn({});
      setAdmins(res.data?.admins || []);
    } catch (err) {
      setError(err.message || "Failed to load admins.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleSuspend(e) {
    e.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    setActionLoading(suspendTarget);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "suspendAdmin");
      await fn({ userId: suspendTarget, reason: suspendReason.trim() });
      setSuspendTarget(null);
      setSuspendReason("");
      await load();
    } catch (err) {
      setActionError(err.message || "Failed to suspend admin.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleReactivate(userId) {
    setActionLoading(userId);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "reactivateAdmin");
      await fn({ userId });
      await load();
    } catch (err) {
      setActionError(err.message || "Failed to reactivate admin.");
    } finally {
      setActionLoading("");
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-4xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Admin Management</h1>
            <p className="text-xs text-slate-400 mt-0.5">View, suspend, and reactivate admin-role accounts</p>
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

        {/* Suspend modal */}
        {suspendTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
            <form onSubmit={handleSuspend}
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
              <h2 className="text-base font-semibold text-slate-900">Suspend Admin</h2>
              <p className="text-sm text-slate-500">Provide a reason for suspension. This will be recorded in the audit log.</p>
              <textarea
                value={suspendReason}
                onChange={(e) => setSuspendReason(e.target.value)}
                rows={3}
                required
                placeholder="Reason for suspension..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setSuspendTarget(null); setSuspendReason(""); }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={!!actionLoading}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                  {actionLoading ? "Suspending..." : "Suspend"}
                </button>
              </div>
            </form>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-16 rounded-xl border border-slate-200 bg-white animate-pulse" />
            ))}
          </div>
        ) : admins.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No admin accounts found.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Name / Email</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Role</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Status</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {admins.map((admin) => (
                  <tr key={admin.userId} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{admin.fullName || "—"}</p>
                      <p className="text-xs text-slate-400">{admin.email || admin.phone || admin.userId}</p>
                    </td>
                    <td className="px-4 py-3">
                      <RoleBadge role={admin.role} />
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={admin.status} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      {admin.role !== "super_admin" && (
                        admin.status === "suspended" ? (
                          <button type="button"
                            onClick={() => handleReactivate(admin.userId)}
                            disabled={actionLoading === admin.userId}
                            className="rounded-md border border-green-300 px-3 py-1 text-xs text-green-700 hover:bg-green-50 disabled:opacity-60">
                            {actionLoading === admin.userId ? "..." : "Reactivate"}
                          </button>
                        ) : (
                          <button type="button"
                            onClick={() => setSuspendTarget(admin.userId)}
                            disabled={!!actionLoading}
                            className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-60">
                            Suspend
                          </button>
                        )
                      )}
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

function RoleBadge({ role }) {
  const cls = role === "super_admin"
    ? "bg-purple-100 text-purple-700"
    : role === "finance"
    ? "bg-teal-100 text-teal-700"
    : "bg-blue-100 text-blue-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {role || "admin"}
    </span>
  );
}

function StatusBadge({ status }) {
  const cls = status === "active"
    ? "bg-green-100 text-green-700"
    : status === "suspended"
    ? "bg-red-100 text-red-700"
    : "bg-amber-100 text-amber-700";
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>
      {status || "unknown"}
    </span>
  );
}
