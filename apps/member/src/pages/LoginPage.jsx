import { useMemo, useState } from "react";
import { registerMemberAccount, signInWithPhonePIN } from "../services/auth";
import {
  isValidSupportedPhone,
  normalizePhoneE164,
  PHONE_VALIDATION_MESSAGE,
} from "../utils/phoneAuth";

// ─── Kirimba Logo Mark (SVG inline — no external image needed) ───────────────
function KirimbaLogo({ size = 48 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="#F9C22B" />
      <circle cx="12" cy="12" r="6" fill="#2AADA0" />
      <circle cx="28" cy="10" r="4" fill="#2AADA0" />
      <circle cx="38" cy="18" r="5" fill="#2AADA0" />
      <circle cx="10" cy="28" r="4" fill="#2AADA0" />
      <circle cx="22" cy="26" r="7" fill="#2AADA0" />
      <circle cx="36" cy="32" r="4" fill="#2AADA0" />
      <circle cx="14" cy="40" r="4" fill="#2AADA0" />
      <circle cx="30" cy="42" r="3" fill="#2AADA0" />
      <circle cx="42" cy="42" r="3" fill="#2AADA0" />
    </svg>
  );
}

// ─── Phone icon ───────────────────────────────────────────────────────────────
function PhoneIcon() {
  return (
    <svg className="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
    </svg>
  );
}

// ─── Lock icon ────────────────────────────────────────────────────────────────
function LockIcon() {
  return (
    <svg className="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

// ─── User icon ────────────────────────────────────────────────────────────────
function UserIcon() {
  return (
    <svg className="w-4 h-4 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  );
}

// ─── Input field component ────────────────────────────────────────────────────
function InputField({ label, icon, error, ...inputProps }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-semibold text-brand-800 uppercase tracking-wide">
        {label}
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2">{icon}</span>
        <input
          {...inputProps}
          className="w-full pl-9 pr-4 py-3 rounded-xl border-2 border-brand-100 bg-brand-50 text-slate-800 text-sm placeholder-slate-400 focus:outline-none focus:border-brand-500 focus:bg-white transition-colors"
        />
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// ─── Main LoginPage ───────────────────────────────────────────────────────────
export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isSignup = useMemo(() => mode === "signup", [mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (!/^\d{6}$/.test(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }

    const normalizedPhone = normalizePhoneE164(phone);
    if (!isValidSupportedPhone(normalizedPhone)) {
      setError(PHONE_VALIDATION_MESSAGE);
      return;
    }

    if (isSignup && pin !== confirmPin) {
      setError("PIN entries do not match.");
      return;
    }

    if (isSignup && fullName.trim().length < 3) {
      setError("Full name is required (min 3 characters).");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignup) {
        await registerMemberAccount({
          fullName: fullName.trim(),
          phone: normalizedPhone,
          email: email.trim() || null,
          pin,
        });
        setMessage("Account created! Waiting for admin approval.");
        setMode("login");
        setPin("");
        setConfirmPin("");
      } else {
        await signInWithPhonePIN(normalizedPhone, pin);
      }
    } catch (err) {
      setError(err.message || "Authentication failed.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-brand-500">
      <div className="min-h-screen max-w-md mx-auto flex flex-col px-4">

      {/* ── Top brand area ── */}
      <div className="flex flex-col items-center justify-center pt-10 pb-8 px-4 safe-top">
        <div className="flex items-center gap-3 mb-4">
          <KirimbaLogo size={52} />
          <span className="text-4xl font-extrabold text-white tracking-tight">kirimba</span>
        </div>
        <p className="text-brand-100 text-sm text-center max-w-xs">
          Save together. Grow together. Borrow with confidence.
        </p>
      </div>

      {/* ── White card ── */}
      <div className="flex-1 bg-white rounded-t-[28px] px-5 pt-7 pb-8 shadow-card-lg">

        {/* Tab switcher */}
        <div className="flex bg-brand-50 rounded-2xl p-1 mb-6">
          <button
            type="button"
            onClick={() => { setMode("login"); setError(""); setMessage(""); }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              !isSignup
                ? "bg-brand-500 text-white shadow-sm"
                : "text-brand-600 hover:text-brand-800"
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            onClick={() => { setMode("signup"); setError(""); setMessage(""); }}
            className={`flex-1 py-2.5 rounded-xl text-sm font-semibold transition-all ${
              isSignup
                ? "bg-brand-500 text-white shadow-sm"
                : "text-brand-600 hover:text-brand-800"
            }`}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignup && (
            <InputField
              label="Full Name"
              icon={<UserIcon />}
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="e.g. Amina Niyonzima"
            />
          )}

          <InputField
            label="Phone Number"
            icon={<PhoneIcon />}
            type="tel"
            required
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+25766123456"
          />
          <p className="text-xs text-slate-400 -mt-2 pl-1">
            Burundi +25766… · Rwanda +250788… · Uganda +256788…
          </p>

          {isSignup && (
            <InputField
              label="Email (optional)"
              icon={<PhoneIcon />}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="your@email.com"
            />
          )}

          <InputField
            label="6-Digit PIN"
            icon={<LockIcon />}
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            minLength={6}
            maxLength={6}
            required
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••"
          />

          {isSignup && (
            <InputField
              label="Confirm PIN"
              icon={<LockIcon />}
              type="password"
              inputMode="numeric"
              pattern="\d{6}"
              minLength={6}
              maxLength={6}
              required
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value)}
              placeholder="••••••"
            />
          )}

          {/* Error / success messages */}
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-red-500 mt-0.5">⚠</span>
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
          {message && (
            <div className="flex items-start gap-2 bg-brand-50 border border-brand-200 rounded-xl px-4 py-3">
              <span className="text-brand-500 mt-0.5">✓</span>
              <p className="text-sm text-brand-700">{message}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-brand-500 hover:bg-brand-600 active:bg-brand-700 text-white font-bold py-4 rounded-2xl text-base transition-all disabled:opacity-60 active:scale-95 shadow-card mt-2"
          >
            {isSubmitting
              ? "Please wait…"
              : isSignup
              ? "Create My Account"
              : "Sign In"}
          </button>
        </form>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-400 mt-5">
          By continuing you agree to Kirimba's terms of service
        </p>
      </div>
      </div>
    </main>
  );
}
