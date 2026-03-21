# KIRIMBA Architecture Audit
> **Date**: 2026-03-16
> **Source of truth**: `kirimba_project_reset_summary.md`
> **Scope**: Full codebase audit against target architecture before Firestore reset

---

## 1. Current Architecture Found in Code

### Role System (8 roles total)
| Role | Status | Notes |
|------|--------|-------|
| `super_admin` | Active | Full platform control |
| `admin` | Active | Operations staff |
| `finance` | Active | View-only financial oversight |
| `agent` | Active | Field staff |
| `leader` | Active | Group governance |
| `member` | Active | End user |
| `institution_user` | Active | Generic institution staff (new) |
| `umuco` | **Legacy** | Still accepted in code — migration callable exists but not yet run |

### Institution Model
- `institutions/{id}` collection exists with all required fields
- `groups.institutionId` FK set by `submitBatch` and backfilled via `backfillGroupInstitutionIds`
- `depositBatches.institutionId` denormalized from group at submit time
- Institution-scoped read rules exist for `institution_user` role in `depositBatches`
- `backfillUmucoInstitution` seeds `institutions/umuco` with hardcoded document ID

### Backend Functions (53 callables + 2 scheduled)
All modules read and confirmed. Core business logic is sound.

### Frontend Apps
| App | Routes | Completeness |
|-----|--------|-------------|
| member | 18 declared | ~50% wired — group management, transaction history, agent finder incomplete |
| agent | Deposits complete | Loans, Settlements, Withdrawals folders exist but partially complete |
| admin | 21 routes | ~90% complete |
| umuco | 6 routes | 100% complete |

---

## 2. Mismatches vs Target Architecture

### HIGH — Remove in Phase 1

#### H1: `fundMovements` deprecated collection still written (`loans.js`)
- **Location**: `functions/src/loans.js` — `executeLoanDisbursement` (lines 107, 219–226) and `executeLoanRepayment` (lines 244, 365–372)
- **Impact**: Every loan disbursement and repayment writes two redundant documents — one to `fundLedger` (correct) and one to deprecated `fundMovements`
- **Fix**: Remove `fundMovementRef` creation and `tx.set(fundMovementRef, ...)` from both functions

#### H2: `"umuco_branch"` channel still accepted and sent (backend + frontend)
- **Backend** `savings.js` line 189: `allowedChannels = ["agent", "institution_branch", "umuco_branch", "agent_qr"]`
- **Backend** `loans.js` line 682: validation accepts `"umuco_branch"` but error message already says `'institution_branch'`
- **Frontend** `apps/agent/src/features/Loans/LoanRepaymentScreen.jsx` line 16: `const CHANNELS = ["agent", "umuco_branch"]` — still sends old name
- **Frontend** `apps/member/src/features/Transactions/TransactionHistoryScreen.jsx` line 22: maps `umuco_branch` to display label
- **Fix**: Rename `"umuco_branch"` → `"institution_branch"` across all 4 files

#### H3: `getFeesConfig` reads from legacy `config/fees` collection (`savings.js`)
- **Location**: `functions/src/savings.js` lines 95–112
- **Impact**: `recordDeposit` and `recordWithdrawal` read fees from `config/fees` (deprecated). The canonical source is `systemConfig/fees`. Fee and commission logic will be 0 after reset since `config/fees` will be empty.
- **Fix**: Read from `systemConfig/fees` instead; fall back to zero values if that also doesn't exist

#### H4: `recordRepayment` channel validation inconsistency (`loans.js`)
- Accepts `"umuco_branch"` but error message says `"channel must be 'agent' or 'institution_branch'."` — contradiction
- **Fix**: Covered by H2 above

---

### MEDIUM — Address before or at reset

#### M1: `ROLES.UMUCO` still a first-class role in `constants.js`
- Used in `confirmBatch`, `flagBatch`, `getBatchesForGroup`, and Firestore rules as an accepted value
- **Decision**: Keep for now; remove after clean reseed (no legacy `umuco` users will exist after reset)

#### M2: Firestore rules still support legacy `umuco` role
- `isUmuco()` alias function exists; `depositBatches` and `institutionPools` accept `umuco` role
- `institutionPools` rule is asymmetric: `institution_user` is institution-scoped, `umuco` is not
- **Fix**: Remove after `migrateInstitutionUserRoles` is run and confirmed

