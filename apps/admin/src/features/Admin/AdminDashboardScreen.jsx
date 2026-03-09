import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOutAccount } from "../../services/auth";

export default function AdminDashboardScreen({ user, role }) {
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
      setIsSigningOut(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Admin Dashboard</h1>
              <p className="mt-1 text-sm text-slate-500">
                Signed in as <span className="font-medium">{user?.email || user?.uid}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={isSigningOut}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              {isSigningOut ? "Signing out..." : "Sign out"}
            </button>
          </div>

          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

          <div className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Deposits
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => navigate("/admin/deposits/pending")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Pending Deposits</span>
                <span className="mt-1 text-sm text-slate-500">
                  Review and approve agent-recorded deposits
                </span>
              </button>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Loan Operations
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => navigate("/admin/loans")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Loan Operations Console</span>
                <span className="mt-1 text-sm text-slate-500">
                  Manage pending, active, overdue, and defaulted loans
                </span>
              </button>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Approvals
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3">
              <button
                type="button"
                onClick={() => navigate("/admin/approvals")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Pending Members & Groups</span>
                <span className="mt-1 text-sm text-slate-500">
                  Approve or reject new members and approve pending groups
                </span>
              </button>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              Agent Management
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => navigate("/admin/agents/new")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Create Agent</span>
                <span className="mt-1 text-sm text-slate-500">
                  Provision a new field-staff agent account
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/admin/agents")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">View Agents</span>
                <span className="mt-1 text-sm text-slate-500">
                  List all agents and manage group assignments
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/admin/agents/assign")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Assign Agent</span>
                <span className="mt-1 text-sm text-slate-500">
                  Link active agents to active groups
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/admin/agents/reconciliation")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Agent Reconciliations</span>
                <span className="mt-1 text-sm text-slate-500">
                  Review and mark submitted close-day reports
                </span>
              </button>
            </div>
          </div>

          <div className="mt-8">
            <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
              User Provisioning
            </h2>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => navigate("/admin/admins/new")}
                disabled={role !== "super_admin"}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all disabled:opacity-60 disabled:hover:border-slate-200 disabled:hover:shadow-none"
              >
                <span className="text-base font-medium text-slate-900">Create Admin</span>
                <span className="mt-1 text-sm text-slate-500">
                  Super admin only. Provision an internal admin account
                </span>
              </button>
              <button
                type="button"
                onClick={() => navigate("/admin/institutions/new")}
                className="flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-slate-400 hover:shadow-sm transition-all"
              >
                <span className="text-base font-medium text-slate-900">Create Institution User</span>
                <span className="mt-1 text-sm text-slate-500">
                  Provision partner institution staff accounts
                </span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
