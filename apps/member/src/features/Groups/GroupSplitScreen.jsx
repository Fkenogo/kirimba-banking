import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { confirmLeaderClaim, loadCurrentGroup } from "./leaderGroupAccess";
import { PageShell, Card, Alert, PrimaryButton, FormInput, LoadingScreen } from "../../components/ui";

const GROUP_SIZE_THRESHOLD = 12;
const STEP = { IDLE: "idle", SELECT: "select", NAME: "name", CONFIRM: "confirm", DONE: "done" };

export default function GroupSplitScreen({ user }) {
  const navigate    = useNavigate();
  const [group,     setGroup]     = useState(null);
  const [members,   setMembers]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const [step,         setStep]         = useState(STEP.IDLE);
  const [selectedIds,  setSelectedIds]  = useState(new Set());
  const [newGroupName, setNewGroupName] = useState("");
  const [submitting,   setSubmitting]   = useState(false);
  const [submitError,  setSubmitError]  = useState(null);
  const [result,       setResult]       = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const { groupId, group: currentGroup } = await loadCurrentGroup(db, user.uid);
        if (!groupId || !currentGroup) { setError("You are not in a group."); return; }

        const hasLeaderClaim = await confirmLeaderClaim(user);
        if (!hasLeaderClaim || currentGroup.leaderId !== user.uid) {
          setError("Only group leaders can split a group.");
          return;
        }
        setGroup(currentGroup);

        const getGroupMembers = httpsCallable(functions, "getGroupMembers");
        const res = await getGroupMembers({ groupId });
        setMembers((res.data?.members || []).filter((m) => m.userId !== user.uid));
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
      if (next.has(userId)) next.delete(userId); else next.add(userId);
      return next;
    });
  }

  async function submitSplit() {
    if (!group?.id) return;
    setSubmitting(true); setSubmitError(null);
    try {
      const fn = httpsCallable(functions, "initiateGroupSplit");
      const res = await fn({
        sourceGroupId:    group.id,
        newGroupName:     newGroupName.trim(),
        memberIdsToMove:  [...selectedIds],
      });
      setResult(res.data || null);
      setStep(STEP.DONE);
    } catch (err) {
      setSubmitError(err?.message || "Split failed.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <LoadingScreen title="Split Group" backTo="/app/group/manage" backLabel="Back to Manage Group" />;

  /* ─── Error / access denied ─── */
  if (error) {
    return (
      <PageShell title="Split Group" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">
        <Card>
          <div className="px-5 py-8 text-center space-y-3">
            <p className="text-sm font-bold text-slate-800">Access Restricted</p>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  /* ─── Done ─── */
  if (step === STEP.DONE && result) {
    return (
      <PageShell title="Split Group" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">
        <Card>
          <div className="px-5 py-10 text-center space-y-4">
            <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-base font-extrabold text-slate-900">Group Split Complete!</p>
              <p className="text-sm text-slate-500 mt-1.5">{result.movedCount} members moved to the new group.</p>
            </div>
            {result.newInviteCode && (
              <div className="bg-brand-50 rounded-2xl px-5 py-4 text-left">
                <p className="text-xs font-bold uppercase tracking-widest text-brand-600 mb-1">New Group Code</p>
                <p className="text-3xl font-mono font-extrabold text-brand-700 tracking-widest">{result.newInviteCode}</p>
                <p className="text-xs text-slate-400 mt-1">Share this code with the moved members.</p>
              </div>
            )}
            <PrimaryButton onClick={() => navigate("/app/home")}>Back to Home</PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  /* ─── Main wizard ─── */
  return (
    <PageShell title="Split Group" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">

      {/* Group context banner */}
      <div className="bg-brand-500 rounded-2xl px-5 py-4 text-white">
        <p className="text-xs text-brand-200 uppercase tracking-wide">Splitting</p>
        <p className="text-base font-bold">{group?.name}</p>
        <p className="text-xs text-brand-200 mt-0.5">{group?.memberCount ?? 0} members</p>
      </div>

      {/* Not large enough */}
      {!isLarge && step === STEP.IDLE && (
        <Card>
          <div className="px-5 py-6 text-center space-y-3">
            <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <p className="text-sm font-bold text-slate-700">Group is not large enough to split</p>
            <p className="text-xs text-slate-400">
              A split becomes available once your group has more than {GROUP_SIZE_THRESHOLD} members.
              Currently: {group?.memberCount ?? 0} members.
            </p>
          </div>
        </Card>
      )}

      {/* Ready to split — idle */}
      {isLarge && step === STEP.IDLE && (
        <Card>
          <div className="px-5 py-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-gold-100 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-gold-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-bold text-slate-800">Your group is growing</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  With {group?.memberCount} members, you can split into two groups. Select members to move to a new group.
                </p>
              </div>
            </div>
            <PrimaryButton onClick={() => setStep(STEP.SELECT)}>Start Split</PrimaryButton>
          </div>
        </Card>
      )}

      {/* Step: select members */}
      {step === STEP.SELECT && (
        <Card>
          <div className="px-5 py-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">
              Select Members to Move ({selectedIds.size} selected)
            </p>
            {members.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-2">No other members available.</p>
            ) : (
              <div className="space-y-2">
                {members.map((member) => (
                  <label key={member.userId}
                    className={`flex items-center gap-3 rounded-xl border-2 px-4 py-3 cursor-pointer transition-colors ${
                      selectedIds.has(member.userId)
                        ? "border-brand-500 bg-brand-50"
                        : "border-slate-100 bg-slate-50 hover:border-brand-200"
                    }`}>
                    <input
                      type="checkbox"
                      checked={selectedIds.has(member.userId)}
                      onChange={() => toggleMember(member.userId)}
                      className="w-4 h-4 accent-brand-500 shrink-0"
                    />
                    <div className="w-8 h-8 bg-brand-100 rounded-lg flex items-center justify-center shrink-0">
                      <span className="text-xs font-extrabold text-brand-600">
                        {String(member.fullName || "?")[0].toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-bold text-slate-800 truncate">{member.fullName || member.userId}</p>
                      <p className="text-xs text-slate-400">{formatMemberMeta(member)}</p>
                    </div>
                  </label>
                ))}
              </div>
            )}
            <PrimaryButton
              onClick={() => setStep(STEP.NAME)}
              disabled={selectedIds.size === 0}
            >
              Continue ({selectedIds.size} selected)
            </PrimaryButton>
          </div>
        </Card>
      )}

      {/* Step: name new group */}
      {step === STEP.NAME && (
        <Card>
          <div className="px-5 py-5 space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Name the New Group</p>
            <FormInput
              label="New Group Name"
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="e.g. Kirimba North"
            />
            <div className="flex gap-3">
              <button onClick={() => setStep(STEP.SELECT)}
                className="flex-1 py-3 rounded-2xl border-2 border-slate-200 text-slate-600 font-bold text-sm">
                Back
              </button>
              <PrimaryButton
                onClick={() => setStep(STEP.CONFIRM)}
                disabled={!newGroupName.trim()}
              >
                Continue
              </PrimaryButton>
            </div>
          </div>
        </Card>
      )}

      {/* Step: confirm */}
      {step === STEP.CONFIRM && (
        <Card>
          <div className="px-5 py-5 space-y-4">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Confirm Split</p>
            <div className="bg-brand-50 rounded-2xl px-4 py-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Members moving</span>
                <span className="font-bold text-slate-800">{selectedIds.size}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">New group name</span>
                <span className="font-bold text-slate-800">{newGroupName}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">Remaining in {group?.name}</span>
                <span className="font-bold text-slate-800">{(group?.memberCount ?? 0) - selectedIds.size}</span>
              </div>
            </div>

            {submitError && <Alert type="error">{submitError}</Alert>}

            <div className="flex gap-3">
              <button onClick={() => setStep(STEP.NAME)}
                className="flex-1 py-3 rounded-2xl border-2 border-slate-200 text-slate-600 font-bold text-sm">
                Back
              </button>
              <PrimaryButton onClick={submitSplit} loading={submitting}>
                Confirm Split
              </PrimaryButton>
            </div>
          </div>
        </Card>
      )}

    </PageShell>
  );
}

function formatMemberMeta(member) {
  const role = member.role === "leader" ? "Leader" : "Member";
  const joinedAt = member.joinedAt?.toDate
    ? member.joinedAt.toDate()
    : typeof member.joinedAt?._seconds === "number"
      ? new Date(member.joinedAt._seconds * 1000)
      : typeof member.joinedAt?.seconds === "number"
        ? new Date(member.joinedAt.seconds * 1000)
        : member.joinedAt
          ? new Date(member.joinedAt)
          : null;

  if (!joinedAt || Number.isNaN(joinedAt.getTime())) {
    return role;
  }

  return `${role} · Joined ${joinedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
}
