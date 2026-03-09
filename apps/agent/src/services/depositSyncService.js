import { httpsCallable } from "firebase/functions";
import { functions } from "./firebase";
import {
  getOfflineDeposits,
  markDepositSynced,
  deleteSyncedDeposits,
} from "./offlineDeposits";

const SYNC_INTERVAL_MS = 10_000;

let intervalId = null;
let listeners = [];

/** Subscribe to pending-count updates. Returns an unsubscribe function. */
export function onPendingCountChange(cb) {
  listeners.push(cb);
  return () => {
    listeners = listeners.filter((l) => l !== cb);
  };
}

function notify(count) {
  listeners.forEach((cb) => cb(count));
}

async function syncDeposits() {
  if (!navigator.onLine) return;

  let pending;
  try {
    pending = await getOfflineDeposits();
  } catch {
    return;
  }

  notify(pending.length);
  if (pending.length === 0) return;

  const recordDeposit = httpsCallable(functions, "recordDeposit");

  for (const deposit of pending) {
    try {
      await recordDeposit({
        memberId: deposit.memberId,
        userId: deposit.userId,
        groupId: deposit.groupId,
        amount: deposit.amount,
        channel: "agent_qr",
        source: "offline",
      });
      await markDepositSynced(deposit.localId);
    } catch {
      // Network still unavailable or transient error — retry next cycle.
    }
  }

  try {
    await deleteSyncedDeposits();
    const remaining = await getOfflineDeposits();
    notify(remaining.length);
  } catch {
    // Non-critical cleanup failure
  }
}

/** Start the background sync loop. Safe to call multiple times. */
export function startSyncService() {
  if (intervalId !== null) return;
  syncDeposits(); // run immediately on start
  intervalId = setInterval(syncDeposits, SYNC_INTERVAL_MS);
}

/** Stop the background sync loop. */
export function stopSyncService() {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

/** One-shot read of the pending count. */
export async function getPendingCount() {
  const pending = await getOfflineDeposits();
  return pending.length;
}
