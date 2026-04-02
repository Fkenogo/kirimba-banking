import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./services/firebase";
import { startSyncService, stopSyncService } from "./services/depositSyncService";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import ScanHubScreen from "./features/Scan/ScanHubScreen";
import ScanDepositScreen from "./features/Deposits/ScanDepositScreen";
import AgentDailySummaryScreen from "./features/Deposits/AgentDailySummaryScreen";
import BatchDetailScreen from "./features/Deposits/BatchDetailScreen";
import AgentBusinessDashboardScreen from "./features/Dashboard/AgentBusinessDashboardScreen";
import CloseDayScreen from "./features/Reconciliation/CloseDayScreen";
import ReconciliationHistoryScreen from "./features/Reconciliation/ReconciliationHistoryScreen";
import LoanDisbursementScreen from "./features/Loans/LoanDisbursementScreen";
import LoanRepaymentScreen from "./features/Loans/LoanRepaymentScreen";
import AgentWithdrawalScreen from "./features/Withdrawals/AgentWithdrawalScreen";
import SettlementScreen from "./features/Settlements/SettlementScreen";
import ProfileScreen from "./features/Profile/ProfileScreen";
import AgentNotificationsScreen from "./features/Notifications/AgentNotificationsScreen";

const BASE_PATH = "/agent";
const LOGIN_PATH = BASE_PATH + "/login";
const HOME_PATH = BASE_PATH + "/home";
const SCAN_PATH = BASE_PATH + "/scan";
const SCAN_DEPOSIT_PATH = BASE_PATH + "/scan-deposit";
const ACTIVITY_PATH = BASE_PATH + "/activity";
const ACTIVITY_BATCH_DETAIL_PATH = BASE_PATH + "/activity/batches/:batchId";
const DEPOSITS_TODAY_PATH = BASE_PATH + "/deposits-today"; // Legacy, redirects to activity
const PROFILE_PATH = BASE_PATH + "/profile";
const DASHBOARD_PATH = BASE_PATH + "/dashboard";
const CLOSE_DAY_PATH = BASE_PATH + "/close-day";
const RECONCILIATION_HISTORY_PATH = BASE_PATH + "/close-day/history";
const NOTIFICATIONS_PATH = BASE_PATH + "/notifications";

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
        const token = await nextUser.getIdTokenResult();
        setRole(token.claims?.role || null);
      } catch {
        setRole(null);
      } finally {
        setIsLoading(false);
      }
      if (nextUser) {
        startSyncService();
      } else {
        stopSyncService();
      }
    });

    return () => {
      unsubscribe();
      stopSyncService();
    };
  }, []);

  if (isLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6">
        <p className="text-sm text-slate-600">Loading authentication...</p>
      </main>
    );
  }

  if (user && role !== "agent") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Access Restricted</h1>
          <p className="mt-2 text-sm text-slate-600">
            This app is available only to agent accounts.
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
      <Route path={LOGIN_PATH} element={user ? <Navigate to={HOME_PATH} replace /> : <LoginPage />} />
      <Route
        path={HOME_PATH}
        element={user ? <HomePage user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />

      {/* Scan Hub & Transaction Flows */}
      <Route
        path={SCAN_PATH}
        element={user ? <ScanHubScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={SCAN_DEPOSIT_PATH}
        element={user ? <ScanDepositScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={BASE_PATH + "/withdrawals"}
        element={user ? <AgentWithdrawalScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={BASE_PATH + "/loans/disburse"}
        element={user ? <LoanDisbursementScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={BASE_PATH + "/loans/repay"}
        element={user ? <LoanRepaymentScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />

      {/* Activity */}
      <Route
        path={ACTIVITY_PATH}
        element={user ? <AgentDailySummaryScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={ACTIVITY_BATCH_DETAIL_PATH}
        element={user ? <BatchDetailScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      {/* Legacy redirect: deposits-today → activity */}
      <Route
        path={DEPOSITS_TODAY_PATH}
        element={user ? <Navigate to={ACTIVITY_PATH} replace /> : <Navigate to={LOGIN_PATH} replace />}
      />

      {/* Profile & Business */}
      <Route
        path={PROFILE_PATH}
        element={user ? <ProfileScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={NOTIFICATIONS_PATH}
        element={user ? <AgentNotificationsScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={DASHBOARD_PATH}
        element={user ? <AgentBusinessDashboardScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={CLOSE_DAY_PATH}
        element={user ? <CloseDayScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={RECONCILIATION_HISTORY_PATH}
        element={user ? <ReconciliationHistoryScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={BASE_PATH + "/settlements"}
        element={user ? <SettlementScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />

      {/* Fallbacks */}
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
