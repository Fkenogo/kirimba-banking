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

export default function SystemConfigScreen() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState("fees");
  const [configs, setConfigs] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [draft, setDraft] = useState("");

  async function loadAll() {
    setLoading(true);
    setError("");
    try {
      const fn = httpsCallable(functions, "getSystemConfig");
      const results = await Promise.all(CONFIG_IDS.map((id) => fn({ configId: id }).catch(() => ({ data: { config: null } }))));
      const loaded = {};
      CONFIG_IDS.forEach((id, i) => {
        loaded[id] = results[i].data?.config || {};
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
    try {
      const fn = httpsCallable(functions, "updateSystemConfig");
      await fn({ configId: activeTab, data: parsed });
      setConfigs((prev) => ({ ...prev, [activeTab]: parsed }));
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
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-3xl space-y-4">

        <div className="flex items-center justify-between gap-4">
          <div>
            <button type="button" onClick={() => navigate("/admin/dashboard")}
              className="mb-1 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
              ← Back to Dashboard
            </button>
            <h1 className="text-xl font-semibold text-slate-900">System Configuration</h1>
            <p className="text-xs text-slate-400 mt-0.5">Fees, loan policy, commission rates, and business rules</p>
          </div>
          <button type="button" onClick={handleSeed} disabled={saving || loading}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-sm text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-60">
            Seed Defaults
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3">
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
                  ? "bg-slate-900 text-white"
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
            <div className="border-b border-slate-100 px-4 py-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">{CONFIG_LABELS[activeTab]}</h2>
              <span className="text-xs text-slate-400">JSON format</span>
            </div>
            <div className="p-4">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={20}
                spellCheck={false}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-slate-50"
              />
            </div>
            <div className="border-t border-slate-100 px-4 py-3 flex justify-end gap-2">
              <button type="button"
                onClick={() => setDraft(JSON.stringify(configs[activeTab] || {}, null, 2))}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
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
            Incorrect values may affect loan approvals, fee calculations, and member credit limits.
          </p>
        </div>
      </div>
    </main>
  );
}
