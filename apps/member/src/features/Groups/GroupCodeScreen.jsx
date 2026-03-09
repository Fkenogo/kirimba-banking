import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../services/firebase";
import { loadCurrentGroup } from "./leaderGroupAccess";

export default function GroupCodeScreen({ user }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

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
          setError("Only the group leader can view this code.");
          return;
        }
        setGroup(currentGroup);
      } catch (err) {
        setError(err?.message || "Failed to load group code.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  async function copyCode() {
    if (!group?.inviteCode) return;
    await navigator.clipboard.writeText(group.inviteCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  if (loading) return <Centered text="Loading..." />;
  if (error) return <Centered text={error} error />;

  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:text-slate-700 mb-1">← Back</button>
        <h1 className="text-lg font-semibold text-slate-900">View Group Code</h1>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-6">
        <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5 space-y-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Group Code</p>
          <div className="flex items-center justify-between gap-3">
            <p className="text-3xl font-mono font-bold text-blue-700 tracking-widest">{group.inviteCode}</p>
            <button
              onClick={copyCode}
              className="text-sm font-medium text-blue-600 hover:text-blue-800 border border-blue-200 rounded-lg px-3 py-1.5"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="text-sm text-slate-600">Share this group code with members so they can request to join.</p>
          <p className="text-xs text-slate-400">Members are added only after leader approval.</p>
        </section>
      </div>
    </main>
  );
}

function Centered({ text, error = false }) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <p className={`text-sm ${error ? "text-red-600" : "text-slate-500"}`}>{text}</p>
    </main>
  );
}
