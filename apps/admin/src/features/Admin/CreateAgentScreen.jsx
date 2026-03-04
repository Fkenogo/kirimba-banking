import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";

export default function CreateAgentScreen() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdAgentId, setCreatedAgentId] = useState(null);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const provisionAgent = httpsCallable(functions, "provisionAgent");
      const result = await provisionAgent({
        fullName: fullName.trim(),
        phone: phone.trim(),
        pin,
      });
      setCreatedAgentId(result.data.agentId);
    } catch (err) {
      setError(err.message || "Failed to create agent.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdAgentId) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700 text-lg">
                ✓
              </span>
              <h1 className="text-xl font-semibold text-slate-900">Agent Created</h1>
            </div>
            <div className="mt-4 rounded-lg bg-slate-50 p-4">
              <p className="text-sm text-slate-600">
                <span className="font-medium">Name:</span> {fullName.trim()}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-medium">Phone:</span> {phone.trim()}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-medium">Agent ID:</span>{" "}
                <span className="font-mono text-xs">{createdAgentId}</span>
              </p>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              The agent can now log in with their phone and PIN. Assign them to a group to enable
              deposit recording.
            </p>
            <button
              type="button"
              onClick={() => navigate("/admin/agents")}
              className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              View Agent List
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => navigate("/admin/dashboard")}
            className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back to Dashboard
          </button>

          <h1 className="text-xl font-semibold text-slate-900">Create Agent</h1>
          <p className="mt-1 text-sm text-slate-500">
            Provision a new field-staff agent account.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Full Name
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jean Pierre"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
            </label>

            <label className="block text-sm font-medium text-slate-700">
              Phone Number
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+25761234567"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-400">Format: +257XXXXXXXX</span>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              PIN
              <input
                type="password"
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                maxLength={4}
                placeholder="4-digit PIN"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Exactly 4 digits. Agent uses this to log in.
              </span>
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSubmitting ? "Creating agent..." : "Create Agent"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
