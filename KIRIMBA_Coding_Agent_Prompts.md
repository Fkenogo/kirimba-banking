# KIRIMBA — Coding Agent Prompts
**How to use this file:** Copy the prompt for each phase and paste it into your coding agent (Cursor, Google IDX AI, GitHub Copilot Chat, or Claude). Work through the phases in order. Each phase builds on the previous one.

---

## MASTER CONTEXT PROMPT
*Paste this first in every new session with a coding agent, before any phase prompt.*

```
I am building KIRIMBA — a digital group savings and lending platform for informal market vendors in Burundi.

TECH STACK:
- Firebase Firestore (database)
- Firebase Authentication (user sessions)
- Firebase Cloud Functions (Node.js — all business logic)
- Firebase Hosting (web apps)
- React + Vite + TailwindCSS (frontend)

BUSINESS MODEL:
- Members save money through field Agents (cash in/out)
- Savings are held at Umuco Microfinance (licensed deposit-taking institution)
- Umuco must confirm each deposit batch before savings count as collateral
- Kirimba gives loans from its own fund, backed by savings held at Umuco
- Credit limit = personal confirmed savings × 1.5
- Loans are auto-approved if within credit limit and fund is available

ROLES: super_admin | agent | member | leader | umuco | finance

CRITICAL RULES:
- All financial writes (balances, savings, loans) happen ONLY in Cloud Functions — never from client code
- Deposits have two stages: Agent records (pending) → Umuco confirms (confirmed)
- Members self-register; Super Admin approves accounts
- Agents are free-floating — not tied to any group
- Group Leaders are members who created a group

The working directory is already set up with a Firebase project. Follow my instructions step by step and ask me before making assumptions about business rules.
```

---

## PHASE 1 — Firebase Project Structure & Firestore Schema

```
Using the MASTER CONTEXT above, set up the foundational Firebase project structure.

TASK: Create the Firestore collections with proper structure.

Create the following files:
1. `firestore.rules` — Security rules for all collections
2. `firestore.indexes.json` — Composite indexes needed for queries
3. `functions/src/constants.js` — Shared constants (roles, statuses, interest rates, etc.)
4. `functions/src/validators.js` — Input validation helpers

FIRESTORE COLLECTIONS TO CREATE (as seed data / schema comments):
- users
- groups
- groupMembers
- transactions
- loans
- depositBatches
- kirimbaFund
- fundMovements

COLLECTION SCHEMAS:

users/{userId}:
  fullName: string
  phone: string (+25779XXXXXXX format)
  nationalId: string | null
  role: 'super_admin' | 'leader' | 'agent' | 'member' | 'umuco' | 'finance'
  status: 'pending_approval' | 'active' | 'suspended'
  groupId: string | null
  isLeader: boolean
  ledGroupId: string | null
  pinHash: string
  createdAt: timestamp
  approvedAt: timestamp | null

groups/{groupId}:
  name: string
  groupCode: string (6-char e.g. KRM-847)
  description: string
  leaderId: string
  status: 'pending_approval' | 'active' | 'suspended'
  totalSavings: number (BIF, confirmed only)
  pendingSavings: number (BIF, awaiting Umuco)
  memberCount: number
  umucoAccountNo: string
  createdAt: timestamp
  approvedAt: timestamp | null

groupMembers/{memberId}:
  userId: string
  groupId: string
  personalSavings: number (confirmed BIF)
  pendingSavings: number (awaiting Umuco)
  lockedSavings: number (as loan collateral)
  creditLimit: number (= personalSavings × 1.5)
  availableCredit: number (= creditLimit - lockedSavings)
  joinedAt: timestamp
  isActive: boolean

transactions/{txnId}:
  memberId: string
  userId: string
  groupId: string
  type: 'deposit' | 'withdrawal' | 'loan_disburse' | 'loan_repay'
  amount: number
  status: 'pending_umuco' | 'confirmed' | 'rejected'
  recordedBy: string (agentId)
  channel: 'agent' | 'umuco_branch'
  batchId: string | null
  notes: string
  receiptNo: string (TXN-YYYY-NNNNN)
  balanceBefore: number
  balanceAfter: number (updated after confirmation for deposits)
  createdAt: timestamp

loans/{loanId}:
  memberId: string
  userId: string
  groupId: string
  amount: number
  interestRate: number (0.06 = 6%)
  interestAmount: number
  totalDue: number
  termDays: 7 | 14 | 30
  dueDate: timestamp
  status: 'pending' | 'active' | 'repaid' | 'defaulted' | 'rejected'
  rejectionReason: string | null
  approvalType: 'auto'
  disbursedBy: string | null
  disbursedAt: timestamp | null
  paidAmount: number
  remainingDue: number
  purpose: string
  fundSource: 'kirimba_fund'
  createdAt: timestamp

depositBatches/{batchId}:
  groupId: string
  agentId: string
  transactionIds: string[]
  totalAmount: number
  memberCount: number
  status: 'submitted' | 'confirmed' | 'flagged'
  submittedAt: timestamp
  confirmedBy: string | null
  confirmedAt: timestamp | null
  umucoNotes: string | null
  umucoAccountRef: string | null

kirimbaFund/current (single document):
  totalFund: number
  deployedFund: number
  availableFund: number
  totalCollateral: number
  lastUpdated: timestamp
  updatedBy: string

fundMovements/{movementId}:
  type: 'top_up' | 'withdrawal' | 'loan_out' | 'repayment_in'
  amount: number
  description: string
  loanId: string | null
  recordedBy: string
  createdAt: timestamp

SECURITY RULES:
- members read their own user doc, their own groupMember, their own transactions and loans
- agents read all users, all groupMembers, all transactions, all loans (to serve any member)
- leaders read all groupMembers and loans within their group only
- umuco reads all transactions, depositBatches, groups
- admin reads and triggers writes on everything
- NO client-side writes to financial fields — only Cloud Functions write to balances

Also create a `functions/src/utils.js` file with:
- generateReceiptNo(type) → returns "TXN-2025-00001" format using Firestore counter
- generateGroupCode() → returns 6-char code like "KRM-847"
- hashPIN(pin) → SHA-256 hash of the PIN string
- calculateCreditLimit(personalSavings) → personalSavings * 1.5
- calculateInterest(amount, termDays) → { rate, interestAmount, totalDue } based on: 7d=6%, 14d=5%, 30d=4%
```

