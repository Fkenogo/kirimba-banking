import { useNavigate } from "react-router-dom";
import { PageShell, Card } from "../../components/ui";

export default function FindAgentScreen() {
  const navigate = useNavigate();

  return (
    <PageShell title="Find an Agent" showBack backTo="/app/dashboard" backLabel="Back to Account">

      {/* Coming soon hero */}
      <div className="bg-brand-500 rounded-2xl px-5 py-8 text-white text-center shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-24 h-24 bg-brand-400 rounded-full opacity-30" />
        <div className="absolute -bottom-4 -left-4 w-16 h-16 bg-brand-400 rounded-full opacity-20" />
        <div className="relative">
          <div className="w-16 h-16 bg-brand-400 rounded-2xl flex items-center justify-center mx-auto mb-3">
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <p className="text-lg font-extrabold">Agent Locator</p>
          <p className="text-sm text-brand-200 mt-1">Coming Soon</p>
        </div>
      </div>

      {/* Notice */}
      <Card>
        <div className="px-5 py-5 text-center space-y-2">
          <p className="text-sm font-bold text-slate-800">Interactive agent map coming soon</p>
          <p className="text-xs text-slate-500">
            We're building a real-time map to help you find the nearest Kirimba agent.
            In the meantime, use the tips below to locate one.
          </p>
        </div>
      </Card>

      {/* How to find an agent */}
      <Card>
        <div className="px-5 pt-4 pb-2">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">How to Find an Agent</p>
          <div className="space-y-0 divide-y divide-slate-50">
            {[
              {
                icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z",
                label: "Ask your group leader",
                sub:   "Your leader knows the agents assigned to your group.",
              },
              {
                icon: "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
                label: "Call Kirimba support",
                sub:   "Our support team will connect you with the nearest available agent.",
              },
              {
                icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
                label: "Check your group chat",
                sub:   "Look for agent contact info on your group's WhatsApp or community board.",
              },
            ].map(({ icon, label, sub }) => (
              <div key={label} className="flex items-start gap-4 py-4">
                <div className="w-9 h-9 bg-brand-50 rounded-xl flex items-center justify-center shrink-0 mt-0.5">
                  <svg className="w-4.5 h-4.5 w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      {/* Back to deposit CTA */}
      <button
        type="button"
        onClick={() => navigate("/app/deposit")}
        className="w-full bg-gold-500 hover:bg-gold-600 text-white font-bold py-4 rounded-2xl text-base transition-all active:scale-95 shadow-card flex items-center justify-center gap-2"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
        Back to Deposit
      </button>

    </PageShell>
  );
}
