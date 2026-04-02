import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, LoadingScreen, formatBIF } from "../../components/ui";
import { loadCurrentGroup } from "./leaderGroupAccess";

const getGroupMembers = httpsCallable(functions, "getGroupMembers");

function formatJoinedAt(joinedAt) {
  if (!joinedAt) return "Join date unavailable";

  let date = null;
  if (typeof joinedAt?.toDate === "function") {
    date = joinedAt.toDate();
  } else if (typeof joinedAt?._seconds === "number") {
    date = new Date(joinedAt._seconds * 1000);
  } else if (typeof joinedAt?.seconds === "number") {
    date = new Date(joinedAt.seconds * 1000);
  } else {
    const parsed = new Date(joinedAt);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return "Join date unavailable";
  }

  return `Joined ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}

export default function GroupManageScreen({ user, notifCount = 0 }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const { group: currentGroup, groupId } = await loadCurrentGroup(db, user.uid);
        if (!currentGroup) {
          setError("You are not in a group.");
          return;
        }
        if (currentGroup.leaderId !== user.uid) {
          setError("Only the group leader can open group management.");
          return;
        }

        const [memberResult, pendingSnap] = await Promise.all([
          getGroupMembers({ groupId }),
          getDocs(query(collection(db, "groups", groupId, "joinRequests"), where("status", "==", "pending"))),
        ]);

        setGroup(currentGroup);
        setMembers(Array.isArray(memberResult.data?.members) ? memberResult.data.members : []);
        setPendingCount(pendingSnap.size);
        setError(null);
      } catch (err) {
        setError(err?.message || "Failed to load group management.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.uid]);

  const sortedMembers = useMemo(
    () => [...members].sort((a, b) => {
      if (a.userId === group?.leaderId) return -1;
      if (b.userId === group?.leaderId) return 1;
      return String(a.fullName || "").localeCompare(String(b.fullName || ""));
    }),
    [group?.leaderId, members]
  );

  if (loading) return <LoadingScreen title="Manage Group" backTo="/app/group/my" backLabel="Back to Group" />;

  if (error) {
    return (
      <PageShell title="Manage Group" showBack backTo="/app/group/my" backLabel="Back to Group" notifCount={notifCount}>
        <Card>
          <div className="px-5 py-8 text-center space-y-3">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-sm font-bold text-slate-800">Access Restricted</p>
            <p className="text-xs text-slate-500">{error}</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="Manage Group" showBack backTo="/app/group/my" backLabel="Back to Group" notifCount={notifCount}>
      <div className="bg-brand-500 rounded-2xl px-5 py-5 text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-4 -right-4 w-20 h-20 bg-brand-400 rounded-full opacity-30" />
        <div className="relative">
          <p className="text-xs text-brand-200 uppercase tracking-wide">Leader Workspace</p>
          <p className="text-2xl font-extrabold mt-1">{group.name}</p>
          <p className="text-sm text-brand-100 mt-1">
            {group.memberCount ?? sortedMembers.length} members · {formatBIF(group.totalSavings)} total savings
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <SummaryCard label="Members" value={String(group.memberCount ?? sortedMembers.length)} />
        <SummaryCard label="Pending Requests" value={String(pendingCount)} tone="gold" />
      </div>

      <Card>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Leader Actions</p>
            <p className="text-sm font-bold text-slate-800 mt-1">What needs your attention</p>
          </div>
          <div className="space-y-3">
            <LeaderAction
              label="Review Pending Join Requests"
              subtitle={pendingCount > 0 ? `${pendingCount} requests waiting for your review` : "No pending requests right now"}
              onClick={() => navigate("/app/group/pending-requests")}
              badge={pendingCount > 0 ? pendingCount : null}
            />
            <LeaderAction
              label="Share Group Code"
              subtitle="Invite new members into the group"
              onClick={() => navigate("/app/group/code")}
            />
            <LeaderAction
              label="Split Group"
              subtitle="Create a new group from selected members"
              onClick={() => navigate("/app/group/split")}
            />
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Member Directory</p>
            <p className="text-sm font-bold text-slate-800 mt-1">Names and roles only</p>
          </div>
          <div className="space-y-3">
            {sortedMembers.map((member) => {
              const isLeader = member.userId === group.leaderId;
              const initials = String(member.fullName || "M")
                .split(" ")
                .map((part) => part[0])
                .slice(0, 2)
                .join("")
                .toUpperCase();

              return (
                <div key={member.userId} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-sm ${isLeader ? "bg-gold-100 text-gold-700" : "bg-brand-50 text-brand-700"}`}>
                    {initials}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-800 truncate">{member.fullName || "Unknown Member"}</p>
                    <p className="text-xs text-slate-500">{formatJoinedAt(member.joinedAt)}</p>
                  </div>
                  <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 ${isLeader ? "bg-gold-50 text-gold-700" : "bg-brand-50 text-brand-700"}`}>
                    {isLeader ? "Leader" : "Member"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </PageShell>
  );
}

function SummaryCard({ label, value, tone = "brand" }) {
  return (
    <div className={`rounded-2xl border px-4 py-4 ${tone === "gold" ? "bg-gold-50 border-gold-100" : "bg-brand-50 border-brand-100"}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">{label}</p>
      <p className="text-lg font-extrabold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function LeaderAction({ label, subtitle, onClick, badge = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-4 rounded-2xl border border-brand-100 bg-white px-4 py-4 text-left"
    >
      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-slate-800">{label}</p>
        <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
      </div>
      {badge ? (
        <span className="min-w-[22px] h-6 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
          {badge > 9 ? "9+" : badge}
        </span>
      ) : null}
    </button>
  );
}
