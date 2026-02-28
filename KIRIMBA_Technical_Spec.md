# KIRIMBA — Full MVP Technical Specification
**Version:** 1.0 — Pilot Build  
**Stack:** Firebase (Firestore · Auth · Functions · Hosting)  
**Pilot Scale:** 5–15 Groups · 30–100 Members  
**Partner:** Umuco Microfinance (Licensed deposit-taking institution)

---

## 1. What KIRIMBA Is

KIRIMBA is a digital group savings and lending platform for informal market vendors in Burundi. Members pool their savings, which are held safely at a licensed microfinance institution (Umuco). KIRIMBA then offers members loans funded from Kirimba's own loan fund — backed by the collective savings held at Umuco as collateral.

**The core loop:**
1. Member saves money → Agent records cash → Goes to Umuco account
2. Umuco confirms the deposit batch → Savings count as collateral
3. Member's credit limit grows (1.5× personal savings)
4. Member requests a loan → Auto-approved if within limit
5. Kirimba disburses loan from its own fund → Agent hands over cash
6. Member repays → Kirimba fund replenished + interest earned

**What makes it work:**
- Umuco holds deposits safely (licensed, regulated)
- Kirimba controls lending independently, backed by those deposits
- No deposit is ever withdrawn without Kirimba Admin approval
- Group leaders recruit and manage their own communities

---

## 2. Roles & Permissions

There are **six roles** in the system. Each has its own login and interface.

| Role | Who They Are | Core Permissions |
|------|-------------|-----------------|
| **Super Admin** | Kirimba team | Approve members, manage loan fund, oversee everything, override any action |
| **Group Leader** | Member who created the group | Create group, invite members via code, view group dashboard, see member savings & loan status |
| **Agent** | Field staff (free-floating) | Record deposits/withdrawals for any member, assist registration, disburse loans, record repayments |
| **Member** | Market vendor / saver | Self-register, join group via code, check balance, request loans, view transactions |
| **Umuco Staff** | Microfinance institution staff | View all deposit transactions, confirm deposit batches, flag discrepancies |
| **Kirimba Finance** | Kirimba internal (part of Admin) | Manage loan fund balance, approve large withdrawals, fund reconciliation |

> **Agent is NOT tied to a group.** Any agent can serve any member. Agents assist and guide — they do not own or manage groups.

> **Group Leader IS a member.** They have member-level access PLUS a group management dashboard. One person, one login, elevated view.

---

## 3. User Registration & Onboarding Flow

### 3.1 Member Self-Registration

```
Step 1: Member opens app → taps "Create Account"
Step 2: Enters: Full Name, Phone Number, National ID (optional), creates 4-digit PIN
Step 3: Account status = "pending_approval"
Step 4: Member sees: "Your account is under review. You will be notified when approved."
Step 5: Super Admin reviews pending accounts → approves
Step 6: Member notified (in-app) → status = "active"
Step 7: Member enters a Group Code to join a group
Step 8: Group Leader sees join request → confirms → member is in the group
```

> Agents assist this process in the field — they sit with members and guide them through the app. But the member does the registration themselves on their own phone.

### 3.2 Group Creation Flow

```
Step 1: Any active member can become a Group Leader by creating a group
Step 2: Leader enters: Group Name, Group Description
Step 3: System generates a unique 6-character Group Code (e.g. KRM-847)
Step 4: Super Admin approves the new group
Step 5: Leader shares Group Code with people they recruit
Step 6: Recruited members self-register → get approved → enter Group Code → join
```

### 3.3 Agent Onboarding

Agents are created **only by Super Admin**. Agents do not self-register. Admin creates agent account → agent receives login credentials → agent is active immediately.

---

## 4. Data Model (Firestore Collections)

All financial writes happen through **Cloud Functions only**. Client apps read directly from Firestore but never write to financial fields.

### 4.1 `users`

