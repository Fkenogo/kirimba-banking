
# KIRIMBA PROJECT – COMPREHENSIVE DEVELOPMENT RESET & ARCHITECTURE SUMMARY

This document is intended to start a **fresh development conversation** with full context of the Kirimba project.

It summarizes:

• current system status  
• architecture  
• user roles and responsibilities  
• existing functionality  
• identified issues  
• final role model  
• dashboard responsibilities  
• institution model  
• operational flows  
• next development direction  

The goal is to **stop patching test data**, align architecture, finish dashboards, and then reset Firestore and reseed clean development data.

---

# 1. DEVELOPMENT WORKFLOW MODEL

Development must follow a strict collaboration loop:

1. ChatGPT analyzes issues and defines tasks.
2. ChatGPT produces a **clear prompt for the coding agent**.
3. Kenogo runs the prompt.
4. Coding agent returns:
   - report
   - terminal output
   - screenshots
   - errors
5. ChatGPT reviews results and defines next tasks.

Kenogo should **not be asked to debug architecture alone**.

The coding agent should perform technical checks whenever possible.

---

# 2. MAJOR DECISION: DEVELOPMENT RESET

The project has accumulated **inconsistent test data** due to architecture evolution.

Examples:
- old groups without institutionId
- legacy "umuco" role naming
- early single‑institution assumptions
- old deposit batches lacking institutionId
- raw IDs displayed instead of institution names

Because this is **still development**, the decision is:

**Do not repair old Firestore data.**

Instead:

1. Finish architecture and dashboard features.
2. Reset Firestore test data.
3. Recreate clean development data.

---

# 3. SYSTEM ARCHITECTURE (PLAIN ENGLISH)

```
MEMBER / LEADER APP
    |
    | register / join group / request loan / request withdrawal / view wallet
    v
USERS + GROUPS + WALLETS + TRANSACTIONS
    ^
    |
    | deposit scan / record deposit / repayments / disbursement / close day
    |
AGENT APP
    |
    | submit deposit batch
    v
DEPOSIT BATCHES
    ^
    |
    | confirm / flag / history / institution note
    |
INSTITUTION APP
    |
    | oversight / exceptions / approvals / control / loan ops
    v
ADMIN APP
```

Underlying layers:

```
Firestore = source of truth
Cloud Functions = business logic
Hosting Apps = role interfaces
Security Rules = access control
Indexes = query performance
```

---

# 4. FINAL ROLE MODEL

## Super Admin
Kirimba owner control and full business oversight.

Can:

• view all members  
• view all groups  
• view all agents  
• view all institutions  
• view all admins  
• view all loans  
• view all transactions  
• view all batches  
• view all reconciliations  
• view flagged exceptions  

Can manage:

• admins  
• agents  
• institution users  
• institutions  

Can configure:

• business rules  
• fees  
• commissions  
• loan rates  
• penalties  

Can monitor:

• exposure  
• defaults  
• liquidity  
• audit logs  

Super admin **should not directly alter financial transactions** without controlled adjustment workflows.

---

## Operations Admin

Internal Kirimba operational staff.

Can:

• approve members  
• approve groups  
• monitor deposits  
• review reconciliations  
• inspect flagged items  
• monitor loan operations  
• manage agents operationally  

Cannot:

• change business rules  
• change fees/rates  
• provision institutions  
• perform financial overrides

---

## Institution User

Partner institution staff (example: Umuco).

Can:

• confirm deposit batches  
• flag deposit batches  
• view institution‑specific history  
• review institution activity  

Cannot:

• manage Kirimba users  
• access other institutions  
• change business settings

---

## Agent

Field operations staff.

Can:

• record deposits  
• disburse loans  
• record repayments  
• process withdrawals  
• submit deposit batches  
• close daily reconciliation

---

## Leader

Group governance role inside the member app.

Can:

• approve join requests  
• manage group membership  
• share group code  
• manage group structure

---

## Member

End user.

Can:

• join group  
• view wallet  
• request loan  
• view transactions  
• request withdrawals  
• interact with agent for deposits

---

# 5. DASHBOARD STRUCTURE

## A. Executive Dashboard (Super Admin)

Key indicators:

• total members  
• active groups  
• confirmed savings  
• pending savings  
• outstanding loans  
• overdue loans  
• defaulted loans  
• deposits today  
• flagged batches  
• active agents  
• active institutions  

This answers:

**“What is happening in the business right now?”**

---

## B. Transaction Oversight

View‑only financial monitoring.

Shows:

• deposits  
• withdrawals  
• loan disbursements  
• repayments  
• reversals  
• flagged items  

Filters:

• date  
• institution  
• group  
• agent  
• member  
• status  