#### M3: `backfillUmucoInstitution` uses hardcoded Firestore doc ID `"umuco"`
- Post-reset, all institutions should be created via `createInstitution` (auto-IDs)
- This callable is a pre-reset-only utility; should be removed from exports post-reset

#### M4: `getExecutiveSummary` missing metrics from target dashboard spec
- **Target requires**: active agents count, active institutions count, deposits today
- **Current**: activeMemberCount, activeGroupCount, pendingApprovals, fund, activeLoansCount, defaultedLoansCount, flaggedBatchCount, submittedBatchCount
- **Fix in Phase 1**: Add `activeAgentCount` and `activeInstitutionCount`

#### M5: Hardcoded business rules — not reading from `systemConfig`
| Constant | Location | Value | Target Config Path |
|----------|----------|-------|--------------------|
| `MIN_WITHDRAWAL_REMAINING_BALANCE` | `savings.js:23` | 5000 | `systemConfig/businessRules.minBalanceBIF` |
| `WITHDRAWAL_APPROVAL_THRESHOLD` | `savings.js:24` | 50000 | `systemConfig/businessRules.largeWithdrawalThresholdBIF` |
| `MAX_GROUP_EXPOSURE_RATIO` | `loans.js:23` | 0.7 | `systemConfig/businessRules.maxGroupExposureRatio` |
| `MAX_BORROWER_CONCENTRATION_RATIO` | `loans.js:24` | 0.4 | `systemConfig/businessRules.maxBorrowerConcentrationRatio` |
| Interest rates | `utils.js` | `{7:0.06, 14:0.05, 30:0.04}` | `systemConfig/loanPolicy.interestRates` |

**Note**: Moving these to live config reads is Phase 3 work. Reading config inside Firestore transactions has latency and consistency implications requiring careful design.

---

### LOW — Post-reset cleanup

#### L1: `wallets` and `groupMembers` balance duplication
- Both collections track savings balances with different field names
- `wallets` used by deposit/withdrawal/loan logic; `groupMembers` used by credit limit calculation
- No single source of truth — both updated independently

#### L2: `memberId` redundant field on transactions
- `transactions.memberId` always equals `transactions.userId` — causes confusion

#### L3: `fundingSource` field inconsistency on loans
- `requestLoan` writes both `fundSource: "kirimba_fund"` and `fundingSource: "kirimba_capital"` on some paths

#### L4: `adminApproveDeposits` is dead code
- Function body throws `permission-denied` immediately at line 312 — all code below is unreachable
- Should be removed from exports

---

## 3. Missing Dashboard Modules by Role

### Super Admin
| Dashboard | Status | Gap |
|-----------|--------|-----|
| Executive Summary | ✅ Exists | Missing active agents, institutions counts |
| Transaction Oversight | ✅ Exists | No export support |
| Admin Management | ✅ Exists | — |
| Institution Management | ✅ Exists | — |
| Group Governance | ✅ Exists | No force-review mechanism |
| Loan Control Center | ✅ Exists | — |
| Deposit & Batch Control (view only) | ✅ Exists | — |
| Reconciliation & Settlement | ✅ Exists | — |
| Pricing & Rules Engine | ✅ Exists | Not dynamically consumed by functions yet |
| Risk & Exception Center | ⚠️ Partial | Missing: concentration risk, inactive leader, reconciliation mismatch, suspicious pattern |
| Audit Log | ✅ Exists | — |

### Operations Admin
| Dashboard | Status | Gap |
|-----------|--------|-----|
| Pending Approvals | ✅ Exists | — |
| Deposit/Batch Monitoring | ✅ Exists | — |
| Loan Operations | ✅ Exists | — |
| Agent Management | ⚠️ Partial | No agent performance/suspension screen |
| Reconciliation Review | ✅ Exists | — |

### Institution User
| Dashboard | Status | Gap |
|-----------|--------|-----|
| Pending Batches (scoped) | ✅ Complete | — |
| Batch Detail (confirm/flag) | ✅ Complete | — |
| Batch History (scoped) | ✅ Complete | — |
| Flagged Exceptions (scoped) | ✅ Complete | — |

### Agent
| Dashboard | Status | Gap |
|-----------|--------|-----|
| Daily Deposit Summary | ✅ Exists | — |
| Loan Management | ⚠️ Partial | LoanRepaymentScreen exists; disbursement screen unknown |
| Settlement Requests | ⚠️ Partial | Folder exists; completion unknown |
| Withdrawal Processing | ⚠️ Partial | Folder exists; completion unknown |