```
users/{userId}
  ├── fullName:           string
  ├── phone:              string           // +25779XXXXXXX
  ├── nationalId:         string | null
  ├── role:               string           // 'super_admin' | 'leader' | 'agent' | 'member' | 'umuco' | 'finance'
  ├── status:             string           // 'pending_approval' | 'active' | 'suspended'
  ├── groupId:            string | null    // FK → groups (null until they join)
  ├── isLeader:           boolean          // true if this user leads a group
  ├── ledGroupId:         string | null    // FK → groups (group they lead)
  ├── pinHash:            string           // hashed PIN (set in Cloud Function)
  ├── createdAt:          timestamp
  └── approvedAt:         timestamp | null
```

### 4.2 `groups`

```
groups/{groupId}
  ├── name:               string           // e.g. "Siyoni Women Traders"
  ├── groupCode:          string           // e.g. "KRM-847" — unique
  ├── description:        string
  ├── leaderId:           string           // FK → users
  ├── status:             string           // 'pending_approval' | 'active' | 'suspended'
  ├── totalSavings:       number           // BIF — running total (confirmed deposits only)
  ├── pendingSavings:     number           // BIF — deposits awaiting Umuco confirmation
  ├── memberCount:        number
  ├── umucoAccountNo:     string           // Umuco account where this group's cash is held
  ├── createdAt:          timestamp
  └── approvedAt:         timestamp | null
```

### 4.3 `groupMembers`

```
groupMembers/{memberId}
  ├── userId:             string           // FK → users
  ├── groupId:            string           // FK → groups
  ├── personalSavings:    number           // BIF — confirmed savings only
  ├── pendingSavings:     number           // BIF — awaiting Umuco batch confirmation
  ├── lockedSavings:      number           // BIF — locked as active loan collateral
  ├── creditLimit:        number           // = personalSavings × 1.5 (auto-calculated)
  ├── availableCredit:    number           // = creditLimit - lockedSavings
  ├── joinedAt:           timestamp
  └── isActive:           boolean
```

### 4.4 `transactions`

```
transactions/{txnId}
  ├── memberId:           string           // FK → groupMembers
  ├── userId:             string           // FK → users
  ├── groupId:            string           // FK → groups
  ├── type:               string           // 'deposit' | 'withdrawal' | 'loan_disburse' | 'loan_repay'
  ├── amount:             number           // BIF
  ├── status:             string           // 'pending_umuco' | 'confirmed' | 'rejected'
  ├── recordedBy:         string           // agentId or 'umuco_branch'
  ├── channel:            string           // 'agent' | 'umuco_branch'
  ├── batchId:            string | null    // FK → depositBatches (for deposits)
  ├── notes:              string
  ├── receiptNo:          string           // TXN-2025-00001
  ├── balanceBefore:      number
  ├── balanceAfter:       number           // only updated after Umuco confirmation for deposits
  └── createdAt:          timestamp
```

### 4.5 `loans`

```
loans/{loanId}
  ├── memberId:           string           // FK → groupMembers
  ├── userId:             string           // FK → users
  ├── groupId:            string           // FK → groups
  ├── amount:             number           // BIF — principal
  ├── interestRate:       number           // e.g. 0.06 = 6%
  ├── interestAmount:     number           // calculated at creation
  ├── totalDue:           number           // amount + interestAmount
  ├── termDays:           number           // 7 | 14 | 30
  ├── dueDate:            timestamp
  ├── status:             string           // 'pending' | 'active' | 'repaid' | 'defaulted' | 'rejected'
  ├── rejectionReason:    string | null
  ├── approvalType:       string           // 'auto' (MVP only)
  ├── disbursedBy:        string | null    // agentId
  ├── disbursedAt:        timestamp | null
  ├── paidAmount:         number           // running repayment total
  ├── remainingDue:       number           // totalDue - paidAmount
  ├── purpose:            string
  ├── fundSource:         string           // 'kirimba_fund' (always in MVP)
  └── createdAt:          timestamp
```

