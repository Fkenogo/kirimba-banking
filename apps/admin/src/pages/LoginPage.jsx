import { useMemo, useState } from "react";
import { signInAccount, signUpAccount } from "../services/auth";

export default function LoginPage() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const isSignup = useMemo(() => mode === "signup", [mode]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");

    if (isSignup && password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      if (isSignup) {
        await signUpAccount(email.trim(), password);
        setMessage("Account created. Access and role are controlled by backend approval.");
      } else {
        await signInAccount(email.trim(), password);
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
        <h1 className="text-xl font-semibold text-slate-900">KIRIMBA Admin</h1>
        <p className="mt-2 text-sm text-slate-600">
          {isSignup ? "Create account" : "Login"} with Firebase Authentication
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

          <label className="block text-sm text-slate-700">
            Password
            <input
              type="password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          {isSignup ? (
            <label className="block text-sm text-slate-700">
              Confirm password
              <input
                type="password"
                minLength={8}
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
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
