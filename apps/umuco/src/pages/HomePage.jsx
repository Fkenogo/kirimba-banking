import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { signOutAccount } from "../services/auth";
import { db } from "../services/firebase";
import { PageShell, formatBIF } from "../components/ui";

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function tsToMs(ts) {
  if (!ts) return 0;
  if (ts._seconds) return ts._seconds * 1000;
  if (ts.toMillis) return ts.toMillis();
  return new Date(ts).getTime();
}

export default function HomePage({ user, institutionId, institutionName }) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut]     = useState(false);
  const [signOutError, setSignOutError]     = useState("");

  // Live stats
  const [pendingBatches, setPendingBatches] = useState(null);
  const [recentBatches, setRecentBatches]   = useState(null);

  // Subscribe to submitted batches
  useEffect(() => {
    if (!institutionId) return;
    const q = query(
      collection(db, "depositBatches"),
      where("institutionId", "==", institutionId),
      where("status", "==", "submitted")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setPendingBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[pending]", err.message)
    );
    return () => unsub();
  }, [institutionId]);

  // Subscribe to confirmed + flagged batches
  useEffect(() => {
    if (!institutionId) return;
    const q = query(
      collection(db, "depositBatches"),
      where("institutionId", "==", institutionId),
      where("status", "in", ["confirmed", "flagged"])
    );
    const unsub = onSnapshot(
      q,
      (snap) => setRecentBatches(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[recent]", err.message)
    );
    return () => unsub();
  }, [institutionId]);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    setSignOutError("");
    try {
      await signOutAccount();
    } catch (err) {
      setSignOutError(err.message || "Failed to sign out.");
      setIsSigningOut(false);
    }
  };

  // Derived stats
  const todayMs = startOfToday().getTime();
  const loading = !institutionId || pendingBatches === null || recentBatches === null;

  const pendingCount  = pendingBatches?.length ?? null;
  const pendingAmount = pendingBatches?.reduce((s, b) => s + Number(b.totalAmount || 0), 0) ?? null;

  const confirmedToday = recentBatches?.filter(
    (b) => b.status === "confirmed" && tsToMs(b.confirmedAt) >= todayMs
  ).length ?? null;

  const flaggedToday = recentBatches?.filter(
    (b) => b.status === "flagged" && tsToMs(b.flaggedAt) >= todayMs
  ).length ?? null;

  const today = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });

  return (
    <PageShell user={user} institutionName={institutionName}>
      {/* Welcome hero */}
      <div className="rounded-2xl bg-brand-500 px-6 py-6 text-white shadow-card-lg">
        <p className="text-brand-100 text-sm">{today}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight">
          {institutionName ? `${institutionName} Operations` : "Institution Operations"}
        </h1>
        <p className="mt-1 text-brand-100 text-sm">{user?.email?.replace("@kirimba.app", "") || "—"}</p>

        {/* Quick pending pill */}
        {!loading && pendingCount !== null && (
          <button
            onClick={() => navigate("/umuco/batches")}
            className={`mt-4 inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-semibold transition-opacity hover:opacity-80 ${
              pendingCount > 0
                ? "bg-gold-400 text-slate-900"
                : "bg-white/20 text-white"
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${pendingCount > 0 ? "bg-slate-700" : "bg-brand-300"}`} />
            {pendingCount > 0
              ? `${pendingCount} batch${pendingCount !== 1 ? "es" : ""} awaiting review`
              : "No pending batches"}
          </button>
        )}
      </div>

      {/* Stats grid */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Today's Overview</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Pending Batches"
            value={loading ? null : String(pendingCount)}
            accent="gold"
            onClick={() => navigate("/umuco/batches")}
          />
          <StatCard
            label="Pending Amount"
            value={loading ? null : formatBIF(pendingAmount)}
            accent="gold"
            onClick={() => navigate("/umuco/batches")}
            small
          />
          <StatCard
            label="Confirmed Today"
            value={loading ? null : String(confirmedToday)}
            accent="brand"
            onClick={() => navigate("/umuco/history")}
          />
          <StatCard
            label="Flagged Today"
            value={loading ? null : String(flaggedToday)}
            accent={flaggedToday > 0 ? "red" : "slate"}
            onClick={() => navigate("/umuco/exceptions")}
          />
        </div>
      </div>

      {/* Operation cards */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">Operations</p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <OperationCard
            title="Pending Batches"
            desc="Review and confirm or flag submitted deposit batches from agents"
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25z" />
            }
            badge={!loading && pendingCount > 0 ? String(pendingCount) : null}
            badgeColor="gold"
            onClick={() => navigate("/umuco/batches")}
          />
          <OperationCard
            title="Batch History"
            desc="Browse all confirmed and flagged batches with date and status filters"
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
            }
            onClick={() => navigate("/umuco/history")}
          />
          <OperationCard
            title="Flagged Batches"
            desc="Exceptions queue — batches with discrepancies needing follow-up"
            icon={
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
            }
            badge={!loading && flaggedToday > 0 ? "!" : null}
            badgeColor="red"
            onClick={() => navigate("/umuco/exceptions")}
          />
        </div>
      </div>

      {/* Sign out */}
      <div className="pt-2 pb-4 border-t border-brand-100">
        {signOutError && (
          <p className="text-sm text-red-600 mb-2">{signOutError}</p>
        )}
        <button
          type="button"
          onClick={handleSignOut}
          disabled={isSigningOut}
          className="text-sm font-medium text-slate-400 hover:text-red-500 transition-colors disabled:opacity-60"
        >
          {isSigningOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </PageShell>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent, onClick, small }) {
  const accentMap = {
    gold:  "bg-gold-50 border-gold-200",
    brand: "bg-brand-50 border-brand-200",
    red:   "bg-red-50 border-red-200",
    slate: "bg-white border-slate-200",
  };
  const textMap = {
    gold:  "text-gold-700",
    brand: "text-brand-700",
    red:   "text-red-700",
    slate: "text-slate-600",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-2xl border px-5 py-4 text-left hover:opacity-80 transition-opacity w-full ${accentMap[accent] || accentMap.slate}`}
    >
      <p className={`text-xs font-semibold uppercase tracking-wide ${textMap[accent] || "text-slate-500"}`}>
        {label}
      </p>
      {value === null ? (
        <div className="h-7 w-20 rounded-lg bg-slate-200 animate-pulse mt-2" />
      ) : (
        <p className={`mt-1 font-bold leading-tight ${small ? "text-lg" : "text-3xl"} text-slate-900`}>
          {value}
        </p>
      )}
    </button>
  );
}

// ─── Operation Card ───────────────────────────────────────────────────────────

function OperationCard({ title, desc, icon, badge, badgeColor, onClick }) {
  const badgeStyles = {
    gold: "bg-gold-400 text-slate-900",
    red:  "bg-red-500 text-white",
  };
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-start gap-3 rounded-2xl border border-brand-100 bg-white px-5 py-5 text-left shadow-card hover:shadow-card-lg hover:border-brand-300 transition-all w-full"
    >
      <div className="flex items-start justify-between w-full gap-2">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center shrink-0">
          <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            {icon}
          </svg>
        </div>
        {badge && (
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${badgeStyles[badgeColor] || badgeStyles.gold}`}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <p className="text-base font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm text-slate-500">{desc}</p>
      </div>
      <span className="text-brand-400 text-sm font-medium mt-auto">Open →</span>
    </button>
  );
}
