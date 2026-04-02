// ─── Shared UI primitives for the KIRIMBA Admin Console ──────────────────────

// ─── Formatters ──────────────────────────────────────────────────────────────

export function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

export function formatNumber(n) {
  return Number(n || 0).toLocaleString("en-US");
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

// ─── Page Header ─────────────────────────────────────────────────────────────
// Used at the top of every feature screen inside the AdminShell

export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-brand-100 shadow-card ${className}`}>
      {children}
    </div>
  );
}

// ─── Card Header ─────────────────────────────────────────────────────────────

export function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-center justify-between gap-4 px-5 py-4 border-b border-brand-100">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

// ─── Section Label ────────────────────────────────────────────────────────────

export function SectionLabel({ children }) {
  return (
    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
      {children}
    </p>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

export function StatusBadge({ status, size = "sm" }) {
  const map = {
    // User/group status
    active:           "bg-brand-100 text-brand-700 border border-brand-200",
    pending:          "bg-gold-100 text-gold-700 border border-gold-200",
    pending_approval: "bg-gold-100 text-gold-700 border border-gold-200",
    suspended:        "bg-red-100 text-red-700 border border-red-200",
    rejected:         "bg-red-100 text-red-700 border border-red-200",
    // Batch status
    submitted:        "bg-gold-100 text-gold-700 border border-gold-200",
    confirmed:        "bg-brand-100 text-brand-700 border border-brand-200",
    flagged:          "bg-red-100 text-red-700 border border-red-200",
    // Loan status
    repaid:           "bg-brand-100 text-brand-700 border border-brand-200",
    defaulted:        "bg-red-100 text-red-700 border border-red-200",
    // Settlement
    approved:         "bg-brand-100 text-brand-700 border border-brand-200",
    paid:             "bg-slate-100 text-slate-600 border border-slate-200",
    requested:        "bg-gold-100 text-gold-700 border border-gold-200",
  };
  const cls = map[status] || "bg-slate-100 text-slate-600 border border-slate-200";
  const padCls = size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <span className={`inline-flex rounded-full font-semibold capitalize ${padCls} ${cls}`}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}

// ─── Role Badge ───────────────────────────────────────────────────────────────

export function RoleBadge({ role }) {
  const map = {
    super_admin: "bg-brand-800 text-white border border-brand-900",
    admin:       "bg-brand-100 text-brand-800 border border-brand-200",
    finance:     "bg-gold-100 text-gold-800 border border-gold-200",
    agent:       "bg-slate-100 text-slate-700 border border-slate-200",
  };
  const cls = map[role] || "bg-slate-100 text-slate-600 border border-slate-200";
  const labels = {
    super_admin: "Super Admin",
    admin:       "Operations Admin",
    finance:     "Finance",
    agent:       "Agent",
  };
  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${cls}`}>
      {labels[role] || role || "—"}
    </span>
  );
}

// ─── Info Row ─────────────────────────────────────────────────────────────────

export function InfoRow({ label, value, mono = false }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-slate-50 last:border-0">
      <span className="text-sm text-slate-500 shrink-0">{label}</span>
      <span className={`text-sm font-medium text-slate-900 text-right ${mono ? "font-mono text-xs" : ""}`}>
        {value ?? "—"}
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
      <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
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
      <div className="flex items-center gap-3">
        <svg className="w-5 h-5 animate-spin text-brand-400" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm font-medium text-slate-400">{label}</span>
      </div>
    </div>
  );
}

// ─── Primary Button ───────────────────────────────────────────────────────────

export function PrimaryButton({ onClick, disabled, children, variant = "default", type = "button", size = "md", className = "" }) {
  const variants = {
    default: "bg-brand-500 hover:bg-brand-600 text-white",
    success: "bg-brand-600 hover:bg-brand-700 text-white",
    danger:  "bg-red-600 hover:bg-red-700 text-white",
    warning: "bg-gold-500 hover:bg-gold-600 text-slate-900",
    outline: "bg-white border border-brand-200 text-brand-700 hover:bg-brand-50",
    ghost:   "bg-slate-100 hover:bg-slate-200 text-slate-700",
    dark:    "bg-slate-900 hover:bg-slate-800 text-white",
  };
  const sizes = {
    sm:  "px-3 py-1.5 text-xs rounded-lg",
    md:  "px-4 py-2 text-sm rounded-xl",
    lg:  "px-5 py-2.5 text-sm rounded-xl",
  };
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant] || variants.default} ${sizes[size] || sizes.md} ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Form Input ───────────────────────────────────────────────────────────────

