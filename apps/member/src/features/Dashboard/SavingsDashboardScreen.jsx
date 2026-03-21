import { useEffect, useState } from "react";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  Timestamp,
  where,
} from "firebase/firestore";
import { db } from "../../services/firebase";

function fmt(n) {
  return Number(n || 0).toLocaleString("en-US");
}

function formatBIF(n) {
  return `${fmt(n)} BIF`;
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return Timestamp.fromDate(d);
}

const MEDALS = ["🥇", "🥈", "🥉"];
const TOP_N = 5;

export default function SavingsDashboardScreen({ user }) {
  const [group, setGroup] = useState(null);
  const [topSavers, setTopSavers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!user?.uid) return;

    async function load() {
      try {
        let groupId = null;
        const gmSnap = await getDoc(doc(db, "groupMembers", user.uid));
        if (gmSnap.exists()) {
          groupId = gmSnap.data()?.groupId || null;
        } else {
          const userSnap = await getDoc(doc(db, "users", user.uid));
          if (userSnap.exists()) {
            const userData = userSnap.data() || {};
            groupId = userData.groupId || userData.ledGroupId || null;
          }
        }

        if (!groupId) { setLoading(false); return; }

        // Load group + this-month transactions in parallel
        const [groupSnap, txSnap] = await Promise.all([
          getDoc(doc(db, "groups", groupId)),
          getDocs(
            query(
              collection(db, "transactions"),
              where("groupId", "==", groupId),
              where("createdAt", ">=", startOfMonth()),
              orderBy("createdAt", "desc")
            )
          ),
        ]);

        if (groupSnap.exists()) {
          setGroup({ id: groupSnap.id, ...groupSnap.data() });
        }

        // Aggregate deposits client-side (avoids needing a new composite index)
        const totals = new Map(); // userId → amount
        for (const d of txSnap.docs) {
          const tx = d.data();
          if (tx.type !== "deposit" || tx.status !== "confirmed") continue;
          const uid = tx.userId;
          totals.set(uid, (totals.get(uid) ?? 0) + Number(tx.amount || 0));
        }

        // Sort descending, take top N
        const ranked = [...totals.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, TOP_N);

        if (ranked.length === 0) { setLoading(false); return; }

        // Resolve names for the top savers
        const userSnaps = await Promise.all(
          ranked.map(([uid]) => getDoc(doc(db, "users", uid)))
        );

        setTopSavers(
          ranked.map(([uid, amount], i) => {
            const data = userSnaps[i].exists() ? userSnaps[i].data() : {};
            return {
              uid,
              name: data.name ?? data.fullName ?? uid,
              amount,
            };
          })
        );
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
        <p className="text-sm text-slate-500 animate-pulse">Loading...</p>
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

  if (!group) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="text-center">
          <p className="text-sm font-medium text-slate-600">No group found</p>
          <p className="text-xs text-slate-400 mt-1">You are not part of a group yet.</p>
        </div>
      </main>
    );
  }

  const totalSavings = Number(group.totalSavings || 0);
  const savingsGoal = group.savingsGoal != null ? Number(group.savingsGoal) : null;
  const hasGoal = savingsGoal !== null && savingsGoal > 0;

  // Clamp to [0, 100] — never overflow the bar
  const rawProgress = hasGoal ? (totalSavings / savingsGoal) * 100 : 0;
  const progress = Math.min(100, Math.max(0, rawProgress));
  const goalReached = rawProgress >= 100;

  // Borrowing power (70% rule)
  const activeLoansTotal = Number(group.totalLoansOutstanding || 0);
  const maxBorrowing = totalSavings * 0.7;
  const availableBorrowing = maxBorrowing - activeLoansTotal;
  const limitReached = availableBorrowing <= 0;
  // Meter shows share of capacity already consumed
  const usedRatio = maxBorrowing > 0 ? Math.min(1, activeLoansTotal / maxBorrowing) : 1;

  return (
    <main className="min-h-screen bg-slate-50 pb-12">
      <div className="max-w-lg mx-auto px-4 pt-6 space-y-4">

        {/* Header */}
        <div>
          <h1 className="text-xl font-bold text-slate-900">Group Savings</h1>
          <p className="text-sm text-slate-500 mt-0.5">{group.name}</p>
        </div>

        {/* Total savings hero card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5">
          <p className="text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">
            Total Group Savings
          </p>
          <p className="text-4xl font-bold text-slate-900 leading-none">
            {fmt(totalSavings)}
          </p>
          <p className="text-sm text-slate-400 mt-1">BIF</p>
        </div>

        {/* Savings goal section — only shown when savingsGoal exists */}
        {hasGoal && (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5 space-y-4">

            {/* Title row */}
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-700">Group Savings Goal</h2>
              {goalReached && (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
                  ✓ Goal Reached
                </span>
              )}
            </div>

            {/* Progress bar */}
            <div>
              <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${
                    goalReached ? "bg-green-500" : "bg-green-400"
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-right text-xs text-slate-400 mt-1.5">
                {Math.round(rawProgress)}%
              </p>
            </div>

            {/* Stats rows */}
            <div className="space-y-2.5 pt-1 border-t border-slate-100">
              <StatRow label="Current Savings" value={formatBIF(totalSavings)} />
              <StatRow label="Goal" value={formatBIF(savingsGoal)} />
              <StatRow
                label="Progress"
                value={`${Math.round(rawProgress)}%`}
                valueClass={goalReached ? "text-green-700 font-bold" : "text-slate-900 font-bold"}
              />
              {!goalReached && (
                <StatRow
                  label="Remaining"
                  value={formatBIF(savingsGoal - totalSavings)}
                  valueClass="text-slate-500"
                />
              )}
            </div>
          </div>
        )}

        {/* Borrowing power meter */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5 space-y-4">

          {/* Title row */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Group Borrowing Power</h2>
            {limitReached && (
              <span className="text-xs font-semibold text-red-600 bg-red-50 border border-red-100 px-2.5 py-1 rounded-full">
                Limit reached
              </span>
            )}
          </div>

          {/* Meter bar — shows consumed share of max borrowing */}
          <div>
            <div className="h-4 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  limitReached ? "bg-red-400" : "bg-blue-500"
                }`}
                style={{ width: `${usedRatio * 100}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-slate-400 mt-1.5">
              <span>0 BIF</span>
              <span>{fmt(maxBorrowing)} BIF max</span>
            </div>
          </div>

          {/* Stats rows */}
          <div className="space-y-2.5 pt-1 border-t border-slate-100">
            <StatRow label="Savings" value={formatBIF(totalSavings)} />
            <StatRow label="Loans Used" value={formatBIF(activeLoansTotal)} />
            {limitReached ? (
              <div className="flex justify-between items-center">
                <span className="text-sm text-slate-500">Available Credit</span>
                <span className="text-sm font-semibold text-red-600">
                  Group lending limit reached
                </span>
              </div>
            ) : (
              <StatRow
                label="Available Credit"
                value={formatBIF(availableBorrowing)}
                valueClass="text-blue-700 font-semibold"
              />
            )}
          </div>
        </div>

        {/* Top savers leaderboard */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm px-5 py-5 space-y-3">
          <h2 className="text-sm font-semibold text-slate-700">Top Savers This Month</h2>

          {topSavers.length === 0 ? (
            <p className="text-sm text-slate-400 py-2 text-center">
              No confirmed deposits this month yet.
            </p>
          ) : (
            <ul className="space-y-2">
              {topSavers.map((saver, i) => {
                const isMe = saver.uid === user?.uid;
                return (
                  <li
                    key={saver.uid}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${
                      isMe
                        ? "bg-blue-50 border border-blue-100"
                        : "bg-slate-50 border border-slate-100"
                    }`}
                  >
                    {/* Rank / medal */}
                    <span className="text-base w-6 text-center shrink-0">
                      {i < 3 ? MEDALS[i] : <span className="text-xs font-bold text-slate-400">{i + 1}</span>}
                    </span>

                    {/* Name */}
                    <span
                      className={`flex-1 text-sm font-medium truncate ${
                        isMe ? "text-blue-800" : "text-slate-800"
                      }`}
                    >
                      {saver.name}
                      {isMe && (
                        <span className="ml-1.5 text-xs font-normal text-blue-500">(you)</span>
                      )}
                    </span>

                    {/* Amount */}
                    <span
                      className={`text-sm font-semibold shrink-0 ${
                        isMe ? "text-blue-700" : "text-slate-700"
                      }`}
                    >
                      {fmt(saver.amount)}{" "}
                      <span className="text-xs font-normal text-slate-400">BIF</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

      </div>
    </main>
  );
}

function StatRow({ label, value, valueClass = "text-slate-900 font-semibold" }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-slate-500">{label}</span>
      <span className={`text-sm ${valueClass}`}>{value}</span>
    </div>
  );
}
