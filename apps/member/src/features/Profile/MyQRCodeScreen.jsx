import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { signOut } from "firebase/auth";
import { auth, db } from "../../services/firebase";
import { PageShell, Card, LoadingScreen } from "../../components/ui";

function formatRole(role) {
  const normalized = String(role || "member").replace(/_/g, " ").trim();
  return normalized.replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatJoinedDate(value) {
  if (!value) return "Not available";

  let date = null;
  if (typeof value?.toDate === "function") {
    date = value.toDate();
  } else if (typeof value?._seconds === "number") {
    date = new Date(value._seconds * 1000);
  } else if (typeof value?.seconds === "number") {
    date = new Date(value.seconds * 1000);
  } else {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed;
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return "Not available";
  }

  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function MyQRCodeScreen({ user, notifCount = 0 }) {
  const navigate = useNavigate();
  const [profile, setProfile] = useState(null);
  const [institutionName, setInstitutionName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [signingOut, setSigningOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        const data = userSnap.exists() ? userSnap.data() || {} : {};
        setProfile(data);

        const currentGroupId = data.ledGroupId || data.groupId || "";
        const currentInstitutionId = data.institutionId || "";

        const [groupSnap, institutionSnap] = await Promise.all([
          currentGroupId ? getDoc(doc(db, "groups", currentGroupId)) : Promise.resolve(null),
          currentInstitutionId ? getDoc(doc(db, "institutions", currentInstitutionId)) : Promise.resolve(null),
        ]);

        setGroupName(groupSnap?.exists() ? groupSnap.data()?.name || "" : "");
        setInstitutionName(institutionSnap?.exists() ? institutionSnap.data()?.name || "" : "");
        setError("");
      } catch (err) {
        setError(err?.message || "Failed to load your profile.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  const memberName = profile?.fullName ?? user?.email ?? "Kirimba Member";
  const memberId = profile?.memberId || "";
  const phone = profile?.phone || "";
  const roleLabel = formatRole(profile?.role);
  const institutionLabel = institutionName || profile?.institutionId || "Not linked";
  const groupLabel = groupName || (profile?.groupId || profile?.ledGroupId ? "Linked group" : "No group yet");
  const memberSince = formatJoinedDate(profile?.approvedAt || profile?.createdAt);
  const qrValue = memberId || user?.uid || "";

  const initials = useMemo(
    () =>
      String(memberName)
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase() || "KM",
    [memberName]
  );

  const quickActions = [
    {
      label: institutionName || profile?.institutionId ? "Change Institution" : "Select Institution",
      sub: institutionName || profile?.institutionId ? `Currently linked to ${institutionLabel}` : "Choose the institution connected to your account",
      path: "/app/institution",
      icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
    },
    {
      label: "My Group",
      sub: groupName ? `Open ${groupName}` : "View or join your savings group",
      path: "/app/group/my",
      icon: "M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z",
    },
    {
      label: "Notifications",
      sub: "Review account alerts and group updates",
      path: "/app/notifications",
      state: { backTo: "/app/profile", backLabel: "Back to Profile" },
      icon: "M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6 6 0 00-5-5.917V4a1 1 0 10-2 0v1.083A6 6 0 006 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
    },
  ];

  if (loading) return <LoadingScreen title="Profile" />;

  return (
    <PageShell title="Profile" notifCount={notifCount}>
      {error ? (
        <Card>
          <div className="px-5 py-4 text-center text-sm text-red-500">{error}</div>
        </Card>
      ) : null}

      <div className="bg-brand-500 rounded-2xl px-5 py-[18px] text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-10 -right-10 w-32 h-32 bg-brand-400 rounded-full opacity-30" />
        <div className="absolute -bottom-8 -left-6 w-24 h-24 bg-gold-400 rounded-full opacity-20" />
        <div className="relative flex items-start gap-4">
          <div className="w-14 h-14 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center shrink-0">
            <span className="text-xl font-extrabold text-white">{initials}</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-widest text-brand-100">Member Identity</p>
            <p className="text-2xl font-extrabold leading-tight mt-1">{memberName}</p>
            {phone ? <p className="text-sm text-brand-100 mt-1">{phone}</p> : null}
            <div className="flex flex-wrap gap-2 mt-3">
              <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-white/15 text-white">
                {roleLabel}
              </span>
              <span className="text-[10px] font-bold uppercase tracking-wide rounded-full px-2.5 py-1 bg-gold-400 text-gold-900">
                {institutionLabel}
              </span>
            </div>
          </div>
        </div>
      </div>

      <Card>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Account Details</p>
            <p className="text-sm font-bold text-slate-800 mt-1">Your Kirimba membership details</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <IdentityTile label="Member ID" value={memberId || "Unavailable"} mono={Boolean(memberId)} />
            <IdentityTile label="Member Since" value={memberSince} />
            <IdentityTile label="Institution" value={institutionLabel} />
            <IdentityTile label="Group" value={groupLabel} />
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-[18px] flex flex-col items-center gap-4">
          <div className="text-center space-y-1">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Member QR</p>
            <p className="text-lg font-extrabold text-slate-900">Use this code to verify your account</p>
            <p className="text-sm text-slate-500 max-w-xs">
              Show this QR code to an agent for deposits, withdrawals, and loan collection.
            </p>
          </div>

          {qrValue ? (
            <div className="p-4 bg-white rounded-[28px] border-2 border-brand-100 shadow-card max-w-full">
              <QRCodeSVG value={qrValue} size={210} bgColor="#ffffff" fgColor="#0f172a" level="M" />
            </div>
          ) : (
            <div className="w-full rounded-2xl border border-dashed border-brand-200 bg-brand-50 px-4 py-5 text-center">
              <p className="text-sm font-semibold text-slate-700">Your QR code is not available right now.</p>
              <p className="text-xs text-slate-500 mt-1">Please refresh the app or contact support if this continues.</p>
            </div>
          )}

          <div className="w-full rounded-2xl bg-slate-50 px-4 py-3.5 text-center">
            <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">Member ID</p>
            {memberId ? (
              <p className="text-sm font-mono font-semibold text-brand-700 tracking-wide mt-1">{memberId}</p>
            ) : (
              <p className="text-sm text-slate-500 mt-1">Member ID unavailable right now. Your QR still identifies your account.</p>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4">
          <div className="mb-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Quick Actions</p>
            <p className="text-sm font-bold text-slate-800 mt-1">Shortcuts for your account</p>
          </div>
          <div className="divide-y divide-slate-50">
            {quickActions.map(({ label, sub, path, state, icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => navigate(path, state ? { state } : undefined)}
                className="w-full flex items-center gap-4 py-4 first:pt-1 last:pb-1 text-left"
              >
                <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-brand-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800">{label}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{sub}</p>
                </div>
                <svg className="w-4 h-4 text-slate-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </button>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="px-5 py-4 space-y-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Security</p>
            <p className="text-sm font-bold text-slate-800 mt-1">Manage this session</p>
            <p className="text-xs text-slate-500 mt-1">Sign out when you are using a shared or borrowed device.</p>
          </div>

          <button
            type="button"
            onClick={async () => {
              setSigningOut(true);
              try {
                await signOut(auth);
              } catch {
                setSigningOut(false);
              }
            }}
            disabled={signingOut}
            className="w-full flex items-center justify-center gap-2 py-4 rounded-2xl border-2 border-red-100 text-red-500 font-bold text-sm hover:bg-red-50 active:bg-red-100 transition-colors disabled:opacity-60"
          >
            {signingOut ? (
              <span className="w-4 h-4 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            )}
            {signingOut ? "Signing out..." : "Sign Out"}
          </button>
        </div>
      </Card>
    </PageShell>
  );
}

function IdentityTile({ label, value, mono = false }) {
  return (
    <div className="rounded-2xl border border-brand-100 bg-brand-50 px-4 py-4 min-h-[88px]">
      <p className="text-[11px] uppercase tracking-wide text-slate-500 font-bold">{label}</p>
      <p className={`text-sm font-semibold text-slate-900 mt-1 leading-relaxed break-words ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
