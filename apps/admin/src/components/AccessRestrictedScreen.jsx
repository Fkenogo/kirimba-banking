import { useNavigate } from "react-router-dom";

export default function AccessRestrictedScreen({
  title = "Access restricted",
  message = "Your role does not have access to this part of the console.",
}) {
  const navigate = useNavigate();

  return (
    <div className="px-8 py-10">
      <div className="max-w-2xl">
        <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center mb-5">
          <svg viewBox="0 0 24 24" fill="none" className="w-6 h-6 text-red-500" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M4.93 19h14.14a2 2 0 0 0 1.73-3L13.73 3a2 2 0 0 0-3.46 0L3.2 16a2 2 0 0 0 1.73 3Z" />
          </svg>
        </div>
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500 max-w-xl">{message}</p>
        <div className="mt-6">
          <button
            type="button"
            onClick={() => navigate("/admin/dashboard")}
            className="rounded-xl bg-brand-500 hover:bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors"
          >
            Go to dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
