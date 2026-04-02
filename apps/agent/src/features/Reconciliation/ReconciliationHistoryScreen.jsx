import { useEffect, useMemo, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { Alert, Card, EmptyState, InfoRow, PageShell, SectionLabel, StatusBadge, formatBIF, formatDate } from "../../components/ui";

function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().getTime();
  if (value?._seconds) return value._seconds * 1000;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDateLabel(dateStr) {
  if (!dateStr) return "—";
  const [year, month, day] = String(dateStr).split("-").map(Number);
  if (!year || !month || !day) return dateStr;
  return new Date(year, month - 1, day).toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = value?.toDate ? value.toDate() : value?._seconds ? new Date(value._seconds * 1000) : new Date(value);
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function differenceTone(amount) {
  if (amount === 0) return "text-brand-700";
  if (amount > 0) return "text-blue-700";
  return "text-red-600";
}

function differenceLabel(amount) {
  if (amount === 0) return "Balanced";
  if (amount > 0) return "Overage";
  return "Shortage";
}

export default function ReconciliationHistoryScreen({ user }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedEntry, setSelectedEntry] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;
    async function loadHistory() {
      setLoading(true);
      setError(null);
      try {
        const snap = await getDocs(query(collection(db, "agentReconciliations"), where("agentId", "==", user.uid)));
        const rows = snap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => {
            const dateCompare = String(b.date || "").localeCompare(String(a.date || ""));
            if (dateCompare !== 0) return dateCompare;
            return (toMillis(b.updatedAt) || toMillis(b.createdAt)) - (toMillis(a.updatedAt) || toMillis(a.createdAt));
          });
        setEntries(rows);
      } catch (historyError) {
        setError(historyError.message || "Failed to load reconciliation history.");
      } finally {
        setLoading(false);
      }
    }
    loadHistory();
  }, [user?.uid]);

  const reviewedCount = useMemo(
    () => entries.filter((entry) => entry.status === "reviewed").length,
    [entries]
  );

  return (
    <PageShell title="Reconciliation History" showBack user={user}>
      {!loading ? (
        <Card>
          <div className="px-5 py-4 flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">History</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {entries.length} submission{entries.length !== 1 ? "s" : ""}
              </p>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Reviewed</p>
              <p className="mt-1 text-sm font-semibold text-slate-800">
                {reviewedCount} / {entries.length}
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {error ? <Alert type="error">{error}</Alert> : null}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(4)].map((_, index) => (
            <div key={index} className="h-24 bg-white rounded-3xl shadow-card" />
          ))}
        </div>
      ) : null}

      {!loading && entries.length === 0 ? (
        <Card>
          <EmptyState
            title="No reconciliation history yet"
            subtitle="Your submitted close-day records will appear here for follow-up and dispute review."
          />
        </Card>
      ) : null}

      {!loading && entries.length > 0 ? (
        <div className="space-y-3">
          <SectionLabel>Past submissions</SectionLabel>
          {entries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setSelectedEntry(entry)}
              className="w-full text-left"
            >
              <Card>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-base font-bold text-slate-900">{formatDateLabel(entry.date)}</p>
                      <p className="text-xs text-slate-400 mt-0.5">Submitted {formatDateTime(entry.createdAt || entry.updatedAt)}</p>
                    </div>
                    <StatusBadge status={entry.status || "submitted"} />
                  </div>

                  <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-2xl px-3 py-3">
                    <div>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wide">Expected</p>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">{formatBIF(entry.cashExpected)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wide">Counted</p>
                      <p className="text-xs font-bold text-slate-800 mt-0.5">{formatBIF(entry.cashCounted)}</p>
                    </div>
                    <div>
                      <p className="text-[11px] text-slate-400 uppercase tracking-wide">Variance</p>
                      <p className={`text-xs font-bold mt-0.5 ${differenceTone(Number(entry.difference || 0))}`}>
                        {formatBIF(entry.difference)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-3 text-xs">
                    <span className={`font-semibold ${differenceTone(Number(entry.difference || 0))}`}>
                      {differenceLabel(Number(entry.difference || 0))}
                    </span>
                    <span className="text-slate-400">
                      {entry.reviewedAt ? `Reviewed ${formatDate(entry.reviewedAt)}` : "Awaiting review"}
                    </span>
                  </div>

                  {entry.notes ? (
                    <p className="text-xs text-slate-500 line-clamp-2">{entry.notes}</p>
                  ) : null}
                </div>
              </Card>
            </button>
          ))}
        </div>
      ) : null}

      {selectedEntry ? (
        <ReconciliationDetailDrawer entry={selectedEntry} onClose={() => setSelectedEntry(null)} />
      ) : null}
    </PageShell>
  );
}

function ReconciliationDetailDrawer({ entry, onClose }) {
  const difference = Number(entry.difference || 0);

  return (
    <div className="fixed inset-0 z-40 flex items-end bg-slate-900/40">
      <button type="button" aria-label="Close detail" className="absolute inset-0" onClick={onClose} />
      <div className="relative w-full max-w-lg mx-auto rounded-t-3xl bg-white shadow-card-lg max-h-[85vh] overflow-y-auto">
        <div className="sticky top-0 bg-white px-5 py-4 border-b border-slate-100 flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Reconciliation detail</p>
            <p className="mt-1 text-base font-bold text-slate-900">{formatDateLabel(entry.date)}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl bg-slate-100 text-slate-400 hover:bg-slate-200 flex items-center justify-center shrink-0"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-4 space-y-4">
          <Card>
            <div className="px-5 py-4 flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Status</p>
                <p className={`mt-1 text-sm font-semibold ${differenceTone(difference)}`}>{differenceLabel(difference)}</p>
              </div>
              <StatusBadge status={entry.status || "submitted"} />
            </div>
            <div className="divide-y divide-slate-50">
              <InfoRow label="Expected Cash" value={formatBIF(entry.cashExpected)} />
              <InfoRow label="Counted Cash" value={formatBIF(entry.cashCounted)} />
              <InfoRow label="Variance" value={formatBIF(entry.difference)} valueClassName={differenceTone(difference)} />
              <InfoRow label="Deposit Count" value={entry.depositCount ?? 0} />
              <InfoRow label="Withdrawal Count" value={entry.withdrawCount ?? 0} />
              <InfoRow label="Commission Accrued" value={formatBIF(entry.commissionAccrued)} />
              <InfoRow label="Offline Pending" value={entry.offlinePendingCount ?? 0} />
            </div>
          </Card>

          <Card>
            <div className="px-5 py-4 border-b border-slate-50">
              <SectionLabel>Audit trail</SectionLabel>
            </div>
            <div className="divide-y divide-slate-50">
              <InfoRow label="Submitted At" value={formatDateTime(entry.createdAt || entry.updatedAt)} />
              <InfoRow label="Last Updated" value={formatDateTime(entry.updatedAt)} />
              <InfoRow label="Reviewed At" value={formatDateTime(entry.reviewedAt)} />
              <InfoRow label="Review Outcome" value={entry.status || "submitted"} />
            </div>
          </Card>

          {(entry.notes || entry.adminNote) ? (
            <Card>
              <div className="px-5 py-4 space-y-3">
                {entry.notes ? (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Agent notes</p>
                    <p className="mt-1 text-sm text-slate-700">{entry.notes}</p>
                  </div>
                ) : null}
                {entry.adminNote ? (
                  <div>
                    <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Review notes</p>
                    <p className="mt-1 text-sm text-slate-700">{entry.adminNote}</p>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
