import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./services/firebase";
import LoginPage from "./pages/LoginPage";
import AdminDashboardScreen from "./features/Admin/AdminDashboardScreen";
import AgentListScreen from "./features/Admin/AgentListScreen";
import PendingDepositsScreen from "./features/Deposits/PendingDepositsScreen";
import AgentReconciliationsScreen from "./features/Agents/AgentReconciliationsScreen";
import ApprovalsScreen from "./features/Approvals/ApprovalsScreen";
import LoansDashboardScreen from "./features/Loans/LoansDashboardScreen";
import LoanDetailScreen from "./features/Loans/LoanDetailScreen";
import ExecutiveDashboardScreen from "./features/SuperAdmin/ExecutiveDashboardScreen";
import LoanPortfolioScreen from "./features/SuperAdmin/LoanPortfolioScreen";
import AdminManagementScreen from "./features/SuperAdmin/AdminManagementScreen";
import AuditLogScreen from "./features/SuperAdmin/AuditLogScreen";
import SystemConfigScreen from "./features/SuperAdmin/SystemConfigScreen";
import AllGroupsScreen from "./features/SuperAdmin/AllGroupsScreen";
import GroupDetailScreen from "./features/SuperAdmin/GroupDetailScreen";
import InstitutionManagementScreen from "./features/SuperAdmin/InstitutionManagementScreen";
import RiskExceptionScreen from "./features/SuperAdmin/RiskExceptionScreen";
import TransactionOversightScreen from "./features/SuperAdmin/TransactionOversightScreen";
import KirimbaFundManagementScreen from "./features/SuperAdmin/KirimbaFundManagementScreen";
import UserProvisioningScreen from "./features/SuperAdmin/UserProvisioningScreen";
import AdminShell from "./components/AdminShell";
import AccessRestrictedScreen from "./components/AccessRestrictedScreen";
import { ADMIN_ROLES, ADMIN_ROUTES, canAccessRoute } from "./config/console";
import InvitationAcceptancePage from "./pages/InvitationAcceptancePage";

const BASE_PATH = "/admin";
const LOGIN_PATH = `${BASE_PATH}/login`;
const DASHBOARD_PATH = `${BASE_PATH}/dashboard`;

function ProtectedShell({ user, role }) {
  return user ? <AdminShell user={user} role={role} /> : <Navigate to={LOGIN_PATH} replace />;
}

