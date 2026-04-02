import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import BottomNav from "../components/BottomNav";
import { SectionLabel } from "../components/ui";
import { db } from "../services/firebase";
import { getPendingCount, onPendingCountChange } from "../services/depositSyncService";

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function todayLabel() {
  return new Date().toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

export default function HomePage({ user }) {
  const navigate = useNavigate();
  const [pendingSync, setPendingSync] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState(0);

  // Live offline-pending count badge
  useEffect(() => {
    getPendingCount().then(setPendingSync);
    return onPendingCountChange(setPendingSync);
  }, []);

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "notifications"), where("recipientId", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const unread = snap.docs.filter((docSnap) => docSnap.data()?.status !== "read").length;
        setUnreadNotifications(unread);
      },
      () => setUnreadNotifications(0)
    );
    return unsub;
  }, [user?.uid]);

  const agentName = user?.displayName || user?.email?.split("@")[0] || "Agent";

  return (
    <div className="flex flex-col min-h-screen bg-brand-50">

      {/* ── Teal hero header ── */}
      <header className="bg-brand-500 px-5 pt-12 pb-8 safe-top">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-brand-100 text-sm font-medium">{greeting()},</p>
              <h1 className="text-white text-xl font-bold mt-0.5 truncate max-w-[220px]">{agentName}</h1>
              <p className="text-brand-200 text-xs mt-0.5">{todayLabel()}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate("/agent/notifications")}
                className="relative w-12 h-12 rounded-2xl bg-white/15 border border-white/10 flex items-center justify-center shrink-0"
                aria-label="Open notifications"
              >
                <BellIcon />
                {unreadNotifications > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                    {unreadNotifications > 9 ? "9+" : unreadNotifications}
                  </span>
                ) : null}
              </button>
              <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                <span className="text-white font-bold text-lg">
                  {agentName.charAt(0).toUpperCase()}
                </span>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <main className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-lg mx-auto px-4 py-5 space-y-5">

          {/* Today Summary - compact stats */}
          <div className="space-y-2">
            <SectionLabel>Today</SectionLabel>
            <div className="grid grid-cols-2 gap-3">
              <SummaryCard
                label="Pending Sync"
                value={pendingSync}
                sublabel={pendingSync === 1 ? "deposit" : "deposits"}
                accent={pendingSync > 0 ? "gold" : "slate"}
              />
              <SummaryCard
                label="Notifications"
                value={unreadNotifications}
                sublabel={unreadNotifications === 1 ? "unread update" : "unread updates"}
                accent={unreadNotifications > 0 ? "brand" : "slate"}
                onClick={() => navigate("/agent/notifications")}
              />
            </div>
          </div>

          {/* Primary Action - Scan Member */}
          <div className="space-y-2">
            <SectionLabel>Quick Actions</SectionLabel>
            <PrimaryActionCard
              title="Scan Member"
              subtitle="Start any transaction by scanning member QR"
              icon={<QrIcon />}
              onClick={() => navigate("/agent/scan")}
            />
          </div>

          {/* Secondary Quick Actions */}
          <div className="grid grid-cols-2 gap-3">
            <SecondaryActionCard
              title="Today's Batches"
              subtitle="Review & submit"
              icon={<BatchIcon />}
              onClick={() => navigate("/agent/activity")}
              badge={pendingSync > 0 ? pendingSync : null}
            />
            <SecondaryActionCard
              title="View Activity"
              subtitle="Transactions and batches"
              icon={<ActivityIcon />}
              onClick={() => navigate("/agent/activity")}
            />
          </div>

          {/* Alerts / Tasks - only show when relevant */}
          {pendingSync > 0 && (
            <div className="space-y-2">
              <SectionLabel>Tasks</SectionLabel>
              <AlertCard
                title="Deposits pending sync"
                message={`${pendingSync} deposit${pendingSync !== 1 ? 's' : ''} waiting to be submitted`}
                action="Review now"
                onClick={() => navigate("/agent/activity")}
              />
            </div>
          )}

        </div>
      </main>

      <BottomNav />
    </div>
  );
}

/* ── Sub-components ── */


function SummaryCard({ label, value, sublabel, accent = "slate", onClick }) {
  const bgClass = accent === "gold" ? "bg-gold-50 border-gold-200" : "bg-white border-slate-100";
  const valueClass = accent === "gold" ? "text-gold-600" : "text-slate-700";
  const labelClass = accent === "gold" ? "text-gold-700" : "text-slate-500";

  const content = (
    <>
      <p className={`text-2xl font-bold ${valueClass}`}>{value}</p>
      <p className={`text-xs font-semibold ${labelClass} mt-0.5`}>{label}</p>
      <p className="text-[10px] text-slate-400 mt-0.5">{sublabel}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${bgClass} border rounded-2xl px-4 py-3 text-center active:scale-[0.98] transition-transform`}
      >
        {content}
      </button>
    );
  }

  return (
    <div className={`${bgClass} border rounded-2xl px-4 py-3 text-center`}>
      {content}
    </div>
  );
}

function PrimaryActionCard({ title, subtitle, icon, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full bg-brand-500 text-white rounded-2xl px-5 py-6 text-left shadow-lg active:scale-[0.98] transition-transform"
    >
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
          <span className="text-white scale-125">{icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-lg font-bold leading-tight">{title}</p>
          <p className="text-brand-100 text-sm mt-1 leading-snug">{subtitle}</p>
        </div>
        <div className="text-white/60">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </button>
  );
}

function SecondaryActionCard({ title, subtitle, icon, onClick, badge = null }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="relative w-full bg-white text-slate-800 border border-slate-100 rounded-2xl px-4 py-4 text-left shadow-card active:scale-[0.98] transition-transform"
    >
      <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center mb-3">
        <span className="text-brand-500">{icon}</span>
      </div>
      <p className="text-sm font-bold leading-tight">{title}</p>
      <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>
      {badge !== null && (
        <span className="absolute top-3 right-3 min-w-[20px] h-5 px-1.5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
          {badge}
        </span>
      )}
    </button>
  );
}

function AlertCard({ title, message, action, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full bg-gold-50 border border-gold-200 rounded-2xl px-4 py-3 text-left active:scale-[0.98] transition-transform"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-gold-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-gold-500" />
            </span>
            <p className="text-sm font-bold text-gold-900">{title}</p>
          </div>
          <p className="text-xs text-gold-700 leading-snug">{message}</p>
        </div>
        <span className="text-xs font-semibold text-gold-600 whitespace-nowrap">{action} →</span>
      </div>
    </button>
  );
}

/* ── Icons ── */

function QrIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 7V4h3M17 4h3v3M4 17v3h3M17 20h3v-3M9 9h1v1H9zM14 9h1v1h-1zM9 14h1v1H9z" />
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="3" width="6" height="6" rx="1" />
      <rect x="3" y="15" width="6" height="6" rx="1" />
    </svg>
  );
}

function BatchIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
    </svg>
  );
}

function ActivityIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
    </svg>
  );
}

function BellIcon() {
  return (
    <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2a2 2 0 01-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
    </svg>
  );
}
