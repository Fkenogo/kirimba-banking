import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const TARGET_TYPES = ["", "user", "group", "loan", "batch", "institution", "systemConfig", "admin"];

function fmtTs(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : new Date(ts);
  return d.toLocaleString("en-GB", { dateStyle: "short", timeStyle: "short" });
}

export default function AuditLogScreen() {
  const navigate = useNavigate();
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [targetType, setTargetType] = useState("");
  const [limitVal] = useState(50);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getAuditLog");
      const res = await fn({ targetType: targetType || undefined, limit: limitVal });
      setLogs(res.data?.logs || []);
    } catch (err) {
      setError(err.message || "Failed to load audit log.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">

        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Audit Log</h1>
            <p className="text-xs text-slate-400 mt-0.5">Full trail of admin and super admin actions</p>
          </div>
          <div className="flex items-center gap-2">
            <select value={targetType} onChange={(e) => setTargetType(e.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1.5 text-sm text-slate-700 bg-white">
              {TARGET_TYPES.map((t) => (
                <option key={t} value={t}>{t || "All types"}</option>
              ))}
            </select>
            <button type="button" onClick={load} disabled={loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
              Search
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-2">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-14 rounded-xl border border-slate-200 bg-white animate-pulse" />
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center">
            <p className="text-sm text-slate-500">No audit log entries found.</p>
          </div>
        ) : (
          <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Timestamp</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Actor</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Action</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Target</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {logs.map((log) => (
                  <tr key={log.logId} className="hover:bg-slate-50 align-top">
                    <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{fmtTs(log.createdAt)}</td>
                    <td className="px-4 py-3">
                      <p className="text-xs font-medium text-slate-800">{log.actorId?.slice(0, 8)}…</p>
                      <p className="text-[10px] text-slate-400">{log.actorRole}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono text-slate-700">{log.action}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-xs text-slate-600">{log.targetType}</p>
                      {log.targetId && <p className="text-[10px] text-slate-400 font-mono">{log.targetId?.slice(0, 12)}…</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500 max-w-xs">
                      {log.meta && Object.keys(log.meta).length > 0 ? (
                        <pre className="whitespace-pre-wrap break-all text-[10px]">{JSON.stringify(log.meta, null, 1)}</pre>
                      ) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
              Showing latest {logs.length} entries
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
