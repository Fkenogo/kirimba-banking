import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../../services/firebase";
import {
  isValidSupportedPhone,
  normalizePhoneE164,
  PHONE_VALIDATION_MESSAGE,
} from "../../utils/phone";

function getBackendErrorMessage(error, fallback) {
  const fromDetails = typeof error?.details === "string"
    ? error.details
    : error?.details?.message;
  const fromMessage = typeof error?.message === "string" ? error.message : "";
  const candidate = (fromDetails || fromMessage || "").trim();
  if (!candidate || candidate.toLowerCase() === "internal") {
    return fallback;
  }
  return candidate;
}

function sanitizePinInput(value) {
  return String(value ?? "")
    .trim()
    .replace(/\D+/g, "")
    .slice(0, 6);
}

export default function CreateInstitutionUserScreen() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [pinTouched, setPinTouched] = useState(false);
  const [institutionId, setInstitutionId] = useState("");
  const [institutions, setInstitutions] = useState([]);
  const [institutionsLoading, setInstitutionsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [createdUserId, setCreatedUserId] = useState(null);
  const [submittedPhone, setSubmittedPhone] = useState("");
  const pinLengthError = pinTouched && pin.length < 6 ? "PIN must be exactly 6 digits." : "";

  useEffect(() => {
    const fn = httpsCallable(functions, "getInstitutions");
    fn({})
      .then((res) => {
        const active = (res.data?.institutions || []).filter((i) => i.status === "active");
        setInstitutions(active);
        if (active.length === 1) setInstitutionId(active[0].id);
      })
      .catch(() => {})
      .finally(() => setInstitutionsLoading(false));
  }, []);

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
      const provisionInstitutionUser = httpsCallable(functions, "provisionInstitutionUser");
      const result = await provisionInstitutionUser({
        fullName: fullName.trim(),
        phone: normalizedPhone,
        pin: sanitizedPin,
        institutionId: institutionId.trim() || null,
      });
      setSubmittedPhone(normalizedPhone);
      setCreatedUserId(result.data.institutionUserId);
    } catch (err) {
      setError(getBackendErrorMessage(err, "Failed to create institution user."));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (createdUserId) {
    return (
      <main className="min-h-screen bg-slate-50 p-6">
        <div className="mx-auto max-w-md">
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h1 className="text-xl font-semibold text-slate-900">Institution User Created</h1>
            <p className="mt-3 text-sm text-slate-600">
              The new institution staff account can now access the institution portal.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              <span className="font-medium">Phone:</span> {submittedPhone}
            </p>
            <p className="mt-2 text-xs font-mono text-slate-500">{createdUserId}</p>
            <button
              type="button"
              onClick={() => navigate("/admin/dashboard")}
              className="mt-5 w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            >
              Back to Dashboard
            </button>
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-md">
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <button
            type="button"
            onClick={() => navigate("/admin/dashboard")}
            className="mb-4 text-sm text-slate-500 hover:text-slate-700"
          >
            ← Back to Dashboard
          </button>
          <h1 className="text-xl font-semibold text-slate-900">Create Institution User</h1>
          <p className="mt-1 text-sm text-slate-500">Admin or super admin.</p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <label className="block text-sm font-medium text-slate-700">
              Full Name
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
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
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-400">Use a 6-digit PIN.</span>
              <span className="mt-1 block text-xs text-slate-500">PIN length: {pin.length} / 6</span>
              {pinLengthError ? <span className="mt-1 block text-xs text-red-600">{pinLengthError}</span> : null}
            </label>
            <label className="block text-sm font-medium text-slate-700">
              Institution
              <select
                required
                value={institutionId}
                onChange={(e) => setInstitutionId(e.target.value)}
                disabled={institutionsLoading}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm disabled:opacity-60"
              >
                <option value="">
                  {institutionsLoading ? "Loading institutions…" : "Select institution"}
                </option>
                {institutions.map((inst) => (
                  <option key={inst.id} value={inst.id}>
                    {inst.name} ({inst.code})
                  </option>
                ))}
              </select>
            </label>

            {error ? <p className="text-sm text-red-600">{error}</p> : null}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create Institution User"}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
