import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function toValidDate(value) {
  if (!value) return null;

  if (value?.toDate && typeof value.toDate === "function") {
    const dateFromTimestamp = value.toDate();
    return Number.isNaN(dateFromTimestamp.getTime()) ? null : dateFromTimestamp;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (typeof value === "object") {
    const rawSeconds = value.seconds ?? value._seconds;
    const rawNanos = value.nanoseconds ?? value._nanoseconds ?? 0;
    if (typeof rawSeconds === "number" && Number.isFinite(rawSeconds)) {
      const millis = rawSeconds * 1000 + Math.floor(rawNanos / 1e6);
      const parsed = new Date(millis);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }

  return null;
}

function formatCreatedAt(value) {
  const date = toValidDate(value);
  if (!date) return "Created —";

  return `Created ${date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function getBackendErrorMessage(error, fallback) {
  const code = typeof error?.code === "string" ? error.code.replace("functions/", "") : "";
  const fromDetails = typeof error?.details === "string"
    ? error.details
    : typeof error?.details?.message === "string"
    ? error.details.message
    : "";
  const detailsObject =
    error?.details && typeof error.details === "object" && !Array.isArray(error.details)
      ? JSON.stringify(error.details)
      : "";
  const fromMessage = typeof error?.message === "string" ? error.message : "";
  const candidate = (fromDetails || fromMessage || detailsObject || "").trim();
  if (!candidate) {
    return code ? `${code}: ${fallback}` : fallback;
  }
  if (candidate.toLowerCase() === "internal") {
    return code ? `${code}: ${fallback}` : fallback;
  }
  return code && !candidate.toLowerCase().startsWith(`${code.toLowerCase()}:`)
    ? `${code}: ${candidate}`
    : candidate;
}

export default function ApprovalsScreen() {
  const navigate = useNavigate();

  const [members, setMembers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [leaderNames, setLeaderNames] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [workingMemberId, setWorkingMemberId] = useState(null);
  const [workingGroupId, setWorkingGroupId] = useState(null);
  const [activeRejectMemberId, setActiveRejectMemberId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [actionError, setActionError] = useState("");

  const pendingMembersCount = members.length;
  const pendingGroupsCount = groups.length;

  async function loadPendingApprovals() {
    setLoading(true);
    setError("");
    try {
      const getPendingApprovals = httpsCallable(functions, "getPendingApprovals");
      const res = await getPendingApprovals({});
      const nextMembers = Array.isArray(res.data?.pendingMembers)
        ? res.data.pendingMembers
        : Array.isArray(res.data?.users)
        ? res.data.users
        : [];
      const nextGroups = Array.isArray(res.data?.pendingGroups)
        ? res.data.pendingGroups
        : Array.isArray(res.data?.groups)
        ? res.data.groups
        : [];
      setMembers(nextMembers);
      setGroups(nextGroups);
      setLeaderNames(
        Object.fromEntries(
          nextGroups
            .filter((g) => g?.leaderId)
            .map((g) => [g.leaderId, g?.leaderName || g?.leaderId])
        )
      );
    } catch (err) {
      setError(getBackendErrorMessage(err, "Failed to load pending approvals."));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadPendingApprovals();
  }, []);

  async function handleApproveMember(memberId) {
    setActionError("");
    setWorkingMemberId(memberId);
    try {
      const approveMember = httpsCallable(functions, "approveMember");
      await approveMember({ userId: memberId });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      if (activeRejectMemberId === memberId) {
        setActiveRejectMemberId(null);
        setRejectReason("");
      }
    } catch (err) {
      setActionError(getBackendErrorMessage(err, "Failed to approve member."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function handleRejectMember(memberId) {
    const reason = rejectReason.trim();
    if (!reason) {
      setActionError("Rejection reason is required.");
      return;
    }
    setActionError("");
    setWorkingMemberId(memberId);
    try {
      const rejectMember = httpsCallable(functions, "rejectMember");
      await rejectMember({ userId: memberId, reason });
      setMembers((prev) => prev.filter((m) => m.id !== memberId));
      setActiveRejectMemberId(null);
      setRejectReason("");
    } catch (err) {
      setActionError(getBackendErrorMessage(err, "Failed to reject member."));
    } finally {
      setWorkingMemberId(null);
    }
  }

  async function handleApproveGroup(groupId) {
    setActionError("");
    setWorkingGroupId(groupId);
    try {
      const approveGroup = httpsCallable(functions, "approveGroup");
      await approveGroup({ groupId });
      setGroups((prev) => prev.filter((g) => g.id !== groupId));
    } catch (err) {
      setActionError(getBackendErrorMessage(err, "Failed to approve group."));
    } finally {
      setWorkingGroupId(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-5xl space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <button
              type="button"
              onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
            >
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Pending Approvals</h1>
            {!loading && (
              <p className="text-xs text-slate-400 mt-0.5">
                {pendingMembersCount} member{pendingMembersCount !== 1 ? "s" : ""}, {pendingGroupsCount} group{pendingGroupsCount !== 1 ? "s" : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={loadPendingApprovals}
            disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
          >
            Refresh
          </button>
        </div>

        {(error || actionError) && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-600">{error || actionError}</p>
          </div>
        )}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Pending Members</h2>
          </div>
          {loading ? (
            <div className="px-5 py-10 text-sm text-slate-400">Loading members…</div>
          ) : members.length === 0 ? (
            <div className="px-5 py-10 text-sm text-slate-500">No pending members.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {members.map((member) => {
                const isRejecting = activeRejectMemberId === member.id;
                const isWorking = workingMemberId === member.id;
                return (
                  <div key={member.id} className="px-5 py-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{member.fullName || member.name || "Unknown"}</p>
                        <p className="text-sm text-slate-600">{member.phone || "—"}</p>
                        <p className="text-xs text-slate-400 mt-1">{formatCreatedAt(member.createdAt)}</p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleApproveMember(member.id)}
                          disabled={isWorking}
                          className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                        >
                          {isWorking ? "Working…" : "Approve"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionError("");
                            setActiveRejectMemberId(member.id);
                            setRejectReason("");
                          }}
                          disabled={isWorking}
                          className="rounded-md border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
                        >
                          Reject
                        </button>
                      </div>
                    </div>

                    {isRejecting && (
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-2">
                        <label className="block text-xs font-medium text-slate-600">
                          Rejection reason
                          <textarea
                            rows={3}
                            value={rejectReason}
                            onChange={(e) => setRejectReason(e.target.value)}
                            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
                            placeholder="Provide reason for rejection"
                          />
                        </label>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setActiveRejectMemberId(null);
                              setRejectReason("");
                            }}
                            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs text-slate-700 bg-white hover:bg-slate-50"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRejectMember(member.id)}
                            disabled={isWorking}
                            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-800 disabled:opacity-60"
                          >
                            {isWorking ? "Rejecting…" : "Confirm Reject"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="text-base font-semibold text-slate-900">Pending Groups</h2>
          </div>
          {loading ? (
            <div className="px-5 py-10 text-sm text-slate-400">Loading groups…</div>
          ) : groups.length === 0 ? (
            <div className="px-5 py-10 text-sm text-slate-500">No pending groups.</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {groups.map((group) => {
                const isWorking = workingGroupId === group.id;
                return (
                  <div key={group.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{group.name || "Unnamed Group"}</p>
                        <p className="text-sm text-slate-600">
                          Leader: {leaderNames[group.leaderId] || group.leaderId || "—"}
                        </p>
                        <p className="text-xs text-slate-400 mt-1">{formatCreatedAt(group.createdAt)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleApproveGroup(group.id)}
                        disabled={isWorking}
                        className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                      >
                        {isWorking ? "Approving…" : "Approve"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
