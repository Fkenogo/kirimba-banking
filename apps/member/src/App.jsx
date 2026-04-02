import { Navigate, Route, Routes } from "react-router-dom";
import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "./services/firebase";
import { useNotifications } from "./hooks/useNotifications";

/* ─── Pages / screens ─── */
import LoginPage                   from "./pages/LoginPage";
import MemberHomeScreen            from "./features/Home/MemberHomeScreen";
import MemberDashboardScreen       from "./features/Dashboard/MemberDashboardScreen";
import SavingsDashboardScreen      from "./features/Dashboard/SavingsDashboardScreen";
import DepositRequestScreen        from "./features/Deposits/DepositRequestScreen";
import FindAgentScreen             from "./features/Deposits/FindAgentScreen";
import TransactionHistoryScreen    from "./features/Transactions/TransactionHistoryScreen";
import RequestLoanScreen           from "./features/Loans/RequestLoanScreen";
import MyLoansScreen               from "./features/Loans/MyLoansScreen";
import WithdrawalRequestScreen     from "./features/Withdrawals/WithdrawalRequestScreen";
import MyQRCodeScreen              from "./features/Profile/MyQRCodeScreen";
import InstitutionSelectionScreen  from "./features/Profile/InstitutionSelectionScreen";
import NotificationsScreen         from "./features/Notifications/NotificationsScreen";
import JoinGroupScreen             from "./features/Groups/JoinGroupScreen";
import CreateGroupScreen           from "./features/Groups/CreateGroupScreen";
import GroupManageScreen           from "./features/Groups/GroupManageScreen";
import GroupCodeScreen             from "./features/Groups/GroupCodeScreen";
import GroupPendingRequestsScreen  from "./features/Groups/GroupPendingRequestsScreen";
import GroupSplitScreen            from "./features/Groups/GroupSplitScreen";
import MyGroupScreen               from "./features/Groups/MyGroupScreen";
import LeaderDashboardScreen       from "./features/Leader/LeaderDashboardScreen";

const BASE_PATH = "/app";

/* ─── Auth-gated route helper ─── */
function Protected({ user, notifCount, element }) {
  if (!user) return <Navigate to={`${BASE_PATH}/login`} replace />;
  // Clone element and inject notifCount if it accepts that prop
  return element;
}

