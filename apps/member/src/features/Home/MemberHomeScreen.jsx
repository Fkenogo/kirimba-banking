import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { db } from "../../services/firebase";
import { resolveCurrentGroupId } from "../Groups/leaderGroupAccess";
import TopHeader from "../../components/TopHeader";
import BottomNav from "../../components/BottomNav";

const BASE = "/app";

function formatBIF(amount) {
  return Number(amount || 0).toLocaleString("en-US");
}

// ─── Quick action buttons (reduced to 3 priority actions) ────────────────────
const QUICK_ACTIONS = [
  {
    label: "Deposit",
    path: `${BASE}/deposit`,
    bg: "bg-brand-500",
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
      </svg>
    ),
  },
  {
    label: "Withdraw",
    path: `${BASE}/withdraw`,
    bg: "bg-gold-500",
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
      </svg>
    ),
  },
  {
    label: "Request Loan",
    path: `${BASE}/loans/request`,
    bg: "bg-brand-700",
    icon: (
      <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
];

// ─── Main component ───────────────────────────────────────────────────────────
export default function MemberHomeScreen({ user, role, notifCount = 0 }) {
  const [institutionId, setInstitutionId] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [groupId, setGroupId] = useState("");
  const [userName, setUserName] = useState("");
  const [wallet, setWallet] = useState(null);
  const [loadingWallet, setLoadingWallet] = useState(true);
  const isLeader = role === "leader";

  useEffect(() => {
    if (!user?.uid) return;
    let unsubWallet;

    async function loadProfile() {
      try {
        const profileSnap = await getDoc(doc(db, "users", user.uid));
        if (profileSnap.exists()) {
          const data = profileSnap.data();
          setUserName(data.fullName || "");
          const rawId = String(data.institutionId || "");
          setInstitutionId(rawId);
          if (rawId) {
            const instSnap = await getDoc(doc(db, "institutions", rawId));
            if (instSnap.exists()) setInstitutionName(instSnap.data().name || rawId);
            else setInstitutionName(rawId);
          }
        }
      } catch {
        setInstitutionId("");
      }

      try {
        const resolvedGroupId = await resolveCurrentGroupId(db, user.uid);
        setGroupId(String(resolvedGroupId || ""));
      } catch {
        setGroupId("");
      }

      // Real-time wallet subscription
      try {
        unsubWallet = onSnapshot(
          doc(db, "wallets", user.uid),
          (snap) => {
            setWallet(snap.exists() ? snap.data() : null);
            setLoadingWallet(false);
          },
          () => {
            setWallet(null);
            setLoadingWallet(false);
          }
        );
      } catch {
        setWallet(null);
        setLoadingWallet(false);
      }
    }
    loadProfile();

    return () => unsubWallet?.();
  }, [user?.uid]);

  const availableBalance = Number(wallet?.availableBalance || 0);
  const balanceLocked = Number(wallet?.balanceLocked || 0);
  const balanceConfirmed = Number(wallet?.balanceConfirmed || 0);
  const creditLimit = Math.max(0, balanceConfirmed * 1.5 - balanceLocked);

  return (
    <div className="min-h-screen bg-brand-50 flex flex-col">
      <TopHeader
        title="Kirimba"
        userName={userName}
        notifCount={notifCount}
        showNotif
        showProfile
      />

      <main className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-lg mx-auto px-4 pt-4 space-y-4">

          {/* ── Hero status banner ── */}
          <div className="bg-brand-500 rounded-2xl px-5 py-5 text-white shadow-card-lg relative overflow-hidden">
            {/* Decorative circles */}
            <div className="absolute -top-6 -right-6 w-24 h-24 bg-brand-400 rounded-full opacity-40" />
            <div className="absolute -bottom-8 -right-2 w-16 h-16 bg-gold-500 rounded-full opacity-30" />
            <p className="text-xs font-semibold uppercase tracking-widest text-brand-100 mb-1">Account Status</p>
            <div className="flex items-center gap-2 mb-3">
              <div className={`w-2 h-2 rounded-full ${groupId ? "bg-gold-400" : "bg-white opacity-50"}`} />
              <p className="text-sm font-medium">
                {groupId ? "Connected to a group" : "Not in a group yet"}
              </p>
            </div>
            <Link
              to={`${BASE}/institution`}
              className="inline-flex items-center gap-2 bg-white bg-opacity-20 hover:bg-opacity-30 transition-colors rounded-xl px-3 py-2 text-xs font-semibold"
            >
              <span>🏛</span>
              {institutionId ? `Institution: ${institutionName || institutionId}` : "Select Institution →"}
            </Link>
          </div>

          {/* ── Account Summary ── */}
          {!loadingWallet && (
            <div className="bg-white rounded-2xl border border-brand-100 px-5 py-4 shadow-card">
              <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Your Account</p>
              <div className="space-y-3">
                <div className="flex justify-between items-baseline">
                  <span className="text-sm text-slate-500">Available Balance</span>
                  <span className="text-xl font-extrabold text-brand-600">{formatBIF(availableBalance)} <span className="text-sm font-normal text-slate-400">BIF</span></span>
                </div>
                <div className="h-px bg-slate-100" />
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs text-slate-400">Locked</p>
                    <p className="text-sm font-bold text-red-500">{formatBIF(balanceLocked)} BIF</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-slate-400">Credit Limit</p>
                    <p className="text-sm font-bold text-brand-600">{formatBIF(creditLimit)} BIF</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Quick actions grid (3 actions) ── */}
          <section>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3 px-1">
              Quick Actions
            </p>
            <div className="grid grid-cols-3 gap-3">
              {QUICK_ACTIONS.map(({ label, path, bg, icon }) => (
                <Link
                  key={path}
                  to={path}
                  className="flex flex-col items-center gap-2"
                >
                  <div className={`w-16 h-16 ${bg} rounded-2xl flex items-center justify-center shadow-card active:scale-95 transition-transform`}>
                    {icon}
                  </div>
                  <span className="text-xs font-semibold text-slate-600 text-center leading-tight">
                    {label}
                  </span>
                </Link>
              ))}
            </div>
          </section>

          {/* ── Leader quick access (compact, if leader) ── */}
          {isLeader && (
            <Link
              to={`${BASE}/group/manage`}
              className="flex items-center gap-3 bg-gradient-to-r from-gold-50 to-gold-100 border-2 border-gold-200 rounded-2xl px-5 py-4 shadow-card hover:from-gold-100 hover:to-gold-150 active:scale-[0.98] transition-all"
            >
              <div className="w-11 h-11 bg-gold-400 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-extrabold text-gold-800 leading-tight">Leader Tools</p>
                <p className="text-xs text-gold-600 mt-0.5">Open Manage Group to review requests and member actions</p>
              </div>
              <svg className="w-5 h-5 text-gold-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

          {/* ── No group CTA (if not in group) ── */}
          {!groupId && (
            <Link
              to={`${BASE}/group/my`}
              className="flex items-center gap-3 bg-white border-2 border-dashed border-brand-300 rounded-2xl px-5 py-4 hover:bg-brand-50 active:scale-[0.98] transition-all"
            >
              <div className="w-11 h-11 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                <svg className="w-6 h-6 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 leading-tight">Join or Create a Group</p>
                <p className="text-xs text-slate-400 mt-0.5">Unlock group savings and loans</p>
              </div>
              <svg className="w-5 h-5 text-brand-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          )}

        </div>
      </main>

      <BottomNav />
    </div>
  );
}
