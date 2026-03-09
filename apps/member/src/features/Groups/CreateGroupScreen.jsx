import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

export default function CreateGroupScreen({ user }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [profileLoading, setProfileLoading] = useState(true);
  const [institutionId, setInstitutionId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null);

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

  async function handleSubmit(event) {
    event.preventDefault();
    setError("");
    if (!institutionId) {
      setError("Select your institution before creating a group.");
      return;
    }
    setIsSubmitting(true);
    try {
      const createGroup = httpsCallable(functions, "createGroup");
      const result = await createGroup({
        name: name.trim(),
        description: description.trim(),
      });
      setCreated(result.data || null);
    } catch (err) {
      setError(err.message || "Failed to submit group request.");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (created) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Group Request Submitted</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your group is pending admin approval. You will become leader after approval.
          </p>
          <p className="mt-3 text-xs text-slate-500">Group ID: {created.groupId}</p>
          <button
            type="button"
            onClick={() => navigate("/app/home")}
            className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Back to Home
          </button>
        </section>
      </main>
    );
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
        <h1 className="text-xl font-semibold text-slate-900">Request New Group</h1>
        <p className="mt-1 text-sm text-slate-500">
          Submit a group request for admin approval.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          {profileLoading ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <p className="text-sm text-slate-600">Loading profile…</p>
            </div>
          ) : !institutionId ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 space-y-2">
              <p className="text-sm text-amber-800 font-medium">
                Institution required before creating a group.
              </p>
              <button
                type="button"
                onClick={() => navigate("/app/institution")}
                className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700"
              >
                Select Institution
              </button>
            </div>
          ) : null}

          <label className="block text-sm font-medium text-slate-700">
            Group Name
            <input
              type="text"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="block text-sm font-medium text-slate-700">
            Description
            <textarea
              required
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          {error ? <p className="text-sm text-red-600">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting || profileLoading || !institutionId}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isSubmitting ? "Submitting..." : "Submit Group Request"}
          </button>
        </form>
      </section>
    </main>
  );
}
