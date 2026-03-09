import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

const INSTITUTIONS = [
  { id: "umuco", label: "Umuco" },
];

export default function InstitutionSelectionScreen({ user }) {
  const navigate = useNavigate();
  const [institutionId, setInstitutionId] = useState("umuco");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    if (!user?.uid) {
      setLoading(false);
      return;
    }

    async function loadProfile() {
      try {
        const snap = await getDoc(doc(db, "users", user.uid));
        if (snap.exists()) {
          const profileInstitutionId = String(snap.data().institutionId || "").trim().toLowerCase();
          if (profileInstitutionId) {
            setInstitutionId(profileInstitutionId);
          }
        }
      } catch (err) {
        setError(err?.message || "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    }

    loadProfile();
  }, [user?.uid]);

  async function handleSave(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const setMemberInstitution = httpsCallable(functions, "setMemberInstitution");
      await setMemberInstitution({ institutionId });
      setSuccess("Institution saved. You can now create or join a group.");
    } catch (err) {
      setError(err?.message || "Failed to save institution.");
    } finally {
      setSaving(false);
    }
  }

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
          <p className="mt-5 text-sm text-slate-500">Loading profile…</p>
        ) : (
          <form onSubmit={handleSave} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Institution
              <select
                value={institutionId}
                onChange={(event) => setInstitutionId(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm bg-white"
              >
                {INSTITUTIONS.map((institution) => (
                  <option key={institution.id} value={institution.id}>
                    {institution.label}
                  </option>
                ))}
              </select>
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            {success ? <p className="text-sm text-emerald-700">{success}</p> : null}

            <button
              type="submit"
              disabled={saving}
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
