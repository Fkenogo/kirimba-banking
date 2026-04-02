import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { confirmLeaderClaim, loadCurrentGroup } from "./leaderGroupAccess";
import { PageShell, Card, EmptyState, LoadingScreen } from "../../components/ui";

export default function GroupPendingRequestsScreen({ user }) {
  const navigate    = useNavigate();
  const [group,     setGroup]     = useState(null);
  const [requests,  setRequests]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const { groupId, group: currentGroup } = await loadCurrentGroup(db, user.uid);
        if (!groupId || !currentGroup) { setError("You are not in a group."); return; }

        const hasLeaderClaim = await confirmLeaderClaim(user);
        if (!hasLeaderClaim || currentGroup.leaderId !== user.uid) {
          setError("Leader permissions required to view join requests.");
          return;
        }
        setGroup(currentGroup);

        const pendingSnap = await getDocs(
          query(collection(db, "groups", groupId, "joinRequests"), where("status", "==", "pending"))
        );

        const items = await Promise.all(
          pendingSnap.docs.map(async (reqDoc) => {
            const data        = reqDoc.data() || {};
            const requesterId = data.userId || reqDoc.id;
            let profile = null;
            try {
              const snap = await getDoc(doc(db, "users", requesterId));
              if (snap.exists()) profile = snap.data();
            } catch { /* ignore rule errors */ }
            const { primaryLabel, secondaryLabel } = resolveDisplay(data, profile, requesterId);
            return { id: reqDoc.id, userId: requesterId, primaryLabel, secondaryLabel };
          })
        );
        setRequests(items);
      } catch (err) {
        setError(err?.message || "Failed to load pending requests.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.uid]);

  async function approveRequest(item) {
    try {
      setApprovingId(item.id);
      const fn = httpsCallable(functions, "approveJoinRequest");
      await fn({ joinRequestId: item.id, userId: item.userId });
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err) {
      setError(err?.message || "Failed to approve request.");
    } finally {
      setApprovingId(null);
    }
  }

  async function rejectRequest(item) {
    try {
      setRejectingId(item.id);
      const fn = httpsCallable(functions, "rejectJoinRequest");
      await fn({ joinRequestId: item.id, userId: item.userId });
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err) {
      setError(err?.message || "Failed to reject request.");
    } finally {
      setRejectingId(null);
    }
  }

  if (loading) return <LoadingScreen title="Join Requests" backTo="/app/group/manage" backLabel="Back to Manage Group" />;

  if (error) {
    return (
      <PageShell title="Join Requests" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">
        <Card>
          <div className="px-5 py-8 text-center space-y-3">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-sm font-bold text-slate-800">Access Restricted</p>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="Join Requests" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">

      {/* Group context */}
      {group && (
        <div className="bg-brand-500 rounded-2xl px-5 py-4 text-white flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-400 rounded-xl flex items-center justify-center shrink-0">
            <svg className="w-4.5 h-4.5 w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-brand-200">Pending requests for</p>
            <p className="text-sm font-bold">{group.name}</p>
          </div>
          <div className="ml-auto">
            <span className="bg-gold-500 text-white text-xs font-extrabold px-2.5 py-1 rounded-full">
              {requests.length}
            </span>
          </div>
        </div>
      )}

      {/* Requests list */}
      {requests.length === 0 ? (
        <Card>
          <EmptyState
            title="No pending requests"
            subtitle="When members request to join, they'll appear here for your approval."
          />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-50">
            {requests.map((item) => (
              <div key={item.id} className="flex items-center gap-3 px-5 py-4">
                {/* Avatar */}
                <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
                  <span className="text-sm font-extrabold text-brand-600">
                    {String(item.primaryLabel || "?")[0].toUpperCase()}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{item.primaryLabel}</p>
                  <p className="text-xs text-slate-400 truncate">{item.secondaryLabel}</p>
                </div>

                {/* Action buttons */}
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => approveRequest(item)}
                    disabled={approvingId === item.id}
                    className="rounded-xl bg-brand-500 px-3 py-2 text-xs font-bold text-white hover:bg-brand-600 disabled:opacity-60 transition-colors active:scale-95"
                  >
                    {approvingId === item.id ? "…" : "Approve"}
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectRequest(item)}
                    disabled={rejectingId === item.id}
                    className="rounded-xl border-2 border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-600 disabled:opacity-60 transition-colors active:scale-95"
                  >
                    {rejectingId === item.id ? "…" : "Reject"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

    </PageShell>
  );
}

/* ─── Helpers ─── */
function pickFirst(...values) {
  for (const v of values) {
    const s = String(v || "").trim();
    if (s) return s;
  }
  return "";
}

function resolveDisplay(requestData, profileData, requesterId) {
  const uidLabel = requesterId ? `UID: ${maskUid(requesterId)}` : "";
  return {
    primaryLabel: pickFirst(
      requestData?.fullName, requestData?.name,
      profileData?.fullName, profileData?.name,
      requestData?.phone,    profileData?.phone,
      "Pending member"
    ),
    secondaryLabel: pickFirst(
      requestData?.phone, profileData?.phone,
      requestData?.memberId ? `Member ID: ${requestData.memberId}` : "",
      profileData?.memberId ? `Member ID: ${profileData.memberId}` : "",
      uidLabel, "Identity pending"
    ),
  };
}

function maskUid(uid) {
  const v = String(uid || "").trim();
  if (!v) return "unknown";
  if (v.length <= 8) return v;
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}
