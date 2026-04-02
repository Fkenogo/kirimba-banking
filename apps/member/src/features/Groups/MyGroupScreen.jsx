import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { loadCurrentGroup } from "./leaderGroupAccess";
import { PageShell, Card, PrimaryButton, LoadingScreen, formatBIF } from "../../components/ui";

const getGroupMembers = httpsCallable(functions, "getGroupMembers");

function formatStatus(status) {
  return String(status || "active")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function resolveInstitution(group) {
  return group?.institutionName || (group?.umucoAccountNo ? "Umuco" : group?.institutionId || "Not linked");
}

function buildMilestones(group) {
  const milestones = [];

  if (Number(group.totalSavings || 0) > 0) {
    milestones.push({ label: "Savings Started", tone: "brand" });
  }
  if (Number(group.memberCount || 0) >= 5) {
    milestones.push({ label: "Strong Circle", tone: "gold" });
  }
  if (Number(group.totalLoansOutstanding || 0) > 0) {
    milestones.push({ label: "Credit Active", tone: "slate" });
  }
  if (Number(group.savingsGoal || 0) > 0 && Number(group.totalSavings || 0) >= Number(group.savingsGoal || 0)) {
    milestones.push({ label: "Goal Reached", tone: "brand" });
  }

  return milestones;
}

function ProgressCard({ group, isLeader }) {
  const totalSavings = Number(group.totalSavings || 0);
  const savingsGoal = Number(group.savingsGoal || 0);
  const hasGoal = savingsGoal > 0;
  const progress = hasGoal ? Math.min(100, Math.round((totalSavings / savingsGoal) * 100)) : 0;
  const remaining = Math.max(0, savingsGoal - totalSavings);

  return (
    <Card>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Shared Goal</p>
            <p className="text-sm font-bold text-slate-800 mt-1">
              {hasGoal ? "Track progress toward your shared target" : "No shared goal set yet"}
            </p>
          </div>
          <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-brand-50 text-brand-700">
            {group.status === "active" ? "Active" : formatStatus(group.status)}
          </span>
        </div>

        {hasGoal ? (
          <>
            <div>
              <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
                <span>{formatBIF(totalSavings)} saved</span>
                <span>{progress}%</span>
              </div>
              <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-brand-500 rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-2xl bg-brand-50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-brand-500 font-bold">Goal</p>
                <p className="text-lg font-extrabold text-brand-700 mt-1">{formatBIF(savingsGoal)}</p>
              </div>
              <div className="rounded-2xl bg-gold-50 px-4 py-3">
                <p className="text-[11px] uppercase tracking-wide text-gold-600 font-bold">Remaining</p>
                <p className="text-lg font-extrabold text-gold-700 mt-1">{formatBIF(remaining)}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50 px-4 py-4">
            <p className="text-sm font-semibold text-slate-700">
              {isLeader ? "Your group has not set a shared goal yet." : "Your group has not set a shared goal yet."}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {isLeader
                ? "You can still track savings progress and handle group actions from this screen."
                : "You can still follow total group savings and group status from this screen."}
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

function OverviewHighlights({ group, milestones, pendingCount, isLeader }) {
  const totalLoansOutstanding = Number(group.totalLoansOutstanding || 0);
  const statusMessage =
    group.status === "active"
      ? "Your group is active and saving together."
      : `Your group is currently ${formatStatus(group.status).toLowerCase()}.`;

  return (
    <Card>
      <div className="px-5 py-4 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Overview</p>
            <p className="text-sm font-bold text-slate-800 mt-1">What matters right now</p>
          </div>
          {isLeader ? (
            <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-slate-100 text-slate-700">
              {pendingCount > 0 ? `${pendingCount} requests need review` : "No requests waiting"}
            </span>
          ) : null}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <MetricTile label="Activity" value={statusMessage} />
          <MetricTile
            label="Recognition"
            value={milestones.length > 0 ? milestones.map((milestone) => milestone.label).join(" · ") : "Building momentum"}
          />
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-4">
          <p className="text-sm font-semibold text-slate-800">
            {totalLoansOutstanding > 0
              ? `${formatBIF(totalLoansOutstanding)} is currently out in group loans.`
              : "No active group loans right now."}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            {isLeader
              ? "Open Group Savings Overview for deeper progress details."
              : "Open Group Savings Overview for a deeper look at group progress."}
          </p>
        </div>
      </div>
    </Card>
  );
}

export default function MyGroupScreen({ user, notifCount = 0 }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [memberPreview, setMemberPreview] = useState([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersError, setMembersError] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const { group: currentGroup, groupId: currentGroupId } = await loadCurrentGroup(db, user.uid);
        if (!currentGroup) {
          setError("no-group");
          return;
        }
        setGroup(currentGroup);
        setGroupId(currentGroupId);
        setError("");
      } catch (err) {
        setError(err?.message || "Failed to load your group.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.uid]);

  const isLeader = group && group.leaderId === user?.uid;

  useEffect(() => {
    if (!isLeader || !groupId) return;
    async function loadPending() {
      try {
        const q = query(collection(db, "groups", groupId, "joinRequests"), where("status", "==", "pending"));
        const snap = await getDocs(q);
        setPendingCount(snap.size);
      } catch {
        setPendingCount(0);
      }
    }
    loadPending();
  }, [groupId, isLeader]);

  useEffect(() => {
    if (!groupId) return;
    async function loadMembers() {
      setMembersLoading(true);
      setMembersError("");
      try {
        const res = await getGroupMembers({ groupId });
        const members = Array.isArray(res.data?.members) ? res.data.members : [];
        const normalizedMembers = members
          .filter((member) => member?.userId)
          .sort((a, b) => {
            if (a.userId === group?.leaderId) return -1;
            if (b.userId === group?.leaderId) return 1;
            return String(a.fullName || "").localeCompare(String(b.fullName || ""));
          });
        setMemberPreview(normalizedMembers.slice(0, 4));
      } catch (err) {
        setMemberPreview([]);
        setMembersError(err?.message || "Unable to load group members right now.");
      } finally {
        setMembersLoading(false);
      }
    }
    loadMembers();
  }, [group?.leaderId, groupId]);

  const milestones = useMemo(() => (group ? buildMilestones(group) : []), [group]);

  if (loading) return <LoadingScreen title="Group" />;

  if (error) {
    return (
      <PageShell title="Group" notifCount={notifCount}>
        <Card>
          <div className="px-5 py-10 text-center space-y-4">
            <div className="w-16 h-16 bg-brand-50 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-slate-800">You are not in a group yet</p>
              <p className="text-sm text-slate-500 mt-1 max-w-xs mx-auto">
                Join an existing group with a code from your leader, or create a new one to start saving together.
              </p>
            </div>
            <div className="space-y-3 pt-1">
              <PrimaryButton onClick={() => navigate("/app/join-group")}>Join a Group</PrimaryButton>
              <button
                type="button"
                onClick={() => navigate("/app/group/create")}
                className="w-full py-3 rounded-2xl border-2 border-brand-100 text-brand-600 font-bold text-sm"
              >
                Create a Group
              </button>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }

  const institutionLabel = resolveInstitution(group);
  const groupStatus = formatStatus(group.status);
  const totalSavings = Number(group.totalSavings || 0);
  const roleLabel = isLeader ? "Group Leader" : "Member";
  const actionCards = isLeader
    ? [
        {
          label: "Manage Group",
          subtitle: pendingCount > 0 ? `${pendingCount} requests need review in Manage Group` : "Member directory and leader actions",
          path: "/app/group/manage",
          badge: pendingCount > 0 ? pendingCount : null,
        },
        {
          label: "Group Savings Overview",
          subtitle: "Open deeper group progress and lending details",
          path: "/app/savings",
          badge: null,
        },
      ]
    : [
        {
          label: "Group Savings Overview",
          subtitle: "Track group progress and milestones",
          path: "/app/savings",
          badge: null,
        },
      ];

  return (
    <PageShell title="Group" notifCount={notifCount}>
      <div className="bg-brand-500 rounded-2xl px-5 py-5 text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-brand-400 rounded-full opacity-30" />
        <div className="relative space-y-4">
          <div>
            <p className="text-xs text-brand-200 uppercase tracking-wide">Your Group</p>
            <p className="text-2xl font-extrabold leading-tight mt-1">{group.name}</p>
            <p className="text-sm text-brand-100 mt-1">{institutionLabel}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-white/20 text-white">
              {groupStatus}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-gold-400 text-gold-900">
              {roleLabel}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Members" value={String(group.memberCount || 0)} tone="brand" />
        <StatCard label="Total Savings" value={formatBIF(totalSavings)} tone="gold" />
        <StatCard label="Group Status" value={groupStatus} tone="slate" />
        <StatCard label="Institution" value={institutionLabel} tone="brand" />
      </div>

      <ProgressCard group={group} isLeader={isLeader} />

      <OverviewHighlights group={group} milestones={milestones} pendingCount={pendingCount} isLeader={isLeader} />

      <Card>
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Group Members</p>
              <p className="text-sm font-bold text-slate-800 mt-1">A quick look at your group</p>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-brand-50 text-brand-700">
              {group.memberCount || memberPreview.length} members
            </span>
          </div>

          {membersLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((item) => (
                <div key={item} className="h-[68px] rounded-2xl bg-slate-50 animate-pulse" />
              ))}
            </div>
          ) : memberPreview.length === 0 ? (
            <div className="rounded-2xl bg-slate-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-700">Group members are unavailable right now.</p>
              <p className="text-xs text-slate-500 mt-1">{membersError || "Please try again in a moment."}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {memberPreview.map((member) => {
                const isMemberLeader = member.userId === group.leaderId || member.role === "leader";
                return (
                  <div key={member.userId} className="flex items-center gap-3 rounded-2xl bg-slate-50 px-4 py-3">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-extrabold text-sm ${isMemberLeader ? "bg-gold-100 text-gold-700" : "bg-brand-50 text-brand-700"}`}>
                      {String(member.fullName || "M")
                        .split(" ")
                        .map((part) => part[0])
                        .slice(0, 2)
                        .join("")
                        .toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{member.fullName || "Unknown Member"}</p>
                      <p className="text-xs text-slate-500">{formatJoinedAt(member.joinedAt)}</p>
                    </div>
                    <span className={`text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 ${isMemberLeader ? "bg-gold-50 text-gold-700" : "bg-brand-50 text-brand-700"}`}>
                      {isMemberLeader ? "Leader" : "Member"}
                    </span>
                  </div>
                );
              })}
              {group.memberCount > memberPreview.length ? (
                <p className="text-xs text-slate-500">Showing {memberPreview.length} of {group.memberCount} members.</p>
              ) : null}
            </div>
          )}
        </div>
      </Card>

      <div className="space-y-3">
        {actionCards.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => navigate(action.path)}
            className="w-full bg-white border border-brand-100 rounded-2xl shadow-card px-5 py-4 flex items-center gap-4 text-left"
          >
            <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <div className="flex-1">
              <p className="text-sm font-bold text-slate-800">{action.label}</p>
              <p className="text-xs text-slate-500 mt-0.5">{action.subtitle}</p>
            </div>
            {action.badge ? (
              <span className="min-w-[22px] h-6 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1">
                {action.badge > 9 ? "9+" : action.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>
    </PageShell>
  );
}

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

function StatCard({ label, value, tone }) {
  const toneClass = tone === "gold"
    ? "bg-gold-50 border-gold-100"
    : tone === "slate"
      ? "bg-slate-50 border-slate-200"
      : "bg-brand-50 border-brand-100";

  return (
    <div className={`rounded-2xl border px-4 py-4 ${toneClass}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">{label}</p>
      <p className="text-lg font-extrabold text-slate-900 mt-1 leading-tight">{value}</p>
    </div>
  );
}

function MetricTile({ label, value }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-4 py-4">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">{label}</p>
      <p className="text-sm font-semibold text-slate-800 mt-1 leading-relaxed">{value}</p>
    </div>
  );
}
