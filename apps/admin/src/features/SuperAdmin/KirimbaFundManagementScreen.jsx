import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}
function fmtBIF(n) {
  return `${fmt(n)} BIF`;
}
function fmtDate(ts) {
  if (!ts) return "—";
  const ms = ts?.toMillis?.() || (typeof ts === "number" ? ts : null);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

const LEDGER_TYPE_LABELS = {
  seed: "Seed",
  topup: "Top-up",
  deduction: "Deduction",
  loan_out: "Loan Out",
  repayment_return: "Repayment In",
  lending_fee_income: "Lending Fee",
  default_loss: "Default Loss",
  manual_adjustment: "Adjustment",
};
const LEDGER_TYPE_COLORS = {
  seed: "bg-indigo-100 text-indigo-700",
  topup: "bg-green-100 text-green-700",
  deduction: "bg-orange-100 text-orange-700",
  loan_out: "bg-blue-100 text-blue-700",
  repayment_return: "bg-teal-100 text-teal-700",
  lending_fee_income: "bg-violet-100 text-violet-700",
  default_loss: "bg-red-100 text-red-700",
  manual_adjustment: "bg-slate-100 text-slate-700",
};

export default function KirimbaFundManagementScreen() {
  const navigate = useNavigate();

  // Data state
  const [fund, setFund] = useState(null);
  const [ledger, setLedger] = useState([]);
  const [loading, setLoading] = useState(true);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [error, setError] = useState("");

  // Action state
  const [actionLoading, setActionLoading] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionSuccess, setActionSuccess] = useState("");

  // Modal state
  const [modal, setModal] = useState(null); // "seed" | "topup" | "deduct" | "pause"

  // Form fields
  const [formAmount, setFormAmount] = useState("");
  const [formNotes, setFormNotes] = useState("");

  async function loadFund() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getKirimbaFundOverview");
      const res = await fn({});
      setFund(res.data?.fund || null);
    } catch (err) {
      setError(err.message || "Failed to load fund overview.");
    } finally {
      setLoading(false);
    }
  }

  async function loadLedger() {
    setLedgerLoading(true);
    try {
      const fn = httpsCallable(functions, "getKirimbaFundLedger");
      const res = await fn({ limit: 100 });
      setLedger(res.data?.entries || []);
    } catch {
      // non-fatal
    } finally {
      setLedgerLoading(false);
    }
  }

  useEffect(() => {
    loadFund();
    loadLedger();
  }, []);

  function openModal(type) {
    setModal(type);
    setFormAmount("");
    setFormNotes("");
    setActionError("");
    setActionSuccess("");
  }

  function closeModal() {
    setModal(null);
    setFormAmount("");
    setFormNotes("");
    setActionError("");
  }

  async function handleSeed(e) {
    e.preventDefault();
    await runAction("seedKirimbaFund", {
      initialCapital: Number(formAmount),
      notes: formNotes.trim() || undefined,
    });
  }

  async function handleTopUp(e) {
    e.preventDefault();
    await runAction("topUpKirimbaFund", {
      amount: Number(formAmount),
      notes: formNotes.trim() || undefined,
    });
  }

  async function handleDeduct(e) {
    e.preventDefault();
    await runAction("deductKirimbaFund", {
      amount: Number(formAmount),
      notes: formNotes.trim(),
    });
  }

  async function handlePause(e) {
    e.preventDefault();
    await runAction("pauseKirimbaLending", { reason: formNotes.trim() });
  }

  async function handleResume() {
    await runAction("resumeKirimbaLending", {});
  }

  async function runAction(fnName, payload) {
    setActionLoading(fnName);
    setActionError("");
    setActionSuccess("");
    try {
      const fn = httpsCallable(functions, fnName);
      await fn(payload);
      setActionSuccess("Action completed successfully.");
      closeModal();
      await loadFund();
      await loadLedger();
    } catch (err) {
      setActionError(err.message || "Action failed.");
    } finally {
      setActionLoading("");
    }
  }

  const f = fund || {};

  return (
    <main className="px-8 py-7 bg-brand-50">
      <div className="mx-auto max-w-5xl space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Kirimba Fund Management</h1>
            <p className="text-xs text-slate-400 mt-0.5">Capital overview, lending-fee income, group incentive accrual, and full ledger</p>
          </div>
          <button type="button" onClick={() => { loadFund(); loadLedger(); }} disabled={loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-brand-50 disabled:opacity-60">
            Refresh
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {actionSuccess && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
            <p className="text-sm text-emerald-700">{actionSuccess}</p>
          </div>
        )}
        {actionError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{actionError}</p>
          </div>
        )}

        {/* Lending paused banner */}
        {!loading && f.lendingPaused && (
          <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-3">
            <span className="text-amber-600 font-bold text-lg leading-none mt-0.5">⚠</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-800">Lending is currently PAUSED</p>
              {f.lendingPausedReason && (
                <p className="text-xs text-amber-700 mt-0.5">Reason: {f.lendingPausedReason}</p>
              )}
              {f.lendingPausedAt && (
                <p className="text-xs text-amber-600 mt-0.5">Since: {fmtDate(f.lendingPausedAt)}</p>
              )}
            </div>
            <button type="button"
              onClick={handleResume}
              disabled={actionLoading === "resumeKirimbaLending"}
              className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60 shrink-0">
              {actionLoading === "resumeKirimbaLending" ? "Resuming…" : "Resume Lending"}
            </button>
          </div>
        )}

        {/* ── Section A: Fund Overview ─────────────────────────────────────── */}
        <section>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Fund Overview</h2>

          {loading ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-20 rounded-xl border border-slate-200 bg-white animate-pulse" />
              ))}
            </div>
          ) : !f.exists ? (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <p className="text-sm text-slate-500 mb-3">Fund not initialized yet.</p>
              <button type="button" onClick={() => openModal("seed")}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                Seed Initial Fund
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <FundCard label="Total Capital" value={fmtBIF(f.totalCapital)} tone="slate" />
              <FundCard label="Available Balance" value={fmtBIF(f.availableFund)} tone="green" />
              <FundCard label="Locked in Loans" value={fmtBIF(f.deployedFund)} tone="blue" />
              <FundCard label="Total Collateral" value={fmtBIF(f.totalCollateral)} tone="purple" />
              <FundCard label="Defaulted Exposure" value={fmtBIF(f.defaultedExposure)} tone={f.defaultedExposure > 0 ? "red" : "neutral"} />
              <FundCard label="Principal Returned" value={fmtBIF(f.repaidReturned)} tone="teal" />
              <FundCard label="Fee Income Collected" value={fmtBIF(f.feeIncomeCollected)} tone="violet" />
              <FundCard label="Group Incentive Accrued" value={fmtBIF(f.groupIncentiveAccrued)} tone="amber" />
            </div>
          )}
        </section>

        {/* ── Section B: Fund Actions ──────────────────────────────────────── */}
        {!loading && f.exists && (
          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Fund Actions</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <ActionCard
                title="Top Up Fund"
                desc="Add capital to the available balance"
                color="green"
                onClick={() => openModal("topup")}
              />
              <ActionCard
                title="Deduct Fund"
                desc="Withdraw capital from available balance"
                color="orange"
                onClick={() => openModal("deduct")}
              />
              {!f.lendingPaused ? (
                <ActionCard
                  title="Pause Lending"
                  desc="Block all new loan requests system-wide"
                  color="amber"
                  onClick={() => openModal("pause")}
                />
              ) : (
                <ActionCard
                  title="Resume Lending"
                  desc="Re-enable new loan requests"
                  color="green"
                  onClick={handleResume}
                  disabled={actionLoading === "resumeKirimbaLending"}
                />
              )}
              <ActionCard
                title="View Ledger"
                desc="Scroll down to the full fund ledger"
                color="slate"
                onClick={() => document.getElementById("fund-ledger")?.scrollIntoView({ behavior: "smooth" })}
              />
            </div>
          </section>
        )}

        {/* ── Section C: Fund Ledger ───────────────────────────────────────── */}
        <section id="fund-ledger">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-3 px-1">Fund Ledger</h2>

          {ledgerLoading ? (
            <div className="space-y-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="h-14 rounded-xl border border-slate-200 bg-white animate-pulse" />
              ))}
            </div>
          ) : ledger.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center">
              <p className="text-sm text-slate-500">No ledger entries yet.</p>
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-brand-50 border-b border-slate-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Date</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Before</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">After</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Notes</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Actor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-brand-50">
                    {ledger.map((entry) => (
                      <tr key={entry.id} className="hover:bg-brand-50">
                        <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                          {fmtDate(entry.createdAt)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${LEDGER_TYPE_COLORS[entry.type] || "bg-slate-100 text-slate-700"}`}>
                            {LEDGER_TYPE_LABELS[entry.type] || entry.type}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-slate-900 tabular-nums">
                          {fmtBIF(entry.amount)}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">
                          {entry.beforeBalance != null ? fmtBIF(entry.beforeBalance) : "—"}
                        </td>
                        <td className="px-4 py-3 text-right text-xs text-slate-500 tabular-nums">
                          {entry.afterBalance != null ? fmtBIF(entry.afterBalance) : "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-600 max-w-xs truncate">
                          {entry.notes || "—"}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500 font-mono">
                          {entry.actorRole === "system"
                            ? <span className="text-slate-400 italic">system</span>
                            : entry.actorId?.slice(0, 8) + "…"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                Showing latest {ledger.length} entries
              </div>
            </div>
          )}
        </section>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────── */}

      {/* Seed Modal */}
      {modal === "seed" && (
        <Modal title="Seed Initial Fund" onClose={closeModal}>
          <p className="text-xs text-slate-500 -mt-2">
            This creates the fund for the first time. Can only be done once.
          </p>
          <form onSubmit={handleSeed} className="space-y-3">
            {actionError && <p className="text-sm text-red-600">{actionError}</p>}
            <Field label="Initial Capital (BIF)" required>
              <input type="number" min="1" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required
                placeholder="e.g. 5000000"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
            <Field label="Notes (optional)">
              <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Reason or reference"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
            <ModalActions onCancel={closeModal} submitLabel="Seed Fund" loading={!!actionLoading} color="indigo" />
          </form>
        </Modal>
      )}

      {/* Top Up Modal */}
      {modal === "topup" && (
        <Modal title="Top Up Fund" onClose={closeModal}>
          <form onSubmit={handleTopUp} className="space-y-3">
            {actionError && <p className="text-sm text-red-600">{actionError}</p>}
            <Field label="Amount to Add (BIF)" required>
              <input type="number" min="1" value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required
                placeholder="e.g. 1000000"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
            <Field label="Notes (optional)">
              <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)}
                placeholder="Source of funds or reference"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
            <ModalActions onCancel={closeModal} submitLabel="Top Up" loading={!!actionLoading} color="green" />
          </form>
        </Modal>
      )}

      {/* Deduct Modal */}
      {modal === "deduct" && (
        <Modal title="Deduct from Fund" onClose={closeModal}>
          <p className="text-xs text-slate-500 -mt-2">
            Available balance: <strong>{fmtBIF(f.availableFund)}</strong>
          </p>
          <form onSubmit={handleDeduct} className="space-y-3">
            {actionError && <p className="text-sm text-red-600">{actionError}</p>}
            <Field label="Amount to Deduct (BIF)" required>
              <input type="number" min="1" max={f.availableFund} value={formAmount} onChange={(e) => setFormAmount(e.target.value)} required
                placeholder="e.g. 500000"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
            <Field label="Reason (required)" required>
              <input type="text" value={formNotes} onChange={(e) => setFormNotes(e.target.value)} required
                placeholder="Explain why funds are being removed"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            </Field>
            <ModalActions onCancel={closeModal} submitLabel="Deduct" loading={!!actionLoading} color="red" />
          </form>
        </Modal>
      )}

      {/* Pause Modal */}
      {modal === "pause" && (
        <Modal title="Pause Lending" onClose={closeModal}>
          <p className="text-xs text-slate-500 -mt-2">
            No new loan requests will be accepted until lending is resumed.
          </p>
          <form onSubmit={handlePause} className="space-y-3">
            {actionError && <p className="text-sm text-red-600">{actionError}</p>}
            <Field label="Reason (required)" required>
              <textarea rows={3} value={formNotes} onChange={(e) => setFormNotes(e.target.value)} required
                placeholder="Why is lending being paused?"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-500" />
            </Field>
            <ModalActions onCancel={closeModal} submitLabel="Pause Lending" loading={!!actionLoading} color="red" />
          </form>
        </Modal>
      )}
    </main>
  );
}

// ── Local UI components ───────────────────────────────────────────────────────

function FundCard({ label, value, tone }) {
  const toneClass = {
    slate: "border-slate-200 bg-slate-800 text-white",
    green: "border-green-200 bg-green-50 text-green-900",
    blue: "border-blue-200 bg-blue-50 text-blue-900",
    purple: "border-purple-200 bg-purple-50 text-purple-900",
    amber: "border-amber-200 bg-amber-50 text-amber-900",
    red: "border-red-200 bg-red-50 text-red-900",
    teal: "border-teal-200 bg-teal-50 text-teal-900",
    violet: "border-violet-200 bg-violet-50 text-violet-900",
    neutral: "border-slate-200 bg-white text-slate-900",
  }[tone] || "border-slate-200 bg-white text-slate-900";

  return (
    <div className={`rounded-xl border px-5 py-4 ${toneClass}`}>
      <p className="text-xs font-medium opacity-60 uppercase tracking-wide">{label}</p>
      <p className="text-xl font-bold mt-1 leading-tight">{value}</p>
    </div>
  );
}

function ActionCard({ title, desc, color, onClick, disabled }) {
  const colorClass = {
    green: "hover:border-green-400",
    orange: "hover:border-orange-400",
    amber: "hover:border-amber-400",
    red: "hover:border-red-400",
    slate: "hover:border-slate-400",
  }[color] || "hover:border-slate-400";

  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`flex flex-col rounded-lg border border-slate-200 bg-white p-4 text-left transition-all hover:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed ${colorClass}`}>
      <span className="text-sm font-medium text-slate-900">{title}</span>
      <span className="mt-1 text-xs text-slate-500">{desc}</span>
    </button>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {children}
      </div>
    </div>
  );
}

function ModalActions({ onCancel, submitLabel, loading, color }) {
  const submitColor = {
    indigo: "bg-indigo-600 hover:bg-indigo-700",
    green: "bg-green-600 hover:bg-green-700",
    red: "bg-red-600 hover:bg-red-700",
  }[color] || "bg-brand-500 hover:bg-brand-600";

  return (
    <div className="flex gap-2 justify-end pt-1">
      <button type="button" onClick={onCancel}
        className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-brand-50">
        Cancel
      </button>
      <button type="submit" disabled={!!loading}
        className={`rounded-md px-4 py-2 text-sm font-medium text-white disabled:opacity-60 ${submitColor}`}>
        {loading ? "Processing…" : submitLabel}
      </button>
    </div>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}
