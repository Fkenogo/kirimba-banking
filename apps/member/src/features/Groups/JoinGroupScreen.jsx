import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

export default function JoinGroupScreen({ user }) {
  const navigate = useNavigate();
  const [groupCode, setGroupCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(true);
  const [institutionId, setInstitutionId] = useState("");
  const [error, setError] = useState(null);
  const [requestSubmitted, setRequestSubmitted] = useState(null); // { groupName, leaderName }

  useEffect(() => {
    if (!user?.uid) {
      setProfileLoading(false);
      return;
    }

    async function loadProfile() {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (userSnap.exists()) {
          setInstitutionId(String(userSnap.data().institutionId || "").trim().toLowerCase());
        }
      } catch {
        setInstitutionId("");
      } finally {
        setProfileLoading(false);
      }
    }

    loadProfile();
  }, [user?.uid]);

  async function handleJoin() {
    if (!institutionId) {
      setError("Select your institution before joining a group.");
      return;
    }

    const code = groupCode.trim().toUpperCase();
    if (!code) {
      setError("Enter a group code.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const joinGroupByInviteCode = httpsCallable(functions, "joinGroupByInviteCode");
      const result = await joinGroupByInviteCode({ inviteCode: code });
      setRequestSubmitted({
        groupName: result.data.groupName,
        leaderName: result.data.leaderName || "Group Leader",
      });
    } catch (err) {
      setError(err.message || "Failed to join group.");
    } finally {
      setLoading(false);
    }
  }

  if (requestSubmitted) {
    return (
      <main className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-6 py-8 text-center space-y-3">
            <div className="text-4xl">✓</div>
            <h1 className="text-xl font-bold text-slate-900">Request submitted</h1>
            <p className="text-sm text-slate-500">
              Your request to join <span className="font-semibold text-slate-800">{requestSubmitted.groupName}</span> has been sent.
            </p>
            <p className="text-xs text-slate-400">Awaiting approval from {requestSubmitted.leaderName}.</p>
          </div>

          <button
            onClick={() => navigate("/app/home")}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-semibold text-sm transition-colors"
          >
            Back to Home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-slate-500 hover:text-slate-700 mb-1"
        >
          ← Back
        </button>
        <h1 className="text-lg font-semibold text-slate-900">Join a Group</h1>
        <p className="text-xs text-slate-400 mt-0.5">Enter a group code shared by your group leader</p>
      </header>

      <div className="flex-1 p-4 max-w-md mx-auto w-full flex flex-col gap-4 pt-8">
        {profileLoading ? (
          <div className="bg-slate-100 border border-slate-200 rounded-xl px-4 py-3">
            <p className="text-sm text-slate-600">Loading profile…</p>
          </div>
        ) : !institutionId ? (
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 space-y-2">
            <p className="text-sm text-amber-800 font-medium">Institution required before joining a group.</p>
            <button
              type="button"
              onClick={() => navigate("/app/institution")}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
            >
              Select Institution
            </button>
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="block text-sm font-medium text-slate-700">Group Code</label>
          <input
            type="text"
            value={groupCode}
            onChange={(e) => setGroupCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && handleJoin()}
            placeholder="e.g. KIR-4821"
            autoFocus
            className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white uppercase"
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <p className="text-sm text-red-600">{error}</p>
          </div>
        )}

        <button
          onClick={handleJoin}
          disabled={loading || profileLoading || !institutionId || !groupCode.trim()}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white py-3.5 rounded-xl font-semibold text-base transition-colors"
        >
          {loading ? "Joining…" : "Join Group"}
        </button>

        <p className="text-xs text-slate-400 text-center">
          Ask your group leader to share the group code (format: KIR-XXXX). QR can be used as optional support.
        </p>
      </div>
    </main>
  );
}
