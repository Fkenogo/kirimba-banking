import { getApp, getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth } from "firebase/auth";

const requiredEnvVars = [
  "VITE_FIREBASE_API_KEY",
  "VITE_FIREBASE_AUTH_DOMAIN",
  "VITE_FIREBASE_PROJECT_ID",
  "VITE_FIREBASE_STORAGE_BUCKET",
  "VITE_FIREBASE_MESSAGING_SENDER_ID",
  "VITE_FIREBASE_APP_ID",
];

if (import.meta.env.DEV) {
  const envPresence = requiredEnvVars.reduce((acc, key) => {
    acc[key] = Boolean(import.meta.env[key]);
    return acc;
  }, {});

  console.info("[KIRIMBA app] Firebase env presence", envPresence);
}

for (const key of requiredEnvVars) {
  if (!import.meta.env[key]) {
    throw new Error(`Missing Firebase config: ${key}`);
  }
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const auth = getAuth(app);

const emulatorHost = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
const isLocalBrowser =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" && isLocalBrowser;

if (useEmulators && !auth.emulatorConfig) {
  connectAuthEmulator(auth, `http://${emulatorHost}`, { disableWarnings: true });
}

if (import.meta.env.DEV && import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" && !isLocalBrowser) {
  console.warn(
    "[KIRIMBA app] VITE_USE_FIREBASE_EMULATORS=true ignored because host is not localhost/127.0.0.1"
  );
}

const authRuntime = {
  useEmulators,
  emulatorHost,
};

export { app, auth, authRuntime };
