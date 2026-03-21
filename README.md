# KIRIMBA

KIRIMBA is a digital group savings and lending platform for informal groups and market vendors in Burundi. Members pool their savings, which are held safely at a licensed microfinance institution (Umuco), while KIRIMBA provides loans from its own fund backed by that collateral.

## Tech Stack

- Firebase Firestore
- Firebase Authentication
- Firebase Cloud Functions (Node.js 20)
- Firebase Hosting (multi-site)
- React + Vite + TailwindCSS

## Project Structure

```text
/functions           Cloud Functions backend (business logic entrypoint)
/apps/member         Member app (served at /app)
/apps/agent          Agent app (served at /agent)
/apps/admin          Admin app (served at /admin)
/apps/umuco          Umuco dashboard app (served at /umuco)
/firebase.json       Firebase services + hosting + emulator config
.firebaserc          Firebase project alias + hosting targets
```

## Setup

```bash
nvm use
npm install
npm run emulators:core
firebase deploy
```

## Local App Routes

Use `npm run dev:all` for live development or `npm run build:all && npm run preview:all` for production bundle preview.

- Member app: `http://127.0.0.1:5173/app/login` in dev, `http://127.0.0.1:4173/app/login` in preview
- Agent app: `http://127.0.0.1:5174/agent/login` in dev, `http://127.0.0.1:4174/agent/login` in preview
- Admin app: `http://127.0.0.1:5175/admin/login` in dev, `http://127.0.0.1:4175/admin/login` in preview
- Umuco app: `http://127.0.0.1:5176/umuco/login` in dev, `http://127.0.0.1:4176/umuco/login` in preview

## Firebase Hosting Targets

- `firebase.json` expects hosting targets for `app`, `agent`, `admin`, and `umuco`.
- `.firebaserc` currently defines only `app` and `admin`.
- Add the real Firebase Hosting site IDs for `agent` and `umuco` before using Firebase Hosting preview channels or multi-site deploys.

## Notes

- Cloud Functions currently include member onboarding, group management, savings/deposit-batch flows, loan lifecycle callables, and health checks.
- Frontend apps are scaffolded with Firebase auth wiring for member, agent, admin, and umuco portals.

## Local Auth Troubleshooting

- Run each app from its workspace, for example `npm run dev:member` or `npm --workspace apps/member run dev`.
- Each app needs Firebase env vars in `apps/<app>/.env.local` (`member`, `agent`, `admin`, `umuco`).
- If `VITE_USE_FIREBASE_EMULATORS=true`, you must run `npm run emulators:core`; otherwise Auth requests to `127.0.0.1:9099` will fail with `auth/network-request-failed`.
- If you do not want local emulators, set `VITE_USE_FIREBASE_EMULATORS=false` in each app `.env.local`.