### 4.6 `depositBatches`

```
depositBatches/{batchId}
  ├── groupId:            string           // FK → groups
  ├── agentId:            string           // who submitted the batch
  ├── transactionIds:     string[]         // array of transaction IDs in this batch
  ├── totalAmount:        number           // BIF — sum of all deposits
  ├── memberCount:        number           // number of members in this batch
  ├── status:             string           // 'submitted' | 'confirmed' | 'flagged'
  ├── submittedAt:        timestamp
  ├── confirmedBy:        string | null    // Umuco userId
  ├── confirmedAt:        timestamp | null
  ├── umucoNotes:         string | null    // Umuco can add notes when confirming or flagging
  └── umucoAccountRef:    string | null    // Umuco internal reference after confirmation
```

### 4.7 `kirimbaFund`

```
kirimbaFund/{recordId}
  ├── totalFund:          number           // BIF — total available for lending
  ├── deployedFund:       number           // BIF — currently out as active loans
  ├── availableFund:      number           // totalFund - deployedFund
  ├── totalCollateral:    number           // BIF — confirmed savings at Umuco
  ├── lastUpdated:        timestamp
  └── updatedBy:          string           // adminId
```

### 4.8 `fundMovements`

```
fundMovements/{movementId}
  ├── type:               string           // 'top_up' | 'withdrawal' | 'loan_out' | 'repayment_in'
  ├── amount:             number           // BIF
  ├── description:        string
  ├── loanId:             string | null    // if related to a loan
  ├── recordedBy:         string           // adminId
  └── createdAt:          timestamp
```

---

## 5. Business Logic & Rules

### 5.1 Credit Limit

- `creditLimit = personalSavings × 1.5`
- Only **confirmed** savings (after Umuco batch confirmation) count toward credit limit
- `availableCredit = creditLimit − lockedSavings`
- Recalculated every time a deposit batch is confirmed by Umuco

### 5.2 Deposit Flow (Two-Stage)

```
Stage 1 — Agent Records:
  Member brings cash to any agent
  Agent records deposit → transaction status = 'pending_umuco'
  Member's pendingSavings += amount (visible but not usable)
  Transaction added to a batch for Umuco

Stage 2 — Umuco Confirms:
  Umuco staff sees batch in their dashboard
  Umuco confirms batch → all transactions status = 'confirmed'
  Member's personalSavings += amount
  Member's pendingSavings -= amount
  Member's creditLimit recalculated
  Group's totalSavings updated
```

### 5.3 Loan Auto-Approval Rules

A loan is **auto-approved** if ALL conditions are met:

1. `requestedAmount <= member.availableCredit`
2. Member has **no other active loan** (status = 'active' or 'pending')
3. `kirimbaFund.availableFund >= requestedAmount`
4. Member status = 'active'
5. Member's group status = 'active'

If any condition fails → loan status = `rejected` with clear reason.

### 5.4 Interest Rates (Fixed for MVP)

| Term | Rate | Example on 75,000 BIF |
|------|------|----------------------|
| 7 days | 6% | Interest = 4,500 → Total = 79,500 BIF |
| 14 days | 5% | Interest = 3,750 → Total = 78,750 BIF |
| 30 days | 4% | Interest = 3,000 → Total = 78,000 BIF |

### 5.5 Collateral Lock & Release

- On loan disbursal: `lockedSavings += loanAmount`
- On full repayment: `lockedSavings -= loanAmount` (released back)
- Withdrawal is blocked against locked savings at all times

### 5.6 Withdrawal Rules

- Available to withdraw: `personalSavings − lockedSavings`
- Minimum balance that must remain: **5,000 BIF**
- Withdrawal is a transaction recorded by an agent
- Large withdrawals (> 50,000 BIF) flagged to Super Admin for review
- **No withdrawal of savings held at Umuco without Kirimba Admin approval**

