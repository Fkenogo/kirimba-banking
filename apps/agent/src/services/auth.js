import { signInWithEmailAndPassword, signOut } from "firebase/auth";
import { auth, authRuntime } from "./firebase";
import {
  isValidSupportedPhone,
  normalizePhoneE164,
  phoneToAuthEmail,
  PHONE_VALIDATION_MESSAGE,
} from "../utils/phoneAuth";

function normalizeAuthError(error) {
  if (!error || typeof error !== "object") {
    return error;
  }

  if (error.code === "auth/network-request-failed" && authRuntime.useEmulators) {
    const enriched = new Error(
      `Firebase Auth emulator is enabled but unreachable at ${authRuntime.emulatorHost}. ` +
      "Start emulators (firebase emulators:start --only auth,firestore,functions) " +
      "or set VITE_USE_FIREBASE_EMULATORS=false in this app's .env.local."
    );
    enriched.code = error.code;
    enriched.cause = error;
    return enriched;
  }

  return error;
}

export async function signInWithPhonePIN(phone, pin) {
  const normalizedPhone = normalizePhoneE164(phone);
  if (!isValidSupportedPhone(normalizedPhone)) {
    throw new Error(PHONE_VALIDATION_MESSAGE);
  }

  try {
    return await signInWithEmailAndPassword(auth, phoneToAuthEmail(normalizedPhone), pin);
  } catch (error) {
    throw normalizeAuthError(error);
  }
}

export function signOutAccount() {
  return signOut(auth);
}
