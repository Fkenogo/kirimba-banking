import { useEffect, useRef } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db } from "../services/firebase";

const SCANNER_ID = "kirimba-qr-scanner";

// ── QR scanner component ─────────────────────────────────────────────────────
// Mirrors the implementation in ScanDepositScreen. One-shot: fires onScan once,
// ignores further frames until the parent unmounts and remounts the scanner.
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

// ── Member lookup ─────────────────────────────────────────────────────────────
// Primary path: query users collection by memberId field (production QR codes).
// Fallback path: treat input as Firebase UID and fetch the document directly
//   (covers seed data and QR codes that embed user.uid as the memberId).
export async function fetchMemberByMemberId(memberId) {
  const snap = await getDocs(
    query(collection(db, "users"), where("memberId", "==", memberId))
  );
  if (!snap.empty) {
    const d = snap.docs[0].data();
    return {
      userId: snap.docs[0].id,
      memberId: d.memberId,
      fullName: d.name ?? d.fullName ?? "Unknown",
      groupId: d.groupId ?? null,
      phone: d.phone ?? null,
    };
  }

  // Fallback: Firebase UID direct lookup
  const direct = await getDoc(doc(db, "users", memberId));
  if (direct.exists()) {
    const d = direct.data();
    return {
      userId: direct.id,
      memberId: d.memberId ?? direct.id,
      fullName: d.name ?? d.fullName ?? "Unknown",
      groupId: d.groupId ?? null,
      phone: d.phone ?? null,
    };
  }

  return null;
}
