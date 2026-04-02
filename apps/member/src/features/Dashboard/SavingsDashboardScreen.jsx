import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { PageShell, Card, LoadingScreen, EmptyState, formatBIF } from "../../components/ui";
import { loadCurrentGroup } from "../Groups/leaderGroupAccess";

function formatStatus(status) {
  return String(status || "active")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function buildMilestones(group) {
  const totalSavings = Number(group.totalSavings || 0);
  const goal = Number(group.savingsGoal || 0);
  const progress = goal > 0 ? totalSavings / goal : 0;
  const items = [];

  if (totalSavings > 0) items.push("Savings Started");
  if (Number(group.memberCount || 0) >= 5) items.push("Strong Circle");
  if (progress >= 0.75 && progress < 1) items.push("Goal In Reach");
  if (progress >= 1) items.push("Goal Reached");

  return items;
}

export default function SavingsDashboardScreen({ user, notifCount = 0 }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const { group: currentGroup, groupId } = await loadCurrentGroup(db, user.uid);
        if (!currentGroup) {
          setGroup(null);
          setLoading(false);
          return;
        }
        setGroup(currentGroup);

        if (currentGroup.leaderId === user.uid && groupId) {
          const pendingSnap = await getDocs(query(collection(db, "groups", groupId, "joinRequests"), where("status", "==", "pending")));
          setPendingCount(pendingSnap.size);
        } else {
          setPendingCount(0);
        }

        setError(null);
      } catch (err) {
        setError(err?.message || "Failed to load group savings overview.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [user?.uid]);

  const isLeader = group?.leaderId === user?.uid;
  const totalSavings = Number(group?.totalSavings || 0);
  const totalLoansOutstanding = Number(group?.totalLoansOutstanding || 0);
  const savingsGoal = Number(group?.savingsGoal || 0);
  const hasGoal = savingsGoal > 0;
  const progress = hasGoal ? Math.min(100, Math.round((totalSavings / savingsGoal) * 100)) : 0;
  const remainingToGoal = Math.max(0, savingsGoal - totalSavings);
  const lendingCapacity = Math.max(0, totalSavings * 0.7 - totalLoansOutstanding);
  const milestones = useMemo(() => (group ? buildMilestones(group) : []), [group]);

  if (loading) return <LoadingScreen title="Group Savings" backTo="/app/group/my" backLabel="Back to Group" />;

  if (error) {
    return (
      <PageShell title="Group Savings" showBack backTo="/app/group/my" backLabel="Back to Group" notifCount={notifCount}>
        <Card>
          <div className="px-5 py-6 text-center text-sm text-red-500">{error}</div>
        </Card>
      </PageShell>
    );
  }

  if (!group) {
    return (
      <PageShell title="Group Savings" showBack backTo="/app/group/my" backLabel="Back to Group" notifCount={notifCount}>
        <Card>
          <EmptyState title="No group found" subtitle="Join or create a group first." />
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell title="Group Savings" showBack backTo="/app/group/my" backLabel="Back to Group" notifCount={notifCount}>
      <div className="bg-brand-500 rounded-2xl px-5 py-5 text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-brand-400 rounded-full opacity-30" />
        <div className="relative">
          <p className="text-xs text-brand-200 uppercase tracking-wide">{group.name}</p>
          <p className="text-4xl font-extrabold mt-1 leading-none">{formatBIF(totalSavings)}</p>
          <p className="text-sm text-brand-200 mt-1">{group.memberCount ?? 0} members · {formatStatus(group.status)}</p>
        </div>
      </div>

      <Card>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Shared Goal</p>
            <p className="text-sm font-bold text-slate-800 mt-1">
              {hasGoal ? "Savings progress toward the group target" : "No shared goal set yet"}
            </p>
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
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="Goal" value={formatBIF(savingsGoal)} />
                <MetricCard label="Remaining" value={formatBIF(remainingToGoal)} tone="gold" />
              </div>
            </>
          ) : (
          <div className="rounded-2xl border border-dashed border-brand-200 bg-brand-50 px-4 py-4">
              <p className="text-sm font-semibold text-slate-700">Set a shared goal to track progress here.</p>
              <p className="text-xs text-slate-500 mt-1">Until then, this screen focuses on group-level savings and lending progress.</p>
            </div>
          )}
        </div>
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <MetricCard label="Group Savings" value={formatBIF(totalSavings)} />
        <MetricCard label="Loans Outstanding" value={formatBIF(totalLoansOutstanding)} tone="slate" />
        <MetricCard label="Lending Capacity" value={formatBIF(lendingCapacity)} tone="brand" />
        <MetricCard label="Institution" value={group.institutionName || group.institutionId || "Linked"} tone="gold" />
      </div>

      <Card>
        <div className="px-5 py-4 space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Recognition</p>
            <p className="text-sm font-bold text-slate-800 mt-1">Group highlights</p>
          </div>
          {milestones.length === 0 ? (
            <p className="text-sm text-slate-500">No milestones unlocked yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {milestones.map((item) => (
                <span key={item} className="text-xs font-bold rounded-full px-3 py-2 bg-brand-50 text-brand-700">
                  {item}
                </span>
              ))}
            </div>
          )}
        </div>
      </Card>

      {isLeader && (
        <Card>
          <div className="px-5 py-4 space-y-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Leader Actions</p>
              <p className="text-sm font-bold text-slate-800 mt-1">Pending work for you</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <MetricCard label="Pending Join Requests" value={String(pendingCount)} tone="gold" />
              <MetricCard label="Group Status" value={formatStatus(group.status)} tone="brand" />
            </div>
            <button
              type="button"
              onClick={() => navigate("/app/group/manage")}
              className="w-full py-3 rounded-2xl border-2 border-brand-100 text-brand-600 font-bold text-sm"
            >
              Open Manage Group
            </button>
          </div>
        </Card>
      )}
    </PageShell>
  );
}

function MetricCard({ label, value, tone = "brand" }) {
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
