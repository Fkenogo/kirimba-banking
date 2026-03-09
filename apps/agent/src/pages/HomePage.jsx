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
    <main className="min-h-screen bg-slate-50">
      <section className="mx-auto w-full max-w-lg px-4 pt-8 pb-10">
        <header className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Agent Dashboard</h1>
          <p className="mt-1 text-xs text-slate-400 truncate">{user.email || user.uid}</p>
        </header>

        <section className="space-y-3">
          <ActionCard
            title="Scan Deposit"
            subtitle="Record a member deposit in the field"
            tone="emerald"
            onClick={() => navigate("/agent/scan-deposit")}
          />
          <ActionCard
            title="Today&apos;s Deposits"
            subtitle="Review synced and pending deposit entries"
            tone="blue"
            onClick={() => navigate("/agent/deposits-today")}
          />
          <ActionCard
            title="Business Dashboard"
            subtitle="Track totals, commissions, and daily performance"
            tone="indigo"
            onClick={() => navigate("/agent/dashboard")}
          />
          <ActionCard
            title="Close Day"
            subtitle="Submit reconciliation and cash summary"
            tone="amber"
            onClick={() => navigate("/agent/close-day")}
          />
        </section>

        {error ? <p className="mt-4 text-sm text-red-600">{error}</p> : null}

        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="mt-8 w-full rounded-2xl bg-slate-900 px-4 py-4 text-sm font-medium text-white disabled:opacity-60"
        >
          {isSigningOut ? "Signing out..." : "Sign out"}
        </button>
      </section>
    </main>
  );
}

function ActionCard({ title, subtitle, onClick, tone }) {
  const toneClasses = {
    emerald: "border-emerald-200 bg-emerald-50",
    blue: "border-blue-200 bg-blue-50",
    indigo: "border-indigo-200 bg-indigo-50",
    amber: "border-amber-200 bg-amber-50",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-2xl border px-5 py-4 text-left shadow-sm active:scale-[0.99] transition-transform ${toneClasses[tone] || "border-slate-200 bg-white"}`}
    >
      <p className="text-base font-semibold text-slate-900">{title}</p>
      <p className="mt-1 text-sm text-slate-600">{subtitle}</p>
    </button>
  );
}
