import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signOut } from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../../services/firebase";
import {
  isValidSupportedPhone,
  normalizePhoneE164,
  PHONE_VALIDATION_MESSAGE,
} from "../../utils/phone";

function getProvisioningError(error) {
  const rawCode = typeof error?.code === "string" ? error.code : "";
  const code = rawCode.startsWith("functions/") ? rawCode.slice("functions/".length) : rawCode;
  const detailsMessage =
    typeof error?.details === "string"
      ? error.details
      : typeof error?.details?.message === "string"
      ? error.details.message
      : "";
  const message = (detailsMessage || error?.message || "").trim();

  switch (code) {
    case "invalid-argument":
      return `invalid-argument: ${message || "Invalid input. Check full name, phone, and PIN format."}`;
    case "already-exists":
      return `already-exists: ${message || "Phone number is already registered."}`;
    case "unauthenticated":
      return `unauthenticated: ${message || "Session expired. Please sign in again."}`;
    case "permission-denied":
      return `permission-denied: ${message || "Insufficient permissions for provisioning agents."}`;
    default:
      return message || "Failed to create agent.";
  }
}

function sanitizePinInput(value) {
  return String(value ?? "")
    .trim()
    .replace(/\D+/g, "")
    .slice(0, 6);
}

export default function CreateAgentScreen() {
  const navigate = useNavigate();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinTouched, setPinTouched] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdAgentId, setCreatedAgentId] = useState(null);
  const [submittedPhone, setSubmittedPhone] = useState("");
  const pinLengthError = pinTouched && pin.length < 6 ? "PIN must be exactly 6 digits." : "";

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setPinTouched(true);
    const sanitizedPin = sanitizePinInput(pin);
    setPin(sanitizedPin);
    if (sanitizedPin.length < 6) {
      return;
    }
    const normalizedPhone = normalizePhoneE164(phone);
    if (!isValidSupportedPhone(normalizedPhone)) {
      setError(PHONE_VALIDATION_MESSAGE);
      return;
    }
    setIsSubmitting(true);

    try {
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setError("Session expired. Please sign in again.");
        return;
      }

      try {
        await currentUser.getIdToken(true);
      } catch {
        await signOut(auth);
        setError("Session expired. Please sign in again.");
        return;
      }

      const provisionAgent = httpsCallable(functions, "provisionAgent");
      const result = await provisionAgent({
        fullName: fullName.trim(),
        phone: normalizedPhone,
        pin: sanitizedPin,
      });
      setSubmittedPhone(normalizedPhone);
      setCreatedAgentId(result.data.agentId);
    } catch (err) {
      setError(getProvisioningError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdAgentId) {
    return (
      <main className="px-8 py-7 bg-brand-50">
        <div className="mx-auto max-w-md">
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-green-100 text-green-700 text-lg">
                ✓
              </span>
              <h1 className="text-xl font-semibold text-slate-900">Agent Created</h1>
            </div>
            <div className="mt-4 rounded-lg bg-brand-50 p-4">
              <p className="text-sm text-slate-600">
                <span className="font-medium">Name:</span> {fullName.trim()}
              </p>
              <p className="mt-1 text-sm text-slate-600">
                <span className="font-medium">Phone:</span> {submittedPhone}
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
              className="mt-5 w-full rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white"
            >
              View Agent List
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="px-8 py-7 bg-brand-50">
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
                placeholder="+25766123456"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Burundi: +25766123456, Rwanda: +250788123456, Uganda: +256788123456
              </span>
            </label>

            <label className="block text-sm font-medium text-slate-700">
              PIN
              <input
                type="text"
                required
                value={pin}
                onChange={(e) => {
                  setPinTouched(true);
                  setPin(sanitizePinInput(e.target.value));
                }}
                onBlur={() => setPinTouched(true)}
                inputMode="numeric"
                pattern="\d*"
                maxLength={6}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-lpignore="true"
                data-1p-ignore="true"
                placeholder="6-digit PIN"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Exactly 6 digits. Agent uses this to log in.
              </span>
              <span className="mt-1 block text-xs text-slate-500">PIN length: {pin.length} / 6</span>
              {pinLengthError ? <span className="mt-1 block text-xs text-red-600">{pinLengthError}</span> : null}
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-brand-500 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSubmitting ? "Creating agent..." : "Create Agent"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
