import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./services/firebase";
import { startSyncService, stopSyncService } from "./services/depositSyncService";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import ScanDepositScreen from "./features/Deposits/ScanDepositScreen";
import AgentDailySummaryScreen from "./features/Deposits/AgentDailySummaryScreen";
import AgentBusinessDashboardScreen from "./features/Dashboard/AgentBusinessDashboardScreen";
import CloseDayScreen from "./features/Reconciliation/CloseDayScreen";

const BASE_PATH = "/agent";
const LOGIN_PATH = BASE_PATH + "/login";
const HOME_PATH = BASE_PATH + "/home";
const SCAN_DEPOSIT_PATH = BASE_PATH + "/scan-deposit";
const DEPOSITS_TODAY_PATH = BASE_PATH + "/deposits-today";
const DASHBOARD_PATH = BASE_PATH + "/dashboard";
const CLOSE_DAY_PATH = BASE_PATH + "/close-day";

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
      <Route
        path={SCAN_DEPOSIT_PATH}
        element={user ? <ScanDepositScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={DEPOSITS_TODAY_PATH}
        element={user ? <AgentDailySummaryScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={DASHBOARD_PATH}
        element={user ? <AgentBusinessDashboardScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route
        path={CLOSE_DAY_PATH}
        element={user ? <CloseDayScreen user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
