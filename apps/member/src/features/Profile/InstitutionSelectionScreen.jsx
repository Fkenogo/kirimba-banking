import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

export default function InstitutionSelectionScreen({ user }) {
  const navigate = useNavigate();
  const [institutionId, setInstitutionId] = useState("");
  const [institutions, setInstitutions] = useState([]);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [loadingInstitutions, setLoadingInstitutions] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Load available institutions from backend
  useEffect(() => {
    const fn = httpsCallable(functions, "getActiveInstitutions");
    fn({})
      .then((res) => setInstitutions(res.data?.institutions || []))
      .catch(() => setError("Failed to load institutions. Please refresh and try again."))
      .finally(() => setLoadingInstitutions(false));
  }, []);

  // Load member's current institution selection
  useEffect(() => {
    if (!user?.uid) {
      setLoadingProfile(false);
      return;
    }
    getDoc(doc(db, "users", user.uid))
      .then((snap) => {
        if (snap.exists()) {
          // Read the raw stored value — do NOT lowercase (doc IDs are case-sensitive)
          const stored = String(snap.data().institutionId || "").trim();
          if (stored) setInstitutionId(stored);
        }
      })
      .catch((err) => setError(err?.message || "Failed to load profile."))
      .finally(() => setLoadingProfile(false));
  }, [user?.uid]);

  async function handleSave(event) {
    event.preventDefault();
    if (!institutionId) return;
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const fn = httpsCallable(functions, "setMemberInstitution");
      await fn({ institutionId });
      setSuccess("Institution saved. You can now create or join a group.");
    } catch (err) {
      setError(err?.message || "Failed to save institution.");
    } finally {
      setSaving(false);
    }
  }

  const loading = loadingProfile || loadingInstitutions;

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <button
          type="button"
          onClick={() => navigate("/app/home")}
          className="mb-4 text-sm text-slate-500 hover:text-slate-700"
        >
          ← Back
        </button>

        <h1 className="text-xl font-semibold text-slate-900">Select Institution</h1>
        <p className="mt-1 text-sm text-slate-500">
          Choose your institution before creating or joining a group.
        </p>

        {loading ? (
          <p className="mt-5 text-sm text-slate-500">Loading…</p>
        ) : (
          <form onSubmit={handleSave} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Institution
              <select
                value={institutionId}
                onChange={(e) => { setInstitutionId(e.target.value); setSuccess(""); }}
                required
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                <option value="" disabled>
                  {institutions.length === 0 ? "No institutions available" : "Select an institution…"}
                </option>
                {institutions.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name}{inst.code ? ` (${inst.code})` : ""}
                  </option>
                ))}
              </select>
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

            <button
              type="submit"
              disabled={saving || !institutionId}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? "Saving..." : "Save Institution"}
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