### 5.7 Kirimba Fund Management

- Super Admin / Finance role manages the loan fund
- Fund is topped up manually (Admin records a top_up fundMovement)
- Every loan disbursal: `availableFund -= loanAmount`
- Every repayment received: `availableFund += repaymentAmount`
- Admin can see fund health: total, deployed, available, collateral ratio

---

## 6. Application Interfaces (5 Apps)

All hosted on Firebase Hosting as separate paths. All are **responsive web apps**.

| App | Path | Users | Primary Device |
|-----|------|-------|---------------|
| Member App | `/app` | Members + Leaders | Mobile phone |
| Agent Interface | `/agent` | Agents | Tablet / phone |
| Admin Portal | `/admin` | Super Admin, Finance | Laptop |
| Umuco Dashboard | `/umuco` | Umuco Staff | Laptop / tablet |
| Leader View | `/leader` | Group Leaders | Mobile / tablet |

> Leader View is a separate path from the Member App for clarity, though the same user logs in with the same credentials. Role-based routing handles this automatically.

---

## 7. Screen Specifications

### 7.1 Member App (`/app`)

**Screen: Login / Register**
- Toggle: "Log In" / "Create Account"
- Create Account fields: Full Name, Phone Number, National ID (optional), PIN (4-digit, confirm PIN)
- On submit: account created with status = `pending_approval`
- Member sees holding screen: "Account under review — we'll notify you when approved"
- Log In: Phone + PIN

**Screen: Pending Approval Screen**
- Friendly waiting message
- Contact info for help
- Auto-redirects to Dashboard when status becomes `active`

**Screen: Join a Group**
- Shown after approval if member has no group
- Enter 6-character Group Code
- Shows group name + leader name for confirmation
- Submits join request → Leader sees it and confirms

**Screen: Dashboard (Home)**
- Savings card: My Savings | Pending | Locked | Available
- Credit card: Credit Limit | Available to Borrow
- Active Loan banner (if exists): Amount Due / Due Date / Days Left / % Repaid
- Group card: Group Name + Total Group Savings (not individual breakdowns)
- Quick actions: Request Loan / View Transactions

**Screen: Request a Loan**
- Amount slider (max = availableCredit)
- Term selector: 7 / 14 / 30 days
- Live calculator: Interest + Total Due + Due Date
- Purpose field (free text)
- Submit → APPROVED (with details + receipt) or DECLINED (with reason)
- Approved loan status = `pending` until agent disburses

**Screen: Transactions**
- Chronological list with filter: All / Savings / Loans
- Each row: date, type, amount, status (pending/confirmed), balance after, receipt no.

**Screen: My Loans**
- Active tab: current loan, progress bar, due date, repayment history
- History tab: all past loans, status badges

**Screen: Profile**
- Name, phone (read-only), change PIN, group info

---

### 7.2 Agent Interface (`/agent`)

**Screen: Login**
- Phone + PIN (agent accounts created by Admin only)

**Screen: Dashboard**
- Quick action buttons: Deposit | Withdraw | Disburse Loan | Record Repayment | Assist Registration
- Today's summary: # transactions / cash in / cash out / batch status

**Screen: Find Member**
- Search by phone or name (searches across ALL groups)
- Shows member card: name, group, savings, credit limit, active loan status

**Screen: Record Deposit**
- Find member → enter amount → optional notes → confirm
- Creates transaction (status = `pending_umuco`)
- System prompts: "Add to existing batch or start new batch for [Group Name]?"
- Receipt shown + shareable text format

**Screen: Record Withdrawal**
- Find member → enter amount → system checks available balance → confirm
- Blocked with reason if insufficient available balance

**Screen: Disburse Loan**
- Find member → see pending loan → shows all details
- Agent confirms "Cash Handed Over" → loan moves to `active`
- Kirimba fund: `availableFund -= loanAmount`

