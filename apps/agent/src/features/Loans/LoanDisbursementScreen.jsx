import { useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { ManualMemberLookup, QrScanner, fetchMemberByMemberId } from "../../utils/memberLookup.jsx";
import { PageShell, Card, SectionLabel, Alert, PrimaryButton, StatusBadge, formatBIF, formatDate } from "../../components/ui";

const SCREEN = { SCANNING: "scanning", MANUAL_LOOKUP: "manual_lookup", LOANS: "loans", RECEIPT: "receipt" };

export default function LoanDisbursementScreen({ user }) {
  const [screen, setScreen]     = useState(SCREEN.SCANNING);
  const [member, setMember]     = useState(null);
  const [loans, setLoans]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [disbursing, setDisbursing] = useState("");
  const [receipt, setReceipt]   = useState(null);

  /* ── Member + loan lookup ── */
  async function loadSelectedMember(found) {
    const snap = await getDocs(
      query(collection(db, "loans"), where("userId", "==", found.userId), where("status", "==", "pending"))
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

  /* ── Disbursement ── */
  async function handleDisburse(loanId) {
    setDisbursing(loanId);
    setError(null);
    try {
      const fn  = httpsCallable(functions, "disburseLoan");
      const res = await fn({ loanId });
      setReceipt({ loanId, memberName: member.fullName, ...res.data });
      setScreen(SCREEN.RECEIPT);
    } catch (err) {
      setError(err.message || "Disbursement failed.");
    } finally {
      setDisbursing("");
    }
  }

  function reset() {
    setScreen(SCREEN.SCANNING);
    setMember(null);
    setLoans([]);
    setError(null);
    setReceipt(null);
    setDisbursing("");
  }

  return (
    <PageShell title="Disburse Loan" user={user}>

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

      {/* ── LOANS ── */}
      {screen === SCREEN.LOANS && member && (
        <>
          {/* Member identity card */}
          <Card>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400 mb-1">Member — confirm identity before handing over cash</p>
                <p className="text-xl font-bold text-slate-900 truncate">{member.fullName}</p>
                <p className="text-sm font-mono text-brand-600 mt-0.5">{member.memberId}</p>
                {member.groupId && <p className="text-xs text-slate-400 mt-0.5">{member.groupId}</p>}
              </div>
              <button
                onClick={reset}
                className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center shrink-0"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </Card>

          {loans.length === 0 ? (
            <Card>
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-semibold text-slate-500">No pending loans for this member.</p>
                <button onClick={reset} className="mt-3 text-sm font-bold text-brand-600 hover:text-brand-700">
                  ← Scan a different member
                </button>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              <SectionLabel>Pending Loans ({loans.length})</SectionLabel>
              {loans.map((loan) => (
                <Card key={loan.id}>
                  <div className="px-5 py-4 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xl font-bold text-slate-900">{formatBIF(loan.amount)}</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {loan.termDays}-day · {((loan.interestRate || 0) * 100).toFixed(0)}% interest
                        </p>
                      </div>
                      <StatusBadge status="pending" />
                    </div>

                    <div className="grid grid-cols-2 gap-3 bg-slate-50 rounded-2xl px-3 py-3">
                      <div>
                        <p className="text-[11px] text-slate-400 uppercase tracking-wide">Total Due</p>
                        <p className="text-sm font-bold text-slate-800 mt-0.5">{formatBIF(loan.totalDue)}</p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-400 uppercase tracking-wide">Due Date</p>
                        <p className="text-sm font-bold text-slate-800 mt-0.5">{formatDate(loan.dueDate)}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-[11px] text-slate-400 uppercase tracking-wide">Purpose</p>
                        <p className="text-sm font-semibold text-slate-700 mt-0.5">{loan.purpose || "—"}</p>
                      </div>
                    </div>

                    <PrimaryButton
                      loading={disbursing === loan.id}
                      disabled={!!disbursing}
                      onClick={() => handleDisburse(loan.id)}
                    >
                      {disbursing === loan.id ? "Disbursing…" : `Disburse ${formatBIF(loan.amount)}`}
                    </PrimaryButton>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {error && <Alert type="error">{error}</Alert>}
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
              <p className="text-lg font-bold text-slate-800">Loan Disbursed</p>
              <p className="text-sm text-slate-400 mt-1">Hand over the cash and confirm the member's ID.</p>
            </div>

            <div className="w-full bg-slate-50 rounded-2xl divide-y divide-white">
              <ReceiptRow label="Member"      value={receipt.memberName} />
              {receipt.receiptNo && <ReceiptRow label="Receipt No." value={receipt.receiptNo} mono />}
              {receipt.transactionId && (
                <ReceiptRow label="Transaction" value={`${receipt.transactionId.slice(0, 12)}…`} mono />
              )}
            </div>

            <button type="button" onClick={reset}
              className="w-full py-3.5 rounded-2xl border-2 border-brand-100 text-sm font-bold text-brand-600 hover:bg-brand-50 transition-colors">
              Disburse Another Loan
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
