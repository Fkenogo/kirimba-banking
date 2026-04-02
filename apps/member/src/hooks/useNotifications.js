/**
 * useNotifications — subscribes to the current user's notification documents
 * in real-time so the bell badge always reflects live unread count.
 *
 * Returns: { notifications, unreadCount, markRead, markAllRead, loading }
 */
import { useEffect, useState, useCallback } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
  limit,
} from "firebase/firestore";
import { db } from "../services/firebase";

export function useNotifications(user, maxItems = 30) {
  const [notifications, setNotifications]   = useState([]);
  const [loading,       setLoading]          = useState(true);

  useEffect(() => {
    if (!user?.uid) { setLoading(false); return; }

    const q = query(
      collection(db, "notifications"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc"),
      limit(maxItems)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setNotifications(
          snap.docs.map((d) => ({ id: d.id, ...d.data() }))
        );
        setLoading(false);
      },
      () => {
        // Firestore rules may block the query before indexes are built —
        // fail silently so the UI still renders.
        setLoading(false);
      }
    );

    return unsub;
  }, [user?.uid, maxItems]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const markRead = useCallback(async (notifId) => {
    try {
      await updateDoc(doc(db, "notifications", notifId), { read: true });
    } catch { /* ignore */ }
  }, []);

  const markAllRead = useCallback(async () => {
    const unread = notifications.filter((n) => !n.read);
    if (!unread.length) return;
    const batch = writeBatch(db);
    unread.forEach((n) => batch.update(doc(db, "notifications", n.id), { read: true }));
    try { await batch.commit(); } catch { /* ignore */ }
  }, [notifications]);

  return { notifications, unreadCount, markRead, markAllRead, loading };
}
