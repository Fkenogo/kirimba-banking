import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

const CONFIG_IDS = ["fees", "loanPolicy", "commissionPolicy", "businessRules"];
const CONFIG_LABELS = {
  fees: "Fees",
  loanPolicy: "Loan Policy",
  commissionPolicy: "Commission Policy",
  businessRules: "Business Rules",
};
const SUPPORTED_LOAN_TERM_DURATIONS = [7, 14, 21, 30];

function formatBIF(value) {
  return `${Number(value || 0).toLocaleString()} BIF`;
}

function formatPct(value, { minimumFractionDigits = 0, maximumFractionDigits = 0 } = {}) {
  return `${(Number(value || 0) * 100).toLocaleString(undefined, {
    minimumFractionDigits,
    maximumFractionDigits,
  })}%`;
}

function deriveFeeSummary(configs) {
  const fees = configs?.fees || {};
  return {
    depositFeeFlat: Number(fees.depositFeeFlat || 0),
    withdrawFeeFlat: Number(fees.withdrawFeeFlat || 0),
    agentCommissionSharePct: Number(fees.agentCommissionSharePct || 0),
    kirimbaRetainedSharePct: Number(fees.kirimbaRetainedSharePct || 0),
    agentCommissionDepositFlat: Number(fees.agentCommissionDepositFlat || 0),
    agentCommissionWithdrawFlat: Number(fees.agentCommissionWithdrawFlat || 0),
    kirimbaRetainedDepositFlat: Number(fees.kirimbaRetainedDepositFlat || 0),
    kirimbaRetainedWithdrawFlat: Number(fees.kirimbaRetainedWithdrawFlat || 0),
  };
}

function deriveLoanPolicySummary(configs) {
  const loanPolicy = configs?.loanPolicy || {};
  const termPricing = Array.isArray(loanPolicy.termPricing) ? loanPolicy.termPricing : [];
  const sortedTerms = [...termPricing]
    .map((term) => ({
      durationDays: Number(term?.durationDays || 0),
      contractedFeePct: Number(term?.contractedFeePct || 0),
      minimumFeeFloor: Number(term?.minimumFeeFloor || 0),
      active: term?.active !== false,
    }))
    .sort((a, b) => a.durationDays - b.durationDays);

  return {
    defaultTermDays: Number(loanPolicy.defaultTermDays || 0),
    earlySettlementRebateEnabled: loanPolicy.earlySettlementRebateEnabled === true,
    termPricing: sortedTerms,
  };
}

function validateLoanPolicyDraft(policy) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    throw new Error("Loan policy must be a JSON object.");
  }

  if (!Array.isArray(policy.termPricing)) {
    throw new Error("Loan policy must include a termPricing array.");
  }

  const normalizedTerms = policy.termPricing.map((term, index) => {
    const durationDays = Number(term?.durationDays);
    if (!SUPPORTED_LOAN_TERM_DURATIONS.includes(durationDays)) {
      throw new Error(`Loan term ${index + 1} must use one of: 7, 14, 21, 30 days.`);
    }

    const contractedFeePct = Number(term?.contractedFeePct);
    if (term?.active !== false && (!Number.isFinite(contractedFeePct) || contractedFeePct < 0)) {
      throw new Error(`Active ${durationDays}-day pricing must include a valid contractedFeePct.`);
    }

    return {
      durationDays,
      contractedFeePct,
      active: term?.active !== false,
    };
  }).sort((a, b) => a.durationDays - b.durationDays);

  const uniqueDurations = new Set(normalizedTerms.map((term) => term.durationDays));
  if (uniqueDurations.size !== SUPPORTED_LOAN_TERM_DURATIONS.length) {
    throw new Error("Loan policy must define exactly one pricing entry for 7, 14, 21, and 30 days.");
  }

  const activeTerms = normalizedTerms.filter((term) => term.active);
  for (let index = 1; index < activeTerms.length; index += 1) {
    const previous = activeTerms[index - 1];
    const current = activeTerms[index];
    if (current.contractedFeePct <= previous.contractedFeePct) {
      throw new Error(`${current.durationDays}-day contractedFeePct must be higher than ${previous.durationDays}-day pricing.`);
    }
  }
}

