import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}

export default function AgentWithdrawalScreen({ user }) {
  const navigate = useNavigate();
  const [memberId, setMemberId] = useState("");
  const [memberData, setMemberData] = useState(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [looking, setLooking] = useState(false);
  const [lookError, setLookError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [receipt, setReceipt] = useState(null);

  async function handleLookup(e) {
    e.preventDefault();
    setLookError("");
    setMemberData(null);
    setReceipt(null);
    const uid = memberId.trim();
    if (!uid) return;
    setLooking(true);
    try {
      const [userSnap, walletSnap] = await Promise.all([
        getDoc(doc(db, "users", uid)),
        getDoc(doc(db, "wallets", uid)),
      ]);
      if (!userSnap.exists()) {
        setLookError("Member not found. Check the ID and try again.");
        return;
      }
      const u = userSnap.data();
      const w = walletSnap.exists() ? walletSnap.data() : {};
      setMemberData({ uid, name: u.fullName || "—", phone: u.phone || "—", wallet: w });
    } catch (err) {
      setLookError(err.message || "Lookup failed.");
    } finally {
      setLooking(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setSubmitError("Enter a valid amount.");
      return;
    }
    setSubmitting(true);
    setSubmitError("");
    try {
      const fn = httpsCallable(functions, "recordWithdrawal");
      const res = await fn({ userId: memberData.uid, amount: parsed, notes: notes.trim() });
      setReceipt({ ...res.data, amount: parsed, memberName: memberData.name });
      setMemberData(null);
      setMemberId("");
      setAmount("");
      setNotes("");
    } catch (err) {
      setSubmitError(err.message || "Withdrawal failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">

        <div>
          <button type="button" onClick={() => navigate("/agent/home")}
            className="mb-1 text-xs text-slate-500 hover:text-slate-700">← Home</button>
          <h1 className="text-xl font-bold text-slate-900">Process Withdrawal</h1>
          <p className="text-xs text-slate-400 mt-0.5">Disburse cash to a member</p>
        </div>

        {/* Success */}
        {receipt && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-5 space-y-3 text-center">
            <div className="text-3xl">✓</div>
            <h3 className="text-base font-bold text-green-800">Withdrawal Processed</h3>
            <div className="rounded-lg bg-white border border-green-100 divide-y divide-green-50 text-sm text-left">
              <DetailRow label="Member" value={receipt.memberName} />
              <DetailRow label="Amount" value={formatBIF(receipt.amount)} />
              {receipt.receiptNo && <DetailRow label="Receipt" value={receipt.receiptNo} />}
              <DetailRow label="Status" value={receipt.status === "confirmed" ? "Confirmed" : "Pending approval"} />
            </div>
            {receipt.status !== "confirmed" && (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                Large withdrawal submitted for approval. Member will be notified.
              </p>
            )}
            <button type="button" onClick={() => setReceipt(null)}
              className="text-sm font-medium text-green-700 underline underline-offset-2">
              Process another withdrawal
            </button>
          </div>
        )}

        {!receipt && (
          <>
            {/* Member lookup */}
            <form onSubmit={handleLookup} className="rounded-xl bg-white border border-slate-200 px-4 py-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Member ID / UID</p>
              <input
                type="text"
                value={memberId}
                onChange={(e) => { setMemberId(e.target.value); setLookError(""); setMemberData(null); }}
                placeholder="Paste or scan member UID"
                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
              {lookError && <p className="text-sm text-red-600">{lookError}</p>}
              <button type="submit" disabled={looking || !memberId.trim()}
                className="w-full rounded-xl bg-indigo-600 text-white font-semibold py-3 text-sm disabled:opacity-50">
                {looking ? "Looking up…" : "Look Up Member"}
              </button>
            </form>

            {/* Member info + withdrawal form */}
            {memberData && (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Member card */}
                <div className="rounded-xl bg-slate-800 text-white px-4 py-4 space-y-2">
                  <p className="text-xs text-slate-400 font-medium uppercase tracking-wide">Member</p>
                  <p className="text-base font-bold">{memberData.name}</p>
                  <p className="text-xs text-slate-400">{memberData.phone}</p>
                  <div className="pt-2 border-t border-slate-700 grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <p className="text-slate-400">Available</p>
                      <p className="font-semibold text-green-400">{formatBIF(memberData.wallet.availableBalance)}</p>
                    </div>
                    <div>
                      <p className="text-slate-400">Locked</p>
                      <p className="font-semibold text-amber-400">{formatBIF(memberData.wallet.balanceLocked)}</p>
                    </div>
                  </div>
                  <button type="button" onClick={() => { setMemberData(null); setMemberId(""); }}
                    className="text-xs text-slate-400 hover:text-slate-200 pt-1">
                    Change member
                  </button>
                </div>

                {/* Amount */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Withdrawal Amount (BIF)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    min="1"
                    step="1"
                    value={amount}
                    onChange={(e) => { setAmount(e.target.value); setSubmitError(""); }}
                    placeholder={`Available: ${formatBIF(memberData.wallet.availableBalance)}`}
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-xs text-slate-400 mt-1">Amounts ≥ 50,000 BIF require admin approval.</p>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes (optional)</label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Reason or reference"
                    className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>

                {submitError && (
                  <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">{submitError}</p>
                )}

                <button type="submit" disabled={submitting || !amount}
                  className="w-full rounded-xl bg-blue-600 text-white font-semibold py-3 text-sm disabled:opacity-50">
                  {submitting ? "Processing…" : "Process Withdrawal"}
                </button>
              </form>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function DetailRow({ label, value }) {
  return (
    <div className="px-4 py-2.5 flex justify-between items-center">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="font-medium text-slate-900 text-sm">{value}</span>
    </div>
  );
}
