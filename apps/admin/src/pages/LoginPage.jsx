import { useState } from "react";
import { signInWithEmailPIN, signInWithPhonePIN } from "../services/auth";
import { isValidSupportedPhone, normalizePhoneE164, PHONE_VALIDATION_MESSAGE } from "../utils/phone";

export default function LoginPage() {
  const [useSuperAdminEmail, setUseSuperAdminEmail] = useState(false);
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }

    if (!useSuperAdminEmail) {
      const normalizedPhone = normalizePhoneE164(phone);
      if (!isValidSupportedPhone(normalizedPhone)) {
        setError(PHONE_VALIDATION_MESSAGE);
        return;
      }

      setIsSubmitting(true);
      try {
        await signInWithPhonePIN(normalizedPhone, pin);
      } catch (err) {
        setError(err.message || "Authentication failed.");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!email.trim()) {
      setError("Email is required for super admin login.");
      return;
    }

    setIsSubmitting(true);
    try {
      await signInWithEmailPIN(email.trim(), pin);
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">KIRIMBA Admin</h1>
        <p className="mt-2 text-sm text-slate-600">
          {useSuperAdminEmail
            ? "Super admin login (email + PIN)"
            : "Admin/institution login (phone number + PIN)"}
        </p>

        <button
          type="button"
          onClick={() => {
            setUseSuperAdminEmail((value) => !value);
            setError("");
          }}
          className="mt-3 text-xs text-slate-600 underline"
        >
          {useSuperAdminEmail ? "Use phone login" : "Use super admin email login"}
        </button>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {useSuperAdminEmail ? (
            <label className="block text-sm text-slate-700">
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ) : (
            <label className="block text-sm text-slate-700">
              Phone Number
              <input
                type="tel"
                required
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+25766123456"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Burundi: +25766123456, Rwanda: +250788123456, Uganda: +256788123456
              </span>
            </label>
          )}

          <label className="block text-sm text-slate-700">
            PIN
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              minLength={6}
              maxLength={6}
              required
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <span className="mt-1 block text-xs text-slate-500">Use a 6-digit PIN.</span>
          </label>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isSubmitting ? "Please wait..." : "Login"}
          </button>
        </form>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
      </section>
    </main>
  );
}
