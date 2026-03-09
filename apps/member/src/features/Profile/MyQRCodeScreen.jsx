import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { db } from "../../services/firebase";

export default function MyQRCodeScreen({ user }) {
  const [profile, setProfile] = useState(null);
  const [groupName, setGroupName] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        const userSnap = await getDoc(doc(db, "users", user.uid));
        if (!userSnap.exists()) return;

        const data = userSnap.data();
        setProfile(data);

        const gid = data.groupId;
        if (gid) {
          const groupSnap = await getDoc(doc(db, "groups", gid));
          if (groupSnap.exists()) {
            setGroupName(groupSnap.data().name);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-sm text-slate-500">Loading...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <p className="text-sm text-red-600">Error: {error}</p>
      </main>
    );
  }

  const memberId = profile?.memberId;
  const memberName = profile?.name ?? profile?.fullName ?? user.email ?? "Member";
  const qrValue = JSON.stringify({ memberId: memberId ?? null });

  return (
    <main className="min-h-screen bg-slate-50 flex flex-col">
      <div className="max-w-lg mx-auto w-full px-4 pt-8 pb-12 flex flex-col items-center">

        {/* Header */}
        <h1 className="text-xl font-bold text-slate-900 mb-1 self-start">My Deposit QR</h1>
        <p className="text-xs text-slate-400 mb-8 self-start">
          Show this to an agent to record a deposit.
        </p>

        {/* QR card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 flex flex-col items-center w-full">
          {memberId ? (
            <div className="p-4 bg-white rounded-xl border border-slate-100">
              <QRCodeSVG
                value={qrValue}
                size={220}
                bgColor="#ffffff"
                fgColor="#0f172a"
                level="M"
              />
            </div>
          ) : (
            <div className="w-[220px] h-[220px] flex items-center justify-center bg-slate-100 rounded-xl border border-slate-200">
              <p className="text-xs text-slate-400 text-center px-4">
                Member ID not assigned yet
              </p>
            </div>
          )}

          <div className="mt-6 text-center space-y-1">
            <p className="text-base font-semibold text-slate-900">{memberName}</p>
            {memberId && (
              <p className="text-sm font-mono text-blue-600 font-medium">{memberId}</p>
            )}
            {groupName ? (
              <p className="text-sm text-slate-500">{groupName}</p>
            ) : (
              <p className="text-sm text-slate-400 italic">No group assigned</p>
            )}
          </div>
        </div>

        {/* Instruction */}
        <p className="mt-6 text-sm text-slate-500 text-center max-w-xs">
          Show this code to an agent when making a deposit.
        </p>
      </div>
    </main>
  );
}
