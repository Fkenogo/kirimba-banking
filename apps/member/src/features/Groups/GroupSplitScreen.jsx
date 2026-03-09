import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { confirmLeaderClaim, loadCurrentGroup } from "./leaderGroupAccess";

const GROUP_SIZE_THRESHOLD = 12;

const STEP = {
  IDLE: "idle",
  SELECT: "select",
  NAME: "name",
  CONFIRM: "confirm",
  DONE: "done",
};

export default function GroupSplitScreen({ user }) {
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [step, setStep] = useState(STEP.IDLE);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [newGroupName, setNewGroupName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null);

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
          setError("Only group leaders can split a group.");
          return;
        }

        setGroup(currentGroup);

        const getGroupMembers = httpsCallable(functions, "getGroupMembers");
        const membersRes = await getGroupMembers({ groupId });
        setMembers((membersRes.data?.members || []).filter((m) => m.userId !== user.uid));
      } catch (err) {
        setError(err?.message || "Failed to load split workflow.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  const isLarge = useMemo(() => Number(group?.memberCount || 0) > GROUP_SIZE_THRESHOLD, [group?.memberCount]);

  function toggleMember(userId) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function submitSplit() {
    if (!group?.id) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const initiateGroupSplit = httpsCallable(functions, "initiateGroupSplit");
      const res = await initiateGroupSplit({
        sourceGroupId: group.id,
        newGroupName: newGroupName.trim(),
        memberIdsToMove: [...selectedIds],
      });
      setResult(res.data || null);
      setStep(STEP.DONE);
    } catch (err) {
      setSubmitError(err?.message || "Split failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Centered text="Loading..." />;
  if (error) return <Centered text={error} error />;

  if (step === STEP.DONE && result) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-8 text-center space-y-2">
            <div className="text-4xl">✓</div>
            <h1 className="text-xl font-bold text-slate-900">Group Split Complete</h1>
            <p className="text-sm text-slate-500">{result.movedCount} members moved.</p>
          </section>
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">New Group Code</p>
            <p className="text-2xl font-mono font-bold text-blue-700 tracking-widest mt-1">{result.newInviteCode}</p>
          </section>
          <button
            onClick={() => navigate("/app/home")}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-semibold text-sm"
          >
            Back to Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <button onClick={() => navigate(-1)} className="text-sm text-slate-500 hover:text-slate-700 mb-1">← Back</button>
        <h1 className="text-lg font-semibold text-slate-900">Split Group</h1>
        <p className="text-xs text-slate-400 mt-0.5">{group?.name}</p>
      </header>

      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">
        {!isLarge && step === STEP.IDLE && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5">
            <p className="text-sm text-slate-600">Group is not large enough to split yet.</p>
          </section>
        )}

        {isLarge && step === STEP.IDLE && (
          <section className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-amber-900">Your group is growing</p>
            <p className="text-xs text-amber-700">Select members to move into a new group.</p>
            <button
              onClick={() => setStep(STEP.SELECT)}
              className="w-full bg-amber-600 hover:bg-amber-700 text-white py-2.5 rounded-xl text-sm font-semibold"
            >
              Start Split
            </button>
          </section>
        )}

        {step === STEP.SELECT && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800">Select Members to Move</p>
            {members.length === 0 ? (
              <p className="text-sm text-slate-500">No members available to move.</p>
            ) : (
              <ul className="space-y-2">
                {members.map((member) => (
                  <li key={member.userId} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                    <label className="flex items-center gap-3 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(member.userId)}
                        onChange={() => toggleMember(member.userId)}
                      />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{member.fullName || member.userId}</p>
                        <p className="text-xs text-slate-500">{member.phone || member.userId}</p>
                      </div>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <button
              onClick={() => setStep(STEP.NAME)}
              disabled={selectedIds.size === 0}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            >
              Continue
            </button>
          </section>
        )}

        {step === STEP.NAME && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800">Name New Group</p>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Kirimba North"
              className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              onClick={() => setStep(STEP.CONFIRM)}
              disabled={!newGroupName.trim()}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-40"
            >
              Continue
            </button>
          </section>
        )}

        {step === STEP.CONFIRM && (
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-4 space-y-3">
            <p className="text-sm font-semibold text-slate-800">Confirm Split</p>
            <p className="text-sm text-slate-600">Move {selectedIds.size} members to <span className="font-medium">{newGroupName}</span>.</p>
            {submitError ? <p className="text-sm text-red-600">{submitError}</p> : null}
            <button
              onClick={submitSplit}
              disabled={submitting}
              className="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-xl text-sm font-semibold disabled:opacity-60"
            >
              {submitting ? "Splitting..." : "Confirm Split"}
            </button>
          </section>
        )}
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
