# KIRIMBA Build Alignment

This file is the active implementation checklist distilled from:
- `KIRIMBA_Technical_Spec.md`
- `KIRIMBA_Coding_Agent_Prompts.md`
- `KIRIMBA_Firebase_Setup_Guide.md`

## 1) Core Product Guardrails

- Product: digital group savings + lending platform for Burundi market vendors.
- Deposit flow: Agent records -> Umuco confirms -> only then counts as confirmed savings.
- Lending flow: credit driven by confirmed savings collateral.
- Financial integrity rule: all financial writes happen in Cloud Functions only.
- Member onboarding rule: self-registration defaults to `pending_approval`; activation is admin-led.

## 2) Roles and Access Model

Roles in scope:
- `super_admin`
- `agent`
- `member`
- `leader`
- `umuco`
- `finance`

Critical operational constraints:
- Agent is free-floating (not tied to one group).
- Leader is a member with elevated group visibility.
- Admin/finance handle approvals and fund controls.

## 3) Required Platform Stack

- Firebase: Firestore, Auth, Functions, Hosting.
- Frontend: React + Vite + Tailwind.
- Multi-app hosting paths:
  - Member: `/app`
  - Agent: `/agent`
  - Admin: `/admin`
  - Umuco: `/umuco`

## 4) Environment and Runtime Standards

- Use `nvm` in each folder.
- Runtime baseline in this repo: Node `20.x`.
- Do not hardcode Firebase keys or secrets.
- Use `VITE_` env variables for web apps.
- Keep `.env` files uncommitted; commit only `.env.example` templates.

## 5) Data and Security Principles

Primary collections referenced in spec:
- `users`
- `groups`
- `groupMembers`
- `transactions`
- `loans`
- `depositBatches`
- `kirimbaFund`
- `fundMovements`
- `wallets` (current implementation support)

Security posture:
- No client write access to financial/balance fields.
- Backend trigger/function writes through Admin SDK.
- Firestore rules/indexes must remain aligned with active slices.

## 6) Delivery Workflow (must follow)

For each implementation slice:
1. Implement minimal vertical scope.
2. Validate locally (build/emulator/test).
3. Commit with clear message.
4. Push to `main`.
5. Report: changed files, commands run, observed results, how to test.

## 7) Current Slice Status Tracking

Completed:
- Slice 1: backend `onUserCreate` creates `users/{uid}` + `wallets/{uid}` with idempotent wallet creation and `pending_approval` status default.
- Slice 2: member app Firebase auth wiring and minimal login/signup flow.

In progress:
- Slice 3: apply consistent Firebase auth wiring pattern to `agent`, `admin`, and `umuco` apps.

## 8) Change-Risk Notes to Re-check Before Each Push

- If changing `firebase-functions` major behavior, verify trigger/runtime compatibility.
- If changing runtime, verify deploy compatibility with current Firebase project.
- Preserve artifact registry retention policy; do not alter cleanup settings.
- Never commit service account JSON, private keys, or raw secrets.

