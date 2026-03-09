import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { loadCurrentGroup } from "./leaderGroupAccess";
import { db } from "../../services/firebase";

export default function GroupManageScreen({ user }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        const { group: currentGroup } = await loadCurrentGroup(db, user.uid);
        if (!currentGroup) {
          setError("You are not in a group.");
          return;
        }
        if (currentGroup.leaderId !== user.uid) {
          setError("Only the group leader can manage group settings.");
          return;
        }
        setGroup(currentGroup);
      } catch (err) {
        setError(err?.message || "Failed to load group.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-sm text-red-600">{error}</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:text-slate-700 mb-1">
          ← Back
        </button>
        <h1 className="text-lg font-semibold text-slate-900">Manage Group</h1>
        <p className="text-xs text-slate-400 mt-0.5">Overview and settings</p>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Group Overview</p>
          <Row label="Name" value={group.name} />
          <Row label="Status" value={String(group.status || "—").replace(/_/g, " ")} />
          <Row label="Members" value={String(group.memberCount ?? 0)} />
          <Row label="Institution" value={group.institutionId || "—"} />
          <Row label="Total Savings" value={`${Number(group.totalSavings || 0).toLocaleString("en-US")} BIF`} />
        </section>
      </div>
    </main>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium text-slate-900 text-right">{value || "—"}</span>
    </div>
  );
}
