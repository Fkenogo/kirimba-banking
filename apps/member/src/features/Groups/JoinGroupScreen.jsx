import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, Alert, PrimaryButton, FormInput, LoadingScreen } from "../../components/ui";

export default function JoinGroupScreen({ user }) {
  const navigate = useNavigate();
  const [groupCode,      setGroupCode]      = useState("");
  const [loading,        setLoading]        = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [institutionId,  setInstitutionId]  = useState("");
  const [error,          setError]          = useState(null);
  const [submitted,      setSubmitted]      = useState(null); // { groupName, leaderName }

  useEffect(() => {
    if (!user?.uid) { setProfileLoading(false); return; }
    async function loadProfile() {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) setInstitutionId(String(snap.data().institutionId || "").trim().toLowerCase());
      } catch { setInstitutionId(""); }
      finally   { setProfileLoading(false); }
    }
    loadProfile();
  }, [user?.uid]);

  async function handleJoin() {
    if (!institutionId) { setError("Select your institution before joining a group."); return; }
    const code = groupCode.trim().toUpperCase();
    if (!code) { setError("Enter a group code."); return; }
    setLoading(true); setError(null);
    try {
      const joinGroupByInviteCode = httpsCallable(functions, "joinGroupByInviteCode");
      const result = await joinGroupByInviteCode({ inviteCode: code });
      setSubmitted({
        groupName:  result.data.groupName,
        leaderName: result.data.leaderName || "Group Leader",
      });
    } catch (err) {
      setError(err.message || "Failed to join group.");
    } finally {
      setLoading(false);
    }
  }

  /* ─── Success state ─── */
  if (submitted) {
    return (
      <PageShell title="Join a Group" showBack backTo="/app/group/my" backLabel="Back to Group">
        <Card>
          <div className="px-5 py-10 text-center space-y-4">
            <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-base font-extrabold text-slate-900">Request Submitted!</p>
              <p className="text-sm text-slate-500 mt-1.5">
                Your request to join{" "}
                <span className="font-bold text-slate-800">{submitted.groupName}</span>{" "}
                has been sent to {submitted.leaderName}.
              </p>
              <p className="text-xs text-slate-400 mt-2">You'll be added once they approve.</p>
            </div>
            <PrimaryButton onClick={() => navigate("/app/home")}>Back to Home</PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  if (profileLoading) return <LoadingScreen />;

  /* ─── Main form ─── */
  return (
    <PageShell title="Join a Group" showBack backTo="/app/group/my" backLabel="Back to Group">

      {/* Info banner */}
      <Card>
        <div className="px-5 pt-4 pb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How to Join</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Get the group code (e.g. KRM-4821) from your group leader" },
              { step: "2", text: "Type the code below and tap Join" },
              { step: "3", text: "Wait for the leader to approve your request" },
            ].map(({ step, text }) => (
              <div key={step} className="flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-brand-500 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {step}
                </div>
                <p className="text-sm text-slate-600">{text}</p>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Institution warning */}
      {!institutionId && (
        <Alert type="warning">
          You need to select an institution before joining a group.{" "}
          <button
            type="button"
            onClick={() => navigate("/app/institution")}
            className="font-bold underline ml-1"
          >
            Select now →
          </button>
        </Alert>
      )}

      {/* Code input card */}
      <Card>
        <div className="px-5 py-5 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
              Group Code
            </label>
            <input
              type="text"
              value={groupCode}
              onChange={(e) => { setGroupCode(e.target.value.toUpperCase()); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleJoin()}
              placeholder="e.g. KRM-4821"
              autoFocus
              className="w-full border-2 border-brand-100 focus:border-brand-500 rounded-2xl px-4 py-4 text-slate-800 text-2xl font-mono font-bold tracking-widest text-center focus:outline-none bg-brand-50 focus:bg-white transition-colors uppercase placeholder:text-slate-300 placeholder:text-lg placeholder:font-normal placeholder:tracking-normal"
            />
          </div>

          {error && <Alert type="error">{error}</Alert>}

          <PrimaryButton
            onClick={handleJoin}
            loading={loading}
            disabled={!institutionId || !groupCode.trim()}
          >
            Join Group
          </PrimaryButton>
        </div>
      </Card>

    </PageShell>
  );
}
