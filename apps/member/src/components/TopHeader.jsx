import { useLocation, useNavigate } from "react-router-dom";

// ─── Bell / notification icon ─────────────────────────────────────────────────
function BellIcon() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a1 1 0 10-2 0v1.083A6 6 0 006 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
    </svg>
  );
}

// ─── Chevron-left (back arrow) ────────────────────────────────────────────────
function ChevronLeft() {
  return (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
    </svg>
  );
}

/**
 * TopHeader
 *
 * Props:
 *  - title        : string  — page title shown in centre (or left on home)
 *  - showBack     : bool    — show back arrow instead of logo
 *  - showNotif    : bool    — show notification bell (default true)
 *  - showProfile  : bool    — show profile avatar (default true)
 *  - userName     : string  — first name used for greeting + avatar initials
 *  - notifCount   : number  — unread notification count (0 = no badge)
 *  - onProfileClick: fn    — called when avatar is tapped
 */
export default function TopHeader({
  title,
  showBack = false,
  backTo = "",
  backLabel = "",
  showNotif = true,
  showProfile = true,
  userName = "",
  notifCount = 0,
  onProfileClick,
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const initials = userName
    ? userName.trim().split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()
    : "M";

  function handleBack() {
    if (backTo) {
      navigate(backTo);
      return;
    }
    navigate(-1);
  }

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-brand-100 safe-top">
      {showBack ? (
        <div className="px-4 pt-3 pb-2.5">
          <button
            onClick={handleBack}
            className="inline-flex max-w-full items-center gap-2 rounded-full bg-brand-50 px-3 py-2 text-brand-700 transition-colors hover:bg-brand-100"
            aria-label={backLabel || "Go back"}
          >
            <span className="flex items-center justify-center w-5 h-5 shrink-0">
              <ChevronLeft />
            </span>
            <span className="min-w-0 truncate text-xs font-semibold">{backLabel || "Back"}</span>
          </button>
          {title ? (
            <h1 className="mt-2 text-lg font-bold text-slate-900 leading-tight">
              {title}
            </h1>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-3 px-4 h-14">
          <div className="flex-1 min-w-0">
            {userName && (
              <p className="text-xs text-slate-400 truncate">
                Hello, <span className="font-semibold text-brand-600">{userName.split(" ")[0]}</span> 👋
              </p>
            )}
            {title && (
              <h1 className="text-base font-bold text-slate-900 truncate leading-tight">
                {title}
              </h1>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {showNotif && (
              <button
                onClick={() => navigate("/app/notifications", { state: { backTo: location.pathname, backLabel: title ? `Back to ${title}` : "Back" } })}
                className="relative flex items-center justify-center w-9 h-9 rounded-xl bg-brand-50 text-brand-700 hover:bg-brand-100 transition-colors"
                aria-label="Notifications"
              >
                <BellIcon />
                {notifCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] bg-gold-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1 leading-none">
                    {notifCount > 9 ? "9+" : notifCount}
                  </span>
                )}
              </button>
            )}

            {showProfile && (
              <button
                onClick={onProfileClick || (() => navigate("/app/profile"))}
                className="flex items-center justify-center w-9 h-9 rounded-xl bg-brand-500 text-white text-sm font-bold hover:bg-brand-600 transition-colors"
                aria-label="Profile"
              >
                {initials}
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
