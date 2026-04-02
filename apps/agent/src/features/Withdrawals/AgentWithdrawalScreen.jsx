import { useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { ManualMemberLookup, QrScanner, fetchMemberByMemberId } from "../../utils/memberLookup";
import { PageShell, Card, Alert, PrimaryButton, formatBIF } from "../../components/ui";

const SCREEN = {
  SCANNING: "scanning",
  MANUAL_LOOKUP: "manual_lookup",
  MEMBER_FOUND: "member_found",
  RECEIPT: "receipt",
};

export default function AgentWithdrawalScreen({ user }) {
  const [screen,      setScreen]      = useState(SCREEN.SCANNING);
  const [memberData,  setMemberData]  = useState(null);
  const [amount,      setAmount]      = useState("");
  const [notes,       setNotes]       = useState("");
  const [looking,     setLooking]     = useState(false);
  const [lookError,   setLookError]   = useState("");
  const [submitting,  setSubmitting]  = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [receipt,     setReceipt]     = useState(null);

  // Scan → Fetch member → Fetch wallet (two-stage lookup)
  async function handleScan(qrText) {
    setLookError("");
    let data;
    try {
      data = JSON.parse(qrText);
    } catch {
      setLookError("Invalid QR code format.");
      return;
    }
    if (!data?.memberId) {
      setLookError("QR code is missing member ID.");
      return;
    }
    await loadMemberAndWallet(data.memberId);
  }

  async function loadMemberAndWallet(memberId) {
    setLooking(true);
    setLookError("");
    try {
      const member = await fetchMemberByMemberId(memberId.trim());
      if (!member) {
        setLookError(`No member found for ID "${memberId}".`);
        return;
      }
      if (!member.isSelectable) {
        setLookError(member.restriction || "This member cannot be selected.");
        return;
      }
      await loadSelectedMember(member);
    } catch (err) {
      setLookError(err.message || "Lookup failed. Check connection and try again.");
    } finally {
      setLooking(false);
    }
  }

  async function loadSelectedMember(member) {
    try {
      const [userSnap, walletSnap] = await Promise.all([
        getDoc(doc(db, "users", member.userId)),
        getDoc(doc(db, "wallets", member.userId)),
      ]);

      if (!userSnap.exists()) {
        setLookError("Member data not found.");
        return;
      }

      const u = userSnap.data();
      const w = walletSnap.exists() ? walletSnap.data() : {};

      setMemberData({
        uid: member.userId,
        memberId: member.memberId,
        name: u.fullName || member.fullName || "—",
        phone: u.phone || member.phone || "—",
        groupId: member.groupId ?? null,
        wallet: w
      });
      setScreen(SCREEN.MEMBER_FOUND);
    } catch (err) {
      setLookError(err.message || "Lookup failed. Check connection and try again.");
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setSubmitError("Enter a valid amount."); return; }
    setSubmitting(true);
    setSubmitError("");
    try {
      const fn  = httpsCallable(functions, "recordWithdrawal");
      const res = await fn({ userId: memberData.uid, amount: parsed, notes: notes.trim() });
      setReceipt({ ...res.data, amount: parsed, memberName: memberData.name });
      setScreen(SCREEN.RECEIPT);
      setAmount("");
      setNotes("");
    } catch (err) {
      setSubmitError(err.message || "Withdrawal failed.");
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setScreen(SCREEN.SCANNING);
    setMemberData(null);
    setAmount("");
    setNotes("");
    setLookError("");
    setSubmitError("");
    setReceipt(null);
  }

  return (
    <PageShell title="Process Withdrawal" showBack user={user}>

      {/* ── SCANNING STATE ── */}
      {screen === SCREEN.SCANNING && (
        <>
          <p className="text-sm text-slate-500 text-center">Point the camera at member QR code</p>

          <Card>
            <div className="overflow-hidden rounded-3xl">
              <QrScanner onScan={handleScan} />
            </div>
          </Card>

          <button
            type="button"
            onClick={() => { setLookError(""); setScreen(SCREEN.MANUAL_LOOKUP); }}
            className="w-full rounded-2xl border-2 border-brand-100 bg-white px-4 py-3 text-sm font-bold text-brand-600 hover:bg-brand-50 transition-colors"
          >
            Can't scan? Find member manually
          </button>

          {looking && (
            <div className="flex items-center justify-center gap-2 py-2">
              <svg className="w-4 h-4 animate-spin text-brand-500" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-sm text-brand-600 font-medium">Looking up member…</p>
            </div>
          )}

          {lookError && (
            <Alert type="error">
              <div className="flex items-start justify-between gap-2">
                <span>{lookError}</span>
                <button onClick={() => setLookError("")} className="text-red-400 hover:text-red-600 shrink-0">×</button>
              </div>
            </Alert>
          )}
        </>
      )}

      {screen === SCREEN.MANUAL_LOOKUP && (
        <>
          <ManualMemberLookup
            onCancel={reset}
            onSelect={async (selectedMember) => {
              setLookError("");
              setLooking(true);
              await loadSelectedMember(selectedMember);
              setLooking(false);
            }}
          />
          {lookError ? <Alert type="error">{lookError}</Alert> : null}
        </>
      )}

      {/* ── MEMBER FOUND STATE ── */}
      {screen === SCREEN.MEMBER_FOUND && memberData && (
        <>
          {/* Member identity hero */}
          <div className="bg-brand-800 rounded-2xl px-5 py-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-300 mb-2">Member</p>
            <p className="text-xl font-bold text-white truncate">{memberData.name}</p>
            <p className="text-sm text-brand-300 mt-0.5">{memberData.phone}</p>

            <div className="mt-4 pt-4 border-t border-brand-700 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-brand-400 uppercase tracking-wide">Available</p>
                <p className="text-base font-bold text-white mt-0.5">
                  {formatBIF(memberData.wallet.availableBalance)}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-brand-400 uppercase tracking-wide">Locked</p>
                <p className="text-base font-bold text-gold-300 mt-0.5">
                  {formatBIF(memberData.wallet.balanceLocked)}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={reset}
              className="text-xs text-brand-400 hover:text-brand-200 mt-3 font-semibold"
            >
              ← Scan different member
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <Card>
              <div className="px-5 py-5 space-y-4">
                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Withdrawal Amount (BIF)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setSubmitError(""); }}
                    placeholder={`Available: ${formatBIF(memberData.wallet.availableBalance)}`}
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-base text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
                  />
                  <p className="text-[11px] text-slate-400">Amounts ≥ 50,000 BIF require admin approval.</p>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
                    Notes (optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason or reference"
                    className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
                  />
                </div>
              </div>
            </Card>

            {submitError && <Alert type="error">{submitError}</Alert>}

            <PrimaryButton type="submit" loading={submitting} disabled={!amount}>
              {submitting ? "Processing…" : "Process Withdrawal"}
            </PrimaryButton>
          </form>
        </>
      )}

      {/* ── RECEIPT STATE ── */}
      {screen === SCREEN.RECEIPT && receipt && (
        <Card>
          <div className="px-5 py-8 flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-bold text-slate-800">Withdrawal Processed</p>
              {receipt.status !== "confirmed" && (
                <p className="text-sm text-gold-600 font-medium mt-1">Large withdrawal submitted for approval.</p>
              )}
            </div>

            <div className="w-full bg-slate-50 rounded-2xl divide-y divide-white">
              <ReceiptRow label="Member"  value={receipt.memberName} />
              <ReceiptRow label="Amount"  value={formatBIF(receipt.amount)} />
              {receipt.receiptNo && <ReceiptRow label="Receipt No." value={receipt.receiptNo} mono />}
              <ReceiptRow label="Status"  value={receipt.status === "confirmed" ? "Confirmed" : "Pending Approval"} />
            </div>

            {receipt.status !== "confirmed" && (
              <Alert type="warning">
                This is a large withdrawal (≥ 50,000 BIF). It has been submitted for admin approval and the member will be notified.
              </Alert>
            )}

            <button type="button" onClick={reset}
              className="w-full py-3.5 rounded-2xl border-2 border-brand-100 text-sm font-bold text-brand-600 hover:bg-brand-50 transition-colors">
              Process Another Withdrawal
            </button>
          </div>
        </Card>
      )}

    </PageShell>
  );
}

function ReceiptRow({ label, value, mono = false }) {
  return (
    <div className="px-4 py-3 flex items-center justify-between gap-2">
      <span className="text-xs text-slate-400">{label}</span>
      <span className={`text-sm font-semibold text-slate-800 ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}
