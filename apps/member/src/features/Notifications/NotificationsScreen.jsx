import { useLocation } from "react-router-dom";
import { useNotifications } from "../../hooks/useNotifications";
import { PageShell, Card, EmptyState, LoadingScreen } from "../../components/ui";

/* ─── Severity → colour mapping ─── */
const SEVERITY_STYLE = {
  high:   { dot: "bg-red-500",    bg: "bg-red-50",    border: "border-red-100"   },
  medium: { dot: "bg-gold-400",   bg: "bg-gold-50",   border: "border-gold-100"  },
  low:    { dot: "bg-brand-400",  bg: "bg-brand-50",  border: "border-brand-100" },
};

/* ─── Type → icon path ─── */
const TYPE_ICON = {
  loan_approved:   "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  loan_rejected:   "M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z",
  loan_due:        "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  loan_defaulted:  "M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  deposit_confirmed: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  batch_flagged:   "M3 21l1.9-5.7a8.5 8.5 0 113.8 3.8z",
  withdrawal_approved: "M5 13l4 4L19 7",
  join_request:    "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z",
  default:         "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
};

function timeAgo(ts) {
  if (!ts) return "";
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)  return "Just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export default function NotificationsScreen({ user }) {
  const { notifications, unreadCount, markRead, markAllRead, loading } = useNotifications(user);
  const location = useLocation();
  const backTo = location.state?.backTo || "/app/home";
  const backLabel = location.state?.backLabel || "Back to Home";

  if (loading) return <LoadingScreen title="Notifications" backTo={backTo} backLabel={backLabel} />;

  return (
    <PageShell title="Notifications" showBack backTo={backTo} backLabel={backLabel}>

      {/* Header action — mark all read */}
      {unreadCount > 0 && (
        <div className="flex items-center justify-between px-1">
          <p className="text-xs text-slate-400">
            <span className="font-bold text-brand-600">{unreadCount}</span> unread
          </p>
          <button
            onClick={markAllRead}
            className="text-xs font-bold text-brand-500 hover:text-brand-700 py-1 px-2 rounded-lg hover:bg-brand-50 transition-colors"
          >
            Mark all read
          </button>
        </div>
      )}

      {/* Empty state */}
      {notifications.length === 0 && (
        <Card>
          <EmptyState
            title="No notifications yet"
            subtitle="You'll see alerts for loan updates, deposits, group activity, and more."
          />
        </Card>
      )}

      {/* Notifications list */}
      {notifications.length > 0 && (
        <Card>
          <div className="divide-y divide-slate-50">
            {notifications.map((notif) => {
              const sev = SEVERITY_STYLE[notif.severity] || SEVERITY_STYLE.low;
              const iconPath = TYPE_ICON[notif.type] || TYPE_ICON.default;
              const isUnread = !notif.read;

              return (
                <button
                  key={notif.id}
                  onClick={() => markRead(notif.id)}
                  className={`w-full flex items-start gap-3 px-4 py-4 text-left transition-colors ${
                    isUnread ? `${sev.bg}` : "hover:bg-slate-50"
                  }`}
                >
                  {/* Icon */}
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                    isUnread ? "bg-white shadow-card" : "bg-slate-50"
                  }`}>
                    <svg
                      className={`w-4 h-4 ${isUnread ? "text-brand-600" : "text-slate-400"}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
                    </svg>
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm leading-snug ${isUnread ? "font-bold text-slate-900" : "font-medium text-slate-600"}`}>
                      {notif.message || notif.title || "New notification"}
                    </p>
                    <p className="text-[11px] text-slate-400 mt-0.5">{timeAgo(notif.createdAt)}</p>
                  </div>

                  {/* Unread dot */}
                  {isUnread && (
                    <div className={`w-2 h-2 rounded-full shrink-0 mt-2 ${sev.dot}`} />
                  )}
                </button>
              );
            })}
          </div>
        </Card>
      )}

    </PageShell>
  );
}