---

## PHASE 2 — Member Registration & Group Cloud Functions

```
Using the MASTER CONTEXT, build the member registration and group management Cloud Functions.

FILE: functions/src/members.js

Build these HTTPS callable Cloud Functions:

1. registerMember(data)
   Input: { fullName, phone, nationalId, pin, groupCodeToJoin (optional) }
   Logic:
   - Validate all inputs (phone format, PIN is 4 digits)
   - Check phone number not already registered
   - Create Firebase Auth user (email = phone + '@kirimba.app', password = hashed PIN)
   - Create users/{userId} document with status='pending_approval', role='member'
   - Hash the PIN using SHA-256 and store in user doc
   - If groupCodeToJoin provided, save it — member will join after approval
   - Return: { success: true, userId }

2. approveMember(data)
   Auth: super_admin only
   Input: { userId }
   Logic:
   - Set user.status = 'active', user.approvedAt = now()
   - Set custom claim on Firebase Auth token: { role: 'member' }
   - If user had a saved groupCodeToJoin, create a join request automatically
   - Return: { success: true }

3. rejectMember(data)
   Auth: super_admin only
   Input: { userId, reason }
   Logic:
   - Set user.status = 'rejected', store reason
   - Return: { success: true }

4. createGroup(data)
   Auth: active member only
   Input: { name, description }
   Logic:
   - Generate a unique group code (e.g. KRM-847)
   - Create group document with status='pending_approval', leaderId = calling user's uid
   - Set calling user's isLeader=true, ledGroupId = new groupId
   - Return: { success: true, groupId, groupCode }

5. approveGroup(data)
   Auth: super_admin only
   Input: { groupId, umucoAccountNo }
   Logic:
   - Set group.status = 'active', group.umucoAccountNo
   - Update leader's custom claim: { role: 'leader' }
   - Return: { success: true }

6. joinGroup(data)
   Auth: active member only
   Input: { groupCode }
   Logic:
   - Find group by groupCode
   - Validate group is active
   - Check member not already in a group
   - Create a joinRequest sub-document (pending leader approval)
   - Notify the leader (in-app notification)
   - Return: { success: true, groupName, leaderName }

7. approveJoinRequest(data)
   Auth: group leader only
   Input: { joinRequestId, userId }
   Logic:
   - Validate caller is leader of that group
   - Create groupMembers document with all savings fields at 0
   - Update user.groupId = groupId
   - Increment group.memberCount
   - Return: { success: true }

8. resetPIN(data)
   Auth: super_admin or agent only
   Input: { userId, newPIN }
   Logic:
   - Hash new PIN
   - Update Firebase Auth password and user.pinHash
   - Return: { success: true }

9. getPendingApprovals()
   Auth: super_admin only
   Logic:
   - Return all users with status='pending_approval'
   - Return all groups with status='pending_approval'

Export all functions from functions/index.js
```