**Screen: Record Repayment**
- Find member → shows active loan: remaining balance, due date
- Enter amount received (partial or full)
- Full repayment: loan → `repaid`, collateral released

**Screen: Submit Deposit Batch**
- Shows all pending deposits the agent has recorded for a group
- Agent reviews total → submits batch to Umuco
- Batch status → `submitted`

**Screen: Assist Registration**
- Opens a guide/walkthrough the agent can follow alongside the member
- Member does the actual registration on their own phone
- Agent can share the app link via WhatsApp

---

### 7.3 Admin Portal (`/admin`)

**Screen: Dashboard**
- Platform summary: total members, total groups, total savings (confirmed), Kirimba fund status
- Alerts: pending member approvals, pending group approvals, overdue loans, low fund warning
- Recent activity feed

**Screen: Approve Members**
- Queue of pending member accounts
- View details → Approve / Reject (with reason)
- Bulk approve option

**Screen: Approve Groups**
- Queue of pending group applications
- View group info + leader profile → Approve / Reject

**Screen: Members**
- Full member list with search and filters
- View any member: all details, savings, loans, transactions
- Actions: Suspend / Reactivate / Reset PIN

**Screen: Groups**
- All groups table: name, leader, member count, savings, active loans
- Click into group: full member breakdown + transaction log

**Screen: Agents**
- Create new agent accounts
- View agent activity: transactions recorded per agent, batches submitted
- Suspend / Reactivate agents

**Screen: Loan Fund Management**
- Kirimba fund card: Total / Deployed / Available / Collateral at Umuco
- Top Up Fund: enter amount + description → recorded as fundMovement
- Fund history: all movements in/out
- Collateral coverage ratio: (totalSavings at Umuco / totalDeployed)
- Warning if available fund falls below threshold (configurable)

**Screen: Loans Overview**
- All loans across platform: filter by status, group, date
- Overdue loans highlighted with days past due
- Admin can manually update loan status in exceptional cases

**Screen: Withdrawal Approvals**
- Queue of large withdrawals (> 50,000 BIF) awaiting admin review
- Approve / Reject with notes

**Screen: Transactions Log**
- Full audit log across all groups, agents, members
- Filters: group / agent / type / date / status
- Export to CSV

---

### 7.4 Umuco Dashboard (`/umuco`)

**Screen: Login**
- Email + Password (Umuco staff accounts created by Admin)

**Screen: Overview**
- Total deposits held across all groups
- Pending batches awaiting confirmation
- Confirmed deposits this month
- Group breakdown: each group's account balance

**Screen: Deposit Batches**
- List of submitted batches: group name, agent, amount, # of members, date submitted
- Status: `submitted` / `confirmed` / `flagged`
- Click batch: see individual transaction breakdown
- Actions per batch:
  - **Confirm**: "We have received this cash and credited the Umuco account" → batch status = `confirmed`, members' savings updated
  - **Flag**: Add note explaining the discrepancy → batch status = `flagged`, Admin alerted

**Screen: Confirmed Deposits History**
- Full history of all confirmed batches
- Searchable / filterable by group / date / amount
- Internal reference number field (Umuco can enter their own ref after confirming)

**Screen: Flagged Items**
- All flagged batches with notes
- Status updated to resolved by Admin once addressed

> Umuco staff **cannot** initiate any withdrawals or move funds. They can only confirm or flag incoming deposit batches.

---

### 7.5 Leader View (`/leader`)

**Screen: My Group Dashboard**
- Group name, code (to share with recruits), member count
- Total group savings, pending savings, active loans count
- Join requests: list of members who entered the group code → Leader confirms/rejects each

**Screen: Member Directory**
- All group members: name, savings amount, credit limit, loan status (active/none/overdue)
- No individual transaction details shown (member privacy)

**Screen: Overdue Alerts**
- Members with loans past due date
- Can see: member name, amount overdue, days past due
- Can add a note visible to Admin (not a financial action)

