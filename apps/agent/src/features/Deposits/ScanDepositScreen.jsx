import { useState, useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { saveOfflineDeposit } from "../../services/offlineDeposits";
import { onPendingCountChange, getPendingCount } from "../../services/depositSyncService";

const SCREEN = {
  SCANNING: "scanning",
  MEMBER_FOUND: "member_found",
};

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000];
const FLASH_MS = 1500;
const SCANNER_ID = "kirimba-qr-scanner";

// ── Last-amount memory (per member, persisted across sessions) ───────────────
function readLastAmount(memberId) {
  try { return localStorage.getItem(`kla-${memberId}`) ?? ""; }
  catch { return ""; }
}
function writeLastAmount(memberId, amount) {
  try { localStorage.setItem(`kla-${memberId}`, String(amount)); }
  catch {}
}

// ── QR scanner component ─────────────────────────────────────────────────────
function QrScanner({ onScan }) {
  const activeRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ID);
    activeRef.current = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => {
          if (!activeRef.current) {
            activeRef.current = true;
            onScan(text);
          }
        },
        () => {}
      )
      .catch(() => {});

    return () => {
      scanner.isScanning ? scanner.stop().catch(() => {}) : Promise.resolve();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div id={SCANNER_ID} className="w-full aspect-square rounded-2xl overflow-hidden bg-black" />;
}

// ── Firestore lookup ─────────────────────────────────────────────────────────
async function fetchMemberByMemberId(memberId) {
  const snap = await getDocs(
    query(collection(db, "users"), where("memberId", "==", memberId))
  );
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  return {
    userId: snap.docs[0].id,
    memberId: d.memberId,
    fullName: d.name ?? d.fullName ?? "Unknown",
    groupId: d.groupId ?? null,
    phone: d.phone ?? null,
  };
}

function isNetworkError(err) {
  return (
    !navigator.onLine ||
    err?.code === "functions/unavailable" ||
    err?.code === "functions/internal" ||
    err?.message?.toLowerCase().includes("network")
  );
}