export function FormInput({ label, hint, error, ...props }) {
  return (
    <div className="space-y-1.5">
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <input
        {...props}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition-all"
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
      {label && <label className="block text-sm font-medium text-slate-700">{label}</label>}
      <textarea
        rows={rows}
        {...props}
        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:ring-2 focus:ring-brand-100 outline-none transition-all resize-none"
      />
      {hint && <p className="text-xs text-slate-400">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

// ─── Table Wrapper ────────────────────────────────────────────────────────────

export function DataTable({ children }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, right = false, center = false }) {
  return (
    <th className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700 ${right ? "text-right" : center ? "text-center" : "text-left"}`}>
      {children}
    </th>
  );
}

export function Thead({ children }) {
  return (
    <thead>
      <tr className="border-b border-brand-100 bg-brand-50">{children}</tr>
    </thead>
  );
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

export function KpiCard({ label, value, helper, tone = "brand", loading }) {
  const toneMap = {
    brand:   "border-brand-200 bg-brand-50 text-brand-900",
    gold:    "border-gold-200 bg-gold-50 text-gold-900",
    red:     "border-red-200 bg-red-50 text-red-900",
    slate:   "border-slate-900 bg-slate-900 text-white",
    blue:    "border-blue-200 bg-blue-50 text-blue-900",
    amber:   "border-amber-200 bg-amber-50 text-amber-900",
  };
  const helperMap = {
    brand: "text-brand-500",
    gold:  "text-gold-600",
    red:   "text-red-500",
    slate: "text-slate-400",
    blue:  "text-blue-500",
    amber: "text-amber-600",
  };
  return (
    <div className={`rounded-2xl border p-5 ${toneMap[tone] || toneMap.brand}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</p>
      <div className="mt-3 min-h-[36px]">
        {loading ? (
          <div className="h-8 w-20 rounded-lg bg-current opacity-10 animate-pulse" />
        ) : (
          <p className="text-2xl font-bold tracking-tight">{value ?? "—"}</p>
        )}
      </div>
      {helper && <p className={`mt-2 text-xs leading-5 ${helperMap[tone] || "text-slate-500"}`}>{helper}</p>}
    </div>
  );
}

// ─── Tone helpers (for backward compat with dashboard) ───────────────────────

export function toneSurface(tone) {
  return {
    slate:   "border-slate-900 bg-slate-900 text-white",
    brand:   "border-brand-200 bg-brand-50 text-brand-900",
    teal:    "border-brand-200 bg-brand-50 text-brand-900",
    emerald: "border-brand-200 bg-brand-50 text-brand-900",
    amber:   "border-amber-200 bg-amber-50 text-amber-900",
    gold:    "border-gold-200 bg-gold-50 text-gold-900",
    blue:    "border-blue-200 bg-blue-50 text-blue-900",
    rose:    "border-red-200 bg-red-50 text-red-900",
    sky:     "border-sky-200 bg-sky-50 text-sky-900",
    violet:  "border-violet-200 bg-violet-50 text-violet-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";
}

export function toneText(tone) {
  return {
    slate:   "text-slate-900",
    brand:   "text-brand-700",
    emerald: "text-brand-700",
    amber:   "text-amber-700",
    gold:    "text-gold-700",
    blue:    "text-blue-700",
    red:     "text-red-700",
    rose:    "text-red-700",
  }[tone] || "text-slate-700";
}

export function tonePill(tone) {
  return {
    slate: "bg-slate-100 text-slate-600",
    amber: "bg-amber-100 text-amber-700",
    red:   "bg-red-100 text-red-700",
    brand: "bg-brand-100 text-brand-700",
  }[tone] || "bg-slate-100 text-slate-600";
}