---

## 8. Cloud Functions (Complete List)

All functions are Firebase Cloud Functions (Node.js). All financial logic lives here.

### Member & Auth Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `registerMember` | HTTPS | Creates user, sets status=pending, hashes PIN |
| `approveMember` | HTTPS | Admin only — sets status=active |
| `joinGroup` | HTTPS | Member enters group code → creates join request |
| `approveJoinRequest` | HTTPS | Leader confirms → creates groupMember record |
| `resetPIN` | HTTPS | Admin/Agent only — resets member PIN |

### Savings Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `recordDeposit` | HTTPS | Agent records cash deposit — creates transaction (pending_umuco), updates pendingSavings |
| `recordWithdrawal` | HTTPS | Agent records cash withdrawal — validates balance rules |
| `submitBatch` | HTTPS | Agent submits deposit batch to Umuco |
| `confirmBatch` | HTTPS | Umuco staff — confirms batch → activates savings, updates creditLimit |
| `flagBatch` | HTTPS | Umuco staff — flags batch, alerts admin |

### Loan Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `requestLoan` | HTTPS | Member requests loan — auto-approve logic runs here |
| `disburseLoan` | HTTPS | Agent confirms cash handed over — locks collateral, deploys fund |
| `recordRepayment` | HTTPS | Agent records repayment — releases collateral on full repayment |
| `markLoanDefaulted` | Scheduled | Runs daily — flags loans past due date + no payment |

### Fund Management Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `topUpFund` | HTTPS | Admin only — adds to Kirimba loan fund |
| `getFundStatus` | HTTPS | Returns current fund: total, deployed, available, collateral |

### Utility Functions

| Function | Trigger | Description |
|----------|---------|-------------|
| `generateReceipt` | Internal | Creates receipt object for any transaction |
| `sendNotification` | Firestore trigger | On status change — pushes in-app notification |

---

## 9. Firebase Security Rules (Firestore)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function getRole() {
      return get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role;
    }

    function isAdmin() { return getRole() == 'super_admin'; }
    function isAgent() { return getRole() == 'agent'; }
    function isUmuco() { return getRole() == 'umuco'; }
    function isFinance() { return getRole() == 'finance' || isAdmin(); }

    function isMemberOf(groupId) {
      return exists(/databases/$(database)/documents/groupMembers/$(request.auth.uid + '_' + groupId));
    }

    function isLeaderOf(groupId) {
      return get(/databases/$(database)/documents/groups/$(groupId)).data.leaderId == request.auth.uid;
    }

    // Users: read own profile, admin reads all
    match /users/{userId} {
      allow read: if request.auth.uid == userId || isAdmin() || isAgent();
      allow write: if false; // Cloud Functions only
    }

    // Groups: members/leaders read their group, admin reads all
    match /groups/{groupId} {
      allow read: if isMemberOf(groupId) || isAdmin() || isAgent() || isUmuco();
      allow write: if false;
    }

    // GroupMembers: own record, leader of group, admin, agent
    match /groupMembers/{doc} {
      allow read: if resource.data.userId == request.auth.uid
                  || isLeaderOf(resource.data.groupId)
                  || isAdmin() || isAgent();
      allow write: if false;
    }

    // Transactions: own transactions, agents, umuco, admin
    match /transactions/{doc} {
      allow read: if resource.data.userId == request.auth.uid
                  || isAdmin() || isAgent() || isUmuco()
                  || isLeaderOf(resource.data.groupId);
      allow write: if false;
    }

    // Loans: own loans, leader of group, admin, agent
    match /loans/{doc} {
      allow read: if resource.data.userId == request.auth.uid
                  || isAdmin() || isAgent()
                  || isLeaderOf(resource.data.groupId);
      allow write: if false;
    }

    // Deposit Batches: agents, umuco, admin
    match /depositBatches/{doc} {
      allow read: if isAdmin() || isAgent() || isUmuco();
      allow write: if false;
    }

    // Kirimba Fund: admin and finance only
    match /kirimbaFund/{doc} {
      allow read: if isAdmin() || isFinance();
      allow write: if false;
    }

    match /fundMovements/{doc} {
      allow read: if isAdmin() || isFinance();
      allow write: if false;
    }
  }
}
```

---

## 10. Authentication Design

- All users authenticate with **Phone Number + 4-digit PIN**
- PIN is not stored raw — stored as a SHA-256 hash in the user document
- Firebase Auth is used for the session token only; PIN validation happens in Cloud Function
- Custom claims on the Firebase token carry the role: `{ role: 'member' }`, `{ role: 'agent' }` etc.
- App reads role claim on login and routes to correct interface

**Simplified PIN Auth for MVP:**
- Email field in Firebase Auth = `phone@kirimba.app` (e.g. `+25779123456@kirimba.app`)
- Password = hashed PIN (validated server-side)
- Avoids SMS OTP cost during pilot testing
- Can be upgraded to proper phone OTP later

---

## 11. Receipt Format

```
================================
        KIRIMBA RECEIPT
