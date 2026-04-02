import { useState } from "react";
import { signInWithPhonePIN } from "../services/auth";
import { isValidSupportedPhone, normalizePhoneE164, PHONE_VALIDATION_MESSAGE } from "../utils/phoneAuth";

export default function LoginPage() {
  const [phone, setPhone]           = useState("");
  const [pin, setPin]               = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]           = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }

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
  };

  return (
    <main className="min-h-screen bg-brand-500 flex flex-col">
      {/* Hero section */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 pt-16 pb-10 text-center">
        {/* Logo mark */}
        <div className="w-20 h-20 rounded-3xl bg-white/20 flex items-center justify-center mb-5 shadow-card-lg">
          <span className="text-white font-black text-4xl leading-none">K</span>
        </div>
        <h1 className="text-3xl font-black text-white tracking-tight">KIRIMBA</h1>
        <p className="mt-2 text-brand-100 text-base font-medium">Institution Operations Portal</p>

        {/* Partner badge */}
        <div className="mt-6 inline-flex items-center gap-2 bg-white/10 rounded-full px-4 py-2">
          <div className="w-2 h-2 rounded-full bg-gold-400" />
          <span className="text-white text-sm font-medium">Licensed institution partner access</span>
        </div>
      </div>

      {/* Login card */}
      <div className="bg-white rounded-t-3xl px-6 pt-8 pb-10 shadow-card-lg">
        <div className="max-w-sm mx-auto">
          <h2 className="text-xl font-bold text-slate-900">Sign in</h2>
          <p className="mt-1 text-sm text-slate-500">Use your staff phone number and PIN</p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {/* Phone */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Phone Number</label>
              <input
                type="tel"
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+25766123456"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 outline-none transition-all"
              />
              <p className="text-xs text-slate-400">Burundi (+257), Rwanda (+250), Uganda (+256)</p>
            </div>

            {/* PIN */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Staff PIN</label>
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                minLength={6}
                maxLength={6}
                required
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="••••••"
                className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 outline-none transition-all tracking-widest"
              />
              <p className="text-xs text-slate-400">6-digit PIN assigned by your administrator</p>
            </div>

            {/* Error */}
            {error && (
              <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3 text-sm transition-colors disabled:opacity-60 mt-2"
            >
              {isSubmitting ? "Signing in…" : "Sign In"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
