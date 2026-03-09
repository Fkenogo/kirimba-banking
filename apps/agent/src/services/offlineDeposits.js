const DB_NAME = "kirimba-offline";
const DB_VERSION = 1;
const STORE = "pending-deposits";

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "localId", autoIncrement: true });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save a deposit locally. Returns the auto-assigned localId. */
export async function saveOfflineDeposit(deposit) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.add({ ...deposit, synced: false });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Return all deposits that have not been synced yet. */
export async function getOfflineDeposits() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result.filter((d) => !d.synced));
    req.onerror = () => reject(req.error);
  });
}

/** Mark a single deposit as synced by its localId. */
export async function markDepositSynced(localId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const getReq = store.get(localId);

    getReq.onsuccess = () => {
      const record = getReq.result;
      if (!record) { resolve(); return; }
      const putReq = store.put({ ...record, synced: true });
      putReq.onsuccess = () => resolve();
      putReq.onerror = () => reject(putReq.error);
    };

    getReq.onerror = () => reject(getReq.error);
  });
}

/** Delete all deposits that have been successfully synced. */
export async function deleteSyncedDeposits() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAll();

    req.onsuccess = () => {
      const synced = req.result.filter((d) => d.synced);
      if (synced.length === 0) { resolve(); return; }

      let remaining = synced.length;
      for (const d of synced) {
        const del = store.delete(d.localId);
        del.onsuccess = () => { if (--remaining === 0) resolve(); };
        del.onerror = () => reject(del.error);
      }
    };

    req.onerror = () => reject(req.error);
  });
}
