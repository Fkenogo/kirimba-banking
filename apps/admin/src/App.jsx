import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebase";
import LoginPage from "./pages/LoginPage";
import AdminDashboardScreen from "./features/Admin/AdminDashboardScreen";
import CreateAgentScreen from "./features/Admin/CreateAgentScreen";
import AgentListScreen from "./features/Admin/AgentListScreen";
import AssignAgentScreen from "./features/Admin/AssignAgentScreen";

const BASE_PATH = "/admin";
const LOGIN_PATH = BASE_PATH + "/login";
const DASHBOARD_PATH = BASE_PATH + "/dashboard";

function ProtectedRoute({ user, element }) {
  return user ? element : <Navigate to={LOGIN_PATH} replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setIsLoading(false);
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
        element={<ProtectedRoute user={user} element={<AdminDashboardScreen user={user} />} />}
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
        path={BASE_PATH + "/agents/assign"}
        element={<ProtectedRoute user={user} element={<AssignAgentScreen />} />}
      />

      {/* Legacy /home redirect */}
      <Route path={BASE_PATH + "/home"} element={<Navigate to={DASHBOARD_PATH} replace />} />

      {/* Root + wildcard */}
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
