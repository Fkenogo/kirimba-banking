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
import { db } from "../../services/firebase";

function formatAmount(n) {
  return Number(n || 0).toLocaleString();
}

function formatDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const TABS = [
  { key: "pending", label: "Pending Deposits" },
  { key: "submitted", label: "Submitted Batches" },
  { key: "flagged", label: "Flagged Batches" },
];

export default function PendingDepositsScreen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("pending");

  const [deposits, setDeposits] = useState([]);
  const [nameMap, setNameMap] = useState({ users: {}, groups: {} });
  const [batches, setBatches] = useState({ submitted: [], flagged: [] });
  const [batchNameMap, setBatchNameMap] = useState({ users: {}, groups: {} });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [txSnap, submittedSnap, flaggedSnap] = await Promise.all([
          getDocs(query(
            collection(db, "transactions"),
            where("type", "==", "deposit"),
            where("status", "==", "pending_confirmation"),
            orderBy("createdAt", "desc")
          )),
          getDocs(query(collection(db, "depositBatches"), where("status", "==", "submitted"))),
          getDocs(query(collection(db, "depositBatches"), where("status", "==", "flagged"))),
        ]);

        const rows = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        setDeposits(rows);

        const submitted = submittedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const flagged = flaggedSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        // Sort batches newest first client-side
        submitted.sort((a, b) => (b.submittedAt?.toMillis?.() ?? 0) - (a.submittedAt?.toMillis?.() ?? 0));
        flagged.sort((a, b) => (b.flaggedAt?.toMillis?.() ?? 0) - (a.flaggedAt?.toMillis?.() ?? 0));
        setBatches({ submitted, flagged });

        // Resolve names for transactions
        const userIds = new Set();
        const groupIds = new Set();
        for (const row of rows) {
          if (row.userId) userIds.add(row.userId);
          if (row.agentId) userIds.add(row.agentId);
          if (row.groupId) groupIds.add(row.groupId);
        }
        for (const b of [...submitted, ...flagged]) {
          if (b.agentId) userIds.add(b.agentId);
          if (b.groupId) groupIds.add(b.groupId);
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
        setBatchNameMap({ users, groups });
      } catch (err) {
        setError(err.message || "Failed to load pending deposits.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, []);

  const totalPending = deposits.reduce((s, d) => s + Number(d.amount || 0), 0);

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
            <h1 className="text-xl font-semibold text-slate-900">Deposit Monitor</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              View-only — deposits are confirmed by institution staff
            </p>
          </div>
          {!loading && batches.flagged.length > 0 && (
            <span className="inline-flex items-center gap-1.5 bg-red-100 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-full">
              {batches.flagged.length} Flagged Batch{batches.flagged.length !== 1 ? "es" : ""}
            </span>
          )}
        </div>

        {/* Summary strip */}
        {!loading && (
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
              <p className="text-xs font-medium text-amber-700 uppercase tracking-wide">Pending Transactions</p>
              <p className="text-xl font-bold text-amber-900 mt-0.5">{deposits.length}</p>
              <p className="text-xs text-amber-600 mt-0.5">{formatAmount(totalPending)} BIF</p>
            </div>
            <div className="rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-center">
              <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">Submitted Batches</p>
              <p className="text-xl font-bold text-blue-900 mt-0.5">{batches.submitted.length}</p>
              <p className="text-xs text-blue-600 mt-0.5">
                {formatAmount(batches.submitted.reduce((s, b) => s + Number(b.totalAmount || 0), 0))} BIF
              </p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-center">
              <p className="text-xs font-medium text-red-700 uppercase tracking-wide">Flagged Batches</p>
              <p className="text-xl font-bold text-red-900 mt-0.5">{batches.flagged.length}</p>
              <p className="text-xs text-red-600 mt-0.5">
                {formatAmount(batches.flagged.reduce((s, b) => s + Number(b.totalAmount || 0), 0))} BIF
              </p>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setActiveTab(tab.key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium border ${
                activeTab === tab.key
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              {tab.label}
              {tab.key === "flagged" && batches.flagged.length > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                  {batches.flagged.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
          {loading ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-400 animate-pulse">Loading…</p>
            </div>
          ) : error ? (
            <div className="px-6 py-12 text-center space-y-3">
              <p className="text-sm text-red-600">{error}</p>
              <button type="button" onClick={() => window.location.reload()} className="text-sm text-slate-600 underline">
                Retry
              </button>
            </div>
          ) : activeTab === "pending" ? (
            deposits.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm text-slate-500">No pending deposits.</p>
                <p className="text-xs text-slate-400 mt-1">All deposits have been confirmed by the institution.</p>
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
            )
          ) : activeTab === "submitted" ? (
            batches.submitted.length === 0 ? (
              <div className="px-6 py-16 text-center">
                <p className="text-sm text-slate-500">No submitted batches awaiting confirmation.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-3">Batch ID</th>
                      <th className="px-5 py-3">Group</th>
                      <th className="px-5 py-3">Agent</th>
                      <th className="px-5 py-3 text-right">Amount</th>
                      <th className="px-5 py-3 text-right">Members</th>
                      <th className="px-5 py-3">Submitted</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {batches.submitted.map((b) => (
                      <tr key={b.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3.5 font-mono text-xs text-blue-600">{b.id.slice(0, 12)}…</td>
                        <td className="px-5 py-3.5 text-slate-700">{batchNameMap.groups[b.groupId] ?? b.groupId ?? "—"}</td>
                        <td className="px-5 py-3.5 text-slate-600">{b.agentId ? (batchNameMap.users[b.agentId] ?? b.agentId) : "—"}</td>
                        <td className="px-5 py-3.5 text-right font-semibold text-slate-800">
                          {formatAmount(b.totalAmount)}
                          <span className="ml-1 text-xs font-normal text-slate-400">BIF</span>
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-700">{b.memberCount ?? "—"}</td>
                        <td className="px-5 py-3.5 text-slate-500 whitespace-nowrap">{formatDate(b.submittedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : /* flagged */ batches.flagged.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm text-slate-500">No flagged batches.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {batches.flagged.map((b) => (
                <div key={b.id} className="px-5 py-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {batchNameMap.groups[b.groupId] ?? b.groupId ?? "Unknown Group"}
                        {" "}·{" "}
                        <span className="font-normal text-slate-500">
                          {b.agentId ? (batchNameMap.users[b.agentId] ?? b.agentId) : "Unknown Agent"}
                        </span>
                      </p>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">{b.id.slice(0, 16)}…</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold text-slate-900">
                        {formatAmount(b.totalAmount)} <span className="text-xs font-normal text-slate-400">BIF</span>
                      </p>
                      <p className="text-xs text-slate-500">{b.memberCount} members</p>
                    </div>
                  </div>
                  {(b.institutionNotes || b.umucoNotes) && (
                    <div className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                      <p className="text-xs font-semibold text-red-700 mb-0.5">Institution Note</p>
                      <p className="text-sm text-red-800">{b.institutionNotes || b.umucoNotes}</p>
                    </div>
                  )}
                  <p className="text-xs text-slate-400">Flagged {formatDate(b.flaggedAt)} · Submitted {formatDate(b.submittedAt)}</p>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </main>
  );
}
