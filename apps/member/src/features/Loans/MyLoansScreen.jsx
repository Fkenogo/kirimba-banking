import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";

function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE = {
  pending: "bg-amber-100 text-amber-700",
  active: "bg-blue-100 text-blue-700",
  repaid: "bg-green-100 text-green-700",
  defaulted: "bg-red-100 text-red-700",
  rejected: "bg-slate-100 text-slate-500",
};

const TABS = ["active", "all"];

export default function MyLoansScreen({ user }) {
  const navigate = useNavigate();
  const [loans, setLoans] = useState(null);
  const [tab, setTab] = useState("active");

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "loans"),
      where("userId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setLoans(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => console.error("[loans]", err.message)
    );
    return () => unsub();
  }, [user?.uid]);

  const displayed = tab === "active"
    ? (loans || []).filter((l) => l.status === "active" || l.status === "pending")
    : (loans || []);

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900">My Loans</h1>
            <p className="text-xs text-slate-400 mt-0.5">Track your loan status and repayment</p>
          </div>
          <button
            type="button"
            onClick={() => navigate("/app/loans/request")}
            className="rounded-xl bg-indigo-600 text-white text-sm font-medium px-4 py-2 hover:bg-indigo-700"
          >
            Request Loan
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {TABS.map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors capitalize ${
                tab === t ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}>
              {t === "active" ? "Active / Pending" : "All Loans"}
            </button>
          ))}
        </div>

        {loans === null ? (
          <div className="space-y-3">
            {[...Array(2)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-white border border-slate-200 animate-pulse" />
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="rounded-xl bg-white border border-slate-200 px-4 py-12 text-center space-y-3">
            <p className="text-sm text-slate-500">
              {tab === "active" ? "No active or pending loans." : "No loan history."}
            </p>
            <button
              type="button"
              onClick={() => navigate("/app/loans/request")}
              className="text-sm font-medium text-indigo-600 underline underline-offset-2"
            >
              Request your first loan →
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {displayed.map((loan) => (
              <LoanCard key={loan.id} loan={loan} />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function LoanCard({ loan }) {
  const isActive = loan.status === "active";
  const isPending = loan.status === "pending";
  const progressPct = isActive && loan.totalDue > 0
    ? Math.min(100, Math.round(((loan.paidAmount || 0) / loan.totalDue) * 100))
    : null;

  return (
    <div className="rounded-xl bg-white border border-slate-200 px-4 py-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-base font-bold text-slate-900">{formatBIF(loan.amount)}</p>
          <p className="text-xs text-slate-400 mt-0.5">{loan.termDays}-day term · {((loan.interestRate || 0) * 100).toFixed(0)}% fee</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLE[loan.status] || "bg-slate-100 text-slate-600"}`}>
          {loan.status}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <LoanDetail label="Total Due" value={formatBIF(loan.totalDue)} />
        <LoanDetail label="Paid" value={formatBIF(loan.paidAmount)} />
        {isActive && <LoanDetail label="Remaining" value={formatBIF(loan.remainingDue)} highlight />}
        {isActive && <LoanDetail label="Due Date" value={fmtDate(loan.dueDate)} />}
        {isPending && <LoanDetail label="Requested" value={fmtDate(loan.createdAt)} />}
        {loan.status === "repaid" && <LoanDetail label="Repaid On" value={fmtDate(loan.repaidAt)} />}
        {loan.status === "defaulted" && <LoanDetail label="Defaulted" value={fmtDate(loan.defaultedAt)} highlight warn />}
        {loan.status === "rejected" && loan.rejectionReason && (
          <div className="col-span-2">
            <p className="text-slate-400">Reason</p>
            <p className="text-slate-700 font-medium">{loan.rejectionReason}</p>
          </div>
        )}
      </div>

      {progressPct !== null && (
        <div>
          <div className="flex justify-between text-[10px] text-slate-400 mb-1">
            <span>Repayment progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-slate-100">
            <div
              className="h-1.5 rounded-full bg-indigo-500 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {isPending && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          Awaiting disbursement by an agent. Present your ID when collecting funds.
        </p>
      )}
    </div>
  );
}

function LoanDetail({ label, value, highlight, warn }) {
  return (
    <div>
      <p className="text-slate-400">{label}</p>
      <p className={`font-semibold ${warn ? "text-red-600" : highlight ? "text-indigo-700" : "text-slate-800"}`}>
        {value}
      </p>
    </div>
  );
}
