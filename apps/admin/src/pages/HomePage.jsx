import { useState } from "react";
import { signOutAccount } from "../services/auth";

export default function HomePage({ user }) {
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
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">Admin Home</h1>
        <p className="mt-2 text-sm text-slate-600">
          Signed in as <span className="font-medium">{user.email || user.uid}</span>
        </p>

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="mt-6 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {isSigningOut ? "Signing out..." : "Sign out"}
        </button>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
