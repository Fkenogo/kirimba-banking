import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { db } from "../../services/firebase";
import { loadCurrentGroup } from "./leaderGroupAccess";
import { PageShell, Card, LoadingScreen } from "../../components/ui";

export default function GroupCodeScreen({ user }) {
  const navigate = useNavigate();
  const [group,   setGroup]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [copied,  setCopied]  = useState(false);

  useEffect(() => {
    if (!user?.uid) return;
    async function load() {
      try {
        const { group: currentGroup } = await loadCurrentGroup(db, user.uid);
        if (!currentGroup) { setError("You are not in a group."); return; }
        if (currentGroup.leaderId !== user.uid) {
          setError("Only the group leader can view and share the group code.");
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
    const code = group?.inviteCode || group?.groupCode;
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (loading) return <LoadingScreen title="Group Code" backTo="/app/group/manage" backLabel="Back to Manage Group" />;

  if (error) {
    return (
      <PageShell title="Group Code" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">
        <Card>
          <div className="px-5 py-8 text-center space-y-3">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-sm font-bold text-slate-800">Access Restricted</p>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  const code = group?.inviteCode || group?.groupCode || "—";

  return (
    <PageShell title="Group Code" showBack backTo="/app/group/manage" backLabel="Back to Manage Group">

      {/* Big code display card */}
      <Card>
        <div className="px-5 py-7 flex flex-col items-center text-center space-y-4">
          <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center">
            <svg className="w-7 h-7 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
            </svg>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-2">Your Group Code</p>
            <p className="text-4xl font-mono font-extrabold text-brand-600 tracking-widest">{code}</p>
            <p className="text-xs text-slate-400 mt-2">{group.name}</p>
          </div>

          {/* Copy button */}
          <button
            onClick={copyCode}
            className={`w-full py-3.5 rounded-2xl font-bold text-sm transition-all active:scale-95 flex items-center justify-center gap-2 ${
              copied
                ? "bg-brand-500 text-white"
                : "border-2 border-brand-200 text-brand-600 hover:bg-brand-50"
            }`}
          >
            {copied ? (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
                Copy Code
              </>
            )}
          </button>
        </div>
      </Card>

      {/* Instructions card */}
      <Card>
        <div className="px-5 pt-4 pb-4">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How to Share</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Copy the code above and send it to your members via WhatsApp or message" },
              { step: "2", text: "Members enter the code in the \"Join a Group\" screen" },
              { step: "3", text: "You'll see their request in \"Join Requests\" — approve to add them" },
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

    </PageShell>
  );
}
