# KIRIMBA

KIRIMBA is a digital group savings and lending platform for informal groups and market vendors in Burundi. Members pool their savings, which are held safely at a licensed microfinance institution (Umuco), while KIRIMBA provides loans from its own fund backed by that collateral.

## Tech Stack

- Firebase Firestore
- Firebase Authentication
- Firebase Cloud Functions (Node.js 18)
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
npm install
firebase emulators:start
firebase deploy
```

## Notes

- This repository currently contains infrastructure scaffolding only.
- No production business logic has been implemented yet.
