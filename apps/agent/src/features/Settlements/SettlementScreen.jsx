import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";

function formatBIF(n) {
  return `${Number(n || 0).toLocaleString("en-US")} BIF`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

const STATUS_STYLE = {
  requested: "bg-amber-100 text-amber-700",
  approved: "bg-blue-100 text-blue-700",
  paid: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
};

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function defaultPeriodStart() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

export default function SettlementScreen({ user }) {
  const navigate = useNavigate();
  const [settlements, setSettlements] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [requestSuccess, setRequestSuccess] = useState("");
  const [periodStart, setPeriodStart] = useState(defaultPeriodStart);
  const [periodEnd, setPeriodEnd] = useState(todayStr);
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(
      collection(db, "agentSettlements"),
      where("agentId", "==", user.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setSettlements(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => {
        console.warn("[settlements]", err.message);
        setSettlements([]);
      }
    );
    return () => unsub();
  }, [user?.uid]);

  async function handleRequest(e) {
    e.preventDefault();
    if (!periodStart || !periodEnd || periodStart > periodEnd) {
      setRequestError("Select a valid date range (start ≤ end).");
      return;
    }
    setRequesting(true);
    setRequestError("");
    setRequestSuccess("");
    try {
      const fn = httpsCallable(functions, "requestSettlement");
      await fn({ periodStart, periodEnd, notes: notes.trim() || undefined });
      setRequestSuccess("Settlement request submitted. Admin will review and approve.");
      setNotes("");
    } catch (err) {
      setRequestError(err.message || "Failed to submit settlement request.");
    } finally {
      setRequesting(false);
    }
  }

  const pendingCount = (settlements || []).filter((s) => s.status === "requested" || s.status === "approved").length;

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-5">

        <div>
          <button type="button" onClick={() => navigate("/agent/home")}
            className="mb-1 text-xs text-slate-500 hover:text-slate-700">← Home</button>
          <h1 className="text-xl font-bold text-slate-900">Settlements</h1>
          <p className="text-xs text-slate-400 mt-0.5">Request and track your settlement payments</p>
        </div>

        {/* Request settlement form */}
        <form onSubmit={handleRequest} className="rounded-xl bg-white border border-slate-200 px-4 py-4 space-y-3">
          <div>
            <p className="text-sm font-semibold text-slate-800">Request Settlement</p>
            <p className="text-xs text-slate-400">Select the period covered by this settlement request</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-slate-500 mb-1">Period Start</label>
              <input
                type="date"
                value={periodStart}
                max={periodEnd}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Period End</label>
              <input
                type="date"
                value={periodEnd}
                min={periodStart}
                max={todayStr()}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes for admin…"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
            />
          </div>
          {pendingCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              You have {pendingCount} pending settlement{pendingCount > 1 ? "s" : ""}. Wait for resolution before requesting another.
            </p>
          )}
          {requestError && <p className="text-sm text-red-600">{requestError}</p>}
          {requestSuccess && <p className="text-sm text-green-700">{requestSuccess}</p>}
          <button
            type="submit"
            disabled={requesting || pendingCount > 0}
            className="w-full rounded-xl bg-indigo-600 text-white text-sm font-medium px-4 py-2.5 hover:bg-indigo-700 disabled:opacity-50"
          >
            {requesting ? "Submitting…" : "Submit Request"}
          </button>
        </form>

        {/* Settlement history */}
        <section>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Settlement History</h2>
          {settlements === null ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="h-16 rounded-xl bg-white border border-slate-200 animate-pulse" />
              ))}
            </div>
          ) : settlements.length === 0 ? (
            <div className="rounded-xl bg-white border border-slate-200 px-4 py-10 text-center">
              <p className="text-sm text-slate-400">No settlement requests yet.</p>
            </div>
          ) : (
            <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100">
              {settlements.map((s) => (
                <div key={s.id} className="px-4 py-3">
                  <div className="flex justify-between items-start mb-1">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {s.amount ? formatBIF(s.amount) : "Amount pending"}
                      </p>
                      {s.periodStart && s.periodEnd && (
                        <p className="text-xs text-slate-500">{s.periodStart} → {s.periodEnd}</p>
                      )}
                      <p className="text-xs text-slate-400">{fmtDate(s.createdAt)}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold capitalize ${STATUS_STYLE[s.status] || "bg-slate-100 text-slate-600"}`}>
                      {s.status}
                    </span>
                  </div>
                  {s.status === "paid" && s.paidAt && (
                    <p className="text-xs text-green-600">Paid on {fmtDate(s.paidAt)}</p>
                  )}
                  {s.notes && (
                    <p className="text-xs text-slate-400 mt-0.5">{s.notes}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