---

## PHASE 3 — Savings & Deposit Batch Cloud Functions

```
Using the MASTER CONTEXT, build the savings and deposit batch Cloud Functions.

FILE: functions/src/savings.js

IMPORTANT RULE: Deposits have TWO stages:
Stage 1: Agent records → transaction.status = 'pending_umuco', member.pendingSavings increases
Stage 2: Umuco confirms batch → transaction.status = 'confirmed', member.personalSavings increases, creditLimit recalculated

Build these functions:

1. recordDeposit(data)
   Auth: agent only
   Input: { userId, amount, notes, channel ('agent' | 'umuco_branch') }
   Logic:
   - Validate: userId exists and is active, amount > 0
   - Find groupMember record for this userId
   - Generate receiptNo
   - Create transaction document:
       type: 'deposit'
       status: 'pending_umuco'
       balanceBefore: current personalSavings
       balanceAfter: null (set after confirmation)
       batchId: null (set when agent submits batch)
   - Update groupMember: pendingSavings += amount
   - Update group: pendingSavings += amount
   - Return: receipt object

2. recordWithdrawal(data)
   Auth: agent only
   Input: { userId, amount, notes }
   Logic:
   - Find groupMember record
   - availableToWithdraw = personalSavings - lockedSavings
   - Validate: availableToWithdraw - amount >= 5000 (minimum balance)
   - If amount > 50000: create withdrawalRequest for Admin approval, return 'pending_approval' status
   - Otherwise: process immediately
   - Create transaction: type='withdrawal', status='confirmed' (withdrawals don't need Umuco confirmation)
   - Update groupMember: personalSavings -= amount, creditLimit recalculated
   - Update group: totalSavings -= amount
   - Return: receipt object or approval_pending status

3. submitBatch(data)
   Auth: agent only
   Input: { groupId, transactionIds[] }
   Logic:
   - Validate all transactions exist, are type='deposit', status='pending_umuco', belong to this groupId
   - Calculate totalAmount = sum of all transaction amounts
   - Create depositBatch document: status='submitted'
   - Update each transaction: batchId = new batchId
   - Return: { batchId, totalAmount, memberCount, submittedAt }

4. confirmBatch(data)
   Auth: umuco only
   Input: { batchId, umucoAccountRef, notes (optional) }
   Logic:
   - Validate batch exists and status='submitted'
   - For each transaction in batch:
       - transaction.status = 'confirmed'
       - transaction.balanceAfter = current personalSavings + amount
       - groupMember.personalSavings += amount
       - groupMember.pendingSavings -= amount
       - groupMember.creditLimit = personalSavings * 1.5
       - groupMember.availableCredit = creditLimit - lockedSavings
   - Update group: totalSavings += totalAmount, pendingSavings -= totalAmount
   - Update kirimbaFund: totalCollateral = recalculated from all group totalSavings
   - Set batch: status='confirmed', confirmedBy=umucoUserId, confirmedAt=now, umucoAccountRef
   - Return: { success: true, totalConfirmed, groupsUpdated }

5. flagBatch(data)
   Auth: umuco only
   Input: { batchId, notes }
   Logic:
   - Set batch status = 'flagged', umucoNotes = notes
   - Do NOT update any savings balances
   - Create admin alert in Firestore (notifications collection)
   - Return: { success: true }

6. getBatchesForGroup(data)
   Auth: agent, admin, umuco
   Input: { groupId, status (optional filter) }
   Logic:
   - Return all depositBatches for this group, filtered by status if provided

All functions use Firestore transactions (db.runTransaction) where multiple documents are updated together to prevent inconsistency.
```

---

## PHASE 4 — Loan Cloud Functions

