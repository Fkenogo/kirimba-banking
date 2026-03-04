# ADMIN-AGENT-FLOW.md

> **Implemented**: 2026-03-04
> **Scope**: Admin app — Super Admin → Agent provisioning vertical slice
> **Backend**: No changes (provisionAgent + assignAgentToGroup already exist)

---

## What Was Implemented

### New Files

| File | Description |
|---|---|
| `apps/admin/src/features/Admin/AdminDashboardScreen.jsx` | Landing screen after login. Two action cards: "Create Agent" and "View Agents". Sign-out button. |
| `apps/admin/src/features/Admin/CreateAgentScreen.jsx` | Form: Full Name, Phone (+257XXXXXXXX), PIN (4 digits). Calls `provisionAgent`. Success screen shows Agent ID. |
| `apps/admin/src/features/Admin/AgentListScreen.jsx` | Table of all agents from `agents` Firestore collection. Columns: Name, Phone, Status, Assigned Groups, Actions. Each row has "Assign Group" button. |
| `apps/admin/src/features/Admin/AssignAgentScreen.jsx` | Two dropdowns: active agents, active groups. Calls `assignAgentToGroup`. Pre-populates agent if navigated from AgentListScreen. Success and "Assign Another" actions. |

### Modified Files

| File | Change |
|---|---|
| `apps/admin/src/services/firebase.js` | Added `db` (Firestore) and `functions` (Cloud Functions) exports with emulator wiring for ports 8080 and 5001. |
| `apps/admin/src/App.jsx` | Added 4 new protected routes. Replaced `HomePage` as post-login destination with `AdminDashboardScreen`. Kept `/admin/home` → redirect to `/admin/dashboard` for backwards compat. |

---

## Route Map

```
/admin/login          → LoginPage        (existing — unchanged)
/admin/dashboard      → AdminDashboardScreen  [NEW — post-login destination]
/admin/agents         → AgentListScreen       [NEW]
/admin/agents/new     → CreateAgentScreen     [NEW]
/admin/agents/assign  → AssignAgentScreen     [NEW]
/admin/home           → redirects to /admin/dashboard
```

---

## User Flow

```
Login
  └─ /admin/dashboard
        ├─ "Create Agent" → /admin/agents/new
        │     └─ Submit form → provisionAgent() → success screen → /admin/agents
        └─ "View Agents"  → /admin/agents
              └─ "Assign Group" (per row) → /admin/agents/assign (agent pre-selected)
                    └─ Select group → assignAgentToGroup() → success screen
```

---

## Backend Functions Called

| Screen | Function | Payload |
|---|---|---|
| CreateAgentScreen | `provisionAgent` | `{ fullName, phone, pin }` |
| AssignAgentScreen | `assignAgentToGroup` | `{ agentId, groupId }` |

---

## Firestore Collections Read (client-side)

| Screen | Collection | Filter |
|---|---|---|
| AgentListScreen | `agents` | all, ordered by `createdAt desc` |
| AssignAgentScreen | `agents` | `status == "active"` |
| AssignAgentScreen | `groups` | `status == "active"` |

---

## Build Result

```
✓ 59 modules transformed.
✓ built in 1.15s
Zero errors.
```

---

## How to Test (Emulator)

```bash
# Terminal 1 — emulators
npm run emulators:core

# Terminal 2 — admin app
npm run dev:admin
# http://localhost:5175/admin
```

1. Log in as a super_admin user (must have `role: "super_admin"` custom claim)
2. Verify redirect to `/admin/dashboard`
3. Click "Create Agent" → fill in name/phone/PIN → submit
4. Verify agent appears in Firestore emulator `agents` collection
5. Click "View Agents" → verify agent row appears
6. Click "Assign Group" on agent row → select an active group → assign
7. Verify `agents/{uid}.assignedGroups` array updated in Firestore

---

## Constraints Respected

- No backend functions modified
- No new npm dependencies
- All files use `.jsx` (matches existing project — no TypeScript)
- No path aliases — all imports use relative paths
- Styling consistent with existing Tailwind slate palette
