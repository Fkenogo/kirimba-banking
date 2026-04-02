import { useEffect, useMemo, useState } from "react";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import { PageShell, Card, SectionLabel, Alert, PrimaryButton, StatusBadge, EmptyState, formatDate } from "../../components/ui";
import { buildSettlementPayableSummary } from "../../utils/agentFinance";

function formatBIF(n) { return `${Number(n || 0).toLocaleString()} BIF`; }

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts._seconds ? new Date(ts._seconds * 1000) : ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function getSettlementStatusMeta(status) {
  switch (status) {
    case "requested":
      return {
        title: "Requested",
        subtitle: "Waiting for institution finance review",
      };
    case "approved":
      return {
        title: "Approved",
        subtitle: "Approved for payout and waiting for payment",
      };
    case "paid":
      return {
        title: "Paid",
        subtitle: "Commission payout completed",
      };
    case "rejected":
      return {
        title: "Rejected",
        subtitle: "This request was rejected and will not be paid",
      };
    default:
      return {
        title: status || "Unknown",
        subtitle: "Status available in settlement history",
      };
  }
}

function todayStr() { return new Date().toISOString().slice(0, 10); }
function defaultStart() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.toISOString().slice(0, 10);
}

export default function SettlementScreen({ user }) {
  const [settlements,     setSettlements]    = useState(null);
  const [ledgerEntries,   setLedgerEntries]  = useState(null);
  const [requesting,      setRequesting]     = useState(false);
  const [requestError,    setRequestError]   = useState("");
  const [requestSuccess,  setRequestSuccess] = useState("");
  const [periodStart,     setPeriodStart]    = useState(defaultStart);
  const [periodEnd,       setPeriodEnd]      = useState(todayStr);
  const [notes,           setNotes]          = useState("");

  useEffect(() => {
    if (!user?.uid) return;
    const q = query(collection(db, "agentLedgers"), where("agentId", "==", user.uid));
    const unsub = onSnapshot(
      q,
      (snap) => setLedgerEntries(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      () => setLedgerEntries([])
    );
    return unsub;
  }, [user?.uid]);

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
      (err)  => { console.warn("[settlements]", err.message); setSettlements([]); }
    );
    return unsub;
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

  const openSettlements = (settlements || []).filter((s) => s.status === "requested" || s.status === "approved");
  const pendingCount = openSettlements.length;
  const settlementSummary = useMemo(() => {
    if (!ledgerEntries || !settlements) return null;
    return buildSettlementPayableSummary({
      ledgerEntries,
      settlements,
      periodStart,
      periodEnd,
    });
  }, [ledgerEntries, settlements, periodEnd, periodStart]);
  const requestableAmount = settlementSummary?.payableAmount || 0;
  const openSettlement = openSettlements[0] || null;
  const visiblePayableAmount = pendingCount > 0 ? 0 : requestableAmount;
  const openSettlementAmount = openSettlement ? openSettlement.approvedAmount ?? openSettlement.commissionTotal ?? openSettlement.amount ?? 0 : 0;
  const openSettlementMeta = openSettlement ? getSettlementStatusMeta(openSettlement.status) : null;
  const openSettlementBlockMessage = openSettlement
    ? openSettlement.status === "approved"
      ? `You already have an approved payout of ${formatBIF(openSettlementAmount)} from ${fmtDate(openSettlement.createdAt)}. Wait until payment is recorded before sending another request.`
      : `You already have a requested payout of ${formatBIF(openSettlementAmount)} from ${fmtDate(openSettlement.createdAt)}. Wait for review before sending another request.`
    : "";

  return (
    <PageShell title="Settlements" showBack user={user}>

      <Card>
        <div className="px-5 py-4 grid grid-cols-2 gap-3">
          <div className="rounded-2xl bg-brand-50 border border-brand-100 px-4 py-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-500">Settlement Payable</p>
            <p className="mt-1 text-xl font-bold text-brand-800">{ledgerEntries === null ? "—" : formatBIF(visiblePayableAmount)}</p>
            <p className="mt-1 text-[11px] text-brand-600">
              {pendingCount > 0 ? "Blocked while another commission payout remains open" : "Accrued unpaid commission for the selected period"}
            </p>
          </div>
          <div className="rounded-2xl bg-slate-50 border border-slate-100 px-4 py-4">
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Open Requests</p>
            <p className="mt-1 text-xl font-bold text-slate-800">{pendingCount}</p>
            <p className="mt-1 text-[11px] text-slate-500">
              {openSettlement ? `${formatBIF(openSettlementAmount)} ${openSettlementMeta?.title.toLowerCase()}` : "No request in review"}
            </p>
          </div>
        </div>
      </Card>

      {/* ── Request form ── */}
      <Card>
        <form onSubmit={handleRequest} className="px-5 py-5 space-y-4">
          <div>
            <p className="text-sm font-bold text-slate-800">Request Settlement</p>
            <p className="text-xs text-slate-400 mt-0.5">Select the commission period covered by this request</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Period Start</label>
              <input
                type="date"
                value={periodStart}
                max={periodEnd}
                onChange={(e) => setPeriodStart(e.target.value)}
                required
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
              />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Period End</label>
              <input
                type="date"
                value={periodEnd}
                min={periodStart}
                max={todayStr()}
                onChange={(e) => setPeriodEnd(e.target.value)}
                required
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-3 py-2.5 text-sm text-slate-700 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">Notes (optional)</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes for admin…"
              className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
            />
          </div>

          {pendingCount > 0 && (
            <Alert type="warning">
              {openSettlementBlockMessage || `You have ${pendingCount} open settlement request${pendingCount > 1 ? "s" : ""}. Wait for resolution before requesting another.`}
            </Alert>
          )}
          {pendingCount === 0 && settlementSummary && requestableAmount <= 0 ? (
            <Alert type="info">
              No accrued unpaid commission is available for the selected period.
            </Alert>
          ) : null}
          {requestError   && <Alert type="error">{requestError}</Alert>}
          {requestSuccess && <Alert type="success">{requestSuccess}</Alert>}

          <PrimaryButton type="submit" loading={requesting} disabled={pendingCount > 0 || requestableAmount <= 0}>
            {requesting ? "Submitting…" : "Submit Request"}
          </PrimaryButton>
        </form>
      </Card>

      {/* ── Settlement history ── */}
      <div className="space-y-2">
        <SectionLabel>Settlement History</SectionLabel>

        {settlements === null ? (
          <div className="space-y-2 animate-pulse">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-16 bg-white rounded-2xl shadow-card" />
            ))}
          </div>
        ) : settlements.length === 0 ? (
          <Card>
            <EmptyState
              title="No settlement requests yet"
              subtitle="Your settlement history will appear here once you submit a request."
            />
          </Card>
        ) : (
          <Card>
            <div className="divide-y divide-slate-50">
              {settlements.map((s) => (
                <div key={s.id} className="px-5 py-4">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900">
                        {formatBIF(s.paidAmount ?? s.approvedAmount ?? s.commissionTotal ?? s.amount ?? 0)}
                      </p>
                      {s.periodStart && s.periodEnd && (
                        <p className="text-xs text-slate-500 mt-0.5">
                          {s.periodStart} → {s.periodEnd}
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1">
                        {getSettlementStatusMeta(s.status).subtitle}
                      </p>
                    </div>
                    <StatusBadge status={s.status} />
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs text-slate-400">
                    <span>Requested {fmtDate(s.createdAt)}</span>
                    <span className="text-right">{Number(s.commissionEntryCount || 0)} ledger entr{Number(s.commissionEntryCount || 0) === 1 ? "y" : "ies"}</span>
                    <span>{s.approvedAt ? `Reviewed ${fmtDate(s.approvedAt)}` : "Review pending"}</span>
                    <span className="text-right">{s.paidAt ? `Paid ${fmtDate(s.paidAt)}` : "Payment pending"}</span>
                  </div>

                  {s.status === "paid" && s.paidAt && (
                    <p className="text-xs text-brand-600 font-semibold mt-1">Paid on {fmtDate(s.paidAt)}</p>
                  )}
                  {s.status === "approved" && s.approvedAt ? (
                    <p className="text-xs text-blue-600 font-semibold mt-1">Approved on {fmtDate(s.approvedAt)}</p>
                  ) : null}
                  {s.notes && (
                    <p className="text-xs text-slate-500 mt-1 italic line-clamp-2">{s.notes}</p>
                  )}
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>

    </PageShell>
  );
}