```
Using the MASTER CONTEXT, build the loan Cloud Functions.

FILE: functions/src/loans.js

Build these functions:

1. requestLoan(data)
   Auth: active member only
   Input: { amount, termDays (7|14|30), purpose }
   Logic:
   - Get calling user's groupMember record
   - Get kirimbaFund/current document
   - AUTO-APPROVAL CHECKS (all must pass):
     a. amount <= groupMember.availableCredit
     b. No other loan with status='active' or status='pending' for this member
     c. kirimbaFund.availableFund >= amount
     d. member status='active' and group status='active'
   - If any check fails:
     - Create loan with status='rejected', rejectionReason = specific message
     - Return: { approved: false, reason: 'clear human-readable message' }
   - If all checks pass:
     - Calculate interest: 7d=6%, 14d=5%, 30d=4%
     - dueDate = now + termDays
     - Create loan document with status='pending' (pending = approved but not disbursed yet)
     - Return: { approved: true, loanId, amount, interestAmount, totalDue, dueDate, termDays }

2. disburseLoan(data)
   Auth: agent only
   Input: { loanId }
   Logic:
   - Validate loan exists and status='pending'
   - Use Firestore transaction:
     - loan.status = 'active'
     - loan.disbursedBy = agentId
     - loan.disbursedAt = now()
     - groupMember.lockedSavings += loan.amount
     - groupMember.availableCredit = creditLimit - lockedSavings
     - kirimbaFund.deployedFund += loan.amount
     - kirimbaFund.availableFund -= loan.amount
     - Create transaction document: type='loan_disburse', status='confirmed'
     - Create fundMovement: type='loan_out', amount=loan.amount, loanId
   - Return: receipt object with loan details

3. recordRepayment(data)
   Auth: agent only
   Input: { loanId, amount, channel ('agent' | 'umuco_branch') }
   Logic:
   - Validate loan exists and status='active'
   - Validate amount > 0 and amount <= loan.remainingDue
   - Use Firestore transaction:
     - loan.paidAmount += amount
     - loan.remainingDue = loan.totalDue - loan.paidAmount
     - If loan.paidAmount >= loan.totalDue:
         loan.status = 'repaid'
         groupMember.lockedSavings -= loan.amount (release collateral)
         groupMember.availableCredit recalculated
     - kirimbaFund.deployedFund -= amount
     - kirimbaFund.availableFund += amount
     - Create transaction: type='loan_repay', status='confirmed'
     - Create fundMovement: type='repayment_in', amount, loanId
   - Return: receipt + updated loan status

4. markLoanDefaulted — Scheduled Function (runs daily at 6am Bujumbura time)
   Logic:
   - Query all loans where status='active' AND dueDate < now()
   - For each: update status='defaulted'
   - Create admin notification for each defaulted loan
   - Do NOT release collateral on default

5. getMemberLoans(data)
   Auth: member (own loans), agent, leader (group loans), admin
   Input: { userId, status (optional) }
   Logic:
   - Return loans filtered by userId and optional status
   - Ordered by createdAt desc

6. getLoansByGroup(data)
   Auth: leader (own group), agent, admin
   Input: { groupId, status (optional) }
   Logic:
   - Return all loans for members of this group
```

---

## PHASE 5 — Fund Management Cloud Functions

```
Using the MASTER CONTEXT, build the Kirimba fund management Cloud Functions.

FILE: functions/src/fund.js

Build these functions:

1. topUpFund(data)
   Auth: super_admin or finance only
   Input: { amount, description }
   Logic:
   - Validate amount > 0
   - Use Firestore transaction:
     - kirimbaFund.totalFund += amount
     - kirimbaFund.availableFund += amount
     - kirimbaFund.lastUpdated = now(), updatedBy = caller uid
   - Create fundMovement: type='top_up', amount, description
   - Return: updated fund status

2. getFundStatus()
   Auth: admin, finance only
   Logic:
   - Return kirimbaFund/current document
   - Also return: collateral coverage ratio (totalCollateral / deployedFund)
   - Return: fund health status ('healthy' | 'low' | 'critical') based on:
     - healthy: availableFund > 20% of totalFund
     - low: availableFund 5-20% of totalFund
     - critical: availableFund < 5% of totalFund

3. getFundMovements(data)
   Auth: admin, finance
   Input: { limit (default 50), startAfter (pagination) }
   Logic:
   - Return fundMovements ordered by createdAt desc

4. approveWithdrawal(data)
   Auth: super_admin only
   Input: { transactionId, approved (boolean), notes }
   Logic:
   - If approved: process the withdrawal (update member balances, create confirmed transaction)
   - If rejected: mark transaction as rejected, notify member via in-app notification

Export all functions and wire up in functions/index.js:
- All HTTPS callable functions
- Scheduled function: markLoanDefaulted (schedule: 'every day 06:00' using Africa/Bujumbura timezone)
```

---

## PHASE 6 — Agent Interface (Frontend)

