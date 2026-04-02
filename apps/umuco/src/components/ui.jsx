import { useNavigate, useLocation, Link } from "react-router-dom";

// ─── Formatters ─────────────────────────────────────────────────────────────

export function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds
    ? new Date(ts._seconds * 1000)
    : ts.toDate
    ? ts.toDate()
    : new Date(ts);
  return d.toLocaleString([], {
    month: "short",
    day:   "numeric",
    year:  "numeric",
    hour:  "2-digit",
    minute: "2-digit",
  });
}

// ─── Top Navigation ─────────────────────────────────────────────────────────

const NAV_TABS = [
  { label: "Dashboard",  path: "/umuco/home" },
  { label: "Pending",    path: "/umuco/batches" },
  { label: "History",    path: "/umuco/history" },
  { label: "Exceptions", path: "/umuco/exceptions" },
];

function TopNav({ user, institutionName }) {
  const location = useLocation();

  const initials = (() => {
    const email = user?.email || "";
    const parts = email.replace("@kirimba.app", "").split(/\W/).filter(Boolean);
    return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "U";
  })();

  return (
    <header className="sticky top-0 z-30 bg-brand-500 shadow-card-lg">
      {/* Brand bar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
        {/* Logo + name */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-white/20 flex items-center justify-center">
            <span className="text-white font-black text-sm">K</span>
          </div>
          <div className="leading-tight">
            <span className="text-white font-bold text-sm">KIRIMBA</span>
            {institutionName && (
              <span className="text-brand-200 text-xs ml-2">· {institutionName}</span>
            )}
          </div>
        </div>

        {/* User avatar */}
        <div className="w-8 h-8 rounded-xl bg-brand-600 flex items-center justify-center">
          <span className="text-xs font-bold text-white">{initials}</span>
        </div>
      </div>

      {/* Nav tabs */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 flex gap-1 pb-0 overflow-x-auto">
        {NAV_TABS.map((tab) => {
          const isActive =
            tab.path === "/umuco/home"
              ? location.pathname === "/umuco/home"
              : location.pathname.startsWith(tab.path);
          return (
            <Link
              key={tab.path}
              to={tab.path}
              className={`whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? "border-gold-400 text-white"
                  : "border-transparent text-brand-100 hover:text-white hover:border-brand-300"
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </div>
    </header>
  );
}

// ─── PageShell ───────────────────────────────────────────────────────────────

export function PageShell({ title, user, institutionName, children }) {
  return (
    <div className="min-h-screen bg-brand-50 flex flex-col">
      <TopNav user={user} institutionName={institutionName} />
      <main className="flex-1">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          {title && (
            <h1 className="text-xl font-bold text-slate-900">{title}</h1>
          )}
          {children}
        </div>
      </main>
    </div>
  );
}

// ─── Card ────────────────────────────────────────────────────────────────────

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl shadow-card border border-brand-100 ${className}`}>
      {children}
    </div>
  );
}

// ─── Section Label ───────────────────────────────────────────────────────────

export function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </p>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

export function StatusBadge({ status }) {
  const map = {
    submitted: "bg-gold-100 text-gold-700 border border-gold-200",
    confirmed: "bg-brand-100 text-brand-700 border border-brand-200",
    flagged:   "bg-red-100 text-red-700 border border-red-200",
    pending:   "bg-gold-100 text-gold-700 border border-gold-200",
    active:    "bg-brand-100 text-brand-700 border border-brand-200",
  };
  const cls = map[status] || "bg-slate-100 text-slate-600 border border-slate-200";
  return (
    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

export function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-slate-900 text-right ${mono ? "font-mono text-xs" : ""}`}>
        {value || "—"}
      </span>
    </div>
  );
}

// ─── Alert ────────────────────────────────────────────────────────────────────

export function Alert({ type = "error", children }) {
  const styles = {
    error:   "bg-red-50 border-red-200 text-red-700",
    warning: "bg-gold-50 border-gold-200 text-gold-800",
    success: "bg-brand-50 border-brand-200 text-brand-800",
    info:    "bg-blue-50 border-blue-200 text-blue-800",
  };
  return (
    <div className={`rounded-xl border px-4 py-3 text-sm ${styles[type] || styles.error}`}>
      {children}
    </div>
  );
}

// ─── Empty State ──────────────────────────────────────────────────────────────

export function EmptyState({ title, subtitle }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
        <svg className="w-7 h-7 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      {subtitle && <p className="mt-1 text-xs text-slate-400">{subtitle}</p>}
    </div>
  );
}

// ─── Loading State ────────────────────────────────────────────────────────────

export function LoadingState({ label = "Loading…" }) {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="flex items-center gap-3 text-brand-500">
        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm font-medium text-slate-500">{label}</span>
      </div>
    </div>
  );
}

// ─── Primary Button ───────────────────────────────────────────────────────────

export function PrimaryButton({ onClick, disabled, children, variant = "default", type = "button", className = "" }) {
  const variants = {
    default: "bg-brand-500 hover:bg-brand-600 text-white",
    success: "bg-brand-600 hover:bg-brand-700 text-white",
    danger:  "bg-red-600 hover:bg-red-700 text-white",
    outline: "bg-white border border-brand-300 text-brand-700 hover:bg-brand-50",
    ghost:   "bg-slate-100 hover:bg-slate-200 text-slate-700",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.default} ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Form Input ───────────────────────────────────────────────────────────────

export function FormInput({ label, hint, error, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-slate-700">{label}</label>
      )}
      <input
        {...props}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition-all"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Form Textarea ────────────────────────────────────────────────────────────

export function FormTextarea({ label, hint, error, rows = 3, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-sm font-medium text-slate-700">{label}</label>
      )}
      <textarea
        rows={rows}
        {...props}
        className="w-full rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition-all resize-none"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
