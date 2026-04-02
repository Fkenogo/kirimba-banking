import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { signOutAccount } from "../../services/auth";
import { PageShell, Card, SectionLabel } from "../../components/ui";

function fmt(n) { return Number(n || 0).toLocaleString(); }

function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export default function ProfileScreen({ user }) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);

  // Institution context
  const [institutionName, setInstitutionName] = useState(null);
  const [institutionLoading, setInstitutionLoading] = useState(true);

  // Commission summary
  const [todayCommission, setTodayCommission] = useState(null);
  const [pendingCommission, setPendingCommission] = useState(null);
  const [commissionLoading, setCommissionLoading] = useState(true);

  const agentName = user?.displayName || user?.email?.split("@")[0] || "Agent";
  const agentPhone = user?.email || "";
  const agentId = user?.uid || "";
  const lastSignIn = user?.metadata?.lastSignInTime
    ? new Date(user.metadata.lastSignInTime).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : null;

  useEffect(() => {
    if (!user?.uid) {
      setInstitutionLoading(false);
      setCommissionLoading(false);
      return;
    }

    async function loadInstitution() {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const institutionId = userSnap.data()?.institutionId || null;
        if (institutionId) {
          const instSnap = await getDoc(doc(db, "institutions", institutionId));
          setInstitutionName(
            instSnap.exists() ? (instSnap.data().name || institutionId) : institutionId
          );
        } else {
          setInstitutionName(null);
        }
      } catch {
        setInstitutionName(null);
      } finally {
        setInstitutionLoading(false);
      }
    }

    async function loadCommission() {
      try {
        const snap = await getDocs(
          query(
            collection(db, "agentLedgers"),
            where("agentId", "==", user.uid),
            where("type", "==", "commission")
          )
        );
        const entries = snap.docs.map((d) => d.data());
        const todayMs = startOfTodayMs();

        const today = entries
          .filter((e) => (e.createdAt?.toMillis?.() ?? 0) >= todayMs)
          .reduce((s, e) => s + Number(e.amount || 0), 0);

        const pending = entries
          .filter((e) => e.status === "accrued")
          .reduce((s, e) => s + Number(e.amount || 0), 0);

        setTodayCommission(today);
        setPendingCommission(pending);
      } catch {
        setTodayCommission(null);
        setPendingCommission(null);
      } finally {
        setCommissionLoading(false);
      }
    }

    loadInstitution();
    loadCommission();
  }, [user?.uid]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOutAccount();
    } catch {
      setIsSigningOut(false);
    }
  };

  return (
    <PageShell title="Profile" user={user}>

      {/* ── Agent Identity Card ── */}
      <Card>
        <div className="px-5 py-6">
          {/* Avatar + Primary Info */}
          <div className="flex items-center gap-4 mb-4">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-600 flex items-center justify-center shrink-0 shadow-lg">
              <span className="text-white font-bold text-3xl">
                {agentName.charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xl font-bold text-slate-900 truncate">{agentName}</p>
              <p className="text-sm text-slate-500 mt-1">{agentPhone}</p>
              <div className="flex items-center gap-2 mt-2">
                <span className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 border border-brand-100 text-xs font-bold px-2.5 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-500 inline-block" />
                  Agent
                </span>
              </div>
            </div>
          </div>

          {/* Account Details */}
          <div className="bg-slate-50 rounded-2xl px-4 py-3 space-y-2">
            <InfoRow label="Agent ID" value={agentId.slice(0, 12) + "…"} mono />
            {lastSignIn && <InfoRow label="Last sign in" value={lastSignIn} />}
            <InfoRow
              label="Institution"
              value={
                institutionLoading
                  ? "Loading…"
                  : institutionName || "No linked institution"
              }
            />
          </div>
        </div>
      </Card>

      {/* ── Commission Summary ── */}
      <div className="space-y-2">
        <SectionLabel>Commission</SectionLabel>
        <Card>
          <div className="px-5 py-4">
            {commissionLoading ? (
              <p className="text-xs text-slate-400">Loading commission data…</p>
            ) : todayCommission === null && pendingCommission === null ? (
              <p className="text-xs text-slate-400">Commission data is not available right now.</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Today</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(todayCommission)}</p>
                  <p className="text-[11px] text-brand-500 mt-0.5">BIF earned today</p>
                </div>
                <div>
                  <p className="text-[11px] text-slate-400 uppercase tracking-wide mb-1">Pending payout</p>
                  <p className="text-xl font-bold text-slate-900">{fmt(pendingCommission)}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">BIF accrued</p>
                </div>
              </div>
            )}
            {!commissionLoading && pendingCommission === 0 && (
              <p className="mt-3 text-xs text-slate-400">
                No pending commission. Settled entries are tracked in Settlements.
              </p>
            )}
          </div>
        </Card>
      </div>

      {/* ── Business Tools ── */}
      <div className="space-y-2">
        <SectionLabel>Business Tools</SectionLabel>
        <Card>
          <div className="divide-y divide-slate-50">
            <MenuButton
              icon={<NotificationIcon />}
              title="Notifications"
              subtitle="Review agent alerts and settlement updates"
              onClick={() => navigate("/agent/notifications")}
            />
            <MenuButton
              icon={<DashIcon />}
              title="Business Dashboard"
              subtitle="Full daily performance and commission breakdown"
              onClick={() => navigate("/agent/dashboard")}
            />
            <MenuButton
              icon={<SettleIcon />}
              title="Settlements"
              subtitle="Request and track commission payouts"
              onClick={() => navigate("/agent/settlements")}
            />
            <MenuButton
              icon={<CloseDayIcon />}
              title="Close Day"
              subtitle="Submit end-of-day cash reconciliation"
              badge="Required daily"
              badgeColor="gold"
              onClick={() => navigate("/agent/close-day")}
            />
          </div>
        </Card>
      </div>

      {/* ── Account Actions ── */}
      <div className="space-y-2">
        <SectionLabel>Session</SectionLabel>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="w-full py-3.5 rounded-2xl border-2 border-slate-200 text-sm font-bold text-slate-600 hover:border-red-200 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-50"
        >
          {isSigningOut ? "Signing out…" : "Sign Out"}
        </button>
      </div>

      {/* ── Footer ── */}
      <div className="text-center text-xs text-slate-400 pt-4 pb-2">
        <p>KIRIMBA Agent v1.0</p>
        <p className="mt-1">Need help? Contact your institution supervisor</p>
      </div>

    </PageShell>
  );
}

/* ── Sub-components ── */

function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-slate-500">{label}</span>
      <span className={`text-xs font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function MenuButton({ icon, title, subtitle, badge, badgeColor = "slate", onClick }) {
  const badgeColors = {
    gold: "bg-gold-100 text-gold-700 border-gold-200",
    brand: "bg-brand-100 text-brand-700 border-brand-200",
    slate: "bg-slate-100 text-slate-600 border-slate-200",
  };

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-5 py-4 flex items-center gap-3 text-left hover:bg-slate-50 transition-colors active:bg-slate-100"
    >
      <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0 text-brand-500">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-sm font-bold text-slate-900">{title}</p>
          {badge && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border uppercase tracking-wide ${badgeColors[badgeColor]}`}>
              {badge}
            </span>
          )}
        </div>
        <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      </div>
      <svg className="w-5 h-5 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
    </button>
  );
}

/* ── Icons ── */

function DashIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

function SettleIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function CloseDayIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
    </svg>
  );
}

function NotificationIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
    </svg>
  );
}
