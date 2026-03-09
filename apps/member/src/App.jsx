import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./services/firebase";
import LoginPage from "./pages/LoginPage";
import MemberHomeScreen from "./features/Home/MemberHomeScreen";
import MemberDashboardScreen from "./features/Dashboard/MemberDashboardScreen";
import DepositRequestScreen from "./features/Deposits/DepositRequestScreen";
import TransactionHistoryScreen from "./features/Transactions/TransactionHistoryScreen";
import RequestLoanScreen from "./features/Loans/RequestLoanScreen";
import WithdrawalRequestScreen from "./features/Withdrawals/WithdrawalRequestScreen";
import MyQRCodeScreen from "./features/Profile/MyQRCodeScreen";
import InstitutionSelectionScreen from "./features/Profile/InstitutionSelectionScreen";
import SavingsDashboardScreen from "./features/Dashboard/SavingsDashboardScreen";
import JoinGroupScreen from "./features/Groups/JoinGroupScreen";
import GroupManageScreen from "./features/Groups/GroupManageScreen";
import CreateGroupScreen from "./features/Groups/CreateGroupScreen";
import GroupCodeScreen from "./features/Groups/GroupCodeScreen";
import GroupPendingRequestsScreen from "./features/Groups/GroupPendingRequestsScreen";
import GroupSplitScreen from "./features/Groups/GroupSplitScreen";
import MyGroupScreen from "./features/Groups/MyGroupScreen";

const BASE_PATH = "/app";

export default function App() {
  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [profileRole, setProfileRole] = useState(null);
  const [profileStatus, setProfileStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null);
        setProfileRole(null);
        setProfileStatus(null);
        setIsLoading(false);
        return;
      }

      try {
        let claimRole = null;
        try {
          const freshToken = await nextUser.getIdTokenResult(true);
          claimRole = freshToken?.claims?.role || null;
        } catch {
          const cachedToken = await nextUser.getIdTokenResult();
          claimRole = cachedToken?.claims?.role || null;
        }

        const profileSnap = await getDoc(doc(db, "users", nextUser.uid));
        const profile = profileSnap.exists() ? profileSnap.data() || {} : {};
        const firestoreRole = typeof profile.role === "string" ? profile.role : null;
        const firestoreStatus = typeof profile.status === "string" ? profile.status : null;

        setRole(claimRole || firestoreRole || null);
        setProfileRole(firestoreRole);
        setProfileStatus(firestoreStatus);
      } catch {
        setRole(null);
        setProfileRole(null);
        setProfileStatus(null);
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

  const hasAllowedRole = role === "member" || role === "leader";
  const hasAllowedProfileRole = profileRole === "member" || profileRole === "leader";
  const isActiveProfile = profileStatus === "active";
  const isPendingProfile = profileStatus === "pending_approval";
  const hasKnownAllowedRole = hasAllowedProfileRole || hasAllowedRole;
  const canAccessMemberApp = isActiveProfile && hasKnownAllowedRole;

  if (user && !canAccessMemberApp && isPendingProfile) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Account Pending</h1>
          <p className="mt-2 text-sm text-slate-600">
            Your member account is not yet approved for app access.
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

  if (user && !canAccessMemberApp) {
    return (
      <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
        <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center">
          <h1 className="text-xl font-semibold text-slate-900">Account Access Not Ready</h1>
          <p className="mt-2 text-sm text-slate-600">
            We could not confirm member access yet. Please sign out and sign in again.
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
      <Route
        path={`${BASE_PATH}/login`}
        element={user ? <Navigate to={`${BASE_PATH}/home`} replace /> : <LoginPage />}
      />
      <Route
        path={`${BASE_PATH}/home`}
        element={user ? <MemberHomeScreen user={user} role={role} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/dashboard`}
        element={user ? <MemberDashboardScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/deposit`}
        element={user ? <DepositRequestScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/transactions`}
        element={user ? <TransactionHistoryScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/withdraw`}
        element={user ? <WithdrawalRequestScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/loans/request`}
        element={user ? <RequestLoanScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/my-qr`}
        element={user ? <MyQRCodeScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/savings`}
        element={user ? <SavingsDashboardScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/join-group`}
        element={user ? <JoinGroupScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/institution`}
        element={user ? <InstitutionSelectionScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/group/manage`}
        element={user ? <GroupManageScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/group/code`}
        element={user ? <GroupCodeScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/group/pending-requests`}
        element={user ? <GroupPendingRequestsScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/group/split`}
        element={user ? <GroupSplitScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/group/create`}
        element={user ? <CreateGroupScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route
        path={`${BASE_PATH}/group/my`}
        element={user ? <MyGroupScreen user={user} /> : <Navigate to={`${BASE_PATH}/login`} replace />}
      />
      <Route path={BASE_PATH} element={<Navigate to={`${BASE_PATH}/login`} replace />} />
      <Route path="*" element={<Navigate to={`${BASE_PATH}/login`} replace />} />
    </Routes>
  );
}
