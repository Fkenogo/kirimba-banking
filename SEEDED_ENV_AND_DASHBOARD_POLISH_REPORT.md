# SEEDED_ENV_AND_DASHBOARD_POLISH_REPORT

## Files Changed
- `scripts/seed-kirimba-test-env.js` (new)
- `package.json`
- `apps/member/src/features/Home/MemberHomeScreen.jsx`
- `apps/agent/src/pages/HomePage.jsx`
- `apps/umuco/src/pages/HomePage.jsx`

## Seed Script Path
- `scripts/seed-kirimba-test-env.js`

## Seed Process (Reproducible + Safe)

### Safety model
- Emulator-safe by default.
- Script **refuses to run** on non-emulator unless `--allow-production` is explicitly passed.
- Even with `--allow-production`, it requires `KIRIMBA_TEST_MODE=true`.

### Commands
1. Start emulators:
```bash
npm run emulators:core
```

2. Seed test environment (in a second terminal):
```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:test-env
```

3. Reset/cleanup seeded environment:
```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 npm run seed:test-env:reset
```

### Reset behavior
- Deletes seeded auth users and seeded docs by deterministic `seed_*` IDs.
- Then reseeds from scratch (unless `--reset` mode).

## Sample Personas Created
All seeded users use **PIN: `123456`**.

| Persona | UID | Login Phone |
|---|---|---|
| super_admin | `seed_super_admin` | `+250700000001` (internal auth email for login is seeded) |
| admin | `seed_admin` | `+250700000002` |
| institution user | `seed_institution_user` | `+250700000003` |
| agent | `seed_agent` | `+25766100001` |
| approved leader (active group) | `seed_leader_active` | `+25766100002` |
| approved member A (in group) | `seed_member_active_a` | `+25766100003` |
| approved member B (in group) | `seed_member_active_b` | `+25766100004` |
| pending member | `seed_member_pending` | `+25766100005` |
| approved member, no group | `seed_member_no_group` | `+25766100006` |
| pending join request member | `seed_member_pending_join` | `+25766100007` |
| pending group leader member | `seed_member_pending_group_leader` | `+25766100008` |

## Seeded Lifecycle/Data States

### Group state
- Active group: `seed_group_active`
  - leader + two active members linked via `groupMembers`
- Pending group: `seed_group_pending`
- Pending join request under active group for `seed_member_pending_join`

### Financial state
- Wallets seeded for active member/leader users
- Pending deposit transaction: `seed_txn_deposit_pending`
- Confirmed deposit transaction: `seed_txn_deposit_confirmed`
- Submitted deposit batch: `seed_batch_submitted`
- Confirmed deposit batch: `seed_batch_confirmed`
- Loans:
  - pending: `seed_loan_pending`
  - active: `seed_loan_active`
  - overdue/default-eligible: `seed_loan_overdue`
- kirimba fund baseline set at `kirimbaFund/current`

## Dashboard Polish Changes by App

### Member app (mobile-first retained)
- Added top summary cards to clearly surface:
  - institution selected / not selected
  - group connected / not in group
- Existing behavior retained:
  - `My Group` entry appears only when user has group linkage
  - leader actions remain separated and visible only for leader role

### Agent app (mobile-first redesign)
- Reworked agent home into stacked touch-friendly action cards.
- Primary field actions now obvious and phone-usable:
  - Scan Deposit
  - Today’s Deposits
  - Business Dashboard
  - Close Day
- Sign-out remains prominent with large tap target.

### Admin app (desktop-first)
- Existing grouped dashboard sections retained and already aligned:
  - deposits
  - loan operations
  - approvals
  - agent management
  - user provisioning
- No additional structural rewrite made in this pass.

### Institution app (desktop-first)
- Polished home into clearer **Batch Operations** section.
- Emphasized two operational entry points:
  - Pending Batches
  - Batch History

## Manual Test Readiness Checklist

1. Member approval
- Sign in as admin, open approvals, approve `seed_member_pending`.
- Expected: member status becomes active.

2. Institution selection
- Sign in as `seed_member_no_group` in member app.
- Set institution = `umuco`.
- Expected: save succeeds and reflects in profile.

3. Group creation/approval
- Verify pending group `seed_group_pending` appears in admin approvals.
- Approve group.
- Expected: creator becomes leader-linked for that group.

4. Join request approval
- Sign in as leader (`seed_leader_active`).
- Open pending join requests.
- Approve request from `seed_member_pending_join`.
- Expected: member is added to `groupMembers` and user `groupId`.

5. Member dashboard with My Group
- Sign in as `seed_member_active_a` (or approved join member after step 4).
- Expected: "My Group" appears and opens summary.

6. Leader group code + pending join requests
- Sign in as leader.
- Verify group code screen and pending requests module both load.

7. Agent deposit capture
- Sign in as `seed_agent`.
- Use Scan Deposit to record a new deposit for seeded member ID.
- Expected: entry appears in Today’s Deposits and sync path works.

8. Institution batch confirmation
- Sign in as institution user.
- Open pending batches, confirm submitted batch.
- Expected: batch moves from pending to history.

9. Admin loan operations lifecycle
- Sign in as admin.
- Open Loan Operations Console.
- Validate:
  - pending loan visible (`seed_loan_pending`)
  - active and overdue buckets populated
  - approve/disburse/repayment/default actions execute in sequence

## Build/Sanity Checks Run
- `node -c scripts/seed-kirimba-test-env.js`
- `cd apps/member && npm run build`
- `cd apps/agent && npm run build`
- `cd apps/umuco && npm run build`
