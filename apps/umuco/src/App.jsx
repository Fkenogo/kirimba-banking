import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth } from "./services/firebase";
import { db } from "./services/firebase";
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
  const [institutionName, setInstitutionName] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null);
        setInstitutionId(null);
        setInstitutionName(null);
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
        setInstitutionName(null);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!institutionId) {
      setInstitutionName(null);
      return;
    }

    getDoc(doc(db, "institutions", institutionId))
      .then((snap) => {
        if (cancelled) return;
        setInstitutionName(snap.exists() ? snap.data().name || institutionId : institutionId);
      })
      .catch(() => {
        if (!cancelled) setInstitutionName(institutionId);
      });

    return () => {
      cancelled = true;
    };
  }, [institutionId]);

  if (isLoading) {
    return (
      <main className="min-h-screen bg-brand-500 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-3xl bg-white/20 flex items-center justify-center">
            <span className="text-white font-black text-3xl">K</span>
          </div>
          <div className="flex items-center gap-2 text-brand-100">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-sm font-medium">Loading…</span>
          </div>
        </div>
      </main>
    );
  }

  if (user && role !== "institution_user") {
    return (
      <main className="min-h-screen bg-brand-500 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-8 shadow-card-lg text-center">
          <div className="w-14 h-14 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Access Restricted</h1>
          <p className="mt-2 text-sm text-slate-500">
            This portal is available only to institution staff accounts.
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
      <Route path={LOGIN_PATH} element={user ? <Navigate to={HOME_PATH} replace /> : <LoginPage />} />
      <Route
        path={HOME_PATH}
        element={<ProtectedRoute user={user} element={<HomePage user={user} institutionId={institutionId} institutionName={institutionName} />} />}
      />
      <Route
        path={BASE_PATH + "/batches"}
        element={<ProtectedRoute user={user} element={<PendingBatchesScreen institutionId={institutionId} institutionName={institutionName} />} />}
      />
      <Route
        path={BASE_PATH + "/batch/:batchId"}
        element={<ProtectedRoute user={user} element={<BatchDetailScreen institutionName={institutionName} />} />}
      />
      <Route
        path={BASE_PATH + "/history"}
        element={<ProtectedRoute user={user} element={<BatchHistoryScreen institutionId={institutionId} institutionName={institutionName} />} />}
      />
      <Route
        path={BASE_PATH + "/exceptions"}
        element={<ProtectedRoute user={user} element={<FlaggedBatchesScreen institutionId={institutionId} institutionName={institutionName} />} />}
      />
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
