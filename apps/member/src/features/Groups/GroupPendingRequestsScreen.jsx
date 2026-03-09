import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { confirmLeaderClaim, loadCurrentGroup } from "./leaderGroupAccess";

export default function GroupPendingRequestsScreen({ user }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [approvingId, setApprovingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        const { groupId, group: currentGroup } = await loadCurrentGroup(db, user.uid);
        if (!groupId || !currentGroup) {
          setError("You are not in a group.");
          return;
        }

        const hasLeaderClaim = await confirmLeaderClaim(user);
        if (!hasLeaderClaim || currentGroup.leaderId !== user.uid) {
          setError("Leader permissions are required to view pending requests.");
          return;
        }

        setGroup(currentGroup);

        const joinRequestsRef = collection(db, "groups", groupId, "joinRequests");
        const pendingSnap = await getDocs(query(joinRequestsRef, where("status", "==", "pending")));

        const items = await Promise.all(
          pendingSnap.docs.map(async (requestDoc) => {
            const data = requestDoc.data() || {};
            const requesterId = data.userId || requestDoc.id;
            let requesterProfile = null;

            try {
              const requesterSnap = await getDoc(doc(db, "users", requesterId));
              if (requesterSnap.exists()) {
                requesterProfile = requesterSnap.data() || {};
              }
            } catch {
              // Keep fallback values when profile read is blocked by rules.
            }

            const requesterDisplay = resolveRequesterDisplay(data, requesterProfile, requesterId);
            return {
              id: requestDoc.id,
              userId: requesterId,
              primaryLabel: requesterDisplay.primaryLabel,
              secondaryLabel: requesterDisplay.secondaryLabel,
            };
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
      const approveJoinRequest = httpsCallable(functions, "approveJoinRequest");
      await approveJoinRequest({ joinRequestId: item.id, userId: item.userId });
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
      const rejectJoinRequest = httpsCallable(functions, "rejectJoinRequest");
      await rejectJoinRequest({ joinRequestId: item.id, userId: item.userId });
      setRequests((prev) => prev.filter((r) => r.id !== item.id));
    } catch (err) {
      setError(err?.message || "Failed to reject request.");
    } finally {
      setRejectingId(null);
    }
  }

  if (loading) return <Centered text="Loading..." />;
  if (error) return <Centered text={error} error />;

  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:text-slate-700 mb-1">← Back</button>
        <h1 className="text-lg font-semibold text-slate-900">Pending Join Requests</h1>
        <p className="text-xs text-slate-400 mt-0.5">{group?.name}</p>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-3">
        {requests.length === 0 ? (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5">
            <p className="text-sm text-slate-500">No pending join requests.</p>
          </section>
        ) : (
          requests.map((item) => (
            <section
              key={item.id}
              className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{item.primaryLabel}</p>
                <p className="text-xs text-slate-500">{item.secondaryLabel}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => approveRequest(item)}
                  disabled={approvingId === item.id}
                  className="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800 disabled:opacity-60"
                >
                  {approvingId === item.id ? "Approving..." : "Approve"}
                </button>
                <button
                  type="button"
                  onClick={() => rejectRequest(item)}
                  disabled={rejectingId === item.id}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 disabled:opacity-60"
                >
                  {rejectingId === item.id ? "Rejecting..." : "Reject"}
                </button>
              </div>
            </section>
          ))
        )}
      </div>
    </main>
  );
}

function pickFirstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

function resolveRequesterDisplay(requestData, profileData, requesterId) {
  const uidLabel = requesterId ? `UID: ${maskUid(requesterId)}` : "";
  const primaryLabel = pickFirstNonEmpty(
    requestData?.fullName,
    requestData?.name,
    profileData?.fullName,
    profileData?.name,
    requestData?.phone,
    profileData?.phone,
    requestData?.memberId,
    profileData?.memberId,
    "Pending member"
  );

  const secondaryLabel = pickFirstNonEmpty(
    requestData?.phone,
    profileData?.phone,
    requestData?.memberId ? `Member ID: ${requestData.memberId}` : "",
    profileData?.memberId ? `Member ID: ${profileData.memberId}` : "",
    uidLabel,
    "Identity pending"
  );

  return { primaryLabel, secondaryLabel };
}

function maskUid(uid) {
  const value = String(uid || "").trim();
  if (!value) return "unknown";
  if (value.length <= 8) return value;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function Centered({ text, error = false }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <p className={`text-sm ${error ? "text-red-600" : "text-slate-500"}`}>{text}</p>
    </main>
  );
}