function GuardedScreen({ role, path, title, children }) {
  if (!canAccessRoute(role, path)) {
    return (
      <AccessRestrictedScreen
        title={title || "Access restricted"}
        message="This route is not part of your current console experience. Use the sidebar to continue within the modules available to your role."
      />
    );
  }

  return children;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null);
        setIsLoading(false);
        return;
      }

      try {
        const token = await nextUser.getIdTokenResult(true);
        setRole(token.claims?.role || null);
      } catch {
        try {
          await signOut(auth);
        } catch {
          // no-op
        }
        setRole(null);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-brand-800 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-3xl bg-white/15 flex items-center justify-center">
            <span className="text-white font-black text-3xl">K</span>
          </div>
          <div className="flex items-center gap-2 text-brand-200">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">Loading console…</span>
          </div>
        </div>
      </main>
    );
  }

  const isAllowedRole =
    role === ADMIN_ROLES.SUPER_ADMIN ||
    role === ADMIN_ROLES.ADMIN ||
    role === ADMIN_ROLES.FINANCE;

  if (user && !isAllowedRole) {
    return (
      <main className="min-h-screen bg-brand-800 flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-8 shadow-card-lg text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Access Restricted</h1>
          <p className="mt-2 text-sm text-slate-500">
            This console is available only to authorized admin roles.
          </p>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="mt-6 w-full rounded-xl bg-brand-500 hover:bg-brand-600 px-4 py-3 text-sm font-semibold text-white transition-colors"
          >
            Sign out
          </button>
        </div>
      </main>
    );
  }

  return (
    <Routes>
      <Route
        path={LOGIN_PATH}
        element={user ? <Navigate to={DASHBOARD_PATH} replace /> : <LoginPage />}
      />
      <Route path={`${BASE_PATH}/invitations/accept`} element={<InvitationAcceptancePage />} />

      <Route element={<ProtectedShell user={user} role={role} />}>
        <Route
          path={DASHBOARD_PATH}
          element={<AdminDashboardScreen user={user} role={role} />}
        />

        <Route
          path={ADMIN_ROUTES.AGENTS}
          element={
            <GuardedScreen role={role} path={ADMIN_ROUTES.AGENTS} title="Agent management is not available">
              <AgentListScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={ADMIN_ROUTES.AGENTS_NEW}
          element={
            <GuardedScreen role={role} path={ADMIN_ROUTES.AGENTS_NEW} title="Agent provisioning is not available">
              <Navigate to={`${BASE_PATH}/super/provisioning`} replace />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/admins/new`}
          element={
            <GuardedScreen role={role} path="/admin/admins/new" title="Admin provisioning is restricted">
              <Navigate to={`${BASE_PATH}/super/provisioning`} replace />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/institutions/new`}
          element={
            <GuardedScreen role={role} path="/admin/institutions/new" title="Institution provisioning is restricted">
              <Navigate to={`${BASE_PATH}/super/institutions?create=1`} replace />
            </GuardedScreen>
          }
        />
        <Route
          path={ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS}
          element={
            <GuardedScreen role={role} path={ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS}>
              <AgentReconciliationsScreen />
            </GuardedScreen>
          }
        />
        <Route path={ADMIN_ROUTES.RECONCILIATION_LEGACY} element={<Navigate to={ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS} replace />} />
        <Route path={ADMIN_ROUTES.SETTLEMENTS_LEGACY} element={<Navigate to={`${ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS}?focus=settlement`} replace />} />
        <Route path={`${BASE_PATH}/agents/reconciliation`} element={<Navigate to={ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS} replace />} />
        <Route path={`${BASE_PATH}/agents/settlements`} element={<Navigate to={`${ADMIN_ROUTES.RECONCILIATION_SETTLEMENTS}?focus=settlement`} replace />} />

        <Route
          path={`${BASE_PATH}/deposits/pending`}
          element={
            <GuardedScreen role={role} path="/admin/deposits/pending">
              <PendingDepositsScreen />
            </GuardedScreen>
          }
        />

        <Route
          path={`${BASE_PATH}/approvals`}
          element={
            <GuardedScreen role={role} path="/admin/approvals" title="Approvals are not available">
              <ApprovalsScreen />
            </GuardedScreen>
          }
        />

        <Route
          path={`${BASE_PATH}/loans`}
          element={
            <GuardedScreen role={role} path="/admin/loans">
              <LoansDashboardScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/loans/:loanId`}
          element={
            <GuardedScreen role={role} path="/admin/loans/:loanId">
              <LoanDetailScreen />
            </GuardedScreen>
          }
        />

        <Route
          path={`${BASE_PATH}/super/executive`}
          element={
            <GuardedScreen role={role} path="/admin/super/executive" title="Executive overview is restricted">
              <ExecutiveDashboardScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/loans`}
          element={
            <GuardedScreen role={role} path="/admin/super/loans" title="Portfolio summary is restricted">
              <LoanPortfolioScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/admins`}
          element={
            <GuardedScreen role={role} path="/admin/super/admins" title="User and role management is restricted">
              <AdminManagementScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/provisioning`}
          element={
            <GuardedScreen role={role} path="/admin/super/provisioning" title="User provisioning is restricted">
              <UserProvisioningScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/audit`}
          element={
            <GuardedScreen role={role} path="/admin/super/audit" title="Audit log access is restricted">
              <AuditLogScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/config`}
          element={
            <GuardedScreen role={role} path="/admin/super/config" title="Pricing and rules are restricted">
              <SystemConfigScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/groups`}
          element={
            <GuardedScreen role={role} path="/admin/super/groups" title="Group governance is restricted">
              <AllGroupsScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/groups/:groupId`}
          element={
            <GuardedScreen role={role} path="/admin/super/groups/:groupId" title="Group governance is restricted">
              <GroupDetailScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/institutions`}
          element={
            <GuardedScreen role={role} path="/admin/super/institutions" title="Institution management is restricted">
              <InstitutionManagementScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={ADMIN_ROUTES.RISK_EXCEPTIONS}
          element={
            <GuardedScreen role={role} path={ADMIN_ROUTES.RISK_EXCEPTIONS}>
              <RiskExceptionScreen />
            </GuardedScreen>
          }
        />
        <Route path={`${BASE_PATH}/super/exceptions`} element={<Navigate to={ADMIN_ROUTES.RISK_EXCEPTIONS} replace />} />
        <Route
          path={`${BASE_PATH}/super/transactions`}
          element={
            <GuardedScreen role={role} path="/admin/super/transactions" title="Transaction oversight is restricted">
              <TransactionOversightScreen />
            </GuardedScreen>
          }
        />
        <Route
          path={`${BASE_PATH}/super/fund`}
          element={
            <GuardedScreen role={role} path="/admin/super/fund" title="Fund management is restricted">
              <KirimbaFundManagementScreen />
            </GuardedScreen>
          }
        />
      </Route>

      <Route path={`${BASE_PATH}/home`} element={<Navigate to={DASHBOARD_PATH} replace />} />
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