Export support required.

---

## C. User & Role Management

### Admin Management

• add admin  
• suspend admin  
• reactivate admin  
• assign permissions  

### Agent Management

• add agent  
• suspend agent  
• monitor performance  
• review reconciliation history  

### Institution Management

• add institution  
• suspend institution  
• create institution users  

### Member Oversight

• search member  
• view wallet  
• view group  
• view loan exposure  
• suspend member if needed  

---

## D. Group Governance

Shows:

• all groups  
• group leader  
• group size  
• savings totals  
• loan exposure  

Actions:

• pause group  
• unblock group  
• force review  

---

## E. Loan Control Center

Shows:

• pending loan requests  
• approved loans  
• active loans  
• overdue loans  
• defaulted loans  

Controls:

• loan policy  
• lending pause  
• exposure monitoring  

---

## F. Deposit & Batch Control

Shows:

• pending batches  
• confirmed batches  
• flagged batches  

Super admin can:

• investigate  
• audit  

But **not confirm institution batches**.

---

## G. Reconciliation & Settlement

Tracks:

• agent close‑day submissions  
• declared vs expected cash  
• shortages or overages  
• settlement status  

---

## H. Pricing & Rules Engine

Should move configuration out of hardcoded functions.

Suggested structure:

```
systemConfig/businessRules
systemConfig/fees
systemConfig/loanPolicy
systemConfig/commissionPolicy
```

Controls:

• interest rates  
• penalty rates  
• service fees  
• withdrawal fees  
• agent commissions  
• group rules  

---

## I. Risk & Exception Center

Tracks:

• suspicious deposit patterns  
• high default groups  
• inactive leaders  
• reconciliation mismatches  
• concentration risks  

---

## J. Audit Log

Essential for traceability.

Collection:

```
auditLogs/{id}
```

Fields:

```
actorUid
actorRole
action
entityType
entityId
before
after
reason
createdAt
```

---

# 6. INSTITUTION MODEL

Institutions should contain:

```
name
contactPhone
contactName
institutionType
branchCount
region
country
currency
supportsDeposits
supportsWithdrawals
supportsLoanSettlement
settlementAccountReferencePrefix
defaultBatchReferencePrefix
reconciliationMode
isDepositPartner
isLoanPartner
apiEnabled
webhookEnabled
integrationStatus
settlementTerms
institutionLimit
riskLevel
suspendedAt
suspendedBy
updatedAt
updatedBy
```

---

# 7. CORE SYSTEM FLOWS

## Member Onboarding

```
register
-> status pending
-> admin approves
-> member active
-> member selects institution
-> join or create group
```

---

## Group Creation

```
member requests group
-> admin approves
-> group created
-> leader assigned
-> groupMembers entry created
```

---

## Join Group

```
member enters group code
-> join request
-> leader approves
-> groupMembers updated
```

---

## Deposit Flow

```
member gives cash to agent
-> agent records deposit
-> transaction pending
-> wallet.pendingSavings increases
-> agent submits batch
-> institution confirms batch
-> wallet.confirmedSavings increases
```

---

## Flagged Batch Flow

```
institution flags batch
-> batch flagged
-> notifications sent
-> investigation begins
```

---

## Loan Flow

```
member requests loan
-> eligibility check
-> approval
-> agent disburses
-> repayments reduce balance
-> loan closes
```

---

# 8. CURRENT MAJOR DEVELOPMENT ISSUES

1. Multi‑institution architecture still evolving  
2. Legacy Umuco naming still present in parts of code  
3. Dashboard functionality uneven across roles  
4. Notifications system incomplete  
5. Business rules still partially hardcoded  
6. Some Firestore test data inconsistent  

---

# 9. CURRENT DEVELOPMENT PRIORITY

Focus should shift to **feature completion**, not test data fixes.

Priority order:

1. finalize dashboard features  
2. finalize institution architecture  
3. finalize rules engine  
4. finalize notifications  
5. reset Firestore development data  
6. reseed clean development data  

---

# 10. CLEAN DATA RESEED ORDER (AFTER RESET)

1. system config  
2. kirimbaFund  
3. institutions  
4. institution users  
5. admins  
6. agents  
7. members  
8. groups  
9. groupMembers  
10. wallets  
11. deposits  
12. deposit batches  
13. loans  
14. repayments / withdrawals  

---

# 11. FINAL DEVELOPMENT GOAL

Kirimba should become a **multi‑institution savings and credit operating platform** with:

• strong auditability  
• institution‑verified cash flows  
• clear operational dashboards  
• configurable business rules  
• clean role boundaries  

The next phase should focus on **completing dashboard features and architecture stability before reseeding data**.
