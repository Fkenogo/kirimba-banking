import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebase";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

const BASE_PATH = "/app";

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
      <Route
        path={`${BASE_PATH}/login`}
        element={user ? <Navigate to={`${BASE_PATH}/home`} replace /> : <LoginPage />}
      />
      <Route
        path={`${BASE_PATH}/home`}
        element={user ? <HomePage user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route path={BASE_PATH} element={<Navigate to={`${BASE_PATH}/login`} replace />} />
      <Route path="*" element={<Navigate to={`${BASE_PATH}/login`} replace />} />
    </Routes>
  );
}
