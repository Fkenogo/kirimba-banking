import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { httpsCallable } from "firebase/functions";
import { functions } from "../services/firebase";

function formatDate(value) {
  if (!value) return "No timestamp";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No timestamp";
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

function describeCallableError(error, fallbackMessage) {
  const code = String(error?.code || "").trim();
  const message = String(error?.message || "").replace(/^Firebase:\s*/i, "").trim();
  if (code && message) return `${fallbackMessage} (${code}: ${message})`;
  if (message) return `${fallbackMessage} (${message})`;
  return fallbackMessage;
}

function getLoginSurfaceCopy(surface) {
  if (surface === "agent_console") {
    return "Open the Kirimba Agent app and sign in with your phone number and new PIN.";
  }
  if (surface === "institution_console") {
    return "Open the Kirimba Institution Staff app and sign in with your phone number and new PIN.";
  }
  return "Open the Kirimba Admin console and sign in with your phone number and new PIN.";
}

export default function InvitationAcceptancePage() {
  const [searchParams] = useSearchParams();
  const invitationId = searchParams.get("invitation") || "";
  const token = searchParams.get("token") || "";

  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [accepted, setAccepted] = useState(null);

  useEffect(() => {
    async function loadInvitation() {
      if (!invitationId || !token) {
        setError("This invitation link is incomplete.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");
      try {
        const fn = httpsCallable(functions, "getUserInvitationAcceptance");
        const response = await fn({ invitationId, token });
        setInvitation(response.data?.invitation || null);
      } catch (loadError) {
        setInvitation(null);
        setError(describeCallableError(loadError, "This invitation link is not available."));
      } finally {
        setLoading(false);
      }
    }

    void loadInvitation();
  }, [invitationId, token]);

  async function handleAccept(event) {
    event.preventDefault();
    setError("");

    if (!/^\d{6}$/.test(pin)) {
      setError("PIN must be exactly 6 digits.");
      return;
    }

    if (pin !== confirmPin) {
      setError("PIN confirmation does not match.");
      return;
    }

    setIsSubmitting(true);
    try {
      const fn = httpsCallable(functions, "acceptUserInvitation");
      const response = await fn({ invitationId, token, pin });
      setAccepted(response.data || null);
    } catch (runError) {
      setError(describeCallableError(runError, "We couldn't complete invitation acceptance."));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-brand-50 px-6 py-16">
        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-sm text-slate-500">Loading invitation…</p>
        </div>
      </main>
    );
  }

  if (accepted) {
    return (
      <main className="min-h-screen bg-brand-50 px-6 py-16">
        <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Kirimba invitation</p>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Account setup complete</h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Your invitation was accepted successfully. {getLoginSurfaceCopy(accepted.loginSurface)}
          </p>
          <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            Keep your new PIN private. Your access is now governed by the role assigned in the invitation.
          </div>
          <div className="mt-6">
            <Link to="/admin/login" className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600">
              Return to Kirimba Admin
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-brand-50 px-6 py-16">
      <div className="mx-auto max-w-2xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">Kirimba invitation</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Accept your access invitation</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Finish setting up your account by confirming the invitation and creating your six-digit PIN.
        </p>

        {error ? (
          <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}

        {invitation ? (
          <>
            <section className="mt-6 rounded-3xl border border-slate-200 bg-brand-50 p-5">
              <h2 className="text-base font-semibold text-slate-950">Invitation summary</h2>
              <dl className="mt-4 space-y-3 text-sm text-slate-700">
                <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-4">
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Invitee</dt>
                  <dd>{invitation.targetName}</dd>
                </div>
                <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-4">
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Phone</dt>
                  <dd>{invitation.targetPhone}</dd>
                </div>
                <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-4">
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Role</dt>
                  <dd>{invitation.roleLabel}</dd>
                </div>
                <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-4">
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Institution</dt>
                  <dd>{invitation.institutionName || "No institution link"}</dd>
                </div>
                <div className="grid grid-cols-[170px_minmax(0,1fr)] gap-4">
                  <dt className="text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Expires</dt>
                  <dd>{formatDate(invitation.expiresAt)}</dd>
                </div>
              </dl>
            </section>

            <form className="mt-6 space-y-4" onSubmit={handleAccept}>
              <label className="block text-sm font-medium text-slate-700">
                New PIN
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  minLength={6}
                  maxLength={6}
                  required
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
                <span className="mt-1 block text-xs text-slate-500">Use exactly 6 digits.</span>
              </label>

              <label className="block text-sm font-medium text-slate-700">
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
                  className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm text-slate-700"
                />
              </label>

              <button
                type="submit"
                disabled={isSubmitting}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-medium text-white hover:bg-brand-600 disabled:opacity-60"
              >
                {isSubmitting ? "Setting up account…" : "Accept invitation"}
              </button>
            </form>
          </>
        ) : null}
      </div>
    </main>
  );
}
