import {
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { httpsCallable } from "firebase/functions";
import { auth, authRuntime, functions } from "./firebase";
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

function getCallableMessage(error, fallback) {
  const fromDetails = typeof error?.details === "string"
    ? error.details
    : error?.details?.message;
  const fromMessage = typeof error?.message === "string" ? error.message : "";
  const message = (fromDetails || fromMessage || "").trim();
  if (!message || message.toLowerCase() === "internal") {
    return fallback;
  }
  return message;
}

export async function registerMemberAccount({ fullName, phone, pin, email }) {
  const normalizedPhone = normalizePhoneE164(phone);
  if (!isValidSupportedPhone(normalizedPhone)) {
    throw new Error(PHONE_VALIDATION_MESSAGE);
  }

  const registerMember = httpsCallable(functions, "registerMember");
  try {
    await registerMember({
      fullName: String(fullName || "").trim(),
      phone: normalizedPhone,
      pin: String(pin || ""),
      email: email ? String(email).trim().toLowerCase() : null,
    });
  } catch (error) {
    throw new Error(getCallableMessage(error, "Failed to register member account."));
  }
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
