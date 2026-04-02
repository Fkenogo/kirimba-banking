import { useState, useEffect, useRef } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import { ManualMemberLookup, QrScanner, fetchMemberByMemberId } from "../../utils/memberLookup";
import { saveOfflineDeposit } from "../../services/offlineDeposits";
import { onPendingCountChange, getPendingCount } from "../../services/depositSyncService";
import { PageShell, Card, Alert, PrimaryButton } from "../../components/ui";

const SCREEN = {
  SCANNING:     "scanning",
  MANUAL_LOOKUP:"manual_lookup",
  MEMBER_FOUND: "member_found",
};

const QUICK_AMOUNTS = [1000, 2000, 5000, 10000];
const FLASH_MS = 2000;

/* ── Last-amount memory (persisted across sessions) ── */
function readLastAmount(memberId) {
  try { return localStorage.getItem(`kla-${memberId}`) ?? ""; } catch { return ""; }
}
function writeLastAmount(memberId, amount) {
  try { localStorage.setItem(`kla-${memberId}`, String(amount)); } catch {}
}

function isNetworkError(err) {
  return (
    !navigator.onLine ||
    err?.code === "functions/unavailable" ||
    err?.code === "functions/internal" ||
    err?.message?.toLowerCase().includes("network")
  );
}

/* ── Main screen ── */
export default function ScanDepositScreen({ user }) {
  const [screen, setScreen]       = useState(SCREEN.SCANNING);
  const [member, setMember]       = useState(null);
  const [amount, setAmount]       = useState("");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [isOnline, setIsOnline]   = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [flash, setFlash]         = useState(null);
  const flashTimerRef             = useRef(null);

  /* Online/offline tracking */
  useEffect(() => {
    const up   = () => setIsOnline(true);
    const down = () => setIsOnline(false);
    window.addEventListener("online",  up);
    window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  useEffect(() => {
    getPendingCount().then(setPendingCount);
    return onPendingCountChange(setPendingCount);
  }, []);

  useEffect(() => () => clearTimeout(flashTimerRef.current), []);

  function showFlash(type, fm, fa) {
    clearTimeout(flashTimerRef.current);
    setFlash({ type, member: fm, amount: fa });
    flashTimerRef.current = setTimeout(() => setFlash(null), FLASH_MS);
  }

  /* Member lookup */
  function applySelectedMember(found) {
    setAmount(readLastAmount(found.memberId));
    setMember(found);
    setScreen(SCREEN.MEMBER_FOUND);
  }

  async function loadMember(memberId) {
    setLoading(true);
    setError(null);
    try {
      const found = await fetchMemberByMemberId(memberId.trim());
      if (!found) { setError(`No member found for ID "${memberId}".`); return; }
      if (!found.isSelectable) { setError(found.restriction || "This member cannot be selected."); return; }
      applySelectedMember(found);
    } catch {
      setError("Failed to load member. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleScan(text) {
    let data;
    try { data = JSON.parse(text); } catch { setError("Invalid QR code format."); return; }
    if (!data?.memberId) { setError("QR code is missing member ID."); return; }
    await loadMember(data.memberId);
  }

  /* Deposit submit */
  async function handleSubmit() {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) { setError("Enter a valid deposit amount."); return; }

    setLoading(true);
    setError(null);
    const submittedMember = member;
    const submittedAmount = parsed;

    try {
      const recordDeposit = httpsCallable(functions, "recordDeposit");
      await recordDeposit({
        memberId: member.memberId,
        userId: member.userId,
        groupId: member.groupId,
        amount: parsed,
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
          amount: parsed,
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
  }

  return (
    <PageShell title="Scan Deposit" user={user}>

      {/* ── Status pills ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {!isOnline && (
          <span className="inline-flex items-center gap-1.5 bg-gold-100 text-gold-700 border border-gold-200 text-xs font-semibold px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-gold-500 inline-block" />
            Offline Mode
          </span>
        )}
        {pendingCount > 0 && (
          <span className="inline-flex items-center gap-1.5 bg-brand-50 text-brand-700 border border-brand-100 text-xs font-semibold px-3 py-1.5 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-brand-500 animate-pulse inline-block" />
            {pendingCount} pending sync
          </span>
        )}
      </div>

      {/* ── Flash banner ── */}
      {flash && (
        <div className={`rounded-2xl border px-4 py-3 flex items-start gap-3 ${
          flash.type === "offline"
            ? "bg-gold-50 border-gold-200"
            : "bg-brand-50 border-brand-200"
        }`}>
          <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
            flash.type === "offline" ? "bg-gold-100" : "bg-brand-100"
          }`}>
            {flash.type === "offline" ? (
              <svg className="w-4 h-4 text-gold-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </div>
          <div className="flex-1">
            <p className={`text-sm font-bold ${flash.type === "offline" ? "text-gold-800" : "text-brand-800"}`}>
              {flash.type === "offline" ? "Saved Offline" : "Deposit Recorded"}
            </p>
            <p className="text-xs text-slate-600 mt-0.5">
              {flash.member.fullName} · {Number(flash.amount).toLocaleString()} BIF
            </p>
            {flash.type === "offline" && (
              <p className="text-xs text-gold-600 mt-0.5">Will sync automatically when online.</p>
            )}
          </div>
          <button onClick={() => setFlash(null)} className="text-slate-300 hover:text-slate-500 text-xl leading-none">×</button>
        </div>
      )}

      {/* ── SCANNING state ── */}
      {screen === SCREEN.SCANNING && (
        <>
          <p className="text-sm text-slate-500 text-center">Point the camera at a member QR code</p>

          {/* QR camera view */}
          <Card>
            <div className="rounded-3xl overflow-hidden">
              <QrScanner onScan={handleScan} />
            </div>
          </Card>

          <button
            type="button"
            onClick={() => { setError(null); setScreen(SCREEN.MANUAL_LOOKUP); }}
            className="w-full rounded-2xl border-2 border-brand-100 bg-white px-4 py-3 text-sm font-bold text-brand-600 hover:bg-brand-50 transition-colors"
          >
            Can't scan? Find member manually
          </button>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-2">
              <svg className="w-4 h-4 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-sm text-brand-600 font-medium">Looking up member…</p>
            </div>
          )}

          {/* Error (scanning state) */}
          {error && (
            <Alert type="error">
              <div className="flex items-start justify-between gap-2">
                <span>{error}</span>
                <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 shrink-0">×</button>
              </div>
            </Alert>
          )}
        </>
      )}

      {screen === SCREEN.MANUAL_LOOKUP && (
        <ManualMemberLookup
          onCancel={reset}
          onSelect={(selectedMember) => {
            setError(null);
            applySelectedMember(selectedMember);
          }}
        />
      )}

      {/* ── MEMBER FOUND state ── */}
      {screen === SCREEN.MEMBER_FOUND && member && (
        <>
          {/* Member identity card */}
          <Card>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Member</p>
                <p className="text-xl font-bold text-slate-900 truncate">{member.fullName}</p>
                <p className="text-sm font-mono text-brand-600 mt-0.5">{member.memberId}</p>
                {member.groupId && <p className="text-xs text-slate-400 mt-0.5">{member.groupId}</p>}
              </div>
              <button
                onClick={reset}
                className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center shrink-0"
                aria-label="Change member"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </Card>

          {!isOnline && (
            <Alert type="warning">
              Offline — this deposit will be saved locally and synced when your connection returns.
            </Alert>
          )}

          {/* Amount entry */}
          <Card>
            <div className="px-5 py-5 space-y-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Deposit Amount</p>

              {/* Quick amounts */}
              <div className="grid grid-cols-4 gap-2">
                {QUICK_AMOUNTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setAmount(String(q))}
                    className={`py-2.5 rounded-xl text-xs font-bold border-2 transition-colors ${
                      amount === String(q)
                        ? "bg-brand-500 text-white border-brand-500"
                        : "bg-slate-50 text-slate-700 border-slate-100 hover:border-brand-300"
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
                placeholder="or enter custom amount (BIF)"
                min="1"
                autoFocus
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-base text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
              />
            </div>
          </Card>

          {error && <Alert type="error">{error}</Alert>}

          <PrimaryButton loading={loading} disabled={!amount} onClick={handleSubmit}>
            {loading ? "Recording…" : "Record Deposit"}
          </PrimaryButton>

          <button onClick={reset} className="w-full text-sm text-slate-400 hover:text-slate-600 py-2">
            ← Scan a different member
          </button>
        </>
      )}

    </PageShell>
  );
}
