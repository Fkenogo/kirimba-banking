import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "./services/firebase";
import HomePage from "./pages/HomePage";
import LoginPage from "./pages/LoginPage";

const BASE_PATH = "/admin";
const LOGIN_PATH = BASE_PATH + "/login";
const HOME_PATH = BASE_PATH + "/home";

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
      <Route path={LOGIN_PATH} element={user ? <Navigate to={HOME_PATH} replace /> : <LoginPage />} />
      <Route
        path={HOME_PATH}
        element={user ? <HomePage user={user} /> : <Navigate to={LOGIN_PATH} replace />}
      />
      <Route path={BASE_PATH} element={<Navigate to={LOGIN_PATH} replace />} />
      <Route path="*" element={<Navigate to={LOGIN_PATH} replace />} />
    </Routes>
  );
}