```
Using the MASTER CONTEXT, build the Agent web interface.

LOCATION: apps/agent/
FRAMEWORK: React + Vite + TailwindCSS
ROUTING: React Router v6

The agent interface lives at /agent on Firebase Hosting.

DESIGN PRINCIPLES:
- Large, touch-friendly buttons (agents use tablets/phones in noisy market environments)
- High contrast, very readable
- Operations should be completable in as few taps as possible
- Show confirmation screens before any financial action
- Show clear success/error states
- Brand colors: Green (#1A7A4A) primary, White backgrounds, Dark text

BUILD THESE SCREENS:

1. /agent/login
   - Phone number input + 4-digit PIN keypad (big buttons)
   - Error: wrong credentials shown clearly
   - On success: navigate to /agent/home

2. /agent/home (Dashboard)
   - Header: "Good morning, [Agent Name]" + logout
   - Large action buttons in a 2x3 grid:
     [Deposit] [Withdraw]
     [Disburse Loan] [Record Repayment]
     [Submit Batch] [Register Member]
   - Today's summary card: # transactions / BIF in / BIF out / pending batches

3. /agent/member/search
   - Search input: phone or name
   - Real-time results as user types (query Firestore directly)
   - Member card in results: photo placeholder, name, group, status indicator
   - Tap member → navigate to /agent/member/:userId

4. /agent/member/:userId
   - Member summary card: name, group, savings, credit limit, active loan status
   - Action buttons relevant to member state:
     - Always: [Deposit] [Withdraw]
     - If pending loan: [Disburse Loan]
     - If active loan: [Record Repayment]
   - Recent transactions (last 5)

5. /agent/deposit/:userId
   - Member info at top (name, current savings)
   - Amount input (numeric keypad, large)
   - Notes (optional)
   - Channel auto-set to 'agent'
   - [Preview Receipt] → shows confirmation screen
   - [Confirm Deposit] → calls recordDeposit Cloud Function
   - On success: show receipt screen

6. /agent/withdraw/:userId
   - Member info + available balance shown prominently
   - Amount input
   - Real-time validation: shows "Available: X BIF" and "Minimum balance: 5,000 BIF"
   - Red warning if amount would breach limits
   - [Confirm Withdrawal]

7. /agent/loan/disburse/:loanId
   - Loan summary: member, amount, interest, totalDue, dueDate, purpose
   - Large yellow warning: "You are about to hand over [amount] BIF in cash"
   - [Confirm Cash Handed Over] → calls disburseLoan
   - On success: show receipt

8. /agent/repayment/:userId
   - Shows active loan: totalDue, paidAmount, remainingDue, dueDate
   - Amount input (max = remainingDue)
   - Toggle: Full Repayment / Partial Repayment
   - [Confirm Repayment] → calls recordRepayment

9. /agent/batch/:groupId
   - Lists all pending (unsubmitted) deposits for this group
   - Total amount, member count
   - [Submit Batch to Umuco] → calls submitBatch
   - On success: show batch confirmation with summary

10. /agent/receipt/:txnId
    - Full receipt display in the text format defined in the spec
    - [Share as Text] button (copies WhatsApp-ready text to clipboard)
    - [New Transaction] button

Each screen should use a shared component: AgentLayout with back button and agent name in header.
Use React Query (TanStack Query) for data fetching.
Call Cloud Functions using Firebase SDK: httpsCallable(functions, 'functionName').
```

---

## PHASE 7 — Member App (Frontend)