================================
Receipt No:    TXN-2025-00142
Date:          12 Feb 2025, 10:32
--------------------------------
Member:        Marie Niyonzima
Phone:         +25779 XXX XXX
Group:         Siyoni Women Traders
Agent:         Jean-Pierre K.
--------------------------------
Type:          DEPOSIT
Amount:        +10,000 BIF
Status:        PENDING UMUCO CONFIRMATION
Balance After: (updates after confirmation)
================================
KIRIMBA · Help: 0800-KIRIMBA
================================
```

---

## 12. Build Order (Phases)

| Phase | What to Build | Done When |
|-------|-------------|-----------|
| 1 | Firebase project, Firestore collections, Security Rules, Auth | Can create test users and read/write data in emulator |
| 2 | Cloud Functions: registerMember, approveMember, joinGroup, approveJoinRequest | Member registration flow works end-to-end |
| 3 | Cloud Functions: recordDeposit, submitBatch, confirmBatch (savings pipeline) | Deposit flows from agent → pending → Umuco confirms → balance updates |
| 4 | Cloud Functions: requestLoan, disburseLoan, recordRepayment | Full loan lifecycle works |
| 5 | Cloud Functions: topUpFund, getFundStatus, markLoanDefaulted (scheduled) | Fund management works |
| 6 | Agent Interface: Login, Find Member, Deposit, Withdraw, Submit Batch | Agent can serve a member |
| 7 | Member App: Login, Register, Pending Screen, Join Group, Dashboard | Member can register and see their balance |
| 8 | Member App: Request Loan, Loan Confirmation, Transactions, My Loans | Full member journey works |
| 9 | Umuco Dashboard: Login, Batches, Confirm/Flag, History | Umuco can confirm deposits |
| 10 | Admin Portal: Approvals, Members, Groups, Fund Management, Loans Overview | Admin has full oversight |
| 11 | Leader View: Group Dashboard, Join Requests, Member Directory | Leaders can manage their groups |
| 12 | Polish: error messages, receipts, mobile responsiveness, notifications | Ready for pilot |

---

## 13. Out of Scope for MVP

| Feature | Reason Excluded |
|---------|----------------|
| Mobile money API (Lumicash/EcoCash) | Agent cash model used for pilot |
| SMS notifications | In-app notifications only for pilot |
| USSD / feature phone access | Web app only |
| Group voting on loans | Auto-approval only |
| Multiple groups per member | One group per member in pilot |
| WhatsApp chatbot | Post-MVP |
| AI/ML credit scoring | Fixed rules for pilot |
| Loan restructuring / hardship requests | Post-MVP |
| Leader election process | Leader = group creator in MVP |
| Insurance products | Post-MVP |

---

*KIRIMBA MVP Technical Specification v1.0 — Confidential*