export default function App() {
  const [user,          setUser]          = useState(null);
  const [role,          setRole]          = useState(null);
  const [profileRole,   setProfileRole]   = useState(null);
  const [profileStatus, setProfileStatus] = useState(null);
  const [isLoading,     setIsLoading]     = useState(true);

  /* Live notification count — used to power the bell badge across all screens */
  const { unreadCount: notifCount } = useNotifications(user);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      if (!nextUser) {
        setRole(null); setProfileRole(null); setProfileStatus(null);
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
        const firestoreRole   = typeof profile.role   === "string" ? profile.role   : null;
        const firestoreStatus = typeof profile.status === "string" ? profile.status : null;

        setRole(claimRole || firestoreRole || null);
        setProfileRole(firestoreRole);
        setProfileStatus(firestoreStatus);
      } catch {
        setRole(null); setProfileRole(null); setProfileStatus(null);
      } finally {
        setIsLoading(false);
      }
    });

    return unsubscribe;
  }, []);

  /* ─── Loading spinner ─── */
  if (isLoading) {
    return (
      <main className="min-h-screen bg-brand-500 flex flex-col items-center justify-center gap-4">
        <div className="w-12 h-12 border-4 border-brand-300 border-t-white rounded-full animate-spin" />
        <p className="text-sm text-brand-100 font-medium">Loading Kirimba…</p>
      </main>
    );
  }

  const effectiveUser = user;
  const effectiveRole = role;
  const effectiveProfileRole = profileRole;
  const effectiveProfileStatus = profileStatus;

  const hasAllowedRole        = effectiveRole === "member"        || effectiveRole === "leader";
  const hasAllowedProfileRole = effectiveProfileRole === "member" || effectiveProfileRole === "leader";
  const isActiveProfile       = effectiveProfileStatus === "active";
  const isPendingProfile      = effectiveProfileStatus === "pending_approval";
  const canAccessMemberApp    = isActiveProfile && (hasAllowedProfileRole || hasAllowedRole);

  /* ─── Pending approval wall ─── */
  if (effectiveUser && !canAccessMemberApp && isPendingProfile) {
    return (
      <main className="min-h-screen bg-brand-500 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-7 text-center shadow-card-lg">
          <div className="w-16 h-16 bg-gold-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-gold-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Account Pending</h1>
          <p className="mt-2 text-sm text-slate-500">Your account is awaiting approval. You'll be notified once activated.</p>
          <button type="button" onClick={() => signOut(auth)}
            className="mt-6 w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-3.5 rounded-2xl text-sm transition-colors">
            Sign Out
          </button>
        </div>
      </main>
    );
  }

  /* ─── Access not ready wall ─── */
  if (effectiveUser && !canAccessMemberApp) {
    return (
      <main className="min-h-screen bg-brand-500 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-7 text-center shadow-card-lg">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-900">Access Not Ready</h1>
          <p className="mt-2 text-sm text-slate-500">We could not confirm your access. Please sign out and sign in again.</p>
          <button type="button" onClick={() => signOut(auth)}
            className="mt-6 w-full bg-brand-500 hover:bg-brand-600 text-white font-bold py-3.5 rounded-2xl text-sm transition-colors">
            Sign Out
          </button>
        </div>
      </main>
    );
  }

  /* ─── Helper: wrap every protected screen with notifCount prop ─── */
  function G(element) {
    if (!effectiveUser) return <Navigate to={`${BASE_PATH}/login`} replace />;
    // Inject notifCount into direct PageShell children by cloning with prop
    return element;
  }

  return (
    <Routes>
      {/* Auth */}
      <Route path={`${BASE_PATH}/login`}
        element={effectiveUser ? <Navigate to={`${BASE_PATH}/home`} replace /> : <LoginPage />} />

      {/* Home */}
      <Route path={`${BASE_PATH}/home`}
        element={G(<MemberHomeScreen user={effectiveUser} role={effectiveRole} notifCount={notifCount} />)} />

      {/* Savings / dashboard */}
      <Route path={`${BASE_PATH}/dashboard`}
        element={G(<MemberDashboardScreen user={effectiveUser} notifCount={notifCount} />)} />
      <Route path={`${BASE_PATH}/savings`}
        element={G(<SavingsDashboardScreen user={effectiveUser} notifCount={notifCount} />)} />

      {/* Transactions */}
      <Route path={`${BASE_PATH}/transactions`}
        element={G(<TransactionHistoryScreen user={effectiveUser} notifCount={notifCount} />)} />

      {/* Deposits */}
      <Route path={`${BASE_PATH}/deposit`}
        element={G(<DepositRequestScreen user={effectiveUser} notifCount={notifCount} />)} />
      <Route path={`${BASE_PATH}/find-agent`}
        element={G(<FindAgentScreen notifCount={notifCount} />)} />

      {/* Withdrawals */}
      <Route path={`${BASE_PATH}/withdraw`}
        element={G(<WithdrawalRequestScreen user={effectiveUser} notifCount={notifCount} />)} />

      {/* Loans */}
      <Route path={`${BASE_PATH}/loans/request`}
        element={G(<RequestLoanScreen user={effectiveUser} notifCount={notifCount} />)} />
      <Route path={`${BASE_PATH}/loans/my`}
        element={G(<MyLoansScreen user={effectiveUser} notifCount={notifCount} />)} />

      {/* Profile */}
      <Route path={`${BASE_PATH}/profile`}
        element={G(<MyQRCodeScreen user={effectiveUser} notifCount={notifCount} />)} />
      <Route path={`${BASE_PATH}/my-qr`}
        element={G(<MyQRCodeScreen user={effectiveUser} notifCount={notifCount} />)} />
      <Route path={`${BASE_PATH}/institution`}
        element={G(<InstitutionSelectionScreen user={effectiveUser} notifCount={notifCount} />)} />

      {/* Notifications */}
      <Route path={`${BASE_PATH}/notifications`}
        element={G(<NotificationsScreen user={effectiveUser} />)} />

      {/* Groups — member */}
      <Route path={`${BASE_PATH}/group/my`}
        element={G(<MyGroupScreen user={effectiveUser} notifCount={notifCount} />)} />
      <Route path={`${BASE_PATH}/join-group`}
        element={G(<JoinGroupScreen user={effectiveUser} />)} />
      <Route path={`${BASE_PATH}/group/create`}
        element={G(<CreateGroupScreen user={effectiveUser} />)} />

      {/* Groups — leader only */}
      <Route path={`${BASE_PATH}/group/manage`}
        element={G(<GroupManageScreen user={effectiveUser} />)} />
      <Route path={`${BASE_PATH}/group/code`}
        element={G(<GroupCodeScreen user={effectiveUser} />)} />
      <Route path={`${BASE_PATH}/group/pending-requests`}
        element={G(<GroupPendingRequestsScreen user={effectiveUser} />)} />
      <Route path={`${BASE_PATH}/group/split`}
        element={G(<GroupSplitScreen user={effectiveUser} />)} />

      {/* Leader dashboard */}
      <Route path={`${BASE_PATH}/leader`}
        element={G(<LeaderDashboardScreen user={effectiveUser} notifCount={notifCount} />)} />

      {/* Fallbacks */}
      <Route path={BASE_PATH}    element={<Navigate to={`${BASE_PATH}/login`} replace />} />
      <Route path="*"            element={<Navigate to={`${BASE_PATH}/login`} replace />} />
    </Routes>
  );
}
