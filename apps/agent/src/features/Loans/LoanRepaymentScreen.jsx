import { useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { ManualMemberLookup, QrScanner, fetchMemberByMemberId } from "../../utils/memberLookup.jsx";
import { PageShell, Card, SectionLabel, Alert, PrimaryButton, StatusBadge, formatBIF, formatDate } from "../../components/ui";

const SCREEN   = { SCANNING: "scanning", MANUAL_LOOKUP: "manual_lookup", LOANS: "loans", REPAY: "repay", RECEIPT: "receipt" };
const CHANNELS = ["agent", "institution_branch"];

export default function LoanRepaymentScreen({ user }) {
  const [screen, setScreen]           = useState(SCREEN.SCANNING);
  const [member, setMember]           = useState(null);
  const [loans, setLoans]             = useState([]);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [amount, setAmount]           = useState("");
  const [channel, setChannel]         = useState("agent");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [repaying, setRepaying]       = useState(false);
  const [receipt, setReceipt]         = useState(null);

  /* ── Member + loan lookup ── */
  async function loadSelectedMember(found) {
    const snap = await getDocs(
      query(collection(db, "loans"), where("userId", "==", found.userId), where("status", "==", "active"))
    );
    setMember(found);
    setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    setScreen(SCREEN.LOANS);
  }

  async function loadMember(memberId) {
    setLoading(true);
    setError(null);
    try {
      const found = await fetchMemberByMemberId(memberId.trim());
      if (!found) { setError(`No member found for "${memberId}".`); return; }
      if (!found.isSelectable) { setError(found.restriction || "This member cannot be selected."); return; }
      await loadSelectedMember(found);
    } catch (err) {
      setError(err.message || "Lookup failed. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleScan(text) {
    let data;
    try { data = JSON.parse(text); } catch { setError("Invalid QR code."); return; }
    if (!data?.memberId) { setError("QR code is missing memberId."); return; }
    loadMember(data.memberId);
  }

  function selectLoan(loan) {
    setSelectedLoan(loan);
    setAmount("");
    setError(null);
    setScreen(SCREEN.REPAY);
  }

  /* ── Repayment ── */
  async function handleRepay(e) {
    e.preventDefault();
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setError("Enter a valid amount."); return; }
    if (parsed > Number(selectedLoan.remainingDue || 0)) {
      setError(`Amount exceeds remaining due of ${formatBIF(selectedLoan.remainingDue)}.`);
      return;
    }
    setRepaying(true);
    setError(null);
    try {
      const fn  = httpsCallable(functions, "recordRepayment");
      const res = await fn({ loanId: selectedLoan.id, amount: parsed, channel });
      setReceipt({ ...res.data, loanId: selectedLoan.id, memberName: member.fullName });
      setScreen(SCREEN.RECEIPT);
    } catch (err) {
      setError(err.message || "Repayment failed.");
    } finally {
      setRepaying(false);
    }
  }

  function reset() {
    setScreen(SCREEN.SCANNING);
    setMember(null);
    setLoans([]);
    setSelectedLoan(null);
    setAmount("");
    setError(null);
    setReceipt(null);
    setRepaying(false);
  }

  return (
    <PageShell title="Record Repayment" user={user}>

      {/* ── SCANNING ── */}
      {screen === SCREEN.SCANNING && (
        <>
          <p className="text-sm text-slate-500 text-center">Point the camera at a member QR code</p>

          <Card>
            <div className="overflow-hidden rounded-3xl">
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

          {error && <Alert type="error">{error}</Alert>}
        </>
      )}

      {screen === SCREEN.MANUAL_LOOKUP && (
        <>
          <ManualMemberLookup
            onCancel={reset}
            onSelect={async (selectedMember) => {
              setLoading(true);
              setError(null);
              try {
                await loadSelectedMember(selectedMember);
              } catch (err) {
                setError(err.message || "Lookup failed. Try again.");
              } finally {
                setLoading(false);
              }
            }}
          />
          {error && <Alert type="error">{error}</Alert>}
        </>
      )}

      {/* ── LOANS list ── */}
      {screen === SCREEN.LOANS && member && (
        <>
          <Card>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Member</p>
                <p className="text-xl font-bold text-slate-900 truncate">{member.fullName}</p>
                <p className="text-sm font-mono text-brand-600 mt-0.5">{member.memberId}</p>
              </div>
              <button onClick={reset} className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </Card>

          {loans.length === 0 ? (
            <Card>
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-semibold text-slate-500">No active loans for this member.</p>
                <button onClick={reset} className="mt-3 text-sm font-bold text-brand-600 hover:text-brand-700">
                  ← Scan a different member
                </button>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              <SectionLabel>Select Loan to Repay ({loans.length})</SectionLabel>
              {loans.map((loan) => (
                <button key={loan.id} type="button" onClick={() => selectLoan(loan)}
                  className="w-full text-left">
                  <Card>
                    <div className="px-5 py-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xl font-bold text-slate-900">{formatBIF(loan.amount)}</p>
                        <StatusBadge status="active" />
                      </div>
                      <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-2xl px-3 py-3">
                        <div>
                          <p className="text-[11px] text-slate-400 uppercase tracking-wide">Remaining Due</p>
                          <p className="text-sm font-bold text-red-600 mt-0.5">{formatBIF(loan.remainingDue)}</p>
                        </div>
                        <div>
                          <p className="text-[11px] text-slate-400 uppercase tracking-wide">Due Date</p>
                          <p className="text-sm font-bold text-slate-800 mt-0.5">{formatDate(loan.dueDate)}</p>
                        </div>
                      </div>
                    </div>
                  </Card>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── REPAY form ── */}
      {screen === SCREEN.REPAY && member && selectedLoan && (
        <>
          {/* Collapsed member + loan info */}
          <Card>
            <div className="px-5 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{member.fullName}</p>
                <p className="text-xs font-mono text-brand-600">{member.memberId}</p>
              </div>
              <button type="button" onClick={reset} className="text-xs font-bold text-slate-400 hover:text-slate-600 shrink-0">Change</button>
            </div>
          </Card>

          {/* Loan summary */}
          <div className="bg-brand-50 border border-brand-100 rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] text-brand-500 uppercase tracking-wide">Loan</p>
              <p className="text-base font-bold text-brand-900">{formatBIF(selectedLoan.amount)}</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-brand-500 uppercase tracking-wide">Remaining Due</p>
              <p className="text-base font-bold text-red-600">{formatBIF(selectedLoan.remainingDue)}</p>
            </div>
            <button type="button"
              onClick={() => { setSelectedLoan(null); setScreen(SCREEN.LOANS); setError(null); }}
              className="text-xs font-bold text-slate-400 hover:text-slate-600 shrink-0">
              Change
            </button>
          </div>

          <form onSubmit={handleRepay} className="space-y-4">
            <Card>
              <div className="px-5 py-5 space-y-4">
                <SectionLabel>Repayment Amount</SectionLabel>

                {/* Full amount shortcut */}
                <button
                  type="button"
                  onClick={() => { setAmount(String(selectedLoan.remainingDue)); setError(null); }}
                  className="w-full rounded-2xl border-2 border-brand-200 bg-brand-50 text-brand-700 font-bold py-3 text-sm hover:bg-brand-100 transition-colors"
                >
                  Full amount — {formatBIF(selectedLoan.remainingDue)}
                </button>

                <input
                  type="number"
                  inputMode="numeric"
                  min="1"
                  value={amount}
                  onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  placeholder="or enter partial amount (BIF)"
                  className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-base text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
                />

                <SectionLabel>Channel</SectionLabel>
                <div className="grid grid-cols-2 gap-2">
                  {CHANNELS.map((ch) => (
                    <button
                      key={ch}
                      type="button"
                      onClick={() => setChannel(ch)}
                      className={`py-2.5 rounded-2xl border-2 text-sm font-bold transition-colors ${
                        channel === ch
                          ? "border-brand-500 bg-brand-50 text-brand-800"
                          : "border-slate-100 bg-slate-50 text-slate-600"
                      }`}
                    >
                      {ch === "agent" ? "Agent (Cash)" : "Branch"}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {error && <Alert type="error">{error}</Alert>}

            <PrimaryButton type="submit" loading={repaying} disabled={!amount}>
              {repaying ? "Recording…" : "Record Repayment"}
            </PrimaryButton>
          </form>
        </>
      )}

      {/* ── RECEIPT ── */}
      {screen === SCREEN.RECEIPT && receipt && (
        <Card>
          <div className="px-5 py-8 flex flex-col items-center text-center space-y-4">
            <div className="w-16 h-16 bg-brand-100 rounded-full flex items-center justify-center">
              <svg className="w-8 h-8 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-lg font-bold text-slate-800">Repayment Recorded</p>
              {receipt.loanStatus === "repaid" && (
                <p className="text-sm text-brand-600 font-semibold mt-1">Loan fully repaid. Collateral released.</p>
              )}
            </div>

            <div className="w-full bg-slate-50 rounded-2xl divide-y divide-white">
              <ReceiptRow label="Member"     value={receipt.memberName} />
              {receipt.receiptNo && <ReceiptRow label="Receipt No." value={receipt.receiptNo} mono />}
              <ReceiptRow label="Loan Status" value={receipt.loanStatus || receipt.status || "—"} />
            </div>

            <button type="button" onClick={reset}
              className="w-full py-3.5 rounded-2xl border-2 border-brand-100 text-sm font-bold text-brand-600 hover:bg-brand-50 transition-colors">
              Record Another Repayment
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
