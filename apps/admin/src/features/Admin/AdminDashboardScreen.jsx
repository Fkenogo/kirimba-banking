import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOutAccount } from "../../services/auth";

const isSuperAdmin = (role) => role === "super_admin";

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
    <main className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="mx-auto max-w-4xl space-y-6">

        {/* Header */}
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-4 shadow-sm flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-slate-900">
              {isSuperAdmin(role) ? "KIRIMBA Business Console" : "Admin Dashboard"}
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Signed in as{" "}
              <span className="font-medium">{user?.email || user?.uid}</span>
              {" "}·{" "}
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                isSuperAdmin(role)
                  ? "bg-purple-100 text-purple-700"
                  : role === "finance"
                  ? "bg-teal-100 text-teal-700"
                  : "bg-blue-100 text-blue-700"
              }`}>
                {role || "admin"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60 shrink-0"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </div>

        {error && <p className="text-sm text-red-600 px-1">{error}</p>}

        {/* ── Super Admin Only ─────────────────────────────────────────────── */}
        {isSuperAdmin(role) && (
          <section>
            <SectionHeader
              label="Business Oversight"
              badge="Super Admin"
              badgeColor="purple"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <NavCard
                title="Executive Overview"
                desc="Business health at a glance — members, savings, loans, exceptions"
                onClick={() => navigate("/admin/super/executive")}
                accent="purple"
              />
              <NavCard
                title="Transaction Oversight"
                desc="Browse and filter all transactions across the full system"
                onClick={() => navigate("/admin/super/transactions")}
                accent="purple"
              />
              <NavCard
                title="All Groups"
                desc="View, suspend, and reactivate all savings groups"
                onClick={() => navigate("/admin/super/groups")}
                accent="purple"
              />
              <NavCard
                title="Admin Management"
                desc="View, suspend, and reactivate admin-role accounts"
                onClick={() => navigate("/admin/super/admins")}
                accent="purple"
              />
              <NavCard
                title="Institution Management"
                desc="Create and manage partner microfinance institutions"
                onClick={() => navigate("/admin/super/institutions")}
                accent="purple"
              />
              <NavCard
                title="System Configuration"
                desc="Fees, loan policy, commission rates, and business rules"
                onClick={() => navigate("/admin/super/config")}
                accent="purple"
              />
              <NavCard
                title="Risk & Exceptions"
                desc="Flagged batches, defaulted loans, suspended accounts"
                onClick={() => navigate("/admin/super/exceptions")}
                accent="red"
              />
              <NavCard
                title="Fund Management"
                desc="Capital overview, top-up, deductions, lending pause, full ledger"
                onClick={() => navigate("/admin/super/fund")}
                accent="purple"
              />
              <NavCard
                title="Audit Log"
                desc="Full audit trail of all admin and super admin actions"
                onClick={() => navigate("/admin/super/audit")}
                accent="purple"
              />
            </div>
          </section>
        )}

        {/* ── Operations (all admin roles) ─────────────────────────────────── */}
        <section>
          <SectionHeader label="Deposits" />
          <div className="grid grid-cols-1 gap-3">
            <NavCard
              title="Deposit Monitor"
              desc="View pending deposits, submitted batches, and flagged batches"
              onClick={() => navigate("/admin/deposits/pending")}
            />
          </div>
        </section>

        <section>
          <SectionHeader label="Loan Operations" />
          <div className="grid grid-cols-1 gap-3">
            <NavCard
              title="Loan Operations Console"
              desc="Manage pending, active, overdue, and defaulted loans"
              onClick={() => navigate("/admin/loans")}
            />
          </div>
        </section>

        <section>
          <SectionHeader label="Approvals" />
          <div className="grid grid-cols-1 gap-3">
            <NavCard
              title="Pending Members & Groups"
              desc="Approve or reject new members and approve pending groups"
              onClick={() => navigate("/admin/approvals")}
            />
          </div>
        </section>

        <section>
          <SectionHeader label="Agent Management" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NavCard
              title="Create Agent"
              desc="Provision a new field-staff agent account"
              onClick={() => navigate("/admin/agents/new")}
            />
            <NavCard
              title="View Agents"
              desc="List all agents and manage group assignments"
              onClick={() => navigate("/admin/agents")}
            />
            <NavCard
              title="Assign Agent"
              desc="Link active agents to active groups"
              onClick={() => navigate("/admin/agents/assign")}
            />
            <NavCard
              title="Agent Reconciliations"
              desc="Review and mark submitted close-day reports"
              onClick={() => navigate("/admin/agents/reconciliation")}
            />
          </div>
        </section>

        <section>
          <SectionHeader label="User Provisioning" />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <NavCard
              title="Create Admin"
              desc="Super admin only — provision an internal admin account"
              onClick={() => navigate("/admin/admins/new")}
              disabled={!isSuperAdmin(role)}
            />
            <NavCard
              title="Create Institution User"
              desc="Provision partner institution staff accounts"
              onClick={() => navigate("/admin/institutions/new")}
            />
          </div>
        </section>

      </div>
    </main>
  );
}

function SectionHeader({ label, badge, badgeColor = "slate" }) {
  const badgeClasses = {
    purple: "bg-purple-100 text-purple-700",
    slate: "bg-slate-100 text-slate-600",
  };
  return (
    <div className="flex items-center gap-2 mb-3 px-1">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </h2>
      {badge && (
        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badgeClasses[badgeColor]}`}>
          {badge}
        </span>
      )}
    </div>
  );
}

function NavCard({ title, desc, onClick, disabled = false, accent }) {
  const accentBorder = {
    purple: "hover:border-purple-400",
    red: "hover:border-red-400",
  }[accent] || "hover:border-slate-400";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left transition-all hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-slate-200 disabled:hover:shadow-none ${accentBorder}`}
    >
      <span className="text-base font-medium text-slate-900">{title}</span>
      <span className="mt-1 text-sm text-slate-500">{desc}</span>
    </button>
  );
}
