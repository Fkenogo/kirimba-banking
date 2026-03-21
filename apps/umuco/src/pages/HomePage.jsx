import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, doc, getDoc, onSnapshot, query, where } from "firebase/firestore";
import { signOutAccount } from "../services/auth";
import { db } from "../services/firebase";

function fmtBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

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

export default function HomePage({ user, institutionId }) {
  const navigate = useNavigate();
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState("");
  const [institutionName, setInstitutionName] = useState(null);

  // Live stats
  const [pendingBatches, setPendingBatches] = useState(null);
  const [recentBatches, setRecentBatches] = useState(null);

  // Load institution name
  useEffect(() => {
    if (!institutionId) return;
    getDoc(doc(db, "institutions", institutionId))
      .then((snap) => {
        if (snap.exists()) setInstitutionName(snap.data().name || institutionId);
        else setInstitutionName(institutionId);
      })
      .catch(() => setInstitutionName(institutionId));
  }, [institutionId]);

  // Subscribe to submitted batches — scoped to this institution
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

  // Subscribe to confirmed + flagged batches for today's stats — scoped to this institution
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

  const pendingCount = pendingBatches?.length ?? null;
  const pendingAmount = pendingBatches?.reduce((s, b) => s + Number(b.totalAmount || 0), 0) ?? null;

  const confirmedToday = recentBatches?.filter((b) => {
    return b.status === "confirmed" && tsToMs(b.confirmedAt) >= todayMs;
  }).length ?? null;

  const flaggedToday = recentBatches?.filter((b) => {
    return b.status === "flagged" && tsToMs(b.flaggedAt) >= todayMs;
  }).length ?? null;

  const loading = !institutionId || pendingBatches === null || recentBatches === null;

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="max-w-2xl mx-auto px-4 pt-8 pb-12 space-y-6">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">{institutionName ? `${institutionName} Operations` : "Institution Operations"}</h1>
            <p className="text-xs text-slate-400 mt-0.5">{user?.email || user?.uid}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60"
          >
            {isSigningOut ? "Signing out…" : "Sign out"}
          </button>
        </div>
        {signOutError && <p className="text-sm text-red-600">{signOutError}</p>}

        {/* Summary cards */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Today's Overview</h2>
          <div className="grid grid-cols-2 gap-3">
            <StatCard
              label="Pending Batches"
              value={loading ? null : pendingCount}
              tone="amber"
              onClick={() => navigate("/umuco/batches")}
            />
            <StatCard
              label="Pending Amount"
              value={loading ? null : fmtBIF(pendingAmount)}
              tone="amber"
              onClick={() => navigate("/umuco/batches")}
            />
            <StatCard
              label="Confirmed Today"
              value={loading ? null : confirmedToday}
              tone="green"
              onClick={() => navigate("/umuco/history")}
            />
            <StatCard
              label="Flagged Today"
              value={loading ? null : flaggedToday}
              tone={flaggedToday > 0 ? "red" : "slate"}
              onClick={() => navigate("/umuco/exceptions")}
            />
          </div>
        </section>

        {/* Navigation */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-3">Operations</h2>
          <div className="grid grid-cols-1 gap-3">
            <NavCard
              title="Pending Batches"
              desc="Review and confirm or flag submitted deposit batches"
              tone="emerald"
              badge={pendingCount > 0 ? String(pendingCount) : null}
              onClick={() => navigate("/umuco/batches")}
            />
            <NavCard
              title="Batch History"
              desc="Browse confirmed and flagged batches with filters"
              tone="blue"
              onClick={() => navigate("/umuco/history")}
            />
            <NavCard
              title="Flagged Batches"
              desc="Exceptions queue — batches that need follow-up"
              tone="amber"
              badge={flaggedToday > 0 ? "!" : null}
              onClick={() => navigate("/umuco/exceptions")}
            />
          </div>
        </section>
      </div>
    </main>
  );
}

function StatCard({ label, value, tone, onClick }) {
  const toneClass = {
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    green: "border-green-200 bg-green-50 text-green-900",
    red: "border-red-200 bg-red-50 text-red-900",
    slate: "border-slate-200 bg-white text-slate-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl border px-4 py-3 text-left hover:opacity-80 transition-opacity w-full ${toneClass}`}
    >
      <p className="text-xs font-medium opacity-60 uppercase tracking-wide">{label}</p>
      {value === null ? (
        <div className="h-7 w-16 bg-current opacity-10 rounded animate-pulse mt-1" />
      ) : (
        <p className="text-2xl font-bold mt-1 leading-tight">{value}</p>
      )}
    </button>
  );
}

function NavCard({ title, desc, tone, badge, onClick }) {
  const toneClass = {
    emerald: "border-emerald-200 bg-emerald-50 hover:border-emerald-400",
    blue: "border-blue-200 bg-blue-50 hover:border-blue-400",
    amber: "border-amber-200 bg-amber-50 hover:border-amber-400",
  }[tone] || "border-slate-200 bg-white hover:border-slate-400";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center justify-between rounded-xl border px-5 py-4 text-left shadow-sm transition-all ${toneClass}`}
    >
      <div>
        <p className="text-base font-semibold text-slate-900">{title}</p>
        <p className="mt-0.5 text-sm text-slate-600">{desc}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-4">
        {badge && (
          <span className="rounded-full bg-amber-600 text-white text-xs font-bold px-2 py-0.5">{badge}</span>
        )}
        <span className="text-slate-300 text-lg">›</span>
      </div>
    </button>
  );
}
