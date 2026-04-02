import { useEffect, useMemo, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { Alert, Card, EmptyState, PrimaryButton } from "../components/ui";
import { db } from "../services/firebase";
import { normalizePhoneE164 } from "./phoneAuth";

const SCANNER_ID = "kirimba-qr-scanner";

const LOOKUP_MODE = {
  MEMBER_ID: "member_id",
  PHONE: "phone",
  NAME: "name",
};

const SEARCH_MODE_OPTIONS = [
  { value: LOOKUP_MODE.MEMBER_ID, label: "Member ID" },
  { value: LOOKUP_MODE.PHONE, label: "Phone" },
  { value: LOOKUP_MODE.NAME, label: "Full Name" },
];

// ── QR scanner component ─────────────────────────────────────────────────────
// One-shot: fires onScan once, ignores further frames until the parent unmounts.
export function QrScanner({ onScan }) {
  const activeRef = useRef(false);

  useEffect(() => {
    const scanner = new Html5Qrcode(SCANNER_ID);
    activeRef.current = false;

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (text) => {
          if (!activeRef.current) {
            activeRef.current = true;
            onScan(text);
          }
        },
        () => {}
      )
      .catch(() => {});

    return () => {
      scanner.isScanning ? scanner.stop().catch(() => {}) : Promise.resolve();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <div id={SCANNER_ID} className="w-full aspect-square rounded-2xl overflow-hidden bg-black" />;
}

function normalizeMemberDoc(snapshot) {
  const data = snapshot.data() || {};
  return {
    userId: snapshot.id,
    memberId: data.memberId || snapshot.id,
    fullName: data.fullName || data.name || "Unknown",
    groupId: data.groupId || data.ledGroupId || null,
    phone: data.phone || null,
    status: data.status || null,
    role: data.role || null,
  };
}

async function enrichMemberEligibility(member) {
  if (!member) return null;

  let restriction = "";
  let groupName = null;
  let groupStatus = null;

  if (member.role !== "member" && member.role !== "leader") {
    restriction = "Only member accounts can be assisted from this lookup.";
  } else if (member.status !== "active") {
    restriction = "Member account must be active.";
  } else if (!member.groupId) {
    restriction = "User is not linked to a group.";
  } else {
    const groupSnap = await getDoc(doc(db, "groups", member.groupId));
    if (!groupSnap.exists()) {
      restriction = "Member group was not found.";
    } else {
      const groupData = groupSnap.data() || {};
      groupName = groupData.name || groupData.groupCode || member.groupId;
      groupStatus = groupData.status || null;
      if (groupStatus !== "active") {
        restriction = "Group must be active.";
      }
    }
  }

  return {
    ...member,
    groupName,
    groupStatus,
    isSelectable: !restriction,
    restriction,
  };
}

async function fetchMembersByField(field, value) {
  const snap = await getDocs(query(collection(db, "users"), where(field, "==", value)));
  const members = await Promise.all(snap.docs.map((docSnap) => enrichMemberEligibility(normalizeMemberDoc(docSnap))));
  return members.filter(Boolean);
}

export async function fetchMemberByMemberId(memberId) {
  const exactMatches = await fetchMembersByField("memberId", memberId);
  if (exactMatches.length > 0) {
    return exactMatches[0];
  }

  const direct = await getDoc(doc(db, "users", memberId));
  if (direct.exists()) {
    return enrichMemberEligibility(normalizeMemberDoc(direct));
  }

  return null;
}

export async function fetchMembersByPhone(phone) {
  const normalizedPhone = normalizePhoneE164(phone);
  if (!normalizedPhone) return [];
  return fetchMembersByField("phone", normalizedPhone);
}

export async function fetchMembersByExactName(name) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return [];

  const [fullNameMatches, nameMatches] = await Promise.all([
    fetchMembersByField("fullName", normalizedName),
    fetchMembersByField("name", normalizedName),
  ]);

  const byUserId = new Map();
  [...fullNameMatches, ...nameMatches].forEach((member) => {
    if (member?.userId) byUserId.set(member.userId, member);
  });

  return [...byUserId.values()];
}

export async function searchMembers({ mode, queryText }) {
  const trimmed = String(queryText || "").trim();
  if (!trimmed) return [];

  switch (mode) {
    case LOOKUP_MODE.PHONE:
      return fetchMembersByPhone(trimmed);
    case LOOKUP_MODE.NAME:
      return fetchMembersByExactName(trimmed);
    case LOOKUP_MODE.MEMBER_ID:
    default: {
      const member = await fetchMemberByMemberId(trimmed);
      return member ? [member] : [];
    }
  }
}

function LookupModeButton({ option, activeMode, onChange }) {
  const active = option.value === activeMode;
  return (
    <button
      type="button"
      onClick={() => onChange(option.value)}
      className={`flex-1 rounded-2xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${
        active
          ? "border-brand-500 bg-brand-50 text-brand-700"
          : "border-slate-100 bg-slate-50 text-slate-600"
      }`}
    >
      {option.label}
    </button>
  );
}

function LookupResultCard({ member, onSelect }) {
  return (
    <Card>
      <div className="px-5 py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-base font-bold text-slate-900 truncate">{member.fullName}</p>
            <p className="text-xs font-mono text-brand-600 mt-0.5">{member.memberId}</p>
            {member.phone ? <p className="text-xs text-slate-500 mt-1">{member.phone}</p> : null}
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${
              member.isSelectable
                ? "border-brand-100 bg-brand-50 text-brand-700"
                : "border-red-100 bg-red-50 text-red-700"
            }`}
          >
            {member.isSelectable ? "Eligible" : "Blocked"}
          </span>
        </div>

        <div className="rounded-2xl bg-slate-50 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Member status</p>
          <p className="mt-1 text-sm font-semibold text-slate-800">
            {member.status || "unknown"}
            {member.groupName ? ` · ${member.groupName}` : member.groupId ? ` · ${member.groupId}` : ""}
          </p>
          {!member.isSelectable ? (
            <p className="mt-2 text-xs text-red-600">{member.restriction}</p>
          ) : null}
        </div>

        <PrimaryButton type="button" onClick={() => onSelect(member)} disabled={!member.isSelectable}>
          Select Member
        </PrimaryButton>
      </div>
    </Card>
  );
}

export function ManualMemberLookup({ onSelect, onCancel }) {
  const [mode, setMode] = useState(LOOKUP_MODE.MEMBER_ID);
  const [queryText, setQueryText] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const hint = useMemo(() => {
    if (mode === LOOKUP_MODE.PHONE) {
      return "Use the member phone number in international format, for example +25766123456.";
    }
    if (mode === LOOKUP_MODE.NAME) {
      return "Exact full-name lookup only. Prefix search is not supported safely with the current Firestore model.";
    }
    return "Use the member ID printed on the profile or receipt.";
  }, [mode]);

  async function handleSearch(event) {
    event.preventDefault();
    const trimmed = String(queryText || "").trim();
    if (!trimmed) {
      setError("Enter a search value to continue.");
      setHasSearched(false);
      setResults([]);
      return;
    }

    setLoading(true);
    setError("");
    setHasSearched(true);
    try {
      const nextResults = await searchMembers({ mode, queryText: trimmed });
      setResults(nextResults);
    } catch (lookupError) {
      setResults([]);
      setError(lookupError.message || "Member lookup failed. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  function handleModeChange(nextMode) {
    setMode(nextMode);
    setQueryText("");
    setResults([]);
    setError("");
    setHasSearched(false);
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">Manual member lookup</p>
              <p className="mt-1 text-sm text-slate-500">Find the member manually when the QR code cannot be scanned.</p>
            </div>
            <button type="button" onClick={onCancel} className="text-xs font-bold text-slate-400 hover:text-slate-600">
              Back to scan
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {SEARCH_MODE_OPTIONS.map((option) => (
              <LookupModeButton key={option.value} option={option} activeMode={mode} onChange={handleModeChange} />
            ))}
          </div>

          <form onSubmit={handleSearch} className="space-y-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wide text-slate-600">
                {mode === LOOKUP_MODE.NAME ? "Exact full name" : SEARCH_MODE_OPTIONS.find((option) => option.value === mode)?.label}
              </label>
              <input
                type="text"
                value={queryText}
                onChange={(event) => setQueryText(event.target.value)}
                placeholder={
                  mode === LOOKUP_MODE.PHONE
                    ? "+25766123456"
                    : mode === LOOKUP_MODE.NAME
                    ? "Enter the full member name"
                    : "Enter member ID"
                }
                className="w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-800 placeholder-slate-300 focus:outline-none focus:border-brand-400 focus:bg-white transition-colors"
              />
              <p className="text-[11px] text-slate-400">{hint}</p>
            </div>

            <PrimaryButton type="submit" loading={loading}>
              {loading ? "Searching…" : "Find Member"}
            </PrimaryButton>
          </form>
        </div>
      </Card>

      {error ? <Alert type="error">{error}</Alert> : null}

      {!hasSearched ? (
        <Card>
          <EmptyState
            title="Search by a real member field"
            subtitle="Use member ID, phone, or exact full name. Prefix name search is intentionally not enabled without a safe Firestore path."
          />
        </Card>
      ) : null}

      {hasSearched && !loading && !error && results.length === 0 ? (
        <Card>
          <EmptyState
            title="No members found"
            subtitle="Check the lookup value and try again. Only real searchable member fields are supported."
          />
        </Card>
      ) : null}

      {results.length > 0 ? (
        <div className="space-y-3">
          {results.map((member) => (
            <LookupResultCard key={member.userId} member={member} onSelect={onSelect} />
          ))}
        </div>
      ) : null}
    </div>
  );
}
