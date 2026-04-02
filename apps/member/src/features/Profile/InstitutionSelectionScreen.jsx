import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, Alert, PrimaryButton, LoadingScreen } from "../../components/ui";

export default function InstitutionSelectionScreen({ user }) {
  const navigate = useNavigate();
  const [institutionId,        setInstitutionId]        = useState("");
  const [institutions,         setInstitutions]         = useState([]);
  const [loadingProfile,       setLoadingProfile]       = useState(true);
  const [loadingInstitutions,  setLoadingInstitutions]  = useState(true);
  const [saving,               setSaving]               = useState(false);
  const [error,                setError]                = useState("");
  const [success,              setSuccess]              = useState("");

  /* Load institution list */
  useEffect(() => {
    const fn = httpsCallable(functions, "getActiveInstitutions");
    fn({})
      .then((res) => setInstitutions(res.data?.institutions || []))
      .catch(() => setError("Failed to load institutions. Please refresh and try again."))
      .finally(() => setLoadingInstitutions(false));
  }, []);

  /* Load member's current selection */
  useEffect(() => {
    if (!user?.uid) { setLoadingProfile(false); return; }
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (snap.exists()) {
          const stored = String(snap.data().institutionId || "").trim();
          if (stored) setInstitutionId(stored);
        }
      })
      .catch((err) => setError(err?.message || "Failed to load profile."))
      .finally(() => setLoadingProfile(false));
  }, [user?.uid]);

  async function handleSave(e) {
    e.preventDefault();
    if (!institutionId) return;
    setSaving(true); setError(""); setSuccess("");
    try {
      const fn = httpsCallable(functions, "setMemberInstitution");
      await fn({ institutionId });
      setSuccess("Institution saved! You can now create or join a group.");
    } catch (err) {
      setError(err?.message || "Failed to save institution.");
    } finally {
      setSaving(false);
    }
  }

  if (loadingProfile || loadingInstitutions) return <LoadingScreen />;

  /* Find the currently selected institution label */
  const selectedInst = institutions.find((i) => i.id === institutionId);

  return (
    <PageShell title="Select Institution" showBack backTo="/app/profile" backLabel="Back to Profile">

      {/* Info card */}
      <Card>
        <div className="px-5 pt-4 pb-3">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Why this is required</p>
          <div className="space-y-3">
            {[
              { step: "1", text: "Kirimba partners with microfinance institutions to hold your savings" },
              { step: "2", text: "Select the institution your savings group is linked to" },
              { step: "3", text: "You can then create or join a group under that institution" },
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

      {/* Current selection badge */}
      {selectedInst && (
        <div className="flex items-center gap-3 bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3">
          <div className="w-8 h-8 bg-brand-100 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-brand-600 font-semibold">Current institution</p>
            <p className="text-sm font-bold text-brand-800">{selectedInst.name}</p>
          </div>
        </div>
      )}

      {/* Selection form */}
      <Card>
        <form onSubmit={handleSave} noValidate className="px-5 py-5 space-y-4">
          <div className="space-y-2">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
              Choose Institution
            </label>
            {institutions.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl px-4 py-3 text-center">
                <p className="text-sm text-slate-400">No institutions available. Please try again later.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {institutions.map((inst) => (
                  <label key={inst.id}
                    className={`flex items-center gap-3 rounded-2xl border-2 px-4 py-3.5 cursor-pointer transition-colors ${
                      institutionId === inst.id
                        ? "border-brand-500 bg-brand-50"
                        : "border-slate-100 bg-white hover:border-brand-200"
                    }`}>
                    <input
                      type="radio"
                      name="institution"
                      value={inst.id}
                      checked={institutionId === inst.id}
                      onChange={(e) => { setInstitutionId(e.target.value); setSuccess(""); setError(""); }}
                      className="w-4 h-4 accent-brand-500 shrink-0"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-bold text-slate-800">{inst.name}</p>
                      {inst.code && <p className="text-xs text-slate-400">{inst.code}</p>}
                    </div>
                    {institutionId === inst.id && (
                      <svg className="w-4 h-4 text-brand-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </label>
                ))}
              </div>
            )}
          </div>

          {error   && <Alert type="error">{error}</Alert>}
          {success && <Alert type="success">{success}</Alert>}

          <PrimaryButton type="submit" loading={saving} disabled={!institutionId}>
            Save Institution
          </PrimaryButton>

          {success && (
            <button
              type="button"
              onClick={() => navigate("/app/group/my")}
              className="w-full py-3 rounded-2xl border-2 border-brand-100 text-brand-600 font-bold text-sm"
            >
              Go to My Group →
            </button>
          )}
        </form>
      </Card>

    </PageShell>
  );
}
