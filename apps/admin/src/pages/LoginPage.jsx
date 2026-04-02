import { useState } from "react";
import { signInWithEmailPIN, signInWithPhonePIN } from "../services/auth";
import { isValidSupportedPhone, normalizePhoneE164, PHONE_VALIDATION_MESSAGE } from "../utils/phone";

export default function LoginPage() {
  const [useSuperAdminEmail, setUseSuperAdminEmail] = useState(false);
  const [phone, setPhone]     = useState("");
  const [email, setEmail]     = useState("");
  const [pin, setPin]         = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError]     = useState("");

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
    <main className="min-h-screen bg-brand-800 flex">
      {/* Left brand panel */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 p-10 border-r border-brand-700">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-white/15 flex items-center justify-center">
            <span className="text-white font-black text-xl">K</span>
          </div>
          <div>
            <p className="text-white font-bold">KIRIMBA</p>
            <p className="text-brand-300 text-xs">Business Console</p>
          </div>
        </div>

        <div>
          <h1 className="text-3xl font-black text-white leading-tight">
            Oversight.<br />Execution.<br />Control.
          </h1>
          <p className="mt-4 text-brand-200 text-sm leading-6">
            Role-aware operations workspace for admins, finance, and super admin staff managing the KIRIMBA group savings platform.
          </p>

          {/* Role pills */}
          <div className="mt-8 space-y-2">
            {[
              { role: "Super Admin", desc: "Full platform control", color: "bg-white/20 text-white" },
              { role: "Operations Admin", desc: "Approvals & operations", color: "bg-brand-600/60 text-brand-100" },
              { role: "Finance", desc: "Portfolio & settlements", color: "bg-gold-500/20 text-gold-300" },
            ].map((r) => (
              <div key={r.role} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${r.color}`}>
                <div className="w-1.5 h-1.5 rounded-full bg-current opacity-60" />
                <div>
                  <p className="text-sm font-semibold">{r.role}</p>
                  <p className="text-xs opacity-70">{r.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <p className="text-brand-400 text-xs">Authorized access only.</p>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center p-6 bg-brand-50">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-2xl bg-brand-500 flex items-center justify-center">
              <span className="text-white font-black text-xl">K</span>
            </div>
            <div>
              <p className="text-slate-900 font-bold">KIRIMBA Admin</p>
              <p className="text-slate-500 text-xs">Business Console</p>
            </div>
          </div>

          <div className="bg-white rounded-3xl shadow-card-lg border border-brand-100 p-8">
            <h2 className="text-2xl font-bold text-slate-900">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">
              {useSuperAdminEmail
                ? "Super admin login — email address + PIN"
                : "Phone number + 6-digit PIN"}
            </p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              {useSuperAdminEmail ? (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-slate-700">Email Address</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@example.com"
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 placeholder-slate-400 focus:border-brand-400 focus:bg-white focus:ring-2 focus:ring-brand-100 outline-none transition-all"
                  />
                </div>
              ) : (
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
              )}

              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-slate-700">PIN</label>
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
                <p className="text-xs text-slate-400">6-digit PIN</p>
              </div>

              {error && (
                <div className="rounded-xl bg-red-50 border border-red-100 px-4 py-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-semibold py-3 text-sm transition-colors disabled:opacity-60 mt-2"
              >
                {isSubmitting ? "Signing in…" : "Sign In"}
              </button>
            </form>

            {/* Toggle login mode */}
            <button
              type="button"
              onClick={() => { setUseSuperAdminEmail((v) => !v); setError(""); }}
              className="mt-4 text-xs text-brand-600 hover:text-brand-700 font-medium underline-offset-2 hover:underline"
            >
              {useSuperAdminEmail ? "← Use phone number login" : "Super admin? Use email login →"}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