### Member
| Dashboard | Status | Gap |
|-----------|--------|-----|
| Wallet / Savings View | ✅ Exists | — |
| Loan Request | ✅ Exists | — |
| My Loans | ✅ Exists | — |
| QR Code | ✅ Exists | — |
| Group Management | ❌ Missing | Create/join/manage/split screens not wired in routing |
| Transaction History | ❌ Missing | Screen exists but not wired in App.jsx |
| Find Agent | ❌ Missing | Screen exists but not wired in App.jsx |

---

## 4. Legacy "umuco" and Single-Institution Assumptions

| Location | Legacy Reference | Type | Phase to Remove |
|----------|-----------------|------|-----------------|
| `constants.js:10` | `ROLES.UMUCO = "umuco"` | Role constant | Phase 3 (post-reset) |
| `savings.js:189` | `"umuco_branch"` in allowedChannels | Channel string | Phase 1 |
| `savings.js:748,902,1002` | `ROLES.UMUCO` in requireRole calls | Role check | Phase 3 |
| `loans.js:682` | `"umuco_branch"` channel accepted | Channel string | Phase 1 |
| `firestore.rules:28–34` | `isUmuco()` function alias | Rule helper | Phase 3 |
| `firestore.rules:117` | `role() == "umuco"` batch read | Access rule | Phase 3 |
| `firestore.rules:200` | `role() == "umuco"` pools read | Access rule | Phase 3 |
| `superAdmin.js:527` | `db.collection("institutions").doc("umuco")` | Hardcoded doc ID | Phase 3 |
| `apps/umuco/App.jsx:59` | `role !== "umuco"` role check | Frontend check | Phase 3 |
| `apps/agent/LoanRepaymentScreen.jsx:16` | `"umuco_branch"` channel | Frontend channel | Phase 1 |
| `apps/member/TransactionHistoryScreen.jsx:22` | `umuco_branch` display label | Frontend label | Phase 1 |

**Still correct (intentional compat shims):**
- `confirmBatch` accepts `data.umucoAccountRef` alongside `data.institutionRef` — acceptable until migration complete
- `depositBatches` new writes use `institutionNotes` and `institutionRef` correctly

---

## 5. Hardcoded Business Rules That Must Move to Config

These constants must eventually be driven by `systemConfig` documents per the target architecture.

| Constant | Module | Current Value | systemConfig path |
|----------|--------|--------------|-------------------|
| `MIN_WITHDRAWAL_REMAINING_BALANCE` | savings.js | 5000 | `businessRules.minBalanceBIF` |
| `WITHDRAWAL_APPROVAL_THRESHOLD` | savings.js | 50000 | `businessRules.largeWithdrawalThresholdBIF` |
| `MAX_GROUP_EXPOSURE_RATIO` | loans.js | 0.7 | `businessRules.maxGroupExposureRatio` |
| `MAX_BORROWER_CONCENTRATION_RATIO` | loans.js | 0.4 | `businessRules.maxBorrowerConcentrationRatio` |
| Interest rate schedule | utils.js | `{7:0.06, 14:0.05, 30:0.04}` | `loanPolicy.interestRates` |
| Max loan multiplier | loans.js (inline) | 1.5 | `loanPolicy.maxLoanMultiplier` |

**Note**: `seedSystemConfig` already seeds these values into `systemConfig`. The gap is that functions still read constants instead of Firestore. Phase 3 work.

---

## 6. Missing Audit Log Coverage

### Covered ✅
`updateSystemConfig`, `seedSystemConfig`, `suspendUser/reactivateUser`, `suspendGroup/reactivateGroup`, `suspendAdmin/reactivateAdmin`, `suspendInstitution/reactivateInstitution`, `createInstitution`, `seedKirimbaFund`, `topUpKirimbaFund`, `deductKirimbaFund`, `pauseKirimbaLending`, `resumeKirimbaLending`, `migrateInstitutionUserRoles`, `backfillGroupInstitutionIds`

### Missing

