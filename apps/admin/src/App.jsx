import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./services/firebase";
import LoginPage from "./pages/LoginPage";
import AdminDashboardScreen from "./features/Admin/AdminDashboardScreen";
import CreateAgentScreen from "./features/Admin/CreateAgentScreen";
import CreateAdminScreen from "./features/Admin/CreateAdminScreen";
import CreateInstitutionUserScreen from "./features/Admin/CreateInstitutionUserScreen";
import AgentListScreen from "./features/Admin/AgentListScreen";
import AssignAgentScreen from "./features/Admin/AssignAgentScreen";
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

const BASE_PATH = "/admin";
const LOGIN_PATH = BASE_PATH + "/login";
const DASHBOARD_PATH = BASE_PATH + "/dashboard";

function ProtectedRoute({ user, element }) {
  return user ? element : <Navigate to={LOGIN_PATH} replace />;
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
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading authentication...</p>
      </main>
    );
  }

  const isAllowedRole = role === "super_admin" || role === "admin" || role === "finance";
  if (user && !isAllowedRole) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Access Restricted</h1>
          <p className="mt-2 text-sm text-slate-600">
            This app is available only to admin roles.
          </p>
          <button
            type="button"
            onClick={() => signOut(auth)}
            className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
          >
            Sign out
          </button>
        </section>
      </main>
    );
  }

  return (
    <Routes>
      {/* Auth */}
      <Route
        path={LOGIN_PATH}
        element={user ? <Navigate to={DASHBOARD_PATH} replace /> : <LoginPage />}
      />

      {/* Admin dashboard */}
      <Route
        path={DASHBOARD_PATH}
        element={<ProtectedRoute user={user} element={<AdminDashboardScreen user={user} role={role} />} />}
      />

      {/* Agent management */}
      <Route
        path={BASE_PATH + "/agents"}
        element={<ProtectedRoute user={user} element={<AgentListScreen />} />}
      />
      <Route
        path={BASE_PATH + "/agents/new"}
        element={<ProtectedRoute user={user} element={<CreateAgentScreen />} />}
      />
      <Route
        path={BASE_PATH + "/admins/new"}
        element={<ProtectedRoute user={user} element={<CreateAdminScreen />} />}
      />
      <Route
        path={BASE_PATH + "/institutions/new"}
        element={<ProtectedRoute user={user} element={<CreateInstitutionUserScreen />} />}
      />
      <Route
        path={BASE_PATH + "/agents/assign"}
        element={<ProtectedRoute user={user} element={<AssignAgentScreen />} />}
      />

      {/* Agent reconciliations */}
      <Route
        path={BASE_PATH + "/agents/reconciliation"}
        element={<ProtectedRoute user={user} element={<AgentReconciliationsScreen />} />}
      />

      {/* Deposits */}
      <Route
        path={BASE_PATH + "/deposits/pending"}
        element={<ProtectedRoute user={user} element={<PendingDepositsScreen />} />}
      />

      {/* Approvals */}
      <Route
        path={BASE_PATH + "/approvals"}
        element={<ProtectedRoute user={user} element={<ApprovalsScreen />} />}
      />

      {/* Loan operations */}
      <Route
        path={BASE_PATH + "/loans"}
        element={<ProtectedRoute user={user} element={<LoansDashboardScreen />} />}
      />
      <Route
        path={BASE_PATH + "/loans/:loanId"}
        element={<ProtectedRoute user={user} element={<LoanDetailScreen />} />}
      />

      {/* Super admin screens */}
      <Route
        path={BASE_PATH + "/super/executive"}
        element={<ProtectedRoute user={user} element={<ExecutiveDashboardScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/loans"}
        element={<ProtectedRoute user={user} element={<LoanPortfolioScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/admins"}
        element={<ProtectedRoute user={user} element={<AdminManagementScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/audit"}
        element={<ProtectedRoute user={user} element={<AuditLogScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/config"}
        element={<ProtectedRoute user={user} element={<SystemConfigScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/groups"}
        element={<ProtectedRoute user={user} element={<AllGroupsScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/groups/:groupId"}
        element={<ProtectedRoute user={user} element={<GroupDetailScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/institutions"}
        element={<ProtectedRoute user={user} element={<InstitutionManagementScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/exceptions"}
        element={<ProtectedRoute user={user} element={<RiskExceptionScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/transactions"}
        element={<ProtectedRoute user={user} element={<TransactionOversightScreen />} />}
      />
      <Route
        path={BASE_PATH + "/super/fund"}
        element={<ProtectedRoute user={user} element={<KirimbaFundManagementScreen />} />}
      />

      {/* Legacy /home redirect */}
      <Route path={BASE_PATH + "/home"} element={<Navigate to={DASHBOARD_PATH} replace />} />

      {/* Root + wildcard */}
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