// ── Flash banner ─────────────────────────────────────────────────────────────
function FlashBanner({ flash, onDismiss }) {
  if (!flash) return null;
  const isOffline = flash.type === "offline";

  return (
    <div
      className={`rounded-xl border px-4 py-3 flex items-start gap-3 ${
        isOffline
          ? "bg-amber-50 border-amber-200"
          : "bg-green-50 border-green-200"
      }`}
    >
      <span className={`mt-0.5 text-base ${isOffline ? "text-amber-500" : "text-green-500"}`}>
        {isOffline ? "⏳" : "✓"}
      </span>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isOffline ? "text-amber-800" : "text-green-800"}`}>
          {isOffline ? "Saved Offline" : "Deposit Recorded"}
        </p>
        <p className="text-xs text-slate-600 mt-0.5 truncate">
          {flash.member.fullName} &middot; {Number(flash.amount).toLocaleString()} BIF
        </p>
        {isOffline && (
          <p className="text-xs text-amber-600 mt-0.5">Will sync automatically when online.</p>
        )}
      </div>
      <button
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-600 text-lg leading-none shrink-0"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}

// ── Main screen ──────────────────────────────────────────────────────────────
export default function ScanDepositScreen({ user }) {
  const [screen, setScreen] = useState(SCREEN.SCANNING);
  const [member, setMember] = useState(null);
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manualId, setManualId] = useState("");
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [flash, setFlash] = useState(null); // { type, member, amount }

  const flashTimerRef = useRef(null);

  // ── Online/offline tracking ──
  useEffect(() => {
    const up = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    return () => {
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
    };
  }, []);

  // ── Pending sync count ──
  useEffect(() => {
    getPendingCount().then(setPendingCount);
    return onPendingCountChange(setPendingCount);
  }, []);

  // ── Cleanup flash timer on unmount ──
  useEffect(() => () => { clearTimeout(flashTimerRef.current); }, []);

  // ── Flash helpers ──
  function showFlash(type, flashMember, flashAmount) {
    clearTimeout(flashTimerRef.current);
    setFlash({ type, member: flashMember, amount: flashAmount });
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS);
  }
  function dismissFlash() {
    clearTimeout(flashTimerRef.current);
    setFlash(null);
  }

  // ── Member load ──
  async function loadMember(memberId) {
    setLoading(true);
    setError(null);
    try {
      const found = await fetchMemberByMemberId(memberId.trim());
      if (!found) {
        setError(`No member found with ID "${memberId}".`);
        return;
      }
      setAmount(readLastAmount(found.memberId)); // pre-fill last amount
      setMember(found);
      setScreen(SCREEN.MEMBER_FOUND);
    } catch {
      setError("Failed to load member info. Try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleScan(text) {
    let data;
    try { data = JSON.parse(text); }
    catch { setError("Invalid QR code format."); return; }
    if (!data?.memberId) { setError("QR code is missing memberId."); return; }
    await loadMember(data.memberId);
  }

  async function handleManualLoad() {
    if (!manualId.trim()) { setError("Enter a Member ID."); return; }
    await loadMember(manualId);
  }

  // ── Deposit submit ──
  async function handleSubmit() {
    const parsedAmount = parseFloat(amount);
    if (!parsedAmount || parsedAmount <= 0) { setError("Enter a valid amount."); return; }

    setLoading(true);
    setError(null);

    // Capture before reset
    const submittedMember = member;
    const submittedAmount = parsedAmount;

    try {
      const recordDeposit = httpsCallable(functions, "recordDeposit");
      await recordDeposit({
        memberId: member.memberId,
        userId: member.userId,
        groupId: member.groupId,
        amount: parsedAmount,
        channel: "agent_qr",
        source: "online",
      });
      writeLastAmount(member.memberId, amount);
      reset();
      showFlash("success", submittedMember, submittedAmount);
    } catch (err) {
      if (isNetworkError(err)) {
        await saveOfflineDeposit({
          memberId: member.memberId,
          userId: member.userId,
          groupId: member.groupId ?? null,
          amount: parsedAmount,
          agentId: user?.uid ?? null,
          createdAt: new Date().toISOString(),
        });
        writeLastAmount(member.memberId, amount);
        setPendingCount((c) => c + 1);
        reset();
        showFlash("offline", submittedMember, submittedAmount);
      } else {
        setError(err.message || "Failed to record deposit.");
      }
    } finally {
      setLoading(false);
    }
  }

  function reset() {
    setScreen(SCREEN.SCANNING);
    setMember(null);
    setAmount("");
    setError(null);
    setManualId("");
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-800">Scan Deposit</h1>
            <p className="text-xs text-slate-400 mt-0.5">Agent QR deposit workflow</p>
          </div>
          <div className="flex flex-col items-end gap-0.5">
            {!isOnline && (
              <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs font-medium px-2 py-0.5 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" />
                Offline Mode
              </span>
            )}
            {pendingCount > 0 && (
              <span className="text-xs text-slate-400">
                Pending Sync: {pendingCount} deposit{pendingCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 p-4 max-w-md mx-auto w-full space-y-4">

        {/* ── Scanning ── */}
        {screen === SCREEN.SCANNING && (
          <div className="space-y-4">
            {/* Flash banner (auto-dismisses in 1.5s) */}
            <FlashBanner flash={flash} onDismiss={dismissFlash} />

            <p className="text-sm text-slate-500 text-center">
              Point the camera at a member&apos;s QR code
            </p>

            <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
              <QrScanner onScan={handleScan} />
            </div>

            {loading && (
              <p className="text-sm text-center text-blue-600 animate-pulse">
                Looking up member…
              </p>
            )}

            {/* Manual fallback */}
            <div className="pt-2">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-xs text-slate-400 whitespace-nowrap">or enter manually</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>
              <p className="text-sm font-medium text-slate-700 mb-2">Enter Member ID</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualLoad()}
                  placeholder="e.g. G01-023"
                  className="flex-1 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white text-sm"
                />
                <button
                  onClick={handleManualLoad}
                  disabled={loading || !manualId.trim()}
                  className="bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors"
                >
                  Load Member
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Member found + amount entry ── */}
        {screen === SCREEN.MEMBER_FOUND && member && (
          <div className="space-y-4">
            {/* Member card */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                  Member
                </p>
                <p className="text-xl font-semibold text-slate-800 truncate">{member.fullName}</p>
                <p className="text-sm font-mono text-blue-600 mt-0.5">{member.memberId}</p>
                {member.groupId && (
                  <p className="text-sm text-slate-500 mt-0.5">{member.groupId}</p>
                )}
              </div>
              <button
                onClick={reset}
                className="text-slate-300 hover:text-slate-500 text-xl leading-none shrink-0 mt-1"
                aria-label="Change member"
              >
                ×
              </button>
            </div>

            {!isOnline && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                <p className="text-sm text-amber-700">
                  Offline — deposit will sync when connection returns.
                </p>
              </div>
            )}

            {/* Amount input */}
            <div className="space-y-2">
              <label className="block text-sm font-medium text-slate-700">
                Deposit Amount (BIF)
              </label>

              {/* Quick amount buttons */}
              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(String(q))}
                    className={`py-2 rounded-xl text-sm font-medium border transition-colors ${
                      amount === String(q)
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-white text-slate-700 border-slate-300 hover:border-blue-400 hover:text-blue-600"
                    }`}
                  >
                    {q.toLocaleString()}
                  </button>
                ))}
              </div>

              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="or enter custom amount"
                min="1"
                autoFocus
                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-slate-800 text-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>

            <button
              onClick={handleSubmit}
              disabled={loading || !amount}
              className="w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white py-3.5 rounded-xl font-semibold text-base transition-colors"
            >
              {loading ? "Recording…" : "Record Deposit"}
            </button>

            <button
              onClick={reset}
              className="w-full text-slate-400 hover:text-slate-600 text-sm py-2 transition-colors"
            >
              Scan a different member
            </button>
          </div>
        )}

        {/* ── Error banner ── */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-start gap-2">
            <p className="text-sm text-red-600 flex-1">{error}</p>
            <button
              onClick={() => setError(null)}
              className="text-red-300 hover:text-red-500 text-lg leading-none shrink-0"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
