import { useMemo, useState } from "react";
import { registerMemberAccount, signInWithPhonePIN } from "../services/auth";
import {
  isValidSupportedPhone,
  normalizePhoneE164,
  PHONE_VALIDATION_MESSAGE,
} from "../utils/phoneAuth";

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
        setMessage("Account created. Pending approval by admin.");
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
    <main className="min-h-screen flex items-center justify-center p-6 bg-slate-50">
      <section className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">KIRIMBA Member</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isSignup ? "Create account" : "Login"} with phone number and PIN
        </p>

        <div className="mt-4 grid grid-cols-2 rounded-md bg-slate-100 p-1">
          <button
            type="button"
            className={`rounded px-3 py-2 text-sm ${!isSignup ? "bg-white font-medium" : "text-slate-600"}`}
            onClick={() => setMode("login")}
          >
            Login
          </button>
          <button
            type="button"
            className={`rounded px-3 py-2 text-sm ${isSignup ? "bg-white font-medium" : "text-slate-600"}`}
            onClick={() => setMode("signup")}
          >
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          {isSignup ? (
            <label className="block text-sm text-slate-700">
              Full Name
              <input
                type="text"
                required
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ) : null}

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

          {isSignup ? (
            <label className="block text-sm text-slate-700">
              Email (optional)
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ) : null}

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

          {isSignup ? (
            <label className="block text-sm text-slate-700">
              Confirm PIN
              <input
                type="password"
                inputMode="numeric"
                pattern="\d{6}"
                minLength={6}
                maxLength={6}
                required
                value={confirmPin}
                onChange={(event) => setConfirmPin(event.target.value)}
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {isSubmitting ? "Please wait..." : isSignup ? "Create account" : "Login"}
          </button>
        </form>

        {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        {message ? <p className="mt-3 text-sm text-green-700">{message}</p> : null}
      </section>
    </main>
  );
}
