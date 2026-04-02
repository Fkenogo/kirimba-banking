import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../../services/firebase";
import { Alert, Card, EmptyState, InfoRow, PageShell, SectionLabel, StatusBadge, formatBIF } from "../../components/ui";
import { toMillis } from "../../utils/agentFinance";

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

export default function BatchDetailScreen({ user }) {
  const { batchId } = useParams();
  const [batch, setBatch] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.uid || !batchId) return;
    async function loadBatch() {
      setLoading(true);
      setError("");
      try {
        const [batchSnap, txSnap] = await Promise.all([
          getDoc(doc(db, "depositBatches", batchId)),
          getDocs(query(collection(db, "transactions"), where("batchId", "==", batchId))),
        ]);
        if (!batchSnap.exists()) {
          setBatch(null);
          setEntries([]);
          return;
        }

        const batchData = { id: batchSnap.id, ...batchSnap.data() };
        if (batchData.agentId && batchData.agentId !== user.uid) {
          setError("This batch does not belong to your agent account.");
          setBatch(null);
          setEntries([]);
          return;
        }

        const rows = txSnap.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => toMillis(a.createdAt) - toMillis(b.createdAt));

        setBatch(batchData);
        setEntries(rows);
      } catch (loadError) {
        setError(loadError.message || "Failed to load batch details.");
      } finally {
        setLoading(false);
      }
    }
    loadBatch();
  }, [batchId, user?.uid]);

  return (
    <PageShell title="Batch Detail" showBack user={user}>
      {error ? <Alert type="error">{error}</Alert> : null}

      {loading ? (
        <div className="space-y-3 animate-pulse">
          {[...Array(3)].map((_, index) => (
            <div key={index} className="h-24 bg-white rounded-3xl shadow-card" />
          ))}
        </div>
      ) : null}

      {!loading && !batch ? (
        <Card>
          <EmptyState
            title="Batch not found"
            subtitle="This batch record is no longer available."
          />
        </Card>
      ) : null}

      {!loading && batch ? (
        <>
          <Card>
            <div className="px-5 py-4 flex items-start justify-between gap-3 border-b border-slate-50">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Batch ID</p>
                <p className="mt-1 text-sm font-semibold text-slate-800 break-all">{batch.id}</p>
              </div>
              <StatusBadge status={batch.status || "submitted"} />
            </div>
            <div className="divide-y divide-slate-50">
              <InfoRow label="Submitted At" value={formatDateTime(batch.submittedAt || batch.createdAt)} />
              <InfoRow label="Total Batch Amount" value={formatBIF(batch.totalAmount)} />
              <InfoRow label="Member Count" value={batch.memberCount ?? entries.length} />
              <InfoRow label="Transaction Count" value={Array.isArray(batch.transactionIds) ? batch.transactionIds.length : entries.length} />
            </div>
          </Card>

          {(batch.institutionNotes || batch.umucoNotes) ? (
            <Card>
              <div className="px-5 py-4">
                <SectionLabel>Institution Review Note</SectionLabel>
                <p className="mt-2 text-sm text-slate-700">{batch.institutionNotes || batch.umucoNotes}</p>
              </div>
            </Card>
          ) : null}

          <div className="space-y-3">
            <SectionLabel>Batch Entries</SectionLabel>
            {entries.length === 0 ? (
              <Card>
                <EmptyState
                  title="No batch entries found"
                  subtitle="The batch record exists, but no deposit rows were returned for this batch."
                />
              </Card>
            ) : (
              <Card>
                <div className="divide-y divide-slate-50">
                  {entries.map((entry) => (
                    <div key={entry.id} className="px-5 py-4 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {entry.memberName || entry.memberId || entry.userId || "Unknown member"}
                        </p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          {entry.memberId || entry.userId || "—"} · {formatDateTime(entry.createdAt)}
                        </p>
                        {entry.notes ? (
                          <p className="text-xs text-slate-500 mt-1 line-clamp-2">{entry.notes}</p>
                        ) : null}
                      </div>
                      <p className="text-sm font-bold text-slate-900">{formatBIF(entry.amount)}</p>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </div>
        </>
      ) : null}
    </PageShell>
  );
}
