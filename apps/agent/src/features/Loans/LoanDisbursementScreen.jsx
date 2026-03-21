import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, getDocs, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { QrScanner, fetchMemberByMemberId } from "../../utils/memberLookup.jsx";

function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const SCREEN = {
  SCANNING: "scanning",
  LOANS:    "loans",
  RECEIPT:  "receipt",
};

export default function LoanDisbursementScreen() {
  const navigate = useNavigate();
  const [screen, setScreen]     = useState(SCREEN.SCANNING);
  const [member, setMember]     = useState(null);
  const [loans, setLoans]       = useState([]);
  const [manualId, setManualId] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [disbursing, setDisbursing] = useState("");
  const [receipt, setReceipt]   = useState(null);

  // ── Member + loan lookup ──────────────────────────────────────────────────
  async function loadMember(memberId) {
    setLoading(true);
    setError(null);
    try {
      const found = await fetchMemberByMemberId(memberId.trim());
      if (!found) {
        setError(`No member found for "${memberId}".`);
        return;
      }
      const snap = await getDocs(
        query(
          collection(db, "loans"),
          where("userId", "==", found.userId),
          where("status", "==", "pending")
        )
      );
      setMember(found);
      setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      setScreen(SCREEN.LOANS);
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

  function handleManualLoad() {
    if (!manualId.trim()) return;
    loadMember(manualId);
  }

  // ── Disbursement ──────────────────────────────────────────────────────────
  async function handleDisburse(loanId) {
    setDisbursing(loanId);
    setError(null);
    try {
      const fn = httpsCallable(functions, "disburseLoan");
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
    setManualId("");
    setError(null);
    setReceipt(null);
    setDisbursing("");
  }

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">

        <div>
          <button type="button" onClick={() => navigate("/agent/home")}
            className="mb-1 text-xs text-slate-500 hover:text-slate-700">
            ← Home
          </button>
          <h1 className="text-xl font-bold text-slate-900">Loan Disbursement</h1>
          <p className="text-xs text-slate-400 mt-0.5">Scan member QR or enter Member ID</p>
        </div>

        {/* ── SCANNING ── */}
        {screen === SCREEN.SCANNING && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 text-center">
              Point the camera at a member&apos;s QR code
            </p>

            <div className="rounded-2xl overflow-hidden border border-slate-200 shadow-sm">
              <QrScanner onScan={handleScan} />
            </div>

            {loading && (
              <p className="text-sm text-center text-indigo-600 animate-pulse">
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
              <p className="text-sm font-medium text-slate-700 mb-2">Member ID</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={manualId}
                  onChange={(e) => { setManualId(e.target.value); setError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleManualLoad()}
                  placeholder="e.g. G01-023"
                  className="flex-1 border border-slate-300 rounded-xl px-3 py-2.5 text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white text-sm"
                />
                <button
                  onClick={handleManualLoad}
                  disabled={loading || !manualId.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white px-4 py-2.5 rounded-xl font-medium text-sm transition-colors"
                >
                  Load
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── LOANS ── */}
        {screen === SCREEN.LOANS && member && (
          <div className="space-y-4">
            {/* Member identity card — agent confirms identity before handing over cash */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-1">
                  Member
                </p>
                <p className="text-xl font-semibold text-slate-800 truncate">{member.fullName}</p>
                <p className="text-sm font-mono text-indigo-600 mt-0.5">{member.memberId}</p>
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

            {loans.length === 0 ? (
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-8 text-center">
                <p className="text-sm text-slate-500">No pending loans for this member.</p>
                <button
                  onClick={reset}
                  className="mt-3 text-sm text-indigo-600 hover:text-indigo-700 font-medium"
                >
                  Scan a different member
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide px-1">
                  Pending Loans ({loans.length})
                </p>
                {loans.map((loan) => (
                  <div key={loan.id} className="rounded-xl bg-white border border-slate-200 px-4 py-4 space-y-3">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-base font-bold text-slate-900">{formatBIF(loan.amount)}</p>
                        <p className="text-xs text-slate-400">
                          {loan.termDays}-day · {((loan.interestRate || 0) * 100).toFixed(0)}% fee
                        </p>
                      </div>
                      <span className="rounded-full bg-amber-100 text-amber-700 px-2 py-0.5 text-[10px] font-semibold">
                        Pending
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <p className="text-slate-400">Total Due</p>
                        <p className="font-semibold text-slate-800">{formatBIF(loan.totalDue)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400">Due Date</p>
                        <p className="font-semibold text-slate-800">{fmtDate(loan.dueDate)}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-slate-400">Purpose</p>
                        <p className="font-semibold text-slate-800">{loan.purpose || "—"}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDisburse(loan.id)}
                      disabled={!!disbursing}
                      className="w-full rounded-xl bg-green-600 hover:bg-green-700 text-white font-semibold py-2.5 text-sm disabled:opacity-50 transition-colors"
                    >
                      {disbursing === loan.id ? "Disbursing…" : `Disburse ${formatBIF(loan.amount)}`}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── RECEIPT ── */}
        {screen === SCREEN.RECEIPT && receipt && (
          <div className="rounded-xl bg-green-50 border border-green-200 px-5 py-5 space-y-3 text-center">
            <div className="text-3xl">✓</div>
            <h3 className="text-base font-bold text-green-800">Loan Disbursed</h3>
            <div className="rounded-lg bg-white border border-green-100 divide-y divide-green-50 text-sm text-left">
              <DetailRow label="Member" value={receipt.memberName} />
              {receipt.receiptNo && <DetailRow label="Receipt" value={receipt.receiptNo} />}
              <DetailRow label="Transaction" value={`${receipt.transactionId?.slice(0, 12)}…`} />
            </div>
            <p className="text-xs text-green-700">
              Hand over the cash and confirm the member&apos;s ID.
            </p>
            <button type="button" onClick={reset}
              className="text-sm font-medium text-green-700 underline underline-offset-2">
              Disburse another loan
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

function DetailRow({ label, value }) {
  return (
    <div className="px-4 py-2.5 flex justify-between items-center">
      <span className="text-slate-500 text-sm">{label}</span>
      <span className="font-medium text-slate-900 text-sm">{value}</span>
    </div>
  );
}
