import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOutAccount } from "../services/auth";

export default function HomePage({ user }) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError("");
    try {
      await signOutAccount();
    } catch (err) {
      setError(err.message || "Failed to sign out.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <section className="w-full max-w-2xl mx-auto rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Umuco Home</h1>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as <span className="font-medium">{user.email || user.uid}</span>
        </p>

        <section className="mt-6">
          <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">Batch Operations</h2>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => navigate("/umuco/batches")}
              className="flex flex-col rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-left hover:border-emerald-400 hover:shadow-sm transition-all"
            >
              <span className="text-base font-medium text-slate-900">Pending Batches</span>
              <span className="mt-1 text-sm text-slate-600">Review and confirm submitted deposit batches</span>
            </button>

            <button
              type="button"
              onClick={() => navigate("/umuco/history")}
              className="flex flex-col rounded-lg border border-blue-200 bg-blue-50 p-4 text-left hover:border-blue-400 hover:shadow-sm transition-all"
            >
              <span className="text-base font-medium text-slate-900">Batch History</span>
              <span className="mt-1 text-sm text-slate-600">View confirmed and flagged batches</span>
            </button>
          </div>
        </section>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="mt-8 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isSigningOut ? "Signing out..." : "Sign out"}
        </button>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
