import { useNavigate } from "react-router-dom";

export default function FindAgentScreen() {
  const navigate = useNavigate();

  return (
    <main className="min-h-screen bg-slate-50 pb-10">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-6">

        <div>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="mb-2 text-xs text-slate-500 hover:text-slate-700"
          >
            ← Back
          </button>
          <h1 className="text-xl font-bold text-slate-900">Find a KIRIMBA Agent</h1>
          <p className="text-xs text-slate-400 mt-0.5">Locate an agent near you to make a cash deposit or withdrawal</p>
        </div>

        {/* Coming soon notice */}
        <section className="rounded-xl bg-indigo-50 border border-indigo-100 px-5 py-5 space-y-2 text-center">
          <p className="text-2xl">📍</p>
          <p className="text-base font-semibold text-indigo-900">Agent Locator Coming Soon</p>
          <p className="text-sm text-indigo-700">
            We are building an agent map. In the meantime, contact your group leader or KIRIMBA
            support to find an agent near you.
          </p>
        </section>

        {/* Manual tips */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">How to find an agent</h2>
          <div className="rounded-xl bg-white border border-slate-200 divide-y divide-slate-100 text-sm">
            <Tip icon="👥" text="Ask your group leader — they know the agents in your area." />
            <Tip icon="📞" text="Call KIRIMBA support and they will connect you with your nearest agent." />
            <Tip icon="📢" text="Check your group WhatsApp or community board for agent contact details." />
          </div>
        </section>

        <button
          type="button"
          onClick={() => navigate("/app/deposit")}
          className="w-full rounded-xl bg-indigo-600 text-white font-semibold py-3 text-sm hover:bg-indigo-700 transition-colors"
        >
          Back to Deposit
        </button>
      </div>
    </main>
  );
}

function Tip({ icon, text }) {
  return (
    <div className="px-4 py-3 flex items-start gap-3">
      <span className="text-base mt-0.5">{icon}</span>
      <p className="text-slate-700">{text}</p>
    </div>
  );
}
