/**
 * LeaderDashboardScreen
 *
 * A dedicated hub for group leaders. Shows:
 *  - Group stats hero (members, savings, loans)
 *  - Live pending join requests counter with CTA
 *  - Quick action grid (approve, code, manage, split)
 *  - Group savings goal progress (if configured)
 *  - Recent member activity feed
 */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { db } from "../../services/firebase";
import { loadCurrentGroup } from "../Groups/leaderGroupAccess";
import {
  PageShell, Card, SectionLabel, StatusBadge, EmptyState, LoadingScreen, formatBIF, formatDate,
} from "../../components/ui";

export default function LeaderDashboardScreen({ user }) {
  const navigate = useNavigate();

  const [group,          setGroup]          = useState(null);
  const [pendingCount,   setPendingCount]   = useState(0);
  const [recentActivity, setRecentActivity] = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [error,          setError]          = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        /* 1. Load the group this leader manages */
        const { groupId, group: currentGroup } = await loadCurrentGroup(db, user.uid);

        if (!groupId || !currentGroup) {
          setError("You are not in a group yet.");
          return;
        }
        if (currentGroup.leaderId !== user.uid) {
          setError("This page is only accessible to group leaders.");
          return;
        }

        setGroup({ id: groupId, ...currentGroup });

        /* 2. Count pending join requests */
        const pendingSnap = await getDocs(
          query(
            collection(db, "groups", groupId, "joinRequests"),
            where("status", "==", "pending")
          )
        );
        setPendingCount(pendingSnap.size);

        /* 3. Recent group transactions (last 10 confirmed) */
        const txSnap = await getDocs(
          query(
            collection(db, "transactions"),
            where("groupId", "==", groupId),
            orderBy("createdAt", "desc"),
            limit(10)
          )
        );

        /* Fetch member names in parallel */
        const txDocs = txSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
        const uidSet = [...new Set(txDocs.map((t) => t.userId).filter(Boolean))];
        const userSnaps = await Promise.all(uidSet.map((uid) => getDoc(doc(db, "users", uid))));
        const nameMap = {};
        userSnaps.forEach((snap) => {
          if (snap.exists()) nameMap[snap.id] = snap.data().fullName || snap.id;
        });

        setRecentActivity(txDocs.map((t) => ({ ...t, memberName: nameMap[t.userId] || "Member" })));
      } catch (err) {
        setError(err?.message || "Failed to load leader dashboard.");
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [user?.uid]);

  if (loading) return <LoadingScreen />;

  /* ─── Error / not a leader ─── */
  if (error) {
    return (
      <PageShell title="Leader Dashboard" showBack>
        <Card>
          <div className="px-5 py-8 text-center space-y-3">
            <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto">
              <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
            </div>
            <p className="text-sm font-bold text-slate-700">Access Restricted</p>
            <p className="text-xs text-slate-400">{error}</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  /* ─── Computed values ─── */
  const totalSavings   = Number(group.totalSavings  || 0);
  const pendingSavings = Number(group.pendingSavings || 0);
  const memberCount    = Number(group.memberCount    || 0);
  const savingsGoal    = group.savingsGoal != null ? Number(group.savingsGoal) : null;
  const hasGoal        = savingsGoal !== null && savingsGoal > 0;
  const progress       = hasGoal ? Math.min(100, (totalSavings / savingsGoal) * 100) : 0;

  return (
    <PageShell title="Leader Dashboard" showBack>

      {/* ── Hero stats banner ── */}
      <div className="bg-brand-500 rounded-2xl px-5 py-5 text-white shadow-card-lg relative overflow-hidden">
        <div className="absolute -top-6 -right-6 w-28 h-28 bg-brand-400 rounded-full opacity-25" />
        <div className="absolute -bottom-4 -left-2 w-16 h-16 bg-brand-600 rounded-full opacity-30" />
        <div className="relative">
          {/* Gold leader badge */}
          <div className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 bg-gold-400 rounded-lg flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <div>
              <p className="text-[10px] text-brand-200 uppercase tracking-wide">Leader</p>
              <p className="text-sm font-extrabold leading-tight">{group.name}</p>
            </div>
          </div>

          {/* 3 stats */}
          <div className="grid grid-cols-3 gap-2 pt-2 border-t border-brand-400">
            <div>
              <p className="text-[10px] text-brand-200 uppercase tracking-wide">Members</p>
              <p className="text-2xl font-extrabold">{memberCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-brand-200 uppercase tracking-wide">Savings</p>
              <p className="text-lg font-extrabold text-gold-300 leading-tight">{formatBIF(totalSavings)}</p>
            </div>
            <div>
              <p className="text-[10px] text-brand-200 uppercase tracking-wide">Pending</p>
              <p className="text-2xl font-extrabold">{pendingSavings > 0 ? `+${formatBIF(pendingSavings)}` : "—"}</p>
            </div>
          </div>
        </div>
      </div>

      {/* ── Pending join requests alert ── */}
      {pendingCount > 0 && (
        <button
          onClick={() => navigate("/app/group/pending-requests")}
          className="w-full flex items-center gap-3 bg-gold-50 border-2 border-gold-200 rounded-2xl px-4 py-4 text-left hover:bg-gold-100 active:scale-95 transition-all"
        >
          <div className="w-10 h-10 bg-gold-400 rounded-xl flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="text-sm font-extrabold text-gold-800">
              {pendingCount} pending join {pendingCount === 1 ? "request" : "requests"}
            </p>
            <p className="text-xs text-gold-600">Tap to review and approve members</p>
          </div>
          <svg className="w-4 h-4 text-gold-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
        </button>
      )}

      {/* ── Savings goal progress ── */}
      {hasGoal && (
        <>
          <SectionLabel>Savings Goal</SectionLabel>
          <Card>
            <div className="px-5 py-4 space-y-3">
              <div className="flex justify-between items-center">
                <p className="text-sm font-bold text-slate-700">Group Target</p>
                <p className="text-xs text-slate-400">{Math.round(progress)}%</p>
              </div>
              <div className="h-3 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-400 rounded-full transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex justify-between text-xs text-slate-500">
                <span>{formatBIF(totalSavings)} saved</span>
                <span>Goal: {formatBIF(savingsGoal)}</span>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* ── Quick leader actions ── */}
      <SectionLabel>Leader Tools</SectionLabel>
      <div className="grid grid-cols-2 gap-3">
        {[
          {
            label: "Join Requests",
            sub:   pendingCount > 0 ? `${pendingCount} waiting` : "No pending",
            path:  "/app/group/pending-requests",
            badge: pendingCount > 0 ? pendingCount : null,
            bg:    "bg-gold-50",
            icon:  "bg-gold-400",
            svgIcon: "M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4",
          },
          {
            label: "Share Code",
            sub:   "Invite new members",
            path:  "/app/group/code",
            badge: null,
            bg:    "bg-brand-50",
            icon:  "bg-brand-500",
            svgIcon: "M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z",
          },
          {
            label: "Manage Group",
            sub:   "Settings & overview",
            path:  "/app/group/manage",
            badge: null,
            bg:    "bg-slate-50",
            icon:  "bg-slate-600",
            svgIcon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
          },
          {
            label: "Split Group",
            sub:   memberCount > 12 ? "Recommended" : `${memberCount} members`,
            path:  "/app/group/split",
            badge: null,
            bg:    "bg-slate-50",
            icon:  "bg-slate-500",
            svgIcon: "M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4",
          },
        ].map(({ label, sub, path, badge, bg, icon, svgIcon }) => (
          <button
            key={label}
            onClick={() => navigate(path)}
            className={`${bg} border border-brand-100 rounded-2xl px-4 py-4 flex flex-col gap-2 text-left hover:brightness-95 active:scale-95 transition-all shadow-card relative`}
          >
            {badge && (
              <span className="absolute top-2.5 right-2.5 bg-gold-500 text-white text-[10px] font-extrabold w-5 h-5 rounded-full flex items-center justify-center">
                {badge > 9 ? "9+" : badge}
              </span>
            )}
            <div className={`w-9 h-9 ${icon} rounded-xl flex items-center justify-center`}>
              <svg className="w-4.5 h-4.5 w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d={svgIcon} />
              </svg>
            </div>
            <div>
              <p className="text-sm font-extrabold text-slate-800">{label}</p>
              <p className="text-[11px] text-slate-400">{sub}</p>
            </div>
          </button>
        ))}
      </div>

      {/* ── Group savings dashboard shortcut ── */}
      <button
        onClick={() => navigate("/app/savings")}
        className="w-full bg-white border-2 border-dashed border-brand-300 rounded-2xl py-4 flex items-center justify-center gap-2 hover:bg-brand-50 transition-colors active:scale-95"
      >
        <svg className="w-5 h-5 text-brand-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        <span className="text-sm font-bold text-brand-600">Group Savings Dashboard</span>
      </button>

      {/* ── Recent group activity ── */}
      <SectionLabel>Recent Group Activity</SectionLabel>
      {recentActivity.length === 0 ? (
        <Card>
          <EmptyState title="No activity yet" subtitle="Deposits and loans will appear here." />
        </Card>
      ) : (
        <Card>
          <div className="divide-y divide-slate-50">
            {recentActivity.map((tx) => {
              const isDeposit  = tx.type === "deposit";
              const isLoan     = tx.type === "loan_disburse" || tx.type === "loan_repay";
              const dotColor   = isDeposit ? "bg-brand-400" : isLoan ? "bg-gold-400" : "bg-slate-300";
              const amountSign = (isDeposit || tx.type === "loan_repay") ? "+" : "−";
              const amountClr  = (isDeposit || tx.type === "loan_repay") ? "text-brand-600" : "text-gold-600";

              return (
                <div key={tx.id} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 truncate">{tx.memberName}</p>
                    <p className="text-[11px] text-slate-400 capitalize">
                      {String(tx.type || "").replace(/_/g, " ")}
                      {tx.createdAt ? ` · ${formatDate(tx.createdAt)}` : ""}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-extrabold ${amountClr}`}>
                      {amountSign} {formatBIF(tx.amount)}
                    </p>
                    <StatusBadge status={tx.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

    </PageShell>
  );
}