```
Using the MASTER CONTEXT, build the Member web app.

LOCATION: apps/member/
FRAMEWORK: React + Vite + TailwindCSS
ROUTING: React Router v6

The member app lives at /app on Firebase Hosting.

DESIGN PRINCIPLES:
- Mobile-first (designed for 375px width, Android phones)
- Very large text for users who may not be tech-savvy
- Kiswahili/French labels where appropriate (add English fallback)
- Bottom navigation bar for main sections
- Simple, icon-heavy design

BUILD THESE SCREENS:

1. /app/login — Toggle: Login / Create Account

   LOGIN TAB:
   - Phone number field
   - 4-digit PIN keypad
   - [Log In] button
   - Error messages in plain language

   CREATE ACCOUNT TAB:
   - Full Name
   - Phone Number
   - National ID (optional — label: "Optional but recommended")
   - PIN (4 digits) + Confirm PIN
   - [Create Account] → calls registerMember
   - On success: navigate to pending screen

2. /app/pending
   - Large friendly icon (clock/hourglass)
   - Message: "Your account is being reviewed. We'll notify you as soon as it's ready — usually within 24 hours."
   - Show user's name and phone for reference
   - [Need help? Contact us] link
   - Auto-check status every 30 seconds and redirect to /app/join if approved

3. /app/join — Join a Group
   - Shown after approval when user has no group
   - Explanation: "Enter the Group Code your group leader gave you"
   - 6-character code input (auto-uppercase)
   - Shows group name + leader name on code validation (live lookup)
   - [Join Group] → calls joinGroup
   - On success: "Request sent to your group leader for approval"

4. /app/home — Dashboard
   Bottom nav: [Home] [Transactions] [Loans] [Profile]
   
   Content:
   - Greeting: "Hello, [First Name]!"
   - Savings Card (green): 
     My Savings: [personalSavings] BIF
     Pending: [pendingSavings] BIF (with info icon: "Awaiting Umuco confirmation")
     Locked: [lockedSavings] BIF
     Available: [personalSavings - lockedSavings] BIF
   - Credit Card (blue):
     Credit Limit: [creditLimit] BIF
     Available to Borrow: [availableCredit] BIF
   - Active Loan banner (orange, only if loan active):
     "You have an active loan"
     Amount Due: [remainingDue] BIF | Due: [dueDate]
     Progress bar: % repaid
   - Group card (small): [groupName] · [memberCount] members · [totalSavings] BIF total
   - [Request a Loan] big button (grayed out if active loan exists)

5. /app/loan/new — Request Loan
   - Amount slider (0 to availableCredit, snaps to 1000 BIF increments)
   - Manual amount input field (synced with slider)
   - Term buttons: [7 days] [14 days] [30 days]
   - Live calculator box (updates as user changes amount/term):
     Principal: X BIF
     Interest (6%): X BIF
     Total to Repay: X BIF
     Due Date: [date]
   - Purpose input (text, placeholder: "What will you use this for?")
   - [Submit Loan Request]
   - On result: navigate to /app/loan/result

6. /app/loan/result
   - APPROVED state:
     Green checkmark, "Loan Approved!"
     Loan details summary
     "Visit any agent to collect your cash. Show them this confirmation."
     Loan reference number (large, easy to read)
   - DECLINED state:
     Clear reason in simple language
     What to do next (e.g. "Repay your existing loan first" or "Your credit limit is X BIF")

7. /app/transactions
   - Filter tabs: All | Savings | Loans
   - Chronological list:
     Each item: icon (deposit=up arrow green, withdrawal=down arrow red, loan=bank icon)
     Date, type label, amount (colored), status badge (Confirmed/Pending), receipt no.
   - Pull to refresh

8. /app/loans
   - Tabs: [Active] [History]
   - Active tab: current loan card with progress bar, amount due, due date, repayment breakdown
   - History tab: list of past loans with status badges (Repaid/Defaulted)

9. /app/profile
   - Name (read-only), phone (read-only)
   - Group: [groupName] | Group Code: [code]
   - [Change PIN] — enter current PIN, new PIN, confirm
   - App version number at bottom

All amount displays: format as "12,500 BIF" with thousands separator.
All dates: format as "12 Feb 2025" (not US format).
```

---

## PHASE 8 — Umuco Dashboard (Frontend)

```
Using the MASTER CONTEXT, build the Umuco Microfinance dashboard.

LOCATION: apps/umuco/
FRAMEWORK: React + Vite + TailwindCSS

The Umuco dashboard lives at /umuco on Firebase Hosting.

USERS: Umuco staff (accounts created by Kirimba Admin)
DESIGN: Professional, desktop-first, clean table-heavy layout

BUILD THESE SCREENS:

1. /umuco/login
   - Email + Password (Umuco accounts use email, not phone)
   - Standard login form

2. /umuco/home — Overview
   - Summary cards:
     Total Deposits Held: [sum of all group totalSavings] BIF
     Pending Batches: [count] batches awaiting confirmation
     Confirmed This Month: [sum] BIF
     Flagged Items: [count] (red if > 0)
   - Groups table: Name | Account No | Balance | Last Deposit Date | Status

3. /umuco/batches — Deposit Batches (main working screen)
   - Filter tabs: [Pending] [Confirmed] [Flagged] [All]
   - Table columns: Date Submitted | Group | Agent | # Members | Total Amount | Status | Actions
   - For each 'submitted' batch:
     [View Details] → opens batch detail panel/modal
     
   BATCH DETAIL PANEL:
   - Group name, Umuco account number for this group
   - Agent who submitted
   - Transaction breakdown table: Member Name | Amount | Date Recorded
   - Total amount
   - Umuco Account Reference field (text input)
   - Notes field (optional)
   - [CONFIRM BATCH] button (green, prominent) → calls confirmBatch
   - [FLAG ISSUE] button (orange) → opens flag dialog → calls flagBatch
   
   CONFIRM flow:
   - Confirmation dialog: "You are confirming receipt of [amount] BIF for [group]. This will update [N] member savings balances."
   - [Confirm] → success toast → batch moves to Confirmed tab
   
   FLAG flow:
   - Text area: "Describe the issue"
   - [Submit Flag] → batch moves to Flagged tab, admin alerted

4. /umuco/history — Confirmed Deposits
   - Table: Batch Ref | Date Confirmed | Group | Amount | Account Ref | Confirmed By
   - Date range filter
   - Export to CSV button

5. /umuco/flagged — Flagged Items
   - Table of all flagged batches with notes
   - Status: Flagged / Resolved (admin marks resolved)
   - View details of each flagged batch

Keep the UI professional and audit-friendly. Umuco staff are financial professionals.
Every action should show a clear audit trail.
```

