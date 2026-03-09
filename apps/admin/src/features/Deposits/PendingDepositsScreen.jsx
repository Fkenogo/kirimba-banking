import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

function formatAmount(n) {
  return Number(n || 0).toLocaleString();
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PendingDepositsScreen() {
  const navigate = useNavigate();

  const [deposits, setDeposits] = useState([]);
  const [nameMap, setNameMap] = useState({ users: {}, groups: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [confirming, setConfirming] = useState(false); // show confirm bar
  const [approving, setApproving] = useState(false);
  const [approveResult, setApproveResult] = useState(null); // { approvedCount, totalApproved }
  const [approveError, setApproveError] = useState("");

  // ── Load pending deposits + resolve names ──────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const q = query(
          collection(db, "transactions"),
          where("type", "==", "deposit"),
          where("status", "==", "pending_confirmation"),
          orderBy("createdAt", "desc")
        );
        const snap = await getDocs(q);
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDeposits(rows);

        // Collect unique IDs to resolve human-readable names
        const userIds = new Set();
        const groupIds = new Set();
        for (const row of rows) {
          if (row.userId) userIds.add(row.userId);
          if (row.agentId) userIds.add(row.agentId);
          if (row.groupId) groupIds.add(row.groupId);
        }

        const [userSnaps, groupSnaps] = await Promise.all([
          Promise.all([...userIds].map((uid) => getDoc(doc(db, "users", uid)))),
          Promise.all([...groupIds].map((gid) => getDoc(doc(db, "groups", gid)))),
        ]);

        const users = {};
        ;[...userIds].forEach((uid, i) => {
          if (userSnaps[i].exists()) {
            const d = userSnaps[i].data();
            users[uid] = d.name ?? d.fullName ?? uid;
          }
        });

        const groups = {};
        ;[...groupIds].forEach((gid, i) => {
          if (groupSnaps[i].exists()) {
            groups[gid] = groupSnaps[i].data().name ?? gid;
          }
        });

        setNameMap({ users, groups });
      } catch (err) {
        setError(err.message || "Failed to load pending deposits.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  // ── Approve ────────────────────────────────────────────────────────────────
  async function handleApprove() {
    setApproving(true);
    setApproveError("");
    try {
      const transactionIds = deposits.map((d) => d.id);
      const fn = httpsCallable(functions, "adminApproveDeposits");
      const result = await fn({ transactionIds });
      setApproveResult(result.data);
      setDeposits([]); // clear the list — all approved
      setConfirming(false);
    } catch (err) {
      setApproveError(err.message || "Approval failed. Please try again.");
      setConfirming(false);
    } finally {
      setApproving(false);
    }
  }

  const totalPending = deposits.reduce((s, d) => s + Number(d.amount || 0), 0);

  // ── Success state ──────────────────────────────────────────────────────────
  if (approveResult) {
    return (
      <main className="min-h-screen bg-slate-50 p-6 flex items-center justify-center">
        <div className="max-w-md w-full bg-white rounded-xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
          <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="text-lg font-semibold text-slate-900">Deposits Approved</p>
            <p className="text-sm text-slate-500 mt-1">
              {approveResult.approvedCount} deposit{approveResult.approvedCount !== 1 ? "s" : ""}{" "}
              totalling{" "}
              <span className="font-medium text-slate-700">
                {formatAmount(approveResult.totalApproved)} BIF
              </span>{" "}
              confirmed and member balances updated.
            </p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/admin/dashboard")}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Back to Dashboard
          </button>
        </div>
      </main>
    );
  }

  // ── Main view ──────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Pending Deposits</h1>
          </div>
          {!loading && deposits.length > 0 && !approveResult && (
            <button
              type="button"
              onClick={() => { setConfirming(true); setApproveError(""); }}
              disabled={approving}
              className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              Approve Batch ({deposits.length})
            </button>
          )}
        </div>

        {/* Confirmation bar */}
        {confirming && (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 flex items-center justify-between gap-4">
            <p className="text-sm text-amber-800">
              Approve <span className="font-semibold">{deposits.length}</span> deposits totalling{" "}
              <span className="font-semibold">{formatAmount(totalPending)} BIF</span>?
              Member balances will be updated immediately.
            </p>
            <div className="flex gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setConfirming(false)}
                disabled={approving}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApprove}
                disabled={approving}
                className="rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-800 disabled:opacity-60"
              >
                {approving ? "Approving…" : "Confirm"}
              </button>
            </div>
          </div>
        )}

        {/* Approve error */}
        {approveError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{approveError}</p>
          </div>
        )}

        {/* Total pending banner */}
        {!loading && deposits.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 flex items-center justify-between shadow-sm">
            <p className="text-sm text-slate-500">Total Pending Amount</p>
            <p className="text-2xl font-bold text-slate-900">
              {formatAmount(totalPending)}{" "}
              <span className="text-base font-normal text-slate-400">BIF</span>
            </p>
          </div>
        )}

        {/* Table card */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-400 animate-pulse">Loading deposits…</p>
            </div>
          ) : error ? (
            <div className="px-6 py-12 text-center space-y-3">
              <p className="text-sm text-red-600">{error}</p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="text-sm text-slate-600 underline"
              >
                Retry
              </button>
            </div>
          ) : deposits.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-500">No pending deposits.</p>
              <p className="text-xs text-slate-400 mt-1">All deposits have been confirmed.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">Member</th>
                    <th className="px-5 py-3">Member ID</th>
                    <th className="px-5 py-3">Group</th>
                    <th className="px-5 py-3">Agent</th>
                    <th className="px-5 py-3 text-right">Amount</th>
                    <th className="px-5 py-3">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {deposits.map((dep) => (
                    <tr key={dep.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5 font-medium text-slate-900">
                        {nameMap.users[dep.userId] ?? dep.userId ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 font-mono text-xs text-blue-600">
                        {dep.memberId ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {nameMap.groups[dep.groupId] ?? dep.groupId ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-slate-600">
                        {dep.agentId ? (nameMap.users[dep.agentId] ?? dep.agentId) : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right font-semibold text-slate-800">
                        {formatAmount(dep.amount)}
                        <span className="ml-1 text-xs font-normal text-slate-400">BIF</span>
                      </td>
                      <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">
                        {formatDate(dep.createdAt)}
                      </td>
                    </tr>
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