export default function SystemConfigScreen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("fees");
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState("");
  const feeSummary = deriveFeeSummary(configs);
  const loanPolicySummary = deriveLoanPolicySummary(configs);
  const commissionPolicy = configs.commissionPolicy || {};

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getSystemConfig");
      const results = await Promise.all(CONFIG_IDS.map((id) => fn({ configId: id }).catch(() => ({ data: { config: null } }))));
      const loaded = {};
      CONFIG_IDS.forEach((id, i) => {
        loaded[id] = results[i].data?.data || {};
      });
      setConfigs(loaded);
      setDraft(JSON.stringify(loaded[activeTab] || {}, null, 2));
    } catch (err) {
      setError(err.message || "Failed to load system config.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDraft(JSON.stringify(configs[activeTab] || {}, null, 2));
    setError("");
    setSuccess("");
  }, [activeTab, configs]);

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");
    let parsed;
    try {
      parsed = JSON.parse(draft);
    } catch {
      setError("Invalid JSON. Please fix before saving.");
      setSaving(false);
      return;
    }
    if (activeTab === "loanPolicy") {
      try {
        validateLoanPolicyDraft(parsed);
      } catch (validationError) {
        setError(validationError.message || "Loan policy is invalid.");
        setSaving(false);
        return;
      }
    }
    try {
      const fn = httpsCallable(functions, "updateSystemConfig");
      await fn({ configId: activeTab, data: parsed });
      await loadAll();
      setSuccess("Configuration saved successfully.");
    } catch (err) {
      setError(err.message || "Failed to save config.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSeed() {
    setSaving(true);
    setError("");
    setSuccess("");
    try {
      const fn = httpsCallable(functions, "seedSystemConfig");
      await fn({});
      setSuccess("Default configuration seeded. Reloading…");
      await loadAll();
    } catch (err) {
      setError(err.message || "Failed to seed config.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="px-8 py-7 bg-brand-50">
      <div className="mx-auto max-w-3xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">Pricing & Rules</h1>
            <p className="text-xs text-slate-400 mt-0.5">Live fee policy, lending terms, commissions, and business rules</p>
          </div>
          <button type="button" onClick={handleSeed} disabled={saving || loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-brand-50 disabled:opacity-60">
            Seed Defaults
          </button>
        </div>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}
        {success && (
          <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
            <p className="text-sm text-green-700">{success}</p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {CONFIG_IDS.map((id) => (
            <button key={id} type="button"
              onClick={() => setActiveTab(id)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                activeTab === id
                  ? "bg-brand-500 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}>
              {CONFIG_LABELS[id]}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="h-64 rounded-xl border border-slate-200 bg-white animate-pulse" />
        ) : (
          <form onSubmit={handleSave} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="border-b border-brand-100 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">{CONFIG_LABELS[activeTab]}</h2>
              <span className="text-xs text-slate-400">Live engine config</span>
            </div>
            <div className="p-4">
              {activeTab === "fees" ? (
                <ConfigSummary
                  title="Live Agent Transaction Fees"
                  description="The backend fee engine reads this Fees config for agent-handled deposits and withdrawals."
                  items={[
                    { label: "Deposit Fee", value: formatBIF(feeSummary.depositFeeFlat) },
                    { label: "Withdrawal Fee", value: formatBIF(feeSummary.withdrawFeeFlat) },
                    { label: "Agent Transaction Share", value: `${formatPct(feeSummary.agentCommissionSharePct)} · ${formatBIF(feeSummary.agentCommissionDepositFlat)} deposit / ${formatBIF(feeSummary.agentCommissionWithdrawFlat)} withdrawal` },
                    { label: "Kirimba Retained Transaction Share", value: `${formatPct(feeSummary.kirimbaRetainedSharePct)} · ${formatBIF(feeSummary.kirimbaRetainedDepositFlat)} deposit / ${formatBIF(feeSummary.kirimbaRetainedWithdrawFlat)} withdrawal` },
                  ]}
                />
              ) : null}
              {activeTab === "commissionPolicy" ? (
                <ConfigSummary
                  title="Commission Policy View"
                  description="This policy applies only to agent-assisted deposit and withdrawal transaction fees. Loan fees remain fully retained by Kirimba and their pricing basis is defined in the Loan Policy tab."
                  items={[
                    { label: "Agent Transaction Share", value: formatPct(commissionPolicy.agentTransactionCommissionSharePct ?? feeSummary.agentCommissionSharePct) },
                    { label: "Kirimba Retained Transaction Share", value: formatPct(commissionPolicy.kirimbaTransactionRetainedSharePct ?? feeSummary.kirimbaRetainedSharePct) },
                    { label: "Settlement Cycle", value: `${Number(commissionPolicy.settlementCycleDays || 0)} days` },
                  ]}
                />
              ) : null}
              {activeTab === "loanPolicy" ? (
                <>
                  <ConfigSummary
                    title="Live Loan Pricing Basis"
                    description="The live loan engine uses the contracted term fee ladder below. No separate loan processing or origination fee is configured in the current backend logic."
                    items={[
                      ...loanPolicySummary.termPricing.map((term) => ({
                        label: `${term.durationDays}-Day Contracted Fee`,
                        value: `${formatPct(term.contractedFeePct, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${term.minimumFeeFloor > 0 ? ` · minimum ${formatBIF(term.minimumFeeFloor)}` : ""}${term.active ? "" : " · inactive"}`,
                      })),
                      { label: "Loan Processing Fee", value: "None configured" },
                      { label: "Loan Fee Revenue Owner", value: "Kirimba (100%)" },
                      { label: "Default Loan Term", value: loanPolicySummary.defaultTermDays ? `${loanPolicySummary.defaultTermDays} days` : "Not set" },
                    ]}
                  />
                  <div className="mb-4 rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-xs leading-5 text-sky-800">
                    Loan policy uses contracted term fees for 7, 14, 21, and 30 days.
                    Save-time guardrails block duplicate terms, unsupported durations, missing active pricing, and any fee ladder where longer terms are not priced above shorter terms.
                    {loanPolicySummary.earlySettlementRebateEnabled ? " Early-settlement rebates are enabled." : " Early-settlement rebates are not enabled."}
                  </div>
                </>
              ) : null}
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={20}
                spellCheck={false}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-brand-50"
              />
            </div>
            <div className="border-t border-slate-100 px-4 py-3 flex justify-end gap-2">
              <button type="button"
                onClick={() => setDraft(JSON.stringify(configs[activeTab] || {}, null, 2))}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-brand-50">
                Reset
              </button>
              <button type="submit" disabled={saving}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </form>
        )}

        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <p className="text-xs text-amber-700">
            <strong>Warning:</strong> Changes to system configuration take effect immediately and are logged in the audit trail.
            Incorrect values may affect contracted loan fees, member credit limits, group incentive accrual, and transaction behavior.
          </p>
        </div>
      </div>
    </main>
  );
}

function ConfigSummary({ title, description, items }) {
  return (
    <div className="mb-4 rounded-lg border border-brand-100 bg-brand-50 px-4 py-4">
      <div className="mb-3">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        <p className="mt-1 text-xs text-slate-500">{description}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg border border-white/80 bg-white px-3 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{item.label}</p>
            <p className="mt-1 text-sm font-semibold text-slate-800">{item.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