| Operation | Function | Priority |
|-----------|----------|----------|
| Member approval | `approveMember` | HIGH |
| Member rejection | `rejectMember` | HIGH |
| Group approval | `approveGroup` | HIGH |
| Loan disbursement (agent) | `disburseLoan` | HIGH |
| Loan disbursement (admin) | `adminDisburseLoan` | HIGH |
| Loan default (manual) | `adminMarkLoanDefault` | HIGH |
| Loan approval (admin) | `approveLoan` | MEDIUM |
| Batch confirmation | `confirmBatch` | MEDIUM |
| Batch flagging | `flagBatch` | MEDIUM |
| PIN reset | `resetPIN` | MEDIUM |
| Agent provisioning | `provisionAgent` | MEDIUM |
| Admin provisioning | `provisionAdmin` | MEDIUM |
| Institution user provisioning | `provisionInstitutionUser` | MEDIUM |

---

## 7. Missing Notification Coverage

### Covered ✅
- Batch flagged → `batch_flagged` → agent notified
- Loan defaulted → `loan_defaulted` → admin notified (in loan doc)

### Missing

| Event | Expected Notification |
|-------|-----------------------|
| Member approved | → member: "Your account has been approved" |
| Group approved | → leader: "Your group has been approved" |
| Loan disbursed | → member: "Your loan of X BIF has been disbursed" |
| Batch confirmed | → agent: "Your batch for group X has been confirmed" |
| Large withdrawal request | → admin: "Withdrawal of X BIF requires approval" |

---

## 8. Missing Firestore Indexes

### Existing (22 indexes confirmed)
All core indexes present. Institution-scoped batch indexes exist. Core transaction/loan/user/group indexes present.

### Missing for planned dashboard features

| Collection | Fields Needed | Required By |
|-----------|--------------|------------|
| `transactions` | `type ASC + createdAt DESC` | Deposits-today count in executive dashboard |
| `transactions` | `groupId ASC + type ASC + createdAt DESC` | Per-group deposit history with type filter |
| `users` | `role ASC + status ASC` | Active agents count query |
| `agentReconciliations` | `agentId ASC + date DESC` | Agent reconciliation history |
| `agentSettlements` | `agentId ASC + status ASC + createdAt DESC` | Agent settlement tracking |
| `agentSettlements` | `status ASC + createdAt DESC` | Admin settlement queue |
| `notifications` | `recipientId ASC + status ASC + createdAt DESC` | Member notification inbox |

---

## 9. Recommended Implementation Order

### Phase 1 — This session: Legacy cleanup + audit log gaps
1. Remove `fundMovements` writes from `loans.js`
2. Remove `"umuco_branch"` channel from backend (`savings.js`, `loans.js`)
3. Update `LoanRepaymentScreen.jsx` channel to `"institution_branch"`
4. Update `TransactionHistoryScreen.jsx` to display `institution_branch` label
5. Migrate `getFeesConfig` in `savings.js` to read from `systemConfig/fees`
6. Add audit log calls to `approveMember`, `rejectMember`, `approveGroup`, `disburseLoan`, `adminDisburseLoan`, `adminMarkLoanDefault`
7. Add `activeAgentCount` and `activeInstitutionCount` to `getExecutiveSummary`

### Phase 2 — Before reset: Complete UI
1. Wire missing member app routes (group management, transaction history, find agent)
2. Complete agent app screens (settlements, withdrawal processing)
3. Add missing notification events

### Phase 3 — Post-reset: Rules engine + legacy purge
1. Remove `ROLES.UMUCO` and all `umuco` role checks
2. Remove `isUmuco()` from Firestore rules
3. Migrate hardcoded constants to read from `systemConfig`
4. Remove `backfillUmucoInstitution` and other pre-reset utilities from exports
5. Add missing Firestore indexes

### Phase 4 — Post-reset: Data model cleanup
1. Resolve `wallets`/`groupMembers` balance duplication
2. Remove `memberId` redundant field from new transaction writes
3. Remove `adminApproveDeposits` dead function

---

## 10. Unresolved Blockers

| # | Blocker | Impact | Resolution |
|---|---------|--------|-----------|
| B1 | `migrateInstitutionUserRoles` not yet run | Legacy `umuco`-role users still exist | Run before or during reset |
| B2 | `config/fees` used by `getFeesConfig` | Fee/commission = 0 after reset | Fixed in Phase 1 |
| B3 | Member app group management not wired | Members cannot create/join groups from app | Phase 2 work |
| B4 | `adminApproveDeposits` is dead code but exported | Misleading API surface | Phase 4 removal |

---

*Report generated: 2026-03-16*
