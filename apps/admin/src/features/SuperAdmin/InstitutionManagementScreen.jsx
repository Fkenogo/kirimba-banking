import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const INSTITUTION_TYPES = ["microfinance", "bank", "sacco", "cooperative", "other"];
const CURRENCIES = ["BIF", "USD", "EUR", "RWF", "UGX", "TZS", "KES"];
const COUNTRIES = [
  { code: "BI", label: "Burundi" },
  { code: "RW", label: "Rwanda" },
  { code: "UG", label: "Uganda" },
  { code: "TZ", label: "Tanzania" },
  { code: "KE", label: "Kenya" },
];

const EMPTY_FORM = {
  name: "",
  code: "",
  institutionType: "microfinance",
  contactName: "",
  contactEmail: "",
  contactPhone: "",
  country: "BI",
  currency: "BIF",
  supportsDeposits: true,
  supportsWithdrawals: true,
  supportsLoans: false,
  settlementReferencePrefix: "",
  notes: "",
};

function fmtDate(ts) {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts._seconds ? ts._seconds * 1000 : ts);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function InstitutionManagementScreen() {
  const navigate = useNavigate();
  const [institutions, setInstitutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState("");
  const [actionError, setActionError] = useState("");

  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");

  const [suspendTarget, setSuspendTarget] = useState(null);
  const [suspendReason, setSuspendReason] = useState("");

  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getInstitutions");
      const res = await fn({});
      setInstitutions(res.data?.institutions || []);
    } catch (err) {
      setError(err.message || "Failed to load institutions.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function setField(key, value) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleCreate(e) {
    e.preventDefault();
    setCreating(true);
    setCreateError("");
    try {
      const fn = httpsCallable(functions, "createInstitution");
      await fn({
        ...form,
        code: form.code.trim().toUpperCase(),
        settlementReferencePrefix: form.settlementReferencePrefix.trim().toUpperCase() || null,
        contactEmail: form.contactEmail.trim() || null,
        contactPhone: form.contactPhone.trim() || null,
        contactName: form.contactName.trim() || null,
        notes: form.notes.trim() || null,
      });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      setCreateError(err.message || "Failed to create institution.");
    } finally {
      setCreating(false);
    }
  }

  async function handleSuspend(e) {
    e.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    setActionLoading(suspendTarget);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "suspendInstitution");
      await fn({ institutionId: suspendTarget, reason: suspendReason.trim() });
      setSuspendTarget(null);
      setSuspendReason("");
      await load();
    } catch (err) {
      setActionError(err.message || "Failed to suspend institution.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleReactivate(institutionId) {
    setActionLoading(institutionId);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "reactivateInstitution");
      await fn({ institutionId });
      await load();
    } catch (err) {
      setActionError(err.message || "Failed to reactivate institution.");
    } finally {
      setActionLoading("");
    }
  }

  async function handleRepairUmuco() {
    if (!window.confirm(
      "Run Umuco institution repair?\n\nThis will create or patch institutions/umuco with sensible defaults for any missing fields. Existing values are never overwritten."
    )) return;
    setRepairing(true);
    setRepairResult(null);
    setActionError("");
    try {
      const fn = httpsCallable(functions, "backfillUmucoInstitution");
      const res = await fn({});
      setRepairResult(res.data);
      await load();
    } catch (err) {
      setActionError(err.message || "Repair failed.");
    } finally {
      setRepairing(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-4">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Institution Management</h1>
            <p className="text-xs text-slate-400 mt-0.5">Create and manage partner microfinance institutions</p>
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={load} disabled={loading}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
              Refresh
            </button>
            <button type="button" onClick={handleRepairUmuco} disabled={repairing}
              className="rounded-md border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:opacity-60">
              {repairing ? "Repairing…" : "Repair Umuco"}
            </button>
            <button type="button" onClick={() => { setShowCreate(true); setCreateError(""); setForm(EMPTY_FORM); }}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700">
              + Create Institution
            </button>
          </div>
        </div>

        {/* Errors */}
        {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm text-red-700">{error}</p></div>}
        {actionError && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3"><p className="text-sm text-red-700">{actionError}</p></div>}
        {repairResult && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 flex items-start justify-between gap-3">
            <p className="text-sm text-green-800">
              Repair complete — action: <strong>{repairResult.action}</strong>
              {repairResult.patchedFields?.length > 0 && (
                <> · patched: <span className="font-mono text-xs">{repairResult.patchedFields.join(", ")}</span></>
              )}
            </p>
            <button type="button" onClick={() => setRepairResult(null)} className="text-xs text-green-600 hover:text-green-800">Dismiss</button>
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
            <form onSubmit={handleCreate}
              className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-5 my-8">
              <h2 className="text-base font-semibold text-slate-900">Create Institution</h2>
              {createError && <p className="text-sm text-red-600">{createError}</p>}

              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Basic Info</legend>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Institution Name" required>
                    <input type="text" value={form.name} onChange={(e) => setField("name", e.target.value)} required
                      className={INPUT} />
                  </Field>
                  <Field label="Code (e.g. UMUCO)" required>
                    <input type="text" value={form.code} onChange={(e) => setField("code", e.target.value.toUpperCase())} required maxLength={20}
                      className={`${INPUT} font-mono uppercase`} />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Institution Type">
                    <select value={form.institutionType} onChange={(e) => setField("institutionType", e.target.value)} className={INPUT}>
                      {INSTITUTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Settlement Ref Prefix">
                    <input type="text" value={form.settlementReferencePrefix}
                      onChange={(e) => setField("settlementReferencePrefix", e.target.value.toUpperCase())} maxLength={10}
                      className={`${INPUT} font-mono uppercase`} placeholder="e.g. UMC" />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Contact</legend>
                <Field label="Contact Name">
                  <input type="text" value={form.contactName} onChange={(e) => setField("contactName", e.target.value)} className={INPUT} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Contact Email">
                    <input type="email" value={form.contactEmail} onChange={(e) => setField("contactEmail", e.target.value)} className={INPUT} />
                  </Field>
                  <Field label="Contact Phone">
                    <input type="tel" value={form.contactPhone} onChange={(e) => setField("contactPhone", e.target.value)} className={INPUT} placeholder="+25766..." />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500">Location & Currency</legend>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Country">
                    <select value={form.country} onChange={(e) => setField("country", e.target.value)} className={INPUT}>
                      {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                    </select>
                  </Field>
                  <Field label="Currency">
                    <select value={form.currency} onChange={(e) => setField("currency", e.target.value)} className={INPUT}>
                      {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </div>
              </fieldset>

              <fieldset className="space-y-2">
                <legend className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Capabilities</legend>
                <div className="flex gap-6">
                  <Checkbox label="Supports Deposits" checked={form.supportsDeposits} onChange={(v) => setField("supportsDeposits", v)} />
                  <Checkbox label="Supports Withdrawals" checked={form.supportsWithdrawals} onChange={(v) => setField("supportsWithdrawals", v)} />
                  <Checkbox label="Supports Loans" checked={form.supportsLoans} onChange={(v) => setField("supportsLoans", v)} />
                </div>
              </fieldset>

              <Field label="Notes (optional)">
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} rows={2} className={INPUT} />
              </Field>

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => { setShowCreate(false); setCreateError(""); }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={creating}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  {creating ? "Creating…" : "Create Institution"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Suspend modal */}
        {suspendTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <form onSubmit={handleSuspend}
              className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
              <h2 className="text-base font-semibold text-slate-900">Suspend Institution</h2>
              <p className="text-sm text-slate-600">This will prevent new institution users from being provisioned for this institution and flag it as suspended.</p>
              <textarea value={suspendReason} onChange={(e) => setSuspendReason(e.target.value)}
                rows={3} required placeholder="Reason for suspension..."
                className={INPUT} />
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => { setSuspendTarget(null); setSuspendReason(""); }}
                  className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={!!actionLoading}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">
                  {actionLoading ? "Suspending…" : "Suspend"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Institution list */}
        {loading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl border border-slate-200 bg-white animate-pulse" />
            ))}
          </div>
        ) : institutions.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white px-6 py-16 text-center space-y-3">
            <p className="text-sm text-slate-500">No institutions found.</p>
            <p className="text-xs text-slate-400">If Umuco already has live operations, click <strong>Repair Umuco</strong> to seed the record.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {institutions.map((inst) => (
              <InstitutionCard
                key={inst.id}
                inst={inst}
                actionLoading={actionLoading}
                onSuspend={() => setSuspendTarget(inst.id)}
                onReactivate={() => handleReactivate(inst.id)}
              />
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function InstitutionCard({ inst, actionLoading, onSuspend, onReactivate }) {
  const isSuspended = inst.status === "suspended";
  const isLoading = actionLoading === inst.id;

  return (
    <div className={`rounded-xl border bg-white p-5 space-y-4 ${isSuspended ? "border-red-200 bg-red-50/30" : "border-slate-200"}`}>
      {/* Top row: name + status + actions */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-base font-semibold text-slate-900">{inst.name || "—"}</span>
              <span className="font-mono text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded">{inst.code || "—"}</span>
              {inst.institutionType && (
                <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full capitalize">{inst.institutionType}</span>
              )}
              {inst.isBackfilled && (
                <span className="text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">backfilled</span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-0.5">ID: {inst.id}</p>
          </div>
          <StatusBadge status={inst.status} />
        </div>
        <div className="flex gap-2">
          {isSuspended ? (
            <button type="button" onClick={onReactivate} disabled={isLoading}
              className="rounded-md border border-green-300 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-60">
              {isLoading ? "…" : "Reactivate"}
            </button>
          ) : (
            <button type="button" onClick={onSuspend} disabled={!!actionLoading}
              className="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60">
              Suspend
            </button>
          )}
        </div>
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <InfoCell label="Contact">
          {inst.contactName && <span className="block font-medium text-slate-800">{inst.contactName}</span>}
          {inst.contactEmail && <span className="block text-slate-500">{inst.contactEmail}</span>}
          {inst.contactPhone && <span className="block text-slate-500">{inst.contactPhone}</span>}
          {!inst.contactName && !inst.contactEmail && !inst.contactPhone && <span className="text-slate-400">—</span>}
        </InfoCell>
        <InfoCell label="Location">
          {inst.country && <span className="block text-slate-700">{COUNTRIES.find(c => c.code === inst.country)?.label || inst.country}</span>}
          {inst.currency && <span className="block text-slate-500">{inst.currency}</span>}
          {!inst.country && !inst.currency && <span className="text-slate-400">—</span>}
        </InfoCell>
        <InfoCell label="Capabilities">
          <div className="flex flex-wrap gap-1 mt-0.5">
            <CapBadge label="Deposits" active={inst.supportsDeposits} />
            <CapBadge label="Withdrawals" active={inst.supportsWithdrawals} />
            <CapBadge label="Loans" active={inst.supportsLoans} />
          </div>
        </InfoCell>
        <InfoCell label="Settlement Prefix">
          {inst.settlementReferencePrefix
            ? <span className="font-mono text-slate-700">{inst.settlementReferencePrefix}</span>
            : <span className="text-slate-400">—</span>}
        </InfoCell>
      </div>

      {/* Bottom row: notes + dates */}
      <div className="flex items-end justify-between gap-4 flex-wrap border-t border-slate-100 pt-3">
        <p className="text-xs text-slate-400 max-w-lg">{inst.notes || <span className="italic">No notes</span>}</p>
        <div className="flex gap-4 text-xs text-slate-400 shrink-0">
          {inst.createdAt && <span>Created {fmtDate(inst.createdAt)}</span>}
          {inst.updatedAt && <span>Updated {fmtDate(inst.updatedAt)}</span>}
          {isSuspended && inst.suspendedAt && (
            <span className="text-red-500">Suspended {fmtDate(inst.suspendedAt)}{inst.suspendReason ? ` — ${inst.suspendReason}` : ""}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const cls = {
    active: "bg-green-100 text-green-700",
    suspended: "bg-red-100 text-red-700",
  }[status] || "bg-amber-100 text-amber-700";
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${cls}`}>{status || "unknown"}</span>;
}

function CapBadge({ label, active }) {
  return (
    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium ${active ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-400 line-through"}`}>
      {label}
    </span>
  );
}

function InfoCell({ label, children }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">{label}</p>
      {children}
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

function Checkbox({ label, checked, onChange }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)}
        className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
      {label}
    </label>
  );
}

const INPUT = "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";
