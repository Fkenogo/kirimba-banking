import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { auth } from "./services/firebase";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";
import PendingBatchesScreen from "./features/Batches/PendingBatchesScreen";
import BatchDetailScreen from "./features/Batches/BatchDetailScreen";
import BatchHistoryScreen from "./features/Batches/BatchHistoryScreen";
import FlaggedBatchesScreen from "./features/Batches/FlaggedBatchesScreen";

const BASE_PATH = "/umuco";
const LOGIN_PATH = BASE_PATH + "/login";
const HOME_PATH = BASE_PATH + "/home";

function ProtectedRoute({ user, element }) {
  return user ? element : <Navigate to={LOGIN_PATH} replace />;
}

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [institutionId, setInstitutionId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null);
        setInstitutionId(null);
        setIsLoading(false);
        return;
      }

      try {
        const token = await nextUser.getIdTokenResult();
        setRole(token.claims?.role || null);
        setInstitutionId(token.claims?.institutionId || null);
      } catch {
        setRole(null);
        setInstitutionId(null);
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

  if (user && role !== "institution_user") {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Access Restricted</h1>
          <p className="mt-2 text-sm text-slate-600">
            This app is available only to institution staff accounts.
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
        element={<ProtectedRoute user={user} element={<HomePage user={user} institutionId={institutionId} />} />}
      />
      <Route
        path={BASE_PATH + "/batches"}
        element={<ProtectedRoute user={user} element={<PendingBatchesScreen institutionId={institutionId} />} />}
      />
      <Route
        path={BASE_PATH + "/batch/:batchId"}
        element={<ProtectedRoute user={user} element={<BatchDetailScreen />} />}
      />
      <Route
        path={BASE_PATH + "/history"}
        element={<ProtectedRoute user={user} element={<BatchHistoryScreen institutionId={institutionId} />} />}
      />
      <Route
        path={BASE_PATH + "/exceptions"}
        element={<ProtectedRoute user={user} element={<FlaggedBatchesScreen institutionId={institutionId} />} />}
      />
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
