import { useState } from "react";
import { signInWithPhonePIN } from "../services/auth";
import { isValidSupportedPhone, normalizePhoneE164 } from "../utils/phoneAuth";

export default function LoginPage() {
  const [phone, setPhone]           = useState("");
  const [pin, setPin]               = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]           = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }

    const normalizedPhone = normalizePhoneE164(phone);
    if (!isValidSupportedPhone(normalizedPhone)) {
      setError("Enter a valid phone number (e.g. +25766123456).");
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
  };

  return (
    <main className="min-h-screen bg-brand-500 flex flex-col">
      {/* Hero */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-16 pb-8">
        {/* Logo mark */}
        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
          <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
          </svg>
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight">KIRIMBA Agent</h1>
        <p className="mt-1 text-sm text-brand-100">Field operations portal</p>
      </div>

      {/* Login card */}
      <div className="bg-white rounded-t-3xl px-6 pt-8 pb-10 shadow-card-lg">
        <p className="text-base font-bold text-slate-800 mb-5">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Phone */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
              Phone Number
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => { setPhone(e.target.value); setError(""); }}
              placeholder="+25766123456"
              required
              autoComplete="tel"
              className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
            />
            <p className="text-[11px] text-slate-400">Burundi: +257 · Rwanda: +250 · Uganda: +256</p>
          </div>

          {/* PIN */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-600 uppercase tracking-wide">
              PIN
            </label>
            <input
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              minLength={6}
              maxLength={6}
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(""); }}
              placeholder="••••••"
              required
              autoComplete="current-password"
              className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3.5 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors tracking-widest"
            />
            <p className="text-[11px] text-slate-400">6-digit PIN assigned by your administrator</p>
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-100 rounded-2xl px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full flex items-center justify-center gap-2 bg-brand-500 hover:bg-brand-600 disabled:opacity-60 text-white font-bold py-4 rounded-2xl text-sm transition-colors mt-2"
          >
            {isSubmitting && (
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
            )}
            {isSubmitting ? "Signing in…" : "Sign In"}
          </button>
        </form>
      </div>
    </main>
  );
}