---

## PHASE 9 — Admin Portal (Frontend)

```
Using the MASTER CONTEXT, build the Admin portal.

LOCATION: apps/admin/
FRAMEWORK: React + Vite + TailwindCSS

The Admin portal lives at /admin on Firebase Hosting.

USERS: super_admin and finance roles
DESIGN: Desktop-first, data-dense, professional. Left sidebar navigation.

SIDEBAR NAVIGATION:
- Dashboard
- Approvals (with badge count for pending)
- Members
- Groups
- Agents
- Loan Fund
- Loans
- Transactions
- Withdraw Requests

BUILD THESE SCREENS:

1. /admin/login
   Standard login

2. /admin/dashboard
   Platform metrics:
   - Total Members (active) | Total Groups | Total Savings (BIF) | Total Loans Active
   - Kirimba Fund: Available / Deployed / Total (with health indicator)
   - Alert cards (highlighted): Pending Approvals | Overdue Loans | Flagged Batches | Low Fund Warning
   - Recent activity feed (last 20 actions across platform)
   - Chart: daily deposits vs daily repayments (last 30 days) — simple bar chart

3. /admin/approvals
   Two tabs: Members | Groups
   
   MEMBERS tab:
   - Table: Name | Phone | National ID | Registered At | Actions
   - [Approve] [Reject] buttons per row
   - Bulk select + bulk approve
   - Rejection opens dialog: enter reason

   GROUPS tab:
   - Table: Group Name | Leader | Created At | Actions
   - [Approve] (opens dialog to enter Umuco Account No) [Reject]

4. /admin/members
   - Search bar (name or phone)
   - Filter: All | Active | Suspended | Pending
   - Table: Name | Phone | Group | Savings | Credit Limit | Active Loan | Status | Actions
   - [View] → member detail page
   - [Suspend] [Reactivate] [Reset PIN]
   
   Member detail:
   - Full profile, savings breakdown, all loans, all transactions
   - Admin notes field (internal)

5. /admin/groups
   - Table: Group Name | Leader | Members | Total Savings | Active Loans | Status
   - [View] → group detail
   
   Group detail:
   - Group info, leader info
   - Member table with savings and loan status
   - Full transaction log for this group

6. /admin/agents
   - [Create New Agent] button (form: name, phone → creates agent account, auto-generates temp PIN)
   - Table: Name | Phone | Transactions Today | Transactions This Month | Status
   - [View Activity] [Suspend] [Reactivate]
   
   Agent activity:
   - All transactions recorded by this agent
   - Batches submitted

7. /admin/fund — Loan Fund Management (most important screen)
   - Large fund status card:
     TOTAL FUND: X BIF
     DEPLOYED (Active Loans): X BIF
     AVAILABLE: X BIF
     COLLATERAL AT UMUCO: X BIF
     COVERAGE RATIO: X% (total savings / deployed)
   - Health indicator: green/yellow/red
   - [TOP UP FUND] button → dialog: amount + description → calls topUpFund
   - Fund movement history table: Date | Type | Amount | Description | By
   - Chart: fund balance over time

8. /admin/loans
   - Filter: All | Active | Pending | Repaid | Defaulted | Rejected
   - Table: Member | Group | Amount | Total Due | Due Date | Status | Days Overdue
   - Overdue rows highlighted red
   - [View] → loan detail with full history
   - [Mark Repaid] (emergency manual override with audit note)
   - [Export CSV]

9. /admin/transactions
   - Full audit log
   - Filters: Group | Agent | Type | Status | Date Range
   - Table: Date | Receipt No | Member | Type | Amount | Status | Agent | Batch
   - [Export CSV]

10. /admin/withdrawals — Withdrawal Approvals
    - Queue of large withdrawal requests (> 50,000 BIF) pending approval
    - Member info, amount, reason
    - [Approve] [Reject with reason] → calls approveWithdrawal function
```

---

## PHASE 10 — Leader View (Frontend)

