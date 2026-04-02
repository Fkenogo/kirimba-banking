/**
 * Shared UI primitives for the Kirimba Member app.
 * Import what you need — all are lightweight, no extra deps.
 */

import TopHeader from "./TopHeader";
import BottomNav from "./BottomNav";

// ─── PageShell ────────────────────────────────────────────────────────────────
/**
 * Wraps any screen with TopHeader + scroll area + BottomNav.
 * Use showBack for inner screens; omit for tab-root screens.
 */
export function PageShell({ title, showBack = false, backTo = "", backLabel = "", userName = "", notifCount = 0, children, onNotifClick }) {
  return (
    <div className="min-h-screen bg-brand-50 flex flex-col">
      <TopHeader
        title={title}
        showBack={showBack}
        backTo={backTo}
        backLabel={backLabel}
        userName={showBack ? "" : userName}
        notifCount={notifCount}
        showNotif={!showBack}
        showProfile={!showBack}
      />
      <main className="flex-1 overflow-y-auto pb-24">
        <div className={`max-w-lg mx-auto px-4 ${showBack ? "pt-3" : "pt-4"} space-y-4`}>
          {children}
        </div>
      </main>
      <BottomNav />
    </div>
  );
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────
export function SectionLabel({ children }) {
  return (
    <p className="text-xs font-bold uppercase tracking-widest text-slate-400 px-1">
      {children}
    </p>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────
export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-brand-100 shadow-card overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────
const STATUS_MAP = {
  confirmed:             { bg: "bg-brand-50",  text: "text-brand-700",  label: "Confirmed"   },
  pending_confirmation:  { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"     },
  pending_approval:      { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"     },
  pending:               { bg: "bg-gold-50",   text: "text-gold-700",   label: "Pending"     },
  pending_agent:         { bg: "bg-blue-50",   text: "text-blue-700",   label: "At Agent"    },
  submitted:             { bg: "bg-blue-50",   text: "text-blue-700",   label: "Submitted"   },
  active:                { bg: "bg-brand-50",  text: "text-brand-700",  label: "Active"      },
  approved:              { bg: "bg-brand-50",  text: "text-brand-700",  label: "Approved"    },
  repaid:                { bg: "bg-brand-50",  text: "text-brand-700",  label: "Repaid"      },
  rejected:              { bg: "bg-red-50",    text: "text-red-600",    label: "Rejected"    },
  defaulted:             { bg: "bg-red-50",    text: "text-red-700",    label: "Defaulted"   },
  flagged:               { bg: "bg-red-50",    text: "text-red-700",    label: "Flagged"     },
};

export function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { bg: "bg-slate-100", text: "text-slate-600", label: status?.replace(/_/g, " ") || "—" };
  return (
    <span className={`text-[10px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  );
}

// ─── BalanceCard ──────────────────────────────────────────────────────────────
export function BalanceCard({ label, amount, subtitle, children }) {
  return (
    <div className="bg-brand-500 rounded-2xl px-5 py-6 text-white shadow-card-lg relative overflow-hidden">
      <div className="absolute -top-8 -right-8 w-32 h-32 bg-brand-400 rounded-full opacity-30" />
      <div className="absolute -bottom-6 -left-4 w-20 h-20 bg-gold-500 rounded-full opacity-20" />
      <p className="text-xs font-semibold uppercase tracking-widest text-brand-100 mb-1">{label}</p>
      <p className="text-4xl font-extrabold tracking-tight relative z-10">
        {Number(amount || 0).toLocaleString("en-US")}
        <span className="text-lg font-medium text-brand-200 ml-2">BIF</span>
      </p>
      {subtitle && <p className="text-sm text-brand-200 mt-1 relative z-10">{subtitle}</p>}
      {children && <div className="relative z-10">{children}</div>}
    </div>
  );
}

// ─── InfoRow ──────────────────────────────────────────────────────────────────
export function InfoRow({ label, value, valueClass = "text-slate-900" }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-3">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm font-semibold ${valueClass}`}>{value ?? "—"}</span>
    </div>
  );
}

// ─── Divider ──────────────────────────────────────────────────────────────────
export function Divider() {
  return <div className="h-px bg-slate-50 mx-5" />;
}

// ─── FormInput ────────────────────────────────────────────────────────────────
export function FormInput({ label, hint, icon, error, ...props }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">{label}</label>
      <div className="relative">
        {icon && <span className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>}
        <input
          {...props}
          className={`w-full ${icon ? "pl-9" : "pl-4"} pr-4 py-3.5 rounded-xl border-2 border-brand-100 bg-white text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:border-brand-500 transition-colors`}
        />
      </div>
      {hint && !error && <p className="text-xs text-slate-400 pl-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 pl-1">{error}</p>}
    </div>
  );
}

// ─── FormTextarea ─────────────────────────────────────────────────────────────
export function FormTextarea({ label, hint, error, ...props }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">{label}</label>
      <textarea
        {...props}
        className="w-full px-4 py-3.5 rounded-xl border-2 border-brand-100 bg-white text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:border-brand-500 transition-colors resize-none"
      />
      {hint && !error && <p className="text-xs text-slate-400 pl-1">{hint}</p>}
      {error && <p className="text-xs text-red-500 pl-1">{error}</p>}
    </div>
  );
}

// ─── PrimaryButton ────────────────────────────────────────────────────────────
export function PrimaryButton({ children, loading, ...props }) {
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-bold py-4 rounded-2xl text-base transition-all disabled:opacity-50 active:scale-95 shadow-card"
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Please wait…
        </span>
      ) : children}
    </button>
  );
}

// ─── Alert ────────────────────────────────────────────────────────────────────
export function Alert({ type = "error", children }) {
  const styles = {
    error:   { bg: "bg-red-50",    border: "border-red-200",   text: "text-red-700",   icon: "⚠" },
    success: { bg: "bg-brand-50",  border: "border-brand-200", text: "text-brand-700", icon: "✓" },
    info:    { bg: "bg-blue-50",   border: "border-blue-200",  text: "text-blue-700",  icon: "ℹ" },
    warning: { bg: "bg-gold-50",   border: "border-gold-200",  text: "text-gold-700",  icon: "⚠" },
  };
  const s = styles[type] || styles.error;
  return (
    <div className={`flex items-start gap-3 ${s.bg} border ${s.border} rounded-2xl px-4 py-3`}>
      <span className={`${s.text} shrink-0 mt-0.5`}>{s.icon}</span>
      <p className={`text-sm ${s.text}`}>{children}</p>
    </div>
  );
}

// ─── LoadingScreen ────────────────────────────────────────────────────────────
export function LoadingScreen({ title, backTo = "", backLabel = "" }) {
  return (
    <div className="min-h-screen bg-brand-50 flex flex-col">
      <TopHeader title={title} showBack backTo={backTo} backLabel={backLabel} showNotif={false} showProfile={false} />
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-200 border-t-brand-500 rounded-full animate-spin" />
          <p className="text-sm text-slate-400 font-medium">Loading…</p>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────
export function EmptyState({ icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-14 text-center px-6">
      <div className="w-14 h-14 bg-brand-50 rounded-2xl flex items-center justify-center mb-4">
        {icon || (
          <svg className="w-7 h-7 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
        )}
      </div>
      <p className="text-base font-bold text-slate-700">{title}</p>
      {subtitle && <p className="text-sm text-slate-400 mt-1">{subtitle}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
