import { NavLink, Outlet, useLocation } from "react-router-dom";
import { signOutAccount } from "../services/auth";
import { authRuntime } from "../services/firebase";
import {
  getNavigationForRole,
  ROLE_LABELS,
} from "../config/console";

// Role badge colours (teal-based instead of generic)
const ROLE_BADGE = {
  super_admin: "bg-white/20 text-white border border-white/30",
  admin:       "bg-brand-100 text-brand-800 border border-brand-200",
  finance:     "bg-gold-100 text-gold-800 border border-gold-200",
};

function routeIsActive(pathname, item) {
  return item.matchPrefixes?.some((prefix) => pathname.startsWith(prefix));
}

function NavItem({ item, pathname }) {
  const active = routeIsActive(pathname, item);

  return (
    <NavLink
      to={item.to}
      className={`group flex items-start gap-3 rounded-xl px-3 py-2.5 transition-all ${
        active
          ? "bg-white/15 text-white"
          : "text-brand-100 hover:bg-white/10 hover:text-white"
      }`}
    >
      {/* Icon block: first letters of label */}
      <span
        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-bold ${
          active ? "bg-white/20 text-white" : "bg-brand-600/60 text-brand-100 group-hover:bg-brand-600"
        }`}
      >
        {item.label
          .split(" ")
          .slice(0, 2)
          .map((part) => part[0])
          .join("")}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold leading-tight">{item.label}</span>
        <span className={`mt-0.5 block text-xs leading-4 ${active ? "text-brand-100" : "text-brand-300/70"}`}>
          {item.description}
        </span>
      </span>
      {active && (
        <span className="ml-auto mt-0.5 h-1.5 w-1.5 rounded-full bg-gold-400 shrink-0" />
      )}
    </NavLink>
  );
}

export default function AdminShell({ user, role }) {
  const location = useLocation();
  const sections = getNavigationForRole(role);

  const initials = (() => {
    const email = user?.email || "";
    const parts = email.replace("@kirimba.app", "").split(/\W/).filter(Boolean);
    return parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("") || "A";
  })();

  return (
    <div className="min-h-screen bg-brand-50 text-slate-900">
      <div className="grid min-h-screen grid-cols-[260px_minmax(0,1fr)]">

        {/* ─── Sidebar ─── */}
        <aside className="bg-brand-800 flex flex-col sticky top-0 h-screen overflow-y-auto">
          {/* Logo */}
          <div className="px-5 pt-6 pb-5 border-b border-brand-700">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                <span className="text-white font-black text-lg">K</span>
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-tight">KIRIMBA</p>
                <p className="text-brand-200 text-xs">Business Console</p>
              </div>
            </div>
            <p className="mt-3 text-xs text-brand-300 leading-5">
              Role-aware oversight and execution workspace.
            </p>
          </div>

          {/* Navigation */}
          <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
            {sections.map((section) => (
              <section key={section.id}>
                <p className="px-3 mb-2 text-[10px] font-bold uppercase tracking-[0.2em] text-brand-400">
                  {section.label}
                </p>
                <div className="space-y-0.5">
                  {section.items.map((item) => (
                    <NavItem key={item.id} item={item} pathname={location.pathname} />
                  ))}
                </div>
              </section>
            ))}
          </nav>

          {/* User card */}
          <div className="px-4 py-4 border-t border-brand-700">
            <div className="flex items-center gap-3 rounded-xl bg-brand-700/60 px-3 py-3">
              <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center shrink-0">
                <span className="text-white text-xs font-bold">{initials}</span>
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-white truncate">
                  {user?.email?.replace("@kirimba.app", "") || user?.uid || "—"}
                </p>
                <p className="text-[10px] text-brand-300 mt-0.5">{ROLE_LABELS[role] || role || "—"}</p>
              </div>
            </div>
          </div>
        </aside>

        {/* ─── Main Content ─── */}
        <div className="flex min-h-screen flex-col">
          {/* Top header bar */}
          <header className="sticky top-0 z-20 bg-white/90 backdrop-blur border-b border-brand-100 px-8 py-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                {/* Emulator badge */}
                {authRuntime.useEmulators && (
                  <span className="rounded-full border border-gold-200 bg-gold-50 px-3 py-1 text-xs font-semibold text-gold-700">
                    Local Emulator
                  </span>
                )}
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold ${ROLE_BADGE[role] || "border-slate-200 bg-slate-100 text-slate-700"}`}
                >
                  {ROLE_LABELS[role] || role || "Unknown role"}
                </span>
              </div>

              <button
                type="button"
                onClick={signOutAccount}
                className="rounded-xl border border-slate-200 px-4 py-1.5 text-sm font-medium text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-600 transition-colors"
              >
                Sign out
              </button>
            </div>
          </header>

          {/* Screen content */}
          <div className="flex-1 bg-brand-50">
            <Outlet />
          </div>
        </div>

      </div>
    </div>
  );
}