```
Using the MASTER CONTEXT, build the Leader view.

The leader uses the same login as a member (/app/login).
After login, if user.isLeader = true, show a "Leader Dashboard" link in their profile screen.
The leader view lives at /leader on Firebase Hosting (or can be part of the member app with role routing).

BUILD THESE SCREENS:

1. /leader/home — Group Dashboard
   - Group name, Group Code (shown with "Share" button that copies to clipboard)
   - Stats: Member Count | Total Group Savings | Active Loans | Overdue Loans
   - Pending join requests section:
     List of members waiting to join
     [Approve] [Decline] buttons per request

2. /leader/members — Member Directory
   - Table: Name | Savings (BIF) | Credit Limit | Loan Status | Member Since
   - Loan status: badge (No Loan / Active / Overdue)
   - Tapping a row shows: name, savings amount, loan status, days overdue (if any)
   - NO individual transaction history visible (privacy)

3. /leader/alerts — Overdue Loans
   - List of members with overdue loans
   - Columns: Name | Amount Overdue | Days Past Due
   - [Add Note for Admin] — free text note attached to the loan, visible only to Admin
   - No financial action possible here
```

---

## PHASE 11 — Final Setup & Deployment

```
Using the MASTER CONTEXT, configure the Firebase project for deployment.

TASK 1: Firebase Hosting Configuration
Create/update firebase.json to:
- Host /app → apps/member/dist
- Host /agent → apps/agent/dist
- Host /umuco → apps/umuco/dist
- Host /admin → apps/admin/dist
- Host /leader → apps/leader/dist (or handle in member app)
- All unknown routes → each app's index.html (SPA routing)
- Functions: use Node.js 18

TASK 2: Environment Variables
Create .env files for each app:
- VITE_FIREBASE_API_KEY
- VITE_FIREBASE_AUTH_DOMAIN
- VITE_FIREBASE_PROJECT_ID
- VITE_FIREBASE_STORAGE_BUCKET
- VITE_FIREBASE_MESSAGING_SENDER_ID
- VITE_FIREBASE_APP_ID
- VITE_APP_ENV = 'development' | 'production'

TASK 3: Build Scripts
In the root package.json, add build scripts:
- "build:all" → builds all 5 apps sequentially
- "build:member" / "build:agent" / "build:umuco" / "build:admin"
- "dev:all" → starts all apps on different ports (3001-3005)
- "deploy" → build:all then firebase deploy

TASK 4: Firestore Indexes
Add composite indexes needed for:
- transactions where groupId == X, ordered by createdAt desc
- loans where userId == X, status == Y, ordered by createdAt desc
- depositBatches where groupId == X, status == Y, ordered by submittedAt desc
- users where status == 'pending_approval', ordered by createdAt asc

TASK 5: Initial Data Seed
Create a script functions/src/seed.js that:
- Creates one Super Admin account (email + password from env variables)
- Creates the kirimbaFund/current document with totalFund = 0
- Logs: "KIRIMBA seed complete. Login with: [email] / [password]"
Run with: node functions/src/seed.js

TASK 6: Emulator Config
Update .firebaserc and firebase.json to support the local emulator suite:
- Auth emulator: port 9099
- Firestore emulator: port 8080
- Functions emulator: port 5001
- Hosting emulator: port 5000

Provide a README.md in the project root with:
1. Prerequisites
2. Local development setup commands
3. How to run with emulators
4. How to deploy to production
5. How to create the first admin account
```

---

## QUICK FIX PROMPTS

*Use these when you need targeted fixes without re-running a full phase.*

### Fix: Firestore Permission Denied Error
```
I'm getting a "permission denied" error from Firestore when [describe the action].
The current user role is [role].
Check my firestore.rules file and fix the rule that should allow this.
The function being called is [function name].
Show me exactly what rule to change.
```

### Fix: Cloud Function Error
```
My Cloud Function [function name] is throwing this error: [paste error]
Here is the function code: [paste code]
The inputs being passed are: [paste inputs]
Fix the error and explain what was wrong.
```

### Fix: Mobile Layout Issue
```
The [screen name] screen in the [member/agent] app doesn't look right on mobile.
The issue is: [describe issue]
The screen should work on a 375px wide Android phone.
Fix the Tailwind CSS classes to make it responsive and readable.
```

### Fix: Adding a Missing Feature
```
Using the MASTER CONTEXT, add the following feature to the [app name] app:
[Describe feature]
This feature should:
- [Requirement 1]
- [Requirement 2]
Follow the same patterns already established in the codebase.
```

---

*KIRIMBA Coding Agent Prompts v1.0*
