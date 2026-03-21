import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { signOutAccount } from "../../services/auth";
import { db } from "../../services/firebase";
import { resolveCurrentGroupId } from "../Groups/leaderGroupAccess";

const BASE_PATH = "/app";

const MEMBER_MENU_ITEMS = [
  { label: "Savings Dashboard", path: `${BASE_PATH}/dashboard`, icon: "💰" },
  { label: "Deposit", path: `${BASE_PATH}/deposit`, icon: "⬇️" },
  { label: "Withdraw", path: `${BASE_PATH}/withdraw`, icon: "⬆️" },
  { label: "My Loans", path: `${BASE_PATH}/loans/my`, icon: "🏦" },
  { label: "Request Loan", path: `${BASE_PATH}/loans/request`, icon: "💳" },
  { label: "Transactions", path: `${BASE_PATH}/transactions`, icon: "📄" },
  { label: "My QR Code", path: `${BASE_PATH}/my-qr`, icon: "🔲" },
  { label: "Join with Group Code", path: `${BASE_PATH}/join-group`, icon: "👥" },
  { label: "Request New Group", path: `${BASE_PATH}/group/create`, icon: "🧩" },
];

const LEADER_MENU_ITEMS = [
  { label: "View Group Code", path: `${BASE_PATH}/group/code`, icon: "🔑" },
  { label: "Manage Group", path: `${BASE_PATH}/group/manage`, icon: "⚙️" },
  {
    label: "View Pending Join Requests",
    path: `${BASE_PATH}/group/pending-requests`,
    icon: "📥",
  },
  { label: "Split Group", path: `${BASE_PATH}/group/split`, icon: "🧩" },
];

export default function MemberHomeScreen({ user, role }) {
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [error, setError] = useState("");
  const [institutionId, setInstitutionId] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [groupId, setGroupId] = useState("");
  const isLeader = role === "leader";

  useEffect(() => {
    if (!user?.uid) return;
    async function loadProfile() {
      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (profileSnap.exists()) {
          const rawId = String(profileSnap.data().institutionId || "");
          setInstitutionId(rawId);
          if (rawId) {
            // Resolve the institution name from the institutions collection
            const instSnap = await getDoc(doc(db, "institutions", rawId));
            if (instSnap.exists()) {
              setInstitutionName(instSnap.data().name || rawId);
            } else {
              setInstitutionName(rawId);
            }
          }
        }
      } catch {
        setInstitutionId("");
        setInstitutionName("");
      }

      try {
        const resolvedGroupId = await resolveCurrentGroupId(db, user.uid);
        setGroupId(String(resolvedGroupId || ""));
      } catch {
        setGroupId("");
      }
    }
    loadProfile();
  }, [user?.uid]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setError("");
    try {
      await signOutAccount();
    } catch (err) {
      setError(err.message || "Failed to sign out.");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <div className="max-w-lg mx-auto w-full px-4 pt-8 pb-12 flex flex-col flex-1">

        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">{isLeader ? "Leader Dashboard" : "Member Dashboard"}</h1>
          {isLeader && (
            <p className="text-xs text-blue-600 mt-1">Leader tools are enabled in your member app.</p>
          )}
          <p className="text-xs text-slate-400 mt-1 truncate">{user.email || user.uid}</p>
        </div>

        <section className="mb-4 grid grid-cols-1 gap-3">
          <article
            className={`rounded-2xl border px-4 py-3 ${
              institutionId ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">Institution</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">
              {institutionId ? `Selected: ${institutionName || institutionId}` : "Not selected"}
            </p>
          </article>
          <article
            className={`rounded-2xl border px-4 py-3 ${
              groupId ? "border-blue-200 bg-blue-50" : "border-slate-200 bg-white"
            }`}
          >
            <p className="text-[11px] uppercase tracking-wide text-slate-500">My Group</p>
            <p className="text-sm font-semibold text-slate-900 mt-0.5">
              {groupId ? "Connected to a group" : "Not in a group yet"}
            </p>
          </article>
        </section>

        {/* Menu */}
        <nav className="flex flex-col gap-3 flex-1">
          <Link
            to={`${BASE_PATH}/institution`}
            className={`flex items-center gap-4 rounded-2xl border px-5 py-4 shadow-sm active:scale-95 transition-transform ${
              institutionId
                ? "bg-emerald-50 border-emerald-200"
                : "bg-amber-50 border-amber-200"
            }`}
          >
            <span className="text-2xl leading-none">🏛️</span>
            <span className="text-base font-medium text-slate-800">
              {institutionId ? "Institution Selected" : "Select Institution"}
            </span>
            <span className="ml-auto text-slate-300 text-lg">›</span>
          </Link>

          {MEMBER_MENU_ITEMS.map(({ label, path, icon }) => (
            <Link
              key={path}
              to={path}
              className="flex items-center gap-4 rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm active:scale-95 transition-transform"
            >
              <span className="text-2xl leading-none">{icon}</span>
              <span className="text-base font-medium text-slate-800">{label}</span>
              <span className="ml-auto text-slate-300 text-lg">›</span>
            </Link>
          ))}

          {groupId && (
            <Link
              to={`${BASE_PATH}/group/my`}
              className="flex items-center gap-4 rounded-2xl bg-white border border-slate-200 px-5 py-4 shadow-sm active:scale-95 transition-transform"
            >
              <span className="text-2xl leading-none">👨‍👩‍👧‍👦</span>
              <span className="text-base font-medium text-slate-800">My Group</span>
              <span className="ml-auto text-slate-300 text-lg">›</span>
            </Link>
          )}
        </nav>

        {isLeader && (
          <section className="mt-6">
            <h2 className="text-sm font-semibold text-slate-800 mb-3">Leader Actions</h2>
            <div className="flex flex-col gap-3">
              {LEADER_MENU_ITEMS.map(({ label, path, icon }) => (
                <Link
                  key={path}
                  to={path}
                  className="flex items-center gap-4 rounded-2xl bg-blue-50 border border-blue-200 px-5 py-4 shadow-sm active:scale-95 transition-transform"
                >
                  <span className="text-2xl leading-none">{icon}</span>
                  <span className="text-base font-medium text-blue-900">{label}</span>
                  <span className="ml-auto text-blue-300 text-lg">›</span>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Sign out */}
        <div className="mt-10">
          {error && <p className="mb-3 text-sm text-red-600 text-center">{error}</p>}
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-full rounded-2xl bg-slate-900 px-4 py-4 text-sm font-medium text-white disabled:opacity-60 active:scale-95 transition-transform"
          >
            {isSigningOut ? "Signing out..." : "Sign out"}
          </button>
        </div>

      </div>
    </main>
  );
}
