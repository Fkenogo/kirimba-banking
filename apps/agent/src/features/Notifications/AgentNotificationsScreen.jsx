import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { Alert, Card, EmptyState, PageShell, SectionLabel } from "../../components/ui";
import { toMillis } from "../../utils/agentFinance";

function formatDateTime(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : value?._seconds ? new Date(value._seconds * 1000) : new Date(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getNotificationCopy(row) {
  const type = String(row.type || "");
  if (row.title || row.message) {
    return {
      title: row.title || "Notification",
      summary: row.message || row.summary || "Open for the latest update.",
    };
  }
  switch (type) {
    case "batch_flagged":
      return {
        title: "Batch flagged",
        summary: row.message || "A submitted deposit batch needs your follow-up.",
      };
    case "settlement_approved":
      return {
        title: "Settlement approved",
        summary: row.message || "Your commission payout is approved and waiting for payment.",
      };
    case "settlement_paid":
      return {
        title: "Settlement paid",
        summary: row.message || "Your commission payout was marked as paid.",
      };
    default:
      return {
        title: "Notification",
        summary: row.message || row.summary || type.replace(/_/g, " ") || "Agent update",
      };
  }
}

export default function AgentNotificationsScreen({ user }) {
  const [notifications, setNotifications] = useState(null);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "notifications"), where("recipientId", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt));
        setNotifications(rows);
        setError("");
      },
      (snapshotError) => {
        console.warn("[notifications]", snapshotError.message);
        setNotifications([]);
        setError(snapshotError.message || "Failed to load notifications.");
      }
    );
    return unsub;
  }, [user?.uid]);

  const unreadCount = useMemo(
    () => (notifications || []).filter((row) => row.status !== "read").length,
    [notifications]
  );

  async function markAsRead(notificationId) {
    setBusyId(notificationId);
    setError("");
    try {
      const fn = httpsCallable(functions, "markNotificationRead");
      await fn({ notificationId });
    } catch (markError) {
      setError(markError.message || "Failed to mark notification as read.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <PageShell title="Notifications" showBack user={user}>
      <Card>
        <div className="px-5 py-4 flex items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Inbox</p>
            <p className="mt-1 text-sm text-slate-700">Operational updates for your agent account</p>
          </div>
          <div className="rounded-2xl bg-brand-50 border border-brand-100 px-3 py-2 text-right">
            <p className="text-lg font-bold text-brand-700">{unreadCount}</p>
            <p className="text-[10px] font-bold uppercase tracking-wide text-brand-500">Unread</p>
          </div>
        </div>
      </Card>

      {error ? <Alert type="error">{error}</Alert> : null}

      <div className="space-y-2">
        <SectionLabel>Latest Notifications</SectionLabel>
        {notifications === null ? (
          <div className="space-y-3 animate-pulse">
            {[...Array(4)].map((_, index) => (
              <div key={index} className="h-24 bg-white rounded-3xl shadow-card" />
            ))}
          </div>
        ) : notifications.length === 0 ? (
          <Card>
            <EmptyState
              title="No notifications yet"
              subtitle="Agent alerts and follow-up updates will appear here when the system sends them."
            />
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-slate-50">
              {notifications.map((row) => {
                const copy = getNotificationCopy(row);
                const isUnread = row.status !== "read";
                return (
                  <div key={row.id} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          {isUnread ? <span className="w-2 h-2 rounded-full bg-brand-500 shrink-0 mt-0.5" /> : null}
                          <p className="text-sm font-bold text-slate-900">{copy.title}</p>
                        </div>
                        <p className="mt-1 text-sm text-slate-600">{copy.summary}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                          <span>{formatDateTime(row.createdAt)}</span>
                          <span>•</span>
                          <span>{isUnread ? "Unread" : "Read"}</span>
                        </div>
                      </div>
                      {isUnread ? (
                        <button
                          type="button"
                          onClick={() => markAsRead(row.id)}
                          disabled={busyId === row.id}
                          className="shrink-0 rounded-xl border border-brand-100 bg-brand-50 px-3 py-2 text-[11px] font-bold text-brand-700 disabled:opacity-50"
                        >
                          {busyId === row.id ? "Saving…" : "Mark read"}
                        </button>
                      ) : (
                        <span className="shrink-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-[11px] font-bold text-slate-500">
                          Read
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </PageShell>
  );
}
