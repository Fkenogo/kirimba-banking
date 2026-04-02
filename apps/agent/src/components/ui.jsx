/**
 * Agent App — shared UI primitives
 * Mirrors the member app's design system with the same brand tokens.
 */

import { useNavigate } from "react-router-dom";
import BottomNav from "./BottomNav";

/* ─── Formatters ─────────────────────────────────────────────────────────── */

export function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

export function formatDate(ts) {
  if (!ts) return "—";
  const d = ts?._seconds
    ? new Date(ts._seconds * 1000)
    : ts?.toDate
    ? ts.toDate()
    : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

/* ─── PageShell ──────────────────────────────────────────────────────────── */

/**
 * Wraps every screen:  TopHeader (sticky) + scrollable content + BottomNav (fixed).
 *
 * Props:
 *   title       string   — header title
 *   showBack    bool     — show ← back arrow instead of hamburger
 *   user        object   — Firebase user (for avatar initials)
 *   children    ReactNode
 */
export function PageShell({ title, showBack = false, user, children }) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col min-h-screen bg-brand-50">
      {/* Sticky top header */}
      <header className="sticky top-0 z-30 bg-brand-500 safe-top">
        <div className="flex items-center gap-3 px-4 py-3 max-w-lg mx-auto w-full">
          {showBack ? (
            <button
              onClick={() => navigate(-1)}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-white/80 hover:bg-brand-600 active:bg-brand-700 transition-colors shrink-0"
              aria-label="Go back"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
          ) : (
            <div className="w-9 h-9 shrink-0" />
          )}

          <h1 className="flex-1 text-center text-base font-bold text-white tracking-tight">{title}</h1>

          {/* Agent avatar */}
          <div className="w-9 h-9 shrink-0 rounded-xl bg-brand-600 flex items-center justify-center">
            <span className="text-xs font-bold text-white">
              {user?.displayName
                ? user.displayName.charAt(0).toUpperCase()
                : user?.email
                ? user.email.charAt(0).toUpperCase()
                : "A"}
            </span>
          </div>
        </div>
      </header>

      {/* Scrollable content */}
      <main className="flex-1 overflow-y-auto pb-24">
        <div className="max-w-lg mx-auto w-full px-4 py-5 space-y-4">
          {children}
        </div>
      </main>

      {/* Fixed bottom nav */}
      <BottomNav />
    </div>
  );
}

/* ─── Card ───────────────────────────────────────────────────────────────── */

export function Card({ children, className = "" }) {
  return (
    <div className={`bg-white rounded-3xl shadow-card overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

/* ─── SectionLabel ───────────────────────────────────────────────────────── */

export function SectionLabel({ children }) {
  return (
    <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 px-1">
      {children}
    </p>
  );
}

/* ─── StatusBadge ────────────────────────────────────────────────────────── */

const STATUS_STYLES = {
  active:       "bg-brand-50  text-brand-700 border border-brand-100",
  confirmed:    "bg-brand-50  text-brand-700 border border-brand-100",
  reviewed:     "bg-brand-50  text-brand-700 border border-brand-100",
  repaid:       "bg-brand-50  text-brand-700 border border-brand-100",
  pending:      "bg-gold-50   text-gold-700  border border-gold-100",
  pending_umuco:"bg-gold-50   text-gold-700  border border-gold-100",
  submitted:    "bg-gold-50   text-gold-700  border border-gold-100",
  requested:    "bg-gold-50   text-gold-700  border border-gold-100",
  approved:     "bg-blue-50   text-blue-700  border border-blue-100",
  rejected:     "bg-red-50    text-red-700   border border-red-100",
  defaulted:    "bg-red-50    text-red-700   border border-red-100",
  flagged:      "bg-red-50    text-red-700   border border-red-100",
  paid:         "bg-green-50  text-green-700 border border-green-100",
  suspended:    "bg-slate-100 text-slate-500 border border-slate-200",
};

export function StatusBadge({ status }) {
  const label = (status || "unknown").replace(/_/g, " ");
  const cls = STATUS_STYLES[status] || "bg-slate-100 text-slate-500 border border-slate-200";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold capitalize ${cls}`}>
      {label}
    </span>
  );
}

/* ─── InfoRow ────────────────────────────────────────────────────────────── */

export function InfoRow({ label, value, valueClassName = "" }) {
  return (
    <div className="flex items-center justify-between px-5 py-3">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-sm font-semibold text-slate-800 ${valueClassName}`}>{value ?? "—"}</span>
    </div>
  );
}

/* ─── Divider ────────────────────────────────────────────────────────────── */

export function Divider() {
  return <div className="h-px bg-slate-50 mx-5" />;
}

/* ─── FormInput ──────────────────────────────────────────────────────────── */

export function FormInput({
  label, hint, type = "text", value, onChange,
  placeholder, required, disabled, autoComplete,
  inputMode, pattern, minLength, maxLength, min, max,
}) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
          {label}
        </label>
      )}
      <input
        type={type}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        autoComplete={autoComplete}
        inputMode={inputMode}
        pattern={pattern}
        minLength={minLength}
        maxLength={maxLength}
        min={min}
        max={max}
        className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors disabled:opacity-50"
      />
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/* ─── FormTextarea ───────────────────────────────────────────────────────── */

export function FormTextarea({ label, hint, value, onChange, placeholder, rows = 3, maxLength }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
          {label}
        </label>
      )}
      <textarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        maxLength={maxLength}
        className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 resize-none focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
      />
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/* ─── PrimaryButton ──────────────────────────────────────────────────────── */

export function PrimaryButton({ children, type = "button", loading = false, disabled = false, onClick, className = "" }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      onClick={onClick}
      className={`w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold py-4 rounded-2xl text-sm transition-colors ${className}`}
    >
      {loading && (
        <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      )}
      {children}
    </button>
  );
}

/* ─── Alert ──────────────────────────────────────────────────────────────── */

export function Alert({ type = "error", children }) {
  const styles = {
    error:   "bg-red-50   border-red-100   text-red-700",
    success: "bg-brand-50 border-brand-100 text-brand-700",
    warning: "bg-gold-50  border-gold-100  text-gold-700",
    info:    "bg-blue-50  border-blue-100  text-blue-700",
  };
  return (
    <div className={`rounded-2xl border px-4 py-3 text-sm ${styles[type] || styles.info}`}>
      {children}
    </div>
  );
}

/* ─── LoadingScreen ──────────────────────────────────────────────────────── */

export function LoadingScreen() {
  return (
    <main className="min-h-screen bg-brand-500 flex flex-col items-center justify-center gap-4">
      <div className="w-12 h-12 border-4 border-brand-300 border-t-white rounded-full animate-spin" />
      <p className="text-sm text-brand-100 font-medium">Loading…</p>
    </main>
  );
}

/* ─── EmptyState ─────────────────────────────────────────────────────────── */

export function EmptyState({ title = "Nothing here yet", subtitle = "" }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      <div className="w-12 h-12 bg-brand-50 rounded-full flex items-center justify-center mb-3">
        <svg className="w-6 h-6 text-brand-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
        </svg>
      </div>
      <p className="text-sm font-semibold text-slate-600">{title}</p>
      {subtitle && <p className="text-xs text-slate-400 mt-1 max-w-xs">{subtitle}</p>}
    </div>
  );
}
