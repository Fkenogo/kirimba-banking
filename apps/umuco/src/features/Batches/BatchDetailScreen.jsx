import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { db, functions } from "../../services/firebase";
import {
  PageShell, Card, Alert, LoadingState, EmptyState,
  StatusBadge, InfoRow, FormInput, FormTextarea,
  PrimaryButton, SectionLabel, formatBIF, formatDate,
} from "../../components/ui";

export default function BatchDetailScreen({ institutionName }) {
  const { batchId } = useParams();

  const [batch, setBatch]           = useState(null);
  const [groupName, setGroupName]   = useState("");
  const [agentName, setAgentName]   = useState("");
  const [transactions, setTransactions] = useState([]);
  const [memberNames, setMemberNames]   = useState({});
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");
  const [working, setWorking]       = useState(false);

  const [confirmRef,   setConfirmRef]   = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [flagNotes,    setFlagNotes]    = useState("");

  async function loadBatch() {
    if (!batchId) return;
    setLoading(true);
    setError("");
    try {
      const batchSnap = await getDoc(doc(db, "depositBatches", batchId));
      if (!batchSnap.exists()) {
        setError("Batch not found.");
        setBatch(null);
        return;
      }

      const batchData = { id: batchSnap.id, ...batchSnap.data() };
      setBatch(batchData);

      // Fetch group name
      if (batchData.groupId) {
        const groupSnap = await getDoc(doc(db, "groups", batchData.groupId));
        setGroupName(groupSnap.exists() ? groupSnap.data().name || batchData.groupId : batchData.groupId);
      }

      // Fetch agent name
      if (batchData.agentId) {
        const agentSnap = await getDoc(doc(db, "users", batchData.agentId));
        if (agentSnap.exists()) {
          const d = agentSnap.data();
          setAgentName(d.fullName || d.name || batchData.agentId);
        } else {
          setAgentName(batchData.agentId);
        }
      }

      const txIds = Array.isArray(batchData.transactionIds) ? batchData.transactionIds : [];
      if (!txIds.length) { setTransactions([]); return; }

      // Fetch all transactions
      const txSnaps = await Promise.all(txIds.map((id) => getDoc(doc(db, "transactions", id))));
      const rows = txSnaps
        .filter((s) => s.exists())
        .map((s) => ({ id: s.id, ...s.data() }))
        .sort((a, b) => {
          const aMs = a.createdAt?._seconds ? a.createdAt._seconds * 1000 : a.createdAt?.toMillis?.() || 0;
          const bMs = b.createdAt?._seconds ? b.createdAt._seconds * 1000 : b.createdAt?.toMillis?.() || 0;
          return aMs - bMs;
        });
      setTransactions(rows);

      // Batch-fetch member names
      const userIds = [...new Set(rows.map((tx) => tx.userId).filter(Boolean))];
      if (userIds.length) {
        const userSnaps = await Promise.all(userIds.map((id) => getDoc(doc(db, "users", id))));
        const names = {};
        userIds.forEach((id, i) => {
          if (userSnaps[i].exists()) {
            const d = userSnaps[i].data();
            names[id] = d.fullName || d.name || id;
          }
        });
        setMemberNames(names);
      }
    } catch (err) {
      setError(err.message || "Failed to load batch detail.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadBatch(); }, [batchId]);

  async function handleConfirm() {
    const ref = confirmRef.trim();
    if (!ref) { setActionError("Institution account reference is required."); return; }
    setActionError("");
    setActionSuccess("");
    setWorking(true);
    try {
      const confirmBatch = httpsCallable(functions, "confirmBatch");
      await confirmBatch({ batchId, institutionRef: ref, notes: confirmNotes.trim() });
      setActionSuccess("Batch confirmed successfully. Member savings have been updated.");
      await loadBatch();
    } catch (err) {
      setActionError(err.message || "Failed to confirm batch.");
    } finally {
      setWorking(false);
    }
  }

  async function handleFlag() {
    const notes = flagNotes.trim();
    if (!notes) { setActionError("Flag notes are required."); return; }
    setActionError("");
    setActionSuccess("");
    setWorking(true);
    try {
      const flagBatch = httpsCallable(functions, "flagBatch");
      await flagBatch({ batchId, notes });
      setActionSuccess("Batch flagged. The agent and admin have been notified.");
      await loadBatch();
    } catch (err) {
      setActionError(err.message || "Failed to flag batch.");
    } finally {
      setWorking(false);
    }
  }

  const isSubmitted = batch?.status === "submitted";

  return (
    <PageShell title="Batch Detail" institutionName={institutionName}>
      {/* Batch ID sub-label */}
      {batchId && (
        <p className="font-mono text-xs text-slate-400 -mt-3">{batchId}</p>
      )}

      {(error || actionError) && <Alert type="error">{error || actionError}</Alert>}
      {actionSuccess && <Alert type="success">{actionSuccess}</Alert>}

      {loading ? (
        <Card><LoadingState label="Loading batch…" /></Card>
      ) : !batch ? null : (
        <>
          {/* ─── Batch Summary ─── */}
          <Card className="px-5 py-5">
            <div className="flex items-center justify-between mb-4">
              <SectionLabel>Batch Summary</SectionLabel>
              <StatusBadge status={batch.status} />
            </div>

            <div className="mb-4 rounded-2xl border border-brand-100 bg-brand-50 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-600">Current State</p>
              <p className="mt-1 text-sm font-semibold text-slate-900">
                {batch.status === "submitted"
                  ? "Awaiting institution review"
                  : batch.status === "confirmed"
                  ? "Confirmed by institution and posted to member savings"
                  : "Flagged for agent follow-up"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                {batch.status === "submitted"
                  ? "Review batch totals, member rows, and institution reference before confirming."
                  : batch.status === "confirmed"
                  ? "Use the decision timestamps, institution reference, and notes below for audit follow-up."
                  : "Use the recorded notes below to coordinate correction or resubmission with the agent."}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8">
              <InfoRow label="Group"        value={groupName || batch.groupId || "—"} />
              <InfoRow label="Agent"        value={agentName || batch.agentId || "—"} />
              <InfoRow label="Total Amount" value={formatBIF(batch.totalAmount)} />
              <InfoRow label="Member Count" value={String(Number(batch.memberCount || 0))} />
              <InfoRow label="Submitted"    value={formatDate(batch.submittedAt)} />

              {batch.status === "confirmed" && (
                <>
                  <InfoRow label="Confirmed At"           value={formatDate(batch.confirmedAt)} />
                  <InfoRow label="Confirmed By"           value={batch.confirmedBy || "—"} />
                  <InfoRow label="Institution Reference"  value={batch.institutionRef || batch.umucoAccountRef || "—"} />
                </>
              )}
              {batch.status === "flagged" && (
                <>
                  <InfoRow label="Flagged At" value={formatDate(batch.flaggedAt)} />
                  <InfoRow label="Flagged By" value={batch.flaggedBy || "—"} />
                </>
              )}
            </div>

            <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 mb-2">Institution Metadata</p>
                <div className="space-y-2 text-sm text-slate-700">
                  <p><span className="font-medium text-slate-900">Reference:</span> {batch.institutionRef || batch.umucoAccountRef || "—"}</p>
                  <p><span className="font-medium text-slate-900">Submitted:</span> {formatDate(batch.submittedAt)}</p>
                  <p><span className="font-medium text-slate-900">Confirmed:</span> {formatDate(batch.confirmedAt)}</p>
                  <p><span className="font-medium text-slate-900">Flagged:</span> {formatDate(batch.flaggedAt)}</p>
                </div>
              </div>
              <div className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3">
                <p className="text-xs font-semibold text-slate-500 mb-2">Decision Notes</p>
                <p className="text-sm text-slate-800">
                  {batch.institutionNotes || batch.umucoNotes || "No institution note recorded."}
                </p>
              </div>
            </div>
          </Card>

          {/* ─── Member Transactions ─── */}
          <Card>
            <div className="px-5 py-4 border-b border-brand-100">
              <SectionLabel>Member Transactions ({transactions.length})</SectionLabel>
            </div>
            {transactions.length === 0 ? (
              <EmptyState title="No transactions" subtitle="No transactions found in this batch." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-brand-100 bg-brand-50 text-left">
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Member Name</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Member ID</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700 text-right">Amount</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Status</th>
                      <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-brand-700">Recorded</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-brand-50/40 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-900">
                          {memberNames[tx.userId] || tx.userId || "—"}
                        </td>
                        <td className="px-5 py-3 font-mono text-xs text-brand-600">
                          {tx.memberId || "—"}
                        </td>
                        <td className="px-5 py-3 text-right font-bold text-brand-700">
                          {formatBIF(tx.amount)}
                        </td>
                        <td className="px-5 py-3 text-slate-600 capitalize">
                          {tx.status?.replace(/_/g, " ") || "—"}
                        </td>
                        <td className="px-5 py-3 text-slate-500 whitespace-nowrap">
                          {formatDate(tx.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* ─── Decision Panel ─── */}
          {isSubmitted ? (
            <div>
              <SectionLabel>Batch Decision</SectionLabel>
              <div className="mt-3 grid grid-cols-1 lg:grid-cols-2 gap-4">

                {/* Confirm */}
                <Card className="p-5 space-y-4 border-brand-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-brand-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-bold text-brand-800">Confirm Batch</h3>
                  </div>

                  <FormInput
                    label="Institution Account Reference *"
                    value={confirmRef}
                    onChange={(e) => setConfirmRef(e.target.value)}
                    placeholder="e.g. REF-2026-001"
                  />
                  <FormTextarea
                    label="Notes (optional)"
                    rows={3}
                    value={confirmNotes}
                    onChange={(e) => setConfirmNotes(e.target.value)}
                    placeholder="Optional confirmation note"
                  />
                  <PrimaryButton
                    onClick={handleConfirm}
                    disabled={working}
                    variant="success"
                    className="w-full"
                  >
                    {working ? "Processing…" : "Confirm Batch"}
                  </PrimaryButton>
                </Card>

                {/* Flag */}
                <Card className="p-5 space-y-4 border-red-200">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-red-100 flex items-center justify-center">
                      <svg className="w-4 h-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l1.664 1.664M21 21l-1.5-1.5m-5.485-1.242L12 17.25 4.5 21V8.742m.164-4.078a2.15 2.15 0 011.743-1.342 48.507 48.507 0 0111.186 0c1.1.128 1.907 1.077 1.907 2.185V19.5M4.664 4.664L19.5 19.5" />
                      </svg>
                    </div>
                    <h3 className="text-sm font-bold text-red-800">Flag Batch</h3>
                  </div>

                  <FormTextarea
                    label="Flag Notes *"
                    rows={5}
                    value={flagNotes}
                    onChange={(e) => setFlagNotes(e.target.value)}
                    placeholder="Explain the discrepancy or issue in detail"
                  />
                  <PrimaryButton
                    onClick={handleFlag}
                    disabled={working}
                    variant="danger"
                    className="w-full"
                  >
                    {working ? "Processing…" : "Flag Batch"}
                  </PrimaryButton>
                </Card>
              </div>
            </div>
          ) : (
            <Card className="px-5 py-4">
              <p className="text-sm text-slate-500">
                This batch has already been{" "}
                <span className="font-semibold capitalize text-slate-700">{batch.status}</span> and cannot be modified.
              </p>
            </Card>
          )}
        </>
      )}
    </PageShell>
  );
}
