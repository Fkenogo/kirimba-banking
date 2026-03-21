# CLAUDE.md - AI Assistant Guide for KIRIMBA Banking Platform

> **Last Updated**: 2026-03-14
> **Purpose**: Comprehensive guide for AI assistants working on the KIRIMBA codebase

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Recent Updates (v3.1.9)](#recent-updates-v319)
3. [Quick Start](#quick-start)
4. [Repository Structure](#repository-structure)
5. [Technology Stack](#technology-stack)
6. [Architecture & Design Patterns](#architecture--design-patterns)
7. [Database Schema](#database-schema)
8. [Backend API Reference](#backend-api-reference)
9. [Frontend Applications](#frontend-applications)
10. [Development Workflows](#development-workflows)
11. [Critical Patterns & Conventions](#critical-patterns--conventions)
12. [Common Tasks](#common-tasks)
13. [Troubleshooting](#troubleshooting)

---

## Project Overview

**KIRIMBA** is a digital group savings and lending platform for informal groups and market vendors in Burundi. The system enables:

- **Members** pool savings (held at Umuco microfinance institution as collateral)
- **KIRIMBA** provides loans from its own fund, backed by member savings
- **Agents** (field staff) facilitate cash deposits/withdrawals and loan disbursements
- **Umuco** staff confirm deposit batches
- **Admins** manage approvals and oversight

### Key Business Rules

1. **Credit Limit**: 1.5× confirmed personal savings
2. **Collateral**: Active loans lock member savings (can't withdraw locked amount)
3. **Interest Rates**: 6% (7-day), 5% (14-day), 4% (30-day)
4. **Withdrawal Threshold**: <50k BIF instant, ≥50k BIF requires approval
5. **Minimum Balance**: 5k BIF must remain in account
6. **Auto-Approval**: Loans approved if within credit limit + fund available
7. **Default Detection**: Daily check at 6 AM (Africa/Bujumbura) marks overdue loans

### Documentation Files

- [KIRIMBA_Technical_Spec.md](KIRIMBA_Technical_Spec.md) - Full product specification and data models
- [KIRIMBA_Firebase_Setup_Guide.md](KIRIMBA_Firebase_Setup_Guide.md) - Firebase configuration instructions
- [KIRIMBA_Build_Alignment.md](KIRIMBA_Build_Alignment.md) - Build checklist and status tracking
- [README.md](README.md) - Quick setup guide

---

## Recent Updates (v3.1.9)

**Release Date**: March 2026

### Major Features Added

1. **Super Admin Module** (`functions/src/superAdmin.js`)
   - System configuration management (fees, loan policy, commission policy, business rules)
   - User and group suspension workflows
   - Admin user management
   - Institution (partner) management
   - Executive dashboard and business intelligence
   - Comprehensive audit logging

2. **Agent Provisioning & Management** (`functions/src/agents.js`)
   - Streamlined agent onboarding workflow
   - Agent-to-group assignment system
   - Admin and institution user provisioning
   - Agent schema updated with `assignedGroups` array model

3. **Agent Reconciliation & Settlements** (`functions/src/reconciliation.js`)
   - Daily agent reconciliation closure
   - Commission tracking and settlement requests
   - Multi-step approval workflow for payouts

4. **Enhanced Group Management** (`functions/src/groups.js`)
   - Borrow pause capability (freeze loan requests per group)
   - Group split functionality for large groups
   - Leader membership backfill utility

5. **Extended Member, Savings, and Loan Functions**
   - Member-initiated withdrawal requests
   - Bulk deposit approval workflows
   - Enhanced loan dashboard and admin controls
   - Agent ledger queries for commission tracking

6. **Frontend Enhancements**
   - Super Admin dashboard screens (9 new screens in `/apps/admin/src/features/SuperAdmin/`)
   - Agent loan management UI
   - Agent settlement screens
   - Member loan viewing and agent finder
   - Umuco flagged batches screen

### New Collections

- **auditLog**: Comprehensive audit trail for all admin actions
- **institutions**: Partner institution registry
- **systemConfig**: Platform-wide configuration (4 documents)
- **agentSettlements**: Agent payout tracking
- **agentReconciliations**: Daily agent cash reconciliation

### New Constants

```javascript
// Added in v3.1.9
SETTLEMENT_STATUS: { REQUESTED, APPROVED, PAID, REJECTED }
LEDGER_TYPE: { FEE, COMMISSION }
LEDGER_STATUS: { ACCRUED, SETTLED, REVERSED }
```

### Security Enhancements

- Bcrypt PIN hashing (replacing SHA256)
- Idempotency tokens required for `submitBatch`
- Enhanced Firestore security rules
- Notification TTL and automatic cleanup

### Breaking Changes

- `submitBatch` now requires `idempotencyToken` parameter
- `agents` schema changed from single `assignedGroupId` to `assignedGroups[]` array
- New `admin` role distinct from `super_admin`

### Migration Notes

If upgrading from pre-v3.1.9:
1. Run `seedSystemConfig()` to initialize system configuration
2. Update agent documents to use `assignedGroups` array
3. Backfill leader group memberships using `backfillLeaderGroupMembership()`
4. Review and update Firestore indexes (10 new indexes added)

---

## Quick Start

```bash
# 1. Setup environment
nvm use                                    # Use Node 20
npm install                                # Install all workspace dependencies

# 2. Configure Firebase (each app needs .env.local)
# Copy apps/member/.env.example → apps/member/.env.local
# Copy for agent, admin, umuco apps as well
# Set VITE_USE_FIREBASE_EMULATORS=true for local development

# 3. Start Firebase emulators
npm run emulators:core                     # Auth, Firestore, Functions

# 4. Start frontend apps (separate terminals)
npm run dev:member                         # Port 5173
npm run dev:agent                          # Port 5174
npm run dev:admin                          # Port 5175
npm run dev:umuco                          # Port 5176

# OR run all apps concurrently
npm run dev:all

# 5. Access apps
# Member: http://localhost:5173/app
# Agent: http://localhost:5174/agent
# Admin: http://localhost:5175/admin
# Umuco: http://localhost:5176/umuco
# Firebase Emulator UI: http://localhost:4000
```

---

## Repository Structure

```
kirimba-banking/
├── apps/                               # Frontend applications (React + Vite)
│   ├── member/                         # Member app (/app)
│   ├── agent/                          # Agent app (/agent)
│   ├── admin/                          # Admin app (/admin)
│   └── umuco/                          # Umuco dashboard (/umuco)
│
├── functions/                          # Firebase Cloud Functions (Node.js 20)
│   └── src/
│       ├── index.js                    # Function exports (50+ callables + 2 triggers)
│       ├── constants.js                # Enums (roles, statuses, transaction types)
│       ├── members.js                  # Member & group management
│       ├── savings.js                  # Savings & deposits
│       ├── loans.js                    # Loan lifecycle
│       ├── agents.js                   # Agent provisioning & assignment
│       ├── groups.js                   # Group management utilities
│       ├── reconciliation.js           # Agent settlement & reconciliation
│       ├── superAdmin.js               # Business oversight & system config
│       ├── scheduledFunctions.js       # Scheduled cleanup tasks
│       ├── utils.js                    # PIN hashing, calculations, receipts
│       └── validators.js               # Input validation helpers
│
├── firebase.json                       # Firebase config (hosting, emulators)
├── .firebaserc                         # Firebase project alias
├── firestore.rules                     # Firestore security rules (8 role-based rulesets)
├── firestore.indexes.json              # 8 composite indexes
├── package.json                        # Monorepo workspace config
└── [Documentation files]
```

### App Structure (Identical for All 4 Apps)

```
apps/[member|agent|admin|umuco]/
├── src/
│   ├── pages/
│   │   ├── LoginPage.jsx               # Email/password auth with toggle
│   │   └── HomePage.jsx                # Authenticated user display
│   ├── services/
│   │   ├── firebase.js                 # Firebase init + emulator config
│   │   └── auth.js                     # Auth wrappers (signUp, signIn, signOut)
│   ├── components/                     # (Scaffolded, empty)
│   ├── hooks/                          # (Scaffolded, empty)
│   ├── App.jsx                         # Router + auth state management
│   ├── main.jsx                        # React 18 entry point
│   └── index.css                       # Tailwind CSS imports
├── .env.local                          # Firebase config (NOT in git)
├── .env.example                        # Template for Firebase vars
├── package.json                        # App-specific dependencies
├── vite.config.js                      # Vite + React config
└── tailwind.config.js                  # Tailwind configuration
```

---

## Technology Stack

### Backend

- **Firebase Cloud Functions** (Node.js 20)
  - `firebase-functions`: ^7.0.6
  - `firebase-admin`: ^12.7.0
- **Firestore**: NoSQL database
- **Firebase Auth**: Email/password (phone as email format)

### Frontend (All 4 Apps)

- **React**: ^18.3.1 (functional components, hooks)
- **React Router DOM**: ^6.28.0 (SPA routing)
- **Vite**: ^5.4.10 (build tool, dev server)
- **TailwindCSS**: ^3.4.14 (utility-first CSS)
- **Firebase SDK**: ^11.1.0 or ^12.10.0 (auth, Firestore client)

### Development Tools

- **npm workspaces**: Monorepo management
- **concurrently**: Run multiple dev servers
- **nvm**: Node version management

---

## Architecture & Design Patterns

### 1. Monorepo Structure

- **4 independent React apps** share single Firebase project
- **Backend-only writes**: All financial operations via Cloud Functions
- **Frontend apps**: Thin clients for UI/auth only
- **Single hosting target**: Multiple paths (/app, /agent, /admin, /umuco)

### 2. Authentication Architecture

**Phone Number as Email Pattern**:
```
User phone: +257XXXXXXXX
Firebase email: +257XXXXXXXX@kirimba.app
Password: 4-digit PIN (presented as full password)
```

**Auth Flow**:
1. Sign up → Firebase creates auth user → backend trigger creates user profile (status: `pending_approval`)
2. Super admin approves → sets custom role claim via `setCustomUserClaims()`
3. Sign in → ID token includes role claim
4. Frontend checks `user.uid` + custom claims for authorization

**Role-Based Access**:
- **Roles**: `super_admin`, `admin`, `finance`, `agent`, `leader`, `member`, `umuco`
- **Custom Claims**: Injected at approval time, read from `request.auth.token.role`
- **Firestore Rules**: Enforce role-based read access (all writes denied)
- **Note**: `admin` role added in v3.1.9 (distinct from `super_admin`)

### 3. Transaction Safety

**Critical Pattern**: All multi-document operations use Firestore transactions.

```javascript
// Example: Loan disbursement updates 5+ documents atomically
await db.runTransaction(async (transaction) => {
  // Read phase
  const loanSnap = await transaction.get(loanRef);
  const memberSnap = await transaction.get(memberRef);
  const fundSnap = await transaction.get(fundRef);

  // Validation
  if (!loanSnap.exists()) throw new functions.https.HttpsError(...);

  // Write phase (all succeed or all fail)
  transaction.update(loanRef, { status: LOAN_STATUS.ACTIVE, ... });
  transaction.update(memberRef, { lockedSavings: newLocked, ... });
  transaction.update(fundRef, { deployedFund: newDeployed, ... });
  transaction.create(transactionRef, { ... });
  transaction.create(notificationRef, { ... });
});
```

### 4. Batch Operations Pattern

**Deposit Flow**:
1. Agent records deposits → `transactions/{id}` (status: `pending_umuco`)
2. Agent submits batch → `depositBatches/{id}` (status: `submitted`)
3. Umuco confirms batch → all transactions confirmed, savings updated atomically

**Why**: Prevents partial confirmations, provides audit trail, simplifies Umuco workflow.

### 5. Multi-Tenant Frontend

| App      | Base Path | Port | Intended Users               |
|----------|-----------|------|------------------------------|
| **member** | `/app`    | 5173 | Group members (savers)       |
| **agent**  | `/agent`  | 5174 | Field staff (deposits/loans) |
| **admin**  | `/admin`  | 5175 | Super admin, finance staff   |
| **umuco**  | `/umuco`  | 5176 | Microfinance partner staff   |

All apps:
- Share same Firebase project
- Use same auth system
- Access same Firestore data (filtered by role)
- Deploy as separate hosting targets

---

## Database Schema

### Core Collections

#### users
```typescript
{
  fullName: string,
  phone: string,                      // +257XXXXXXXX
  nationalId: string | null,
  role: "super_admin" | "leader" | "agent" | "member" | "umuco" | "finance",
  status: "pending_approval" | "active" | "suspended" | "rejected",
  groupId: string | null,             // FK → groups/{groupId}
  isLeader: boolean,
  ledGroupId: string | null,          // FK → groups/{groupId}
  pinHash: string,                    // SHA256 hash
  createdAt: Timestamp,
  approvedAt: Timestamp | null,
  updatedAt: Timestamp | null
}
```

#### groups
```typescript
{
  name: string,
  description: string,
  groupCode: string,                  // KRM-XXX (unique)
  leaderId: string,                   // FK → users/{uid}
  status: "pending_approval" | "active" | "suspended",
  totalSavings: number,               // Sum of confirmed member savings
  pendingSavings: number,             // Sum of pending deposits
  memberCount: number,
  umucoAccountNo: string,             // Linked Umuco account
  createdAt: Timestamp,
  approvedAt: Timestamp | null,

  // Subcollection
  joinRequests/{joinRequestId}: {
    userId: string,
    status: "pending" | "approved" | "rejected",
    requestedAt: Timestamp
  }
}
```

#### groupMembers
```typescript
{
  userId: string,                     // FK → users/{uid}
  groupId: string,                    // FK → groups/{groupId}
  personalSavings: number,            // Confirmed balance
  pendingSavings: number,             // Awaiting Umuco confirmation
  lockedSavings: number,              // Collateral for active loans
  creditLimit: number,                // 1.5 × personalSavings
  availableCredit: number,            // creditLimit - lockedSavings
  joinedAt: Timestamp,
  isActive: boolean,
  updatedAt: Timestamp
}
```

#### transactions
```typescript
{
  memberId: string,                   // Document ID
  userId: string,                     // FK → users/{uid}
  groupId: string,                    // FK → groups/{groupId}
  type: "deposit" | "withdrawal" | "loan_disburse" | "loan_repay",
  amount: number,
  status: "pending_umuco" | "confirmed" | "rejected",
  recordedBy: string,                 // Agent uid
  channel: "agent" | "umuco_branch",
  batchId: string | null,             // FK → depositBatches/{id}
  receiptNo: string,                  // TXN-YYYY-XXXXX
  balanceBefore: number,
  balanceAfter: number | null,
  notes: string,
  createdAt: Timestamp,
  loanId: string | null               // For loan transactions
}
```

#### loans
```typescript
{
  memberId: string,                   // Document ID
  userId: string,                     // FK → users/{uid}
  groupId: string,                    // FK → groups/{groupId}
  amount: number,
  interestRate: number,               // 0.04, 0.05, or 0.06
  interestAmount: number,
  totalDue: number,                   // amount + interestAmount
  termDays: 7 | 14 | 30,
  dueDate: Timestamp,
  status: "pending" | "active" | "repaid" | "defaulted" | "rejected",
  rejectionReason: string | null,
  approvalType: "auto",
  disbursedBy: string | null,         // Agent uid
  disbursedAt: Timestamp | null,
  paidAmount: number,
  remainingDue: number,
  repaidAt: Timestamp | null,
  defaultedAt: Timestamp | null,
  purpose: string,
  fundSource: "kirimba_fund",
  createdAt: Timestamp,
  updatedAt: Timestamp | null
}
```

#### depositBatches
```typescript
{
  groupId: string,                    // FK → groups/{groupId}
  agentId: string,                    // FK → users/{uid}
  transactionIds: string[],           // FK → transactions/{id}
  totalAmount: number,
  memberCount: number,
  status: "submitted" | "confirmed" | "flagged",
  submittedAt: Timestamp,
  confirmedBy: string | null,         // Umuco staff uid
  confirmedAt: Timestamp | null,
  umucoNotes: string | null,
  umucoAccountRef: string,            // External reference
  flaggedBy: string | null,
  flaggedAt: Timestamp | null,
  updatedAt: Timestamp
}
```

#### kirimbaFund
```typescript
// Document: kirimbaFund/current
{
  totalCollateral: number,            // Sum of all confirmed group savings
  availableFund: number,              // Liquid capital for loans
  deployedFund: number,               // Capital locked in active loans
  lastUpdated: Timestamp,
  updatedBy: string                   // uid of last updater
}
```

### New Collections (v3.1.9+)

#### auditLog
```typescript
{
  actorId: string,                    // FK → users/{uid}
  actorRole: string,                  // Role at time of action
  action: string,                     // e.g., "user_suspended", "config_updated"
  targetType: string,                 // "user" | "group" | "systemConfig" | "institution"
  targetId: string | null,            // FK to target document
  meta: object,                       // Action-specific metadata
  createdAt: Timestamp
}
```

#### institutions
```typescript
{
  name: string,                       // Institution name
  code: string,                       // Unique code (e.g., "UMUCO")
  status: "active" | "suspended",
  contactEmail: string | null,
  notes: string | null,
  createdAt: Timestamp,
  createdBy: string,                  // FK → users/{uid}
  suspendedAt: Timestamp | null,
  suspendedBy: string | null,
  suspendReason: string | null
}
```

#### systemConfig
Documents: `fees`, `loanPolicy`, `commissionPolicy`, `businessRules`

```typescript
// systemConfig/fees
{
  depositFeeFlat: number,
  withdrawFeeFlat: number,
  agentCommissionRate: number,
  updatedAt: Timestamp,
  updatedBy: string
}

// systemConfig/loanPolicy
{
  maxLoanMultiplier: number,          // 1.5
  minLoanAmount: number,
  maxLoanAmount: number,
  defaultTermDays: number,
  interestRates: { 7: 0.06, 14: 0.05, 30: 0.04 }
}

// systemConfig/commissionPolicy
{
  agentDepositCommissionRate: number,
  agentLoanCommissionRate: number,
  settlementCycleDays: number
}

// systemConfig/businessRules
{
  minBalanceBIF: number,
  largeWithdrawalThresholdBIF: number,
  maxGroupSize: number,
  groupSplitThreshold: number
}
```

#### agents (schema update)
```typescript
{
  // ... existing user fields
  assignedGroups: string[],           // Array of group IDs
  institutionId: string | null,       // FK → institutions/{id}
}
```

### Firestore Indexes

18+ composite indexes for efficient queries (key additions in v3.1.9):

**Original indexes (1-8)**:
1. `transactions`: `groupId ASC + createdAt DESC`
2. `loans`: `userId ASC + status ASC + createdAt DESC`
3. `depositBatches`: `groupId ASC + status ASC + submittedAt DESC`
4. `depositBatches`: `groupId ASC + submittedAt DESC`
5. `users`: `status ASC + createdAt ASC`
6. `loans`: `userId ASC + createdAt DESC`
7. `loans`: `groupId ASC + createdAt DESC`
8. `loans`: `groupId ASC + status ASC + createdAt DESC`

**New indexes (v3.1.9+)**:
9. `transactions`: `agentId ASC + type ASC + createdAt ASC`
10. `transactions`: `userId ASC + createdAt DESC`
11. `transactions`: `type ASC + status ASC + createdAt DESC`
12. `users`: `role ASC + createdAt DESC`
13. `auditLog`: `actorId ASC + createdAt DESC`
14. `auditLog`: `targetType ASC + createdAt DESC`
15. `loans`: `status ASC + createdAt DESC`
16. `groups`: `status ASC + createdAt DESC`
17. `depositBatches`: `status ASC + submittedAt DESC`
18. `depositBatches`: `status ASC + flaggedAt DESC`

**Add new indexes** to [firestore.indexes.json](firestore.indexes.json) when Firestore query errors request them.

---

## Backend API Reference

### Member Management (8 Functions)

#### `registerMember(data)`
**Callable by**: Anyone (unauthenticated)
**Purpose**: Self-registration with phone, name, PIN, optional group code
**Input**:
```typescript
{
  phone: string,          // +257XXXXXXXX format
  fullName: string,       // 3-100 chars
  pin: string,            // 4 digits
  nationalId?: string,    // Optional
  joinCode?: string       // Optional group code (KRM-XXX)
}
```
**Returns**: `{ userId: string }`
**Side Effects**:
- Creates Firebase Auth user (email: phone@kirimba.app, password: PIN)
- Triggers `onUserCreate` → creates `users/{uid}` + `wallets/{uid}` (status: `pending_approval`)
- If `joinCode` provided, stores for later processing after approval

#### `approveMember(userId)`
**Callable by**: `super_admin`
**Purpose**: Approve pending member, set role claim, process join request if present
**Input**: `{ userId: string }`
**Returns**: `{ success: true }`
**Side Effects**:
- Sets `status: "active"`, `approvedAt: now`, `role: MEMBER` custom claim
- If join request exists, creates `groups/{groupId}/joinRequests/{userId}`
- **Critical**: Must run before member can use other functions (checks `requireActiveMember`)

#### `rejectMember(userId, reason)`
**Callable by**: `super_admin`
**Purpose**: Reject pending member with reason
**Input**: `{ userId: string, reason: string }`
**Returns**: `{ success: true }`
**Side Effects**: Sets `status: "rejected"`, stores rejection reason

#### `createGroup(name, description)`
**Callable by**: Active member
**Purpose**: Create new savings group with unique code
**Input**:
```typescript
{
  name: string,           // 3-100 chars
  description: string     // 10-500 chars
}
```
**Returns**: `{ groupId: string, groupCode: string }`
**Side Effects**:
- Creates `groups/{groupId}` (status: `pending_approval`)
- Generates unique group code (KRM-XXX format)
- Sets `leaderId` to caller, updates user record

#### `approveGroup(groupId, umucoAccountNo)`
**Callable by**: `super_admin`
**Purpose**: Activate group + link Umuco account
**Input**: `{ groupId: string, umucoAccountNo: string }`
**Returns**: `{ success: true }`
**Side Effects**: Sets `status: "active"`, stores Umuco account reference

#### `joinGroup(groupCode)`
**Callable by**: Active member (not already in group)
**Purpose**: Request to join group via group code
**Input**: `{ groupCode: string }`
**Returns**: `{ joinRequestId: string }`
**Side Effects**: Creates `groups/{groupId}/joinRequests/{joinRequestId}` (status: `pending`)

#### `approveJoinRequest(joinRequestId, userId)`
**Callable by**: Group leader
**Purpose**: Approve member join request
**Input**: `{ joinRequestId: string, userId: string }`
**Returns**: `{ success: true }`
**Side Effects**:
- Creates `groupMembers/{userId}` with zero balances
- Updates `users/{userId}.groupId`
- Increments `groups/{groupId}.memberCount`
- Sets join request status to `approved`

#### `resetPIN(userId, newPIN)`
**Callable by**: `super_admin` or `agent`
**Purpose**: Reset member PIN (security recovery)
**Input**: `{ userId: string, newPIN: string }` (4 digits)
**Returns**: `{ success: true }`
**Side Effects**:
- Updates `users/{userId}.pinHash`
- Updates Firebase Auth password to newPIN

#### `getPendingApprovals()`
**Callable by**: `super_admin`
**Purpose**: Query pending users and groups for admin dashboard
**Input**: None
**Returns**:
```typescript
{
  pendingMembers: Array<{ userId, fullName, phone, createdAt }>,
  pendingGroups: Array<{ groupId, name, leaderName, createdAt }>
}
```

---

### Savings Management (6 Functions)

#### `recordDeposit(userId, amount, channel, notes)`
**Callable by**: `agent`
**Purpose**: Record cash deposit from member
**Input**:
```typescript
{
  userId: string,
  amount: number,         // > 0
  channel: "agent" | "umuco_branch",
  notes: string           // Optional
}
```
**Returns**: `{ transactionId: string, receiptNo: string }`
**Side Effects**:
- Creates `transactions/{id}` (status: `pending_umuco`, type: `deposit`)
- Generates unique receipt number (TXN-YYYY-XXXXX)
- **Does NOT update balances** (requires Umuco confirmation)

#### `recordWithdrawal(userId, amount, notes)`
**Callable by**: `agent`
**Purpose**: Record withdrawal request
**Input**:
```typescript
{
  userId: string,
  amount: number,         // > 0
  notes: string           // Optional
}
```
**Returns**: `{ transactionId: string, receiptNo: string, status: string }`
**Side Effects**:
- If amount < 50,000 BIF: Creates confirmed transaction, immediately updates balance
- If amount ≥ 50,000 BIF: Creates `withdrawalRequests/{id}` (status: `pending_approval`)
- Validates minimum balance (5,000 BIF must remain)
- Validates no locked savings being withdrawn

#### `submitBatch(groupId, transactionIds)`
**Callable by**: `agent`
**Purpose**: Submit pending deposits as batch to Umuco
**Input**:
```typescript
{
  groupId: string,
  transactionIds: string[]
}
```
**Returns**: `{ batchId: string }`
**Side Effects**:
- Creates `depositBatches/{id}` (status: `submitted`)
- Stores transaction IDs, calculates total amount + member count
- **Transaction validation**: All must be pending deposits for same group

#### `confirmBatch(batchId, umucoAccountRef, notes)`
**Callable by**: `umuco` role
**Purpose**: Confirm deposit batch, update all member balances
**Input**:
```typescript
{
  batchId: string,
  umucoAccountRef: string,  // External reference
  notes?: string
}
```
**Returns**: `{ success: true }`
**Side Effects** (atomic transaction):
- Updates all transactions in batch to `status: "confirmed"`
- Updates each member's `personalSavings`, `creditLimit`, `availableCredit`
- Updates group's `totalSavings`
- Updates `kirimbaFund.totalCollateral`
- Sets batch status to `confirmed`

#### `flagBatch(batchId, notes)`
**Callable by**: `umuco` role
**Purpose**: Flag batch for discrepancies (amounts don't match, etc.)
**Input**: `{ batchId: string, notes: string }`
**Returns**: `{ success: true }`
**Side Effects**:
- Sets batch status to `flagged`
- Creates high-severity notification for agent + admin

#### `getBatchesForGroup(groupId, status?)`
**Callable by**: `agent`, `admin`, `umuco`
**Purpose**: Query batches for a group (with optional status filter)
**Input**: `{ groupId: string, status?: "submitted" | "confirmed" | "flagged" }`
**Returns**:
```typescript
{
  batches: Array<{
    batchId,
    totalAmount,
    memberCount,
    status,
    submittedAt,
    agentName
  }>
}
```

---

### Loan Lifecycle (5 Functions)

#### `requestLoan(amount, termDays, purpose)`
**Callable by**: Active member with group
**Purpose**: Request loan (auto-approved if within credit limit + fund available)
**Input**:
```typescript
{
  amount: number,         // 1,000 - 5,000,000 BIF
  termDays: 7 | 14 | 30,
  purpose: string         // 10-500 chars
}
```
**Returns**: `{ loanId: string, status: "pending" | "rejected", rejectionReason?: string }`
**Auto-Approval Logic**:
```javascript
// Approved if ALL conditions met:
1. amount <= member.availableCredit (1.5x savings - locked)
2. amount <= kirimbaFund.availableFund
3. member has no active loans

// Otherwise rejected with reason:
- "Insufficient credit limit"
- "Insufficient fund"
- "Active loan exists"
```
**Side Effects**:
- Creates `loans/{id}` (status: `pending` or `rejected`)
- Calculates interest based on term (6%/5%/4%)
- Sets `dueDate = now + termDays`

#### `disburseLoan(loanId)`
**Callable by**: `agent`
**Purpose**: Disburse approved loan to member
**Input**: `{ loanId: string }`
**Returns**: `{ transactionId: string, receiptNo: string }`
**Side Effects** (atomic transaction):
- Updates loan status to `active`, sets `disbursedBy`, `disbursedAt`
- Locks collateral: `member.lockedSavings += amount`
- Updates `member.availableCredit` (reduces by amount)
- Deducts from fund: `kirimbaFund.deployedFund += amount`, `availableFund -= amount`
- Creates transaction record (type: `loan_disburse`)
- Creates fund movement audit record
- **Critical**: Loan must be in `pending` status (not already disbursed)

#### `recordRepayment(loanId, amount, channel)`
**Callable by**: `agent`
**Purpose**: Record loan repayment (full or partial)
**Input**:
```typescript
{
  loanId: string,
  amount: number,         // > 0, <= remainingDue
  channel: "agent" | "umuco_branch"
}
```
**Returns**: `{ transactionId: string, receiptNo: string, loanStatus: string }`
**Side Effects** (atomic transaction):
- Updates `loan.paidAmount += amount`, `remainingDue -= amount`
- If fully repaid:
  - Sets status to `repaid`, `repaidAt: now`
  - Releases collateral: `member.lockedSavings -= loanAmount`
  - Updates `member.availableCredit`
- Returns fund: `kirimbaFund.deployedFund -= amount`, `availableFund += amount`
- Creates transaction record (type: `loan_repay`)
- Creates fund movement audit record

#### `markLoanDefaulted()` [Scheduled]
**Trigger**: Daily at 6:00 AM Africa/Bujumbura
**Purpose**: Mark overdue active loans as defaulted
**Logic**:
```javascript
// Query all active loans where dueDate < now
// For each overdue loan:
//   - Set status to DEFAULTED, defaultedAt: now
//   - Create high-severity notification for admin
```
**Side Effects**:
- Does NOT release locked collateral (remains locked as bad debt)
- Creates notifications for each defaulted loan

#### `getMemberLoans(userId?, status?)`
**Callable by**: Member (own loans), agent/admin (any member)
**Purpose**: Query member's loan history
**Input**: `{ userId?: string, status?: "pending" | "active" | "repaid" | "defaulted" }`
**Returns**:
```typescript
{
  loans: Array<{
    loanId,
    amount,
    interestRate,
    totalDue,
    paidAmount,
    remainingDue,
    status,
    dueDate,
    createdAt,
    ...
  }>
}
```

#### `getLoansByGroup(groupId, status?)`
**Callable by**: Group leader, agent, admin
**Purpose**: Query group's loan history
**Input**: `{ groupId: string, status?: string }`
**Returns**: Same as `getMemberLoans` but for all group members

---

### Auth Trigger (1 Function)

#### `onUserCreate(user)` [Auth Trigger]
**Trigger**: Firebase Auth user creation
**Purpose**: Create user profile + wallet on signup
**Idempotency**: Checks if documents exist before creating (prevents duplicates)
**Side Effects**:
- Creates `users/{uid}` (status: `pending_approval`, role from metadata or `MEMBER`)
- Creates `wallets/{uid}` (balance: 0, currency: BIF)
- **Critical**: Runs automatically, cannot be called directly

---

### Super Admin Functions (15 Functions) - NEW in v3.1.9

#### System Configuration

##### `getSystemConfig(configId)`
**Callable by**: `super_admin`, `admin`, `finance`
**Purpose**: Retrieve system configuration document
**Input**: `{ configId: "fees" | "loanPolicy" | "commissionPolicy" | "businessRules" }`
**Returns**: `{ configId, data: {...} | null }`

##### `updateSystemConfig(configId, data)`
**Callable by**: `super_admin`
**Purpose**: Update system configuration
**Input**: `{ configId: string, data: object }`
**Returns**: `{ success: true }`
**Side Effects**: Writes audit log entry

##### `seedSystemConfig()`
**Callable by**: `super_admin`
**Purpose**: Initialize system config with default values
**Returns**: `{ seeded: string[] }`

#### User & Group Suspension

##### `suspendUser(userId, reason)`
**Callable by**: `super_admin`
**Purpose**: Suspend any user (except super_admin)
**Input**: `{ userId: string, reason: string }`
**Returns**: `{ success: true }`
**Side Effects**: Sets user status to `suspended`, writes audit log

##### `reactivateUser(userId)`
**Callable by**: `super_admin`
**Purpose**: Reactivate suspended user
**Input**: `{ userId: string }`
**Returns**: `{ success: true }`

##### `suspendGroup(groupId, reason)`
**Callable by**: `super_admin`
**Purpose**: Suspend a group
**Input**: `{ groupId: string, reason: string }`
**Returns**: `{ success: true }`

##### `reactivateGroup(groupId)`
**Callable by**: `super_admin`
**Purpose**: Reactivate suspended group
**Input**: `{ groupId: string }`
**Returns**: `{ success: true }`

#### Admin Management

##### `getAdmins()`
**Callable by**: `super_admin`
**Purpose**: List all admin users (super_admin, admin, finance)
**Returns**: `{ admins: Array<{uid, fullName, phone, role, status, ...}> }`

##### `suspendAdmin(userId, reason)`
**Callable by**: `super_admin`
**Purpose**: Suspend admin user (cannot suspend self or other super_admins)
**Input**: `{ userId: string, reason: string }`
**Returns**: `{ success: true }`

##### `reactivateAdmin(userId)`
**Callable by**: `super_admin`
**Purpose**: Reactivate suspended admin
**Input**: `{ userId: string }`
**Returns**: `{ success: true }`

#### Institution Management

##### `getInstitutions()`
**Callable by**: `super_admin`, `admin`, `finance`
**Purpose**: List all partner institutions
**Returns**: `{ institutions: Array<{id, name, code, status, ...}> }`

##### `createInstitution(name, code, contactEmail?, notes?)`
**Callable by**: `super_admin`
**Purpose**: Register new partner institution
**Input**: `{ name: string, code: string, contactEmail?: string, notes?: string }`
**Returns**: `{ institutionId: string }`
**Validation**: Code must be unique, 2-20 chars

##### `suspendInstitution(institutionId, reason)`
**Callable by**: `super_admin`
**Purpose**: Suspend institution
**Input**: `{ institutionId: string, reason: string }`
**Returns**: `{ success: true }`

##### `reactivateInstitution(institutionId)`
**Callable by**: `super_admin`
**Purpose**: Reactivate institution
**Input**: `{ institutionId: string }`
**Returns**: `{ success: true }`

#### Business Intelligence Dashboards

##### `getExecutiveSummary()`
**Callable by**: `super_admin`
**Purpose**: High-level platform metrics
**Returns**:
```typescript
{
  summary: {
    activeMemberCount: number,
    activeGroupCount: number,
    pendingApprovals: number,
    fund: { totalCollateral, availableFund, deployedFund },
    activeLoansCount: number,
    defaultedLoansCount: number,
    flaggedBatchCount: number,
    submittedBatchCount: number
  }
}
```

##### `getLoanPortfolioSummary()`
**Callable by**: `super_admin`, `admin`, `finance`
**Purpose**: Detailed loan portfolio analysis
**Returns**:
```typescript
{
  portfolio: {
    totalPortfolio: number,
    totalDeployed: number,
    totalDefaulted: number,
    totalRepaid: number,
    pendingDisbursement: number,
    countByStatus: { pending, active, repaid, defaulted, rejected },
    overdueLoanCount: number
  }
}
```

##### `getExceptions()`
**Callable by**: `super_admin`, `admin`
**Purpose**: List all exceptional situations requiring attention
**Returns**:
```typescript
{
  flaggedBatches: Array<{id, ...}>,
  defaultedLoans: Array<{id, ...}>,
  suspendedUsers: Array<{uid, fullName, ...}>,
  suspendedGroups: Array<{id, name, ...}>
}
```
**Note**: Limits each category to 50 items

#### Audit Log

##### `getAuditLog(targetType?, targetId?, actorId?, limit?)`
**Callable by**: `super_admin`, `admin`
**Purpose**: Query audit trail
**Input**: `{ targetType?: string, targetId?: string, actorId?: string, limit?: number }`
**Returns**: `{ entries: Array<{id, action, actorId, targetType, targetId, meta, createdAt}> }`
**Note**: Max limit 200, defaults to 50

---

### Agent Provisioning Functions (4 Functions) - NEW in v3.1.9

#### `provisionAgent(phone, fullName, pin, assignedGroups?)`
**Callable by**: `super_admin`
**Purpose**: Create new agent user with role
**Input**: `{ phone: string, fullName: string, pin: string, assignedGroups?: string[] }`
**Returns**: `{ userId: string }`
**Side Effects**: Creates auth user, sets role to `agent`, status to `active`

#### `assignAgentToGroup(agentId, groupId)`
**Callable by**: `super_admin`, `admin`
**Purpose**: Link agent to group
**Input**: `{ agentId: string, groupId: string }`
**Returns**: `{ success: true }`
**Side Effects**: Adds groupId to agent's `assignedGroups` array

#### `provisionAdmin(phone, fullName, pin, role)`
**Callable by**: `super_admin`
**Purpose**: Create new admin/finance user
**Input**: `{ phone: string, fullName: string, pin: string, role: "admin" | "finance" }`
**Returns**: `{ userId: string }`

#### `provisionInstitutionUser(phone, fullName, pin, institutionId)`
**Callable by**: `super_admin`
**Purpose**: Create umuco staff user
**Input**: `{ phone: string, fullName: string, pin: string, institutionId: string }`
**Returns**: `{ userId: string }`
**Side Effects**: Sets role to `umuco`, links to institution

---

### Group Management Functions (1 Function) - NEW in v3.1.9

#### `adminSetGroupBorrowPause(groupId, isPaused, reason?)`
**Callable by**: `super_admin`, `admin`
**Purpose**: Pause/unpause loan requests for a group
**Input**: `{ groupId: string, isPaused: boolean, reason?: string }`
**Returns**: `{ success: true }`
**Side Effects**: Updates `groups/{groupId}.borrowPaused` field

---

### Agent Reconciliation Functions (5 Functions) - NEW in v3.1.9

#### `closeAgentDay(dateYYYYMMDD, cashCounted, notes?, offlinePendingCount?)`
**Callable by**: `agent`
**Purpose**: Close daily reconciliation
**Input**: `{ dateYYYYMMDD: string (YYYY-MM-DD), cashCounted: number, notes?: string, offlinePendingCount?: number }`
**Returns**: `{ reconciliationId, cashExpected, cashCounted, difference, depositCount, withdrawCount, commissionAccrued }`
**Side Effects**: Upserts `agentReconciliations/{agentId}_{dateYYYYMMDD}` document (re-submittable unless status is `"reviewed"`)

#### `adminUpdateReconciliation(reconciliationId, updates)`
**Callable by**: `super_admin`, `admin`, `finance`
**Purpose**: Adjust reconciliation record
**Input**: `{ reconciliationId: string, updates: object }`
**Returns**: `{ success: true }`

#### `requestSettlement(periodStart, periodEnd, notes?)`
**Callable by**: `agent`
**Purpose**: Request payout of commissions for a date period
**Input**: `{ periodStart: string (YYYY-MM-DD), periodEnd: string (YYYY-MM-DD), notes?: string }`
**Returns**: `{ settlementId: string, commissionTotal: number }`
**Side Effects**: Creates `agentSettlements/{id}` (status: `"requested"`). Deduplicates by exact `periodStart`/`periodEnd` — throws `already-exists` if open request for same period exists.

#### `approveSettlement(settlementId, approvedAmount?, notes?)`
**Callable by**: `super_admin`, `finance`
**Purpose**: Approve settlement request
**Input**: `{ settlementId: string, approvedAmount?: number, notes?: string }`
**Returns**: `{ success: true }`

#### `markSettlementPaid(settlementId, paidAmount, paymentReference, notes?)`
**Callable by**: `super_admin`, `finance`
**Purpose**: Record settlement payment
**Input**: `{ settlementId: string, paidAmount: number, paymentReference: string, notes?: string }`
**Returns**: `{ success: true }`
**Side Effects**: Sets settlement status to `paid`

---

### Updated Member Functions (5+ new) - v3.1.9

**New functions in members.js**:
- `joinGroupByInviteCode(inviteCode)` - Join group via invite link
- `setMemberInstitution(userId, institutionId)` - Link member to institution
- `getGroupMembers(groupId)` - List all members in group
- `initiateGroupSplit(groupId, newGroupName, memberIds)` - Split large group
- `backfillLeaderGroupMembership()` - Admin utility to fix leader records
- `rejectJoinRequest(joinRequestId, userId, reason)` - Reject join request

### Updated Savings Functions (3+ new) - v3.1.9

**New functions in savings.js**:
- `memberRequestWithdrawal(amount, notes)` - Member initiates withdrawal
- `adminApproveDeposits(transactionIds)` - Bulk approve deposits
- `getAgentLedger(agentId, startDate?, endDate?)` - Query agent commissions

### Updated Loans Functions (6+ new) - v3.1.9

**New functions in loans.js**:
- `getLoansDashboard(groupId?, status?)` - Admin loan overview
- `getLoanDetails(loanId)` - Get single loan with full details
- `approveLoan(loanId)` - Admin approve pending loan
- `adminDisburseLoan(loanId, notes?)` - Admin disburse loan
- `adminMarkRepayment(loanId, amount, notes?)` - Admin record repayment
- `adminMarkLoanDefault(loanId, reason)` - Admin mark loan defaulted

---

### Scheduled Functions (1 Function) - NEW in v3.1.9

#### `deleteExpiredNotifications()` [Scheduled]
**Trigger**: Daily cleanup (runs at configured interval)
**Purpose**: Delete old notifications past TTL
**Logic**: Queries `notifications` collection for expired records, deletes in batches

---

## Frontend Applications

### Common Structure

All 4 apps (member, agent, admin, umuco) share identical patterns:

**Pages**:
- [LoginPage.jsx](apps/member/src/pages/LoginPage.jsx) - Toggle between login/signup, email + password fields
- [HomePage.jsx](apps/member/src/pages/HomePage.jsx) - Display authenticated user, sign-out button

**Services**:
- [firebase.js](apps/member/src/services/firebase.js) - Firebase initialization, emulator detection
- [auth.js](apps/member/src/services/auth.js) - Auth wrappers (signUpAccount, signInAccount, signOutAccount)

**Router**:
```javascript
// App.jsx pattern
const router = createBrowserRouter([
  { path: "/", element: user ? <Navigate to={`${BASE_PATH}/home`} /> : <Navigate to={`${BASE_PATH}/login`} /> },
  { path: `${BASE_PATH}/login`, element: <LoginPage /> },
  { path: `${BASE_PATH}/home`, element: user ? <HomePage /> : <Navigate to={`${BASE_PATH}/login`} /> }
], { basename: "/" });
```

**Auth State Management**:
```javascript
// main.jsx pattern
const [user, setUser] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
  const unsubscribe = auth.onAuthStateChanged((currentUser) => {
    setUser(currentUser);
    setLoading(false);
  });
  return () => unsubscribe();
}, []);
```

### App-Specific Differences

| App      | BASE_PATH | Login Title        | Home Title      | Planned Features                          |
|----------|-----------|--------------------|-----------------|-------------------------------------------|
| **member** | `/app`    | KIRIMBA Member     | Member Home     | Savings dashboard, loan requests          |
| **agent**  | `/agent`  | Agent Home         | Agent Home      | Deposit recording, loan disbursements     |
| **admin**  | `/admin`  | Admin Home         | Admin Home      | Member approval, group management         |
| **umuco**  | `/umuco`  | (Same as others)   | (TBD)           | Batch confirmation workflow               |

### Calling Backend Functions

```javascript
// Import
import { functions } from "@/services/firebase";
import { httpsCallable } from "firebase/functions";

// Create callable reference
const registerMember = httpsCallable(functions, "registerMember");

// Call function
try {
  const result = await registerMember({ phone, fullName, pin });
  console.log("User ID:", result.data.userId);
} catch (error) {
  console.error("Error:", error.message);
}
```

### Firebase Emulator Configuration

```javascript
// services/firebase.js pattern
const authRuntime = {
  useEmulators: import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" &&
                (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
};

if (authRuntime.useEmulators) {
  const host = import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  connectAuthEmulator(auth, `http://${host}`, { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
```

**Key Points**:
- Emulators only connect if `VITE_USE_FIREBASE_EMULATORS=true` AND running on localhost
- Prevents accidental production data access during dev
- Auth errors normalized in [auth.js](apps/member/src/services/auth.js) to provide helpful messages

---

## Development Workflows

### Adding a New Backend Function

1. **Define in domain module** ([members.js](functions/src/members.js), [savings.js](functions/src/savings.js), [loans.js](functions/src/loans.js)):
```javascript
// functions/src/savings.js
const recordDeposit = onCall(async (request) => {
  requireRole(request, [ROLES.AGENT]);
  const { userId, amount, channel, notes } = request.data;

  // Validation
  if (!userId || !amount || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "Invalid input");
  }

  // Business logic with Firestore transaction
  const transactionId = await db.runTransaction(async (transaction) => {
    // ...
  });

  return { transactionId, receiptNo };
});
```

2. **Export in [index.js](functions/src/index.js)**:
```javascript
const { recordDeposit } = require("./savings");
exports.recordDeposit = recordDeposit;
```

3. **Test locally**:
```bash
npm run emulators:core
# Call from frontend or Firebase Functions shell
```

4. **Update Firestore rules** if new collection/access pattern:
```
// firestore.rules
match /transactions/{transactionId} {
  allow read: if isAgent() || isAdmin() || resource.data.userId == request.auth.uid;
  allow write: if false; // Backend only
}
```

5. **Add indexes** if query requires:
```json
// firestore.indexes.json
{
  "collectionGroup": "transactions",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "groupId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

6. **Deploy**:
```bash
firebase deploy --only functions
```

### Adding a New Frontend Page

1. **Create page component**:
```javascript
// apps/member/src/pages/DepositPage.jsx
import { useState } from "react";
import { functions } from "@/services/firebase";
import { httpsCallable } from "firebase/functions";

export default function DepositPage() {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const handleDeposit = async () => {
    setLoading(true);
    try {
      const recordDeposit = httpsCallable(functions, "recordDeposit");
      const result = await recordDeposit({ userId: "...", amount: parseFloat(amount), channel: "agent" });
      console.log("Receipt:", result.data.receiptNo);
    } catch (error) {
      console.error("Error:", error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Record Deposit</h1>
      <input
        type="number"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="border p-2 rounded"
        placeholder="Amount (BIF)"
      />
      <button
        onClick={handleDeposit}
        disabled={loading}
        className="bg-blue-500 text-white px-4 py-2 rounded ml-2"
      >
        {loading ? "Processing..." : "Submit"}
      </button>
    </div>
  );
}
```

2. **Add route to [App.jsx](apps/member/src/App.jsx)**:
```javascript
import DepositPage from "./pages/DepositPage";

const router = createBrowserRouter([
  // ...existing routes
  { path: `${BASE_PATH}/deposit`, element: user ? <DepositPage /> : <Navigate to={`${BASE_PATH}/login`} /> }
], { basename: "/" });
```

3. **Add navigation link**:
```javascript
// In HomePage.jsx or navigation component
<Link to={`${BASE_PATH}/deposit`} className="text-blue-500">Record Deposit</Link>
```

### Adding a New Collection

1. **Update Firestore rules**:
```
// firestore.rules
match /newCollection/{docId} {
  allow read: if isAuthenticated() && hasRole("member");
  allow write: if false; // Backend only
}
```

2. **Add indexes if needed**:
```json
// firestore.indexes.json
{
  "collectionGroup": "newCollection",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "userId", "order": "ASCENDING" },
    { "fieldPath": "createdAt", "order": "DESCENDING" }
  ]
}
```

3. **Deploy rules + indexes**:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```

### Testing Locally

**Emulator Workflow**:
```bash
# Terminal 1: Start emulators
npm run emulators:core

# Terminal 2: Start frontend app
npm run dev:member

# Access emulator UI
open http://localhost:4000

# Clear emulator data (if needed)
# Stop emulators, delete ~/.firebase directory, restart
```

**Emulator Features**:
- **Firestore**: View/edit documents, import/export data
- **Auth**: View users, add test users, verify custom claims
- **Functions**: View logs, trigger functions manually
- **Persistent data**: Emulator data saved to disk (not ephemeral)

### Deployment

**Full Deployment**:
```bash
npm run build:all         # Build all 4 frontend apps
firebase deploy           # Deploy functions + hosting + rules + indexes
```

**Partial Deployment**:
```bash
firebase deploy --only functions              # Functions only
firebase deploy --only hosting:member         # Member app only
firebase deploy --only firestore:rules        # Rules only
firebase deploy --only firestore:indexes      # Indexes only
```

**Pre-Deploy Checklist**:
- [ ] Test all changes in emulators
- [ ] Verify Firestore rules allow/deny correctly
- [ ] Check functions logs for errors
- [ ] Verify frontend builds without errors
- [ ] Test auth flow (login/signup)
- [ ] Verify role-based access in UI

---

## Constants & Enums

All constants are defined in [functions/src/constants.js](functions/src/constants.js):

### Roles
```javascript
ROLES = {
  SUPER_ADMIN: "super_admin",    // Full platform control
  ADMIN: "admin",                 // Business operations (v3.1.9+)
  FINANCE: "finance",             // Financial oversight
  AGENT: "agent",                 // Field staff
  LEADER: "leader",               // Group leader
  MEMBER: "member",               // Regular member
  UMUCO: "umuco"                  // Institution staff
}
```

### User & Group Status
```javascript
USER_STATUS = {
  PENDING_APPROVAL: "pending_approval",
  ACTIVE: "active",
  SUSPENDED: "suspended",
  REJECTED: "rejected"
}

GROUP_STATUS = {
  PENDING_APPROVAL: "pending_approval",
  ACTIVE: "active",
  SUSPENDED: "suspended"
}

JOIN_REQUEST_STATUS = {
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected"
}
```

### Transaction Types & Status
```javascript
TRANSACTION_TYPE = {
  DEPOSIT: "deposit",
  WITHDRAWAL: "withdrawal",
  LOAN_DISBURSE: "loan_disburse",
  LOAN_REPAY: "loan_repay"
}

TRANSACTION_STATUS = {
  PENDING_CONFIRMATION: "pending_confirmation",
  CONFIRMED: "confirmed",
  REJECTED: "rejected"
}

DEPOSIT_BATCH_STATUS = {
  SUBMITTED: "submitted",
  CONFIRMED: "confirmed",
  FLAGGED: "flagged"
}
```

### Loan Status & Terms
```javascript
LOAN_STATUS = {
  PENDING: "pending",
  ACTIVE: "active",
  REPAID: "repaid",
  DEFAULTED: "defaulted",
  REJECTED: "rejected"
}

LOAN_TERMS = {
  DAYS_7: 7,
  DAYS_14: 14,
  DAYS_30: 30
}
```

### Agent Ledger & Settlement (v3.1.9+)
```javascript
LEDGER_TYPE = {
  FEE: "fee",
  COMMISSION: "commission"
}

LEDGER_STATUS = {
  ACCRUED: "accrued",
  SETTLED: "settled",
  REVERSED: "reversed"
}

SETTLEMENT_STATUS = {
  REQUESTED: "requested",
  APPROVED: "approved",
  PAID: "paid",
  REJECTED: "rejected"
}
```

---

## Critical Patterns & Conventions

### 1. Phone Number as Email

**Pattern**: Convert phone to email for Firebase Auth compatibility.

```javascript
// Correct
const email = `${phone}@kirimba.app`;  // +257XXXXXXXX@kirimba.app
const password = pin;                  // 4-digit PIN as full password

// Validation
function isValidBurundiPhone(phone) {
  return /^\+257\d{8}$/.test(phone);
}
```

**Why**: Firebase Auth requires email, but users only know phone numbers.

### 2. PIN Hashing

**Pattern**: SHA256 hash PINs before storing.

```javascript
// functions/src/utils.js
const crypto = require("crypto");

function hashPIN(pin) {
  return crypto.createHash("sha256").update(pin).digest("hex");
}

// Usage
const pinHash = hashPIN(newPIN);
await userRef.update({ pinHash });
```

**Why**: Store hashed PINs in Firestore for verification outside Firebase Auth.

### 3. Role-Based Authorization

**Pattern**: Check role at function entry.

```javascript
// functions/src/members.js
function requireRole(request, allowedRoles) {
  if (!request.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Authentication required");
  }

  const userRole = request.auth.token.role;
  if (!allowedRoles.includes(userRole)) {
    throw new functions.https.HttpsError("permission-denied", `Requires roles: ${allowedRoles.join(", ")}`);
  }
}

// Usage
const myFunction = onCall(async (request) => {
  requireRole(request, [ROLES.AGENT, ROLES.ADMIN]);
  // ...
});
```

**Critical**: Always validate role before proceeding with function logic.

### 4. Firestore Transactions for Multi-Doc Operations

**Pattern**: Use `db.runTransaction()` for consistency.

```javascript
// Atomic update across multiple docs
const result = await db.runTransaction(async (transaction) => {
  // READ PHASE (all reads first)
  const doc1Snap = await transaction.get(doc1Ref);
  const doc2Snap = await transaction.get(doc2Ref);

  // VALIDATION
  if (!doc1Snap.exists()) throw new Error("Doc1 not found");

  // COMPUTE
  const newValue = doc1Snap.data().value + doc2Snap.data().value;

  // WRITE PHASE (all writes after reads)
  transaction.update(doc1Ref, { value: newValue });
  transaction.update(doc2Ref, { processed: true });
  transaction.create(logRef, { action: "combined", value: newValue });

  return { success: true, newValue };
});
```

**Rules**:
- All `transaction.get()` calls before any `transaction.update/create/delete()`
- If any write fails, all rollback automatically
- No async operations (like calling external APIs) inside transaction

### 5. Idempotency in Triggers

**Pattern**: Check if operation already done before proceeding.

```javascript
// functions/src/index.js
onUserCreate = auth.user().onCreate(async (user) => {
  const userRef = db.collection("users").doc(user.uid);
  const userSnap = await userRef.get();

  // Idempotent: only create if doesn't exist
  if (userSnap.exists()) {
    return null;
  }

  await userRef.set({ /* user data */ });
  return null;
});
```

**Why**: Auth triggers can fire multiple times; prevent duplicate records.

### 6. Receipt Number Generation

**Pattern**: Use Firestore counter with transaction.

```javascript
// functions/src/utils.js
async function generateReceiptNo() {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`TXN_${year}`);

  const newNum = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(counterRef);
    const nextVal = (snap.exists() ? snap.data().value : 0) + 1;
    transaction.set(counterRef, { value: nextVal, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return nextVal;
  });

  return `TXN-${year}-${String(newNum).padStart(5, "0")}`;
}
```

**Why**: Ensures unique, sequential receipt numbers across concurrent requests.

### 7. Credit Limit Calculation

**Pattern**: 1.5× confirmed savings minus locked collateral.

```javascript
// functions/src/utils.js
function calculateCreditLimit(personalSavings, lockedSavings) {
  const baseLimit = personalSavings * 1.5;
  const availableCredit = baseLimit - lockedSavings;
  return {
    creditLimit: baseLimit,
    availableCredit: Math.max(availableCredit, 0)
  };
}
```

**Update on**:
- Deposit confirmation (increases `personalSavings`)
- Loan disbursement (increases `lockedSavings`)
- Loan repayment (decreases `lockedSavings`)

### 8. Interest Rate by Term

**Pattern**: Fixed rates based on loan term.

```javascript
// functions/src/utils.js
function calculateInterest(amount, termDays) {
  const rates = { 7: 0.06, 14: 0.05, 30: 0.04 };
  const rate = rates[termDays] || 0.05;
  const interestAmount = amount * rate;
  return {
    interestRate: rate,
    interestAmount: Math.round(interestAmount),
    totalDue: amount + Math.round(interestAmount)
  };
}
```

**Why**: Incentivize shorter-term loans (higher rates for 7-day).

### 9. Batch Confirmation Pattern

**Pattern**: Group operations for audit trail + efficiency.

```javascript
// Agent submits batch
const batch = {
  groupId,
  agentId,
  transactionIds: ["txn1", "txn2", "txn3"],
  totalAmount: 150000,
  memberCount: 3,
  status: "submitted",
  submittedAt: now
};
await db.collection("depositBatches").add(batch);

// Umuco confirms batch (atomic)
await db.runTransaction(async (transaction) => {
  // Update all transactions in batch
  for (const txnId of transactionIds) {
    transaction.update(db.collection("transactions").doc(txnId), { status: "confirmed" });
  }

  // Update batch status
  transaction.update(batchRef, { status: "confirmed", confirmedAt: now, confirmedBy: uid });

  // Update group + member balances
  // ...
});
```

**Why**: Prevents partial confirmations, provides clear audit trail.

### 10. Emulator Auto-Detection

**Pattern**: Only connect emulators if explicitly enabled AND on localhost.

```javascript
// services/firebase.js
const useEmulators = import.meta.env.VITE_USE_FIREBASE_EMULATORS === "true" &&
                     (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");

if (useEmulators) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099");
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
}
```

**Why**: Prevents accidental production access during dev, but also prevents emulator connection in deployed preview environments.

---

## Common Tasks

### Add a New Role

1. **Update constants**:
```javascript
// functions/src/constants.js
const ROLES = {
  SUPER_ADMIN: "super_admin",
  AGENT: "agent",
  MEMBER: "member",
  UMUCO: "umuco",
  FINANCE: "finance",
  NEW_ROLE: "new_role"  // Add here
};
```

2. **Update Firestore rules**:
```
// firestore.rules
function hasRole(role) {
  let claim = request.auth.token.role;
  return claim == role;
}

function isNewRole() {
  return hasRole("new_role");
}

// Add access rules
match /someCollection/{docId} {
  allow read: if isNewRole() || isAdmin();
}
```

3. **Update function authorization**:
```javascript
// In relevant functions
requireRole(request, [ROLES.NEW_ROLE, ROLES.ADMIN]);
```

4. **Update frontend role checks** (if conditional UI):
```javascript
// In React components
const canAccess = user?.customClaims?.role === "new_role";
```

### Add a New Transaction Type

1. **Update constants**:
```javascript
// functions/src/constants.js
const TRANSACTION_TYPES = {
  DEPOSIT: "deposit",
  WITHDRAWAL: "withdrawal",
  LOAN_DISBURSE: "loan_disburse",
  LOAN_REPAY: "loan_repay",
  NEW_TYPE: "new_type"  // Add here
};
```

2. **Create function to record new transaction**:
```javascript
// In savings.js or loans.js
const recordNewType = onCall(async (request) => {
  requireRole(request, [ROLES.AGENT]);
  const { userId, amount } = request.data;

  const receiptNo = await generateReceiptNo();
  const transactionRef = db.collection("transactions").doc();

  await transactionRef.set({
    memberId: userId,
    userId,
    type: TRANSACTION_TYPES.NEW_TYPE,
    amount,
    status: "confirmed",
    recordedBy: request.auth.uid,
    receiptNo,
    createdAt: FieldValue.serverTimestamp()
  });

  return { transactionId: transactionRef.id, receiptNo };
});
```

3. **Export in [index.js](functions/src/index.js)**:
```javascript
exports.recordNewType = recordNewType;
```

### Query Firestore from Frontend

```javascript
// Import
import { db } from "@/services/firebase";
import { collection, query, where, orderBy, limit, getDocs } from "firebase/firestore";

// Query example
async function getMyTransactions(userId) {
  const q = query(
    collection(db, "transactions"),
    where("userId", "==", userId),
    orderBy("createdAt", "desc"),
    limit(20)
  );

  const snapshot = await getDocs(q);
  const transactions = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  return transactions;
}
```

**Important**:
- Firestore rules enforce read access (will fail if unauthorized)
- Composite indexes required for multi-condition queries
- Add indexes to [firestore.indexes.json](firestore.indexes.json) if query fails

### Add Environment Variable

1. **Add to .env.example**:
```bash
# apps/member/.env.example
VITE_NEW_CONFIG=value
```

2. **Add to .env.local** (each app):
```bash
# apps/member/.env.local
VITE_NEW_CONFIG=actual_value
```

3. **Access in code**:
```javascript
// services/firebase.js or elsewhere
const newConfig = import.meta.env.VITE_NEW_CONFIG;
```

**Important**: Only variables prefixed with `VITE_` are exposed to frontend.

---

## Troubleshooting

### Auth Errors

#### `auth/network-request-failed`
**Cause**: Emulators not running while `VITE_USE_FIREBASE_EMULATORS=true`
**Solution**:
```bash
# Option 1: Start emulators
npm run emulators:core

# Option 2: Disable emulators
# In apps/member/.env.local
VITE_USE_FIREBASE_EMULATORS=false
```

#### `auth/invalid-credential`
**Cause**: Wrong email or password
**Solution**: Verify phone format (+257XXXXXXXX@kirimba.app) and PIN

#### `permission-denied`
**Cause**: User not approved or role not set
**Solution**:
1. Check user status in Firestore: `users/{uid}.status` should be `active`
2. Verify custom claim: `users/{uid}` → Auth → Custom claims
3. Super admin must approve member first

### Firestore Query Errors

#### `index-not-available`
**Cause**: Missing composite index
**Solution**:
1. Copy index definition from error message
2. Add to [firestore.indexes.json](firestore.indexes.json)
3. Deploy: `firebase deploy --only firestore:indexes`
4. Wait 2-3 minutes for index build

#### `permission-denied` on read
**Cause**: Firestore rules block access
**Solution**:
1. Check [firestore.rules](firestore.rules) for collection
2. Verify user role/auth state
3. Test in emulator UI (http://localhost:4000)

### Function Errors

#### `unauthenticated`
**Cause**: Function called without auth token
**Solution**: Ensure user logged in before calling function

#### `invalid-argument`
**Cause**: Missing or invalid function parameters
**Solution**: Check function signature in [backend API reference](#backend-api-reference)

#### `internal`
**Cause**: Unhandled error in function code
**Solution**: Check function logs (`firebase functions:log` or emulator UI)

### Build Errors

#### `Cannot find module '@/services/firebase'`
**Cause**: Vite alias not configured
**Solution**: Verify [vite.config.js](apps/member/vite.config.js):
```javascript
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src")
  }
}
```

#### `VITE_FIREBASE_API_KEY is not defined`
**Cause**: Missing .env.local file
**Solution**: Copy .env.example → .env.local and fill in Firebase config

### Emulator Issues

#### Emulator data persists across restarts
**Cause**: Firestore emulator saves data to disk
**Solution**: Delete emulator data:
```bash
# Stop emulators (Ctrl+C)
rm -rf ~/.firebase
npm run emulators:core  # Fresh start
```

#### Port already in use
**Cause**: Emulators already running or port conflict
**Solution**:
```bash
# Find process on port (e.g., 5001)
lsof -i :5001

# Kill process
kill -9 <PID>

# Restart emulators
npm run emulators:core
```

### Deployment Issues

#### `Billing account not configured`
**Cause**: Firebase Blaze plan required for Functions
**Solution**: Upgrade project to Blaze plan in Firebase Console

#### `functions: Unhandled error Error: User code failed to load`
**Cause**: Syntax error or missing dependency in functions
**Solution**:
1. Test functions locally in emulator
2. Check `functions/package.json` dependencies
3. Run `npm install` in functions directory

#### `hosting: Deploy failed`
**Cause**: Build output missing or incorrect hosting config
**Solution**:
1. Verify `npm run build:all` succeeds
2. Check [firebase.json](firebase.json) hosting targets
3. Verify `apps/*/dist/` directories exist

---

## Best Practices

### Security

1. **Never expose sensitive data in frontend**
   - Store secrets in Firebase Functions environment
   - Use Firestore rules to enforce access control
   - Validate all inputs in backend functions

2. **Always validate function inputs**
   ```javascript
   if (!userId || !amount || amount <= 0) {
     throw new functions.https.HttpsError("invalid-argument", "Invalid input");
   }
   ```

3. **Use role-based authorization**
   - Check role at function entry
   - Never trust client-provided role data
   - Use custom claims from Firebase Auth

4. **Backend-only writes**
   - All financial operations via Cloud Functions
   - Firestore rules deny all writes from client
   - Prevents unauthorized data manipulation

### Performance

1. **Use Firestore indexes**
   - Add composite indexes for multi-condition queries
   - Monitor index build status in Firebase Console

2. **Batch operations**
   - Group related operations (deposits → batches)
   - Reduces transaction count and improves audit trail

3. **Limit query results**
   ```javascript
   query(collection, where(...), orderBy(...), limit(20))
   ```

4. **Use Firestore transactions sparingly**
   - Only when multi-doc consistency required
   - Transactions have performance overhead

### Code Organization

1. **Domain-driven modules**
   - Group related functions (members.js, savings.js, loans.js)
   - Keep files under 600 lines

2. **Shared utilities**
   - Extract common logic (utils.js, validators.js)
   - Avoid duplication across functions

3. **Constants for enums**
   - Define in [constants.js](functions/src/constants.js)
   - Prevents typos and enables autocomplete

4. **Clear error messages**
   ```javascript
   throw new functions.https.HttpsError(
     "permission-denied",
     "Insufficient credit limit. Available: 50000 BIF, Requested: 100000 BIF"
   );
   ```

### Testing

1. **Test in emulators first**
   - Verify all changes locally before deploying
   - Use emulator UI to inspect data

2. **Test auth flows**
   - Signup → approval → login → function calls
   - Test role-based access for each role

3. **Test error cases**
   - Invalid inputs
   - Unauthorized access
   - Edge cases (zero balances, overdue loans, etc.)

4. **Check function logs**
   - Monitor for errors during testing
   - Add debug logging for complex operations

---

## Additional Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [React Documentation](https://react.dev)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Cloud Functions Guides](https://firebase.google.com/docs/functions)
- [Vite Documentation](https://vitejs.dev)
- [TailwindCSS Documentation](https://tailwindcss.com/docs)

---

## Contact & Support

For questions or issues with the KIRIMBA platform:
1. Check [KIRIMBA_Technical_Spec.md](KIRIMBA_Technical_Spec.md) for product details
2. Review [KIRIMBA_Firebase_Setup_Guide.md](KIRIMBA_Firebase_Setup_Guide.md) for setup issues
3. Check Firebase Console logs for runtime errors
4. Test in emulators to isolate issues

---

**Last Updated**: 2026-03-02
**Maintained by**: KIRIMBA Development Team
