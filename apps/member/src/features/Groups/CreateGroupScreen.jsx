import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, Alert, PrimaryButton, FormInput, FormTextarea, LoadingScreen } from "../../components/ui";

export default function CreateGroupScreen({ user }) {
  const navigate = useNavigate();
  const [name,           setName]           = useState("");
  const [description,    setDescription]    = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [institutionId,  setInstitutionId]  = useState("");
  const [submitting,     setSubmitting]     = useState(false);
  const [error,          setError]          = useState("");
  const [created,        setCreated]        = useState(null);

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

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    if (!institutionId) { setError("Select your institution before creating a group."); return; }
    setSubmitting(true);
    try {
      const createGroup = httpsCallable(functions, "createGroup");
      const result = await createGroup({ name: name.trim(), description: description.trim() });
      setCreated(result.data || null);
    } catch (err) {
      setError(err.message || "Failed to submit group request.");
    } finally {
      setSubmitting(false);
    }
  }

  if (profileLoading) return <LoadingScreen />;

  /* ─── Success state ─── */
  if (created) {
    return (
      <PageShell title="Create a Group" showBack backTo="/app/group/my" backLabel="Back to Group">
        <Card>
          <div className="px-5 py-10 text-center space-y-4">
            <div className="w-16 h-16 bg-brand-100 rounded-2xl flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-base font-extrabold text-slate-900">Group Request Submitted!</p>
              <p className="text-sm text-slate-500 mt-1.5">
                Your group is pending admin approval. You will become the leader after approval.
              </p>
              {created.groupId && (
                <p className="text-xs font-mono text-slate-400 mt-2">ID: {created.groupId}</p>
              )}
            </div>
            <PrimaryButton onClick={() => navigate("/app/home")}>Back to Home</PrimaryButton>
          </div>
        </Card>
      </PageShell>
    );
  }

  /* ─── Main form ─── */
  return (
    <PageShell title="Create a Group" showBack backTo="/app/group/my" backLabel="Back to Group">

      {/* How it works */}
      <Card>
        <div className="px-5 pt-4 pb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How It Works</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Fill in your group name and description" },
              { step: "2", text: "Submit for admin review and approval" },
              { step: "3", text: "Once approved, you become the group leader" },
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
          You need to select an institution before creating a group.{" "}
          <button
            type="button"
            onClick={() => navigate("/app/institution")}
            className="font-bold underline ml-1"
          >
            Select now →
          </button>
        </Alert>
      )}

      {/* Form card */}
      <Card>
        <form onSubmit={handleSubmit} noValidate className="px-5 py-5 space-y-4">
          <FormInput
            label="Group Name"
            type="text"
            value={name}
            onChange={(e) => { setError(""); setName(e.target.value); }}
            placeholder="e.g. Kirimba Market Group"
            hint="3–100 characters"
          />
          <FormTextarea
            label="Description"
            rows={3}
            value={description}
            onChange={(e) => { setError(""); setDescription(e.target.value); }}
            placeholder="Describe the purpose of your group…"
            hint="10–500 characters"
          />

          {error && <Alert type="error">{error}</Alert>}

          <PrimaryButton
            type="submit"
            loading={submitting}
            disabled={!institutionId || name.trim().length < 3 || description.trim().length < 10}
          >
            Submit Group Request
          </PrimaryButton>
        </form>
      </Card>

    </PageShell>
  );
}
