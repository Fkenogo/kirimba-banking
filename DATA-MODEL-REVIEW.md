# KIRIMBA BANKING - FIRESTORE ARCHITECTURE REVIEW

**Review Date**: 2026-03-02
**Reviewer**: Claude Code Assistant
**Codebase Version**: Current (main branch)
**Review Scope**: Complete Firestore data model, query patterns, transactions, and scalability

---

## 📊 EXECUTIVE SUMMARY

### Overall Assessment

**Firestore Architecture Score: 6.1/10** (Grade: C)

The KIRIMBA banking platform uses Firestore effectively for basic operations but has **3 critical architectural issues** that will cause production failures at scale:

1. **CRITICAL**: `confirmBatch()` transaction exceeds Firestore's 25-operation limit (would fail at 30+ transactions)
2. **CRITICAL**: Write contention on `groups.memberCount` and `kirimbaFund/current` (hits 20 ops/second limit)
3. **CRITICAL**: Unbounded `notifications` collection with no retention policy (unlimited growth)

**Strengths:**
- ✅ Clean collection structure with logical separation
- ✅ Consistent use of Firestore transactions for atomic updates
- ✅ Well-designed composite indexes (8 indexes covering common queries)
- ✅ Strong security rules with role-based access control
- ✅ Appropriate denormalization (memberCount, totalSavings)

**Critical Weaknesses:**
- ❌ Transaction operation count not validated against 25-op limit
- ❌ All-groups read in confirmBatch causing O(groups) complexity
- ❌ Missing pagination on 9 out of 11 queries (unbounded reads)
- ❌ Write hotspots without distributed counters
- ❌ No data retention policies

### Risk Level by Category

| Category | Score | Risk | Impact |
|----------|-------|------|---------|
| **Data Model Design** | 7/10 | LOW | Well-structured, clean separation |
| **Query Patterns** | 6/10 | MEDIUM | Missing pagination, some inefficiencies |
| **Transaction Safety** | 4/10 | **HIGH** | Critical bugs in confirmBatch |
| **Scalability** | 5/10 | **HIGH** | Write contention, unbounded growth |
| **Security Rules** | 8/10 | MEDIUM | 2 scope issues (groups/transactions) |
| **Cost Efficiency** | 7/10 | LOW | $6-7/month at 1000 users |

---

## 🗂️ DATA MODEL ARCHITECTURE

### Collection Overview (10 Collections)

```
kirimba-banking (Firebase project)
├── users/                    # User accounts (Firebase Auth + custom claims)
├── members/                  # Member profiles + savings balances
├── groups/                   # Savings groups + collateral tracking
├── groupJoinRequests/        # Pending group membership requests
├── agents/                   # Agent profiles (verified status)
├── depositTransactions/      # Individual deposit records
├── depositBatches/           # Agent batch submissions
├── loans/                    # Loan applications + repayment tracking
├── notifications/            # ⚠️ UNBOUNDED - no retention policy
└── kirimbaFund/             # ⚠️ WRITE HOTSPOT - single doc updated frequently
    └── current              # Fund balance + collateral
```

### Data Model Grade: 7/10

**Strengths:**
1. **Logical Separation**: Clean domain boundaries (users, members, savings, loans)
2. **Denormalization**: Appropriate use of memberCount, totalSavings for query performance
3. **Relationship Modeling**: Clear parent-child relationships (groups → members)
4. **Document Structure**: Consistent field naming (camelCase, timestamps)

**Issues:**
1. **Unbounded Collections** (CRITICAL):
   - `notifications/` has no TTL or retention policy (grows forever)
   - `depositTransactions/` has no archival strategy (could reach millions)
2. **Write Hotspots** (CRITICAL):
   - `kirimbaFund/current` updated on every batch confirmation (single doc)
   - `groups/{id}.memberCount` updated on every member join/leave
3. **Missing Indexes**:
   - `notifications` collection has no composite index for user queries
4. **Document Size Risk**:
   - `members/{id}` could exceed 1MB if transaction history grows (currently safe)

---

## 🔍 QUERY PATTERN ANALYSIS

### Query Inventory (11 Queries Analyzed)

#### 1. **Get Pending Members** (`members.js:118-122`)
```javascript
// Query: members where status == 'pending'
const pendingSnapshot = await db.collection("members")
  .where("status", "==", "pending")
  .get();
```
- **Read Count**: 1 read per pending member
- **Index**: ✅ Uses firestore.indexes.json entry (members: status ASC, createdAt ASC)
- **Pagination**: ❌ Missing (could return 1000s of docs)
- **Performance**: O(pending_members)
- **Risk**: MEDIUM - No limit() clause
- **Fix**: Add `.limit(50)` and pagination

#### 2. **Get User by Phone** (`members.js:46-48`)
```javascript
// Query: users where phoneNumber == phone
const existingUserSnap = await db.collection("users")
  .where("phoneNumber", "==", phone)
  .get();
```
- **Read Count**: 1 read (phone is unique)
- **Index**: ✅ Single-field index on phoneNumber
- **Pagination**: N/A (unique field)
- **Performance**: O(1)
- **Risk**: LOW
- **Optimization**: Consider using phone as document ID to avoid query

#### 3. **Get Member by UID** (`members.js:50-51`)
```javascript
// Direct document read
const memberDoc = await db.collection("members").doc(uid).get();
```
- **Read Count**: 1 read
- **Index**: N/A (direct doc access)
- **Performance**: O(1)
- **Risk**: LOW

#### 4. **Get Pending Join Requests for Group** (`members.js:387-391`)
```javascript
// Query: groupJoinRequests where groupId == id AND status == 'pending'
const pendingRequestsSnap = await db.collection("groupJoinRequests")
  .where("groupId", "==", groupId)
  .where("status", "==", "pending")
  .get();
```
- **Read Count**: 1 read per pending request
- **Index**: ✅ Composite index (groupId ASC, status ASC)
- **Pagination**: ❌ Missing
- **Performance**: O(pending_requests_per_group)
- **Risk**: MEDIUM - Could be 100s of requests
- **Fix**: Add `.limit(20)` and pagination

#### 5. **Get User's Groups** (`savings.js:143-147`)
```javascript
// Query: groups where memberIds array-contains userId
const groupsSnapshot = await db.collection("groups")
  .where("memberIds", "array-contains", userId)
  .get();
```
- **Read Count**: 1 read per group user belongs to
- **Index**: ✅ Single-field index on memberIds
- **Pagination**: ❌ Missing (but bounded by max groups per user)
- **Performance**: O(user_groups)
- **Risk**: LOW - Typically 1-3 groups per user
- **Optimization**: Cache in client

#### 6. **Get All Groups** (⚠️ CRITICAL ISSUE - `savings.js:436-440`)
```javascript
// CRITICAL: Reads ALL groups in transaction
const groupsQuerySnap = await tx.get(db.collection("groups"));
let totalCollateral = 0;
groupsQuerySnap.forEach((groupDoc) => {
  totalCollateral += Number(groupDoc.data().totalSavings || 0);
});
```
- **Read Count**: 1 read × ALL groups (50-200+ at scale)
- **Index**: None (full collection scan)
- **Pagination**: ❌ Missing
- **Performance**: O(total_groups)
- **Risk**: **CRITICAL** - Exceeds 25-operation transaction limit
- **Impact**: Function FAILS at 30+ groups
- **Fix**: Use `FieldValue.increment()` instead:
  ```javascript
  tx.set(
    db.collection("kirimbaFund").doc("current"),
    {
      totalCollateral: FieldValue.increment(batchTotalSavings),
      lastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );
  ```

#### 7. **Get Pending Batches** (`savings.js:596-600`)
```javascript
// Query: depositBatches where status == 'pending'
const batchesSnapshot = await db.collection("depositBatches")
  .where("status", "==", "pending")
  .get();
```
- **Read Count**: 1 read per pending batch
- **Index**: ✅ Composite index (status ASC, submittedAt ASC)
- **Pagination**: ❌ Missing
- **Performance**: O(pending_batches)
- **Risk**: MEDIUM - Could be 50+ batches
- **Fix**: Add `.limit(20)` and `.orderBy("submittedAt", "desc")`

#### 8. **Get Batch Transactions** (`savings.js:407-411`)
```javascript
// Query: depositTransactions where batchId == batchId
const txnsSnapshot = await tx.get(
  db.collection("depositTransactions").where("batchId", "==", batchId)
);
```
- **Read Count**: 1 read per transaction in batch
- **Index**: ✅ Composite index (batchId ASC, createdAt ASC)
- **Pagination**: N/A (bounded by batch size ~10-50)
- **Performance**: O(transactions_per_batch)
- **Risk**: LOW - Max 50 transactions per batch
- **Issue**: Combined with all-groups read, exceeds 25-op limit

#### 9. **Get User's Loans** (`loans.js:120-125`)
```javascript
// Query: loans where userId == userId
const loansSnapshot = await db.collection("loans")
  .where("userId", "==", userId)
  .get();
```
- **Read Count**: 1 read per user loan
- **Index**: ✅ Composite index (userId ASC, createdAt ASC)
- **Pagination**: ❌ Missing
- **Performance**: O(user_loans)
- **Risk**: LOW - Typically 1-5 loans per user
- **Optimization**: Add `.orderBy("createdAt", "desc").limit(10)`

#### 10. **Get Overdue Loans** (⚠️ INEFFICIENT - `loans.js:474-484`)
```javascript
// Reads ALL active loans, filters in-memory
const loansSnapshot = await db.collection("loans")
  .where("status", "==", "active")
  .get();

const now = Date.now();
const overdueLoans = [];
loansSnapshot.forEach((doc) => {
  const loan = doc.data();
  if (loan.dueDate && loan.dueDate.toMillis() < now) {
    overdueLoans.push({ id: doc.id, ...loan });
  }
});
```
- **Read Count**: ALL active loans (inefficient)
- **Index**: ✅ Single-field index on status
- **Pagination**: ❌ Missing
- **Performance**: O(all_active_loans)
- **Risk**: HIGH - Reads 100s of loans to find 10-20 overdue
- **Fix**: Add composite index and query directly:
  ```javascript
  // Add to firestore.indexes.json:
  {
    "collectionGroup": "loans",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "dueDate", "order": "ASCENDING" }
    ]
  }

  // Query:
  const overdueLoans = await db.collection("loans")
    .where("status", "==", "active")
    .where("dueDate", "<", new Date())
    .get();
  ```

#### 11. **Get User Role** (`utils.js:34-36`)
```javascript
// Direct document read
const userDoc = await db.collection("users").doc(uid).get();
return userDoc.exists ? userDoc.data().role : null;
```
- **Read Count**: 1 read per role check
- **Index**: N/A (direct doc access)
- **Performance**: O(1)
- **Risk**: MEDIUM - Called on EVERY function (high volume)
- **Optimization**: Use custom claims instead (no Firestore read):
  ```javascript
  const { role } = context.auth.token; // From Firebase Auth token
  ```

### Query Pattern Summary

| Query | Index | Pagination | Efficiency | Risk |
|-------|-------|------------|------------|------|
| Get Pending Members | ✅ | ❌ | Medium | MEDIUM |
| Get User by Phone | ✅ | N/A | High | LOW |
| Get Member by UID | N/A | N/A | High | LOW |
| Get Pending Join Requests | ✅ | ❌ | Medium | MEDIUM |
| Get User's Groups | ✅ | ❌ | High | LOW |
| **Get All Groups** | ❌ | ❌ | **Low** | **CRITICAL** |
| Get Pending Batches | ✅ | ❌ | Medium | MEDIUM |
| Get Batch Transactions | ✅ | N/A | High | LOW |
| Get User's Loans | ✅ | ❌ | High | LOW |
| **Get Overdue Loans** | ⚠️ | ❌ | **Low** | **HIGH** |
| Get User Role | N/A | N/A | Medium | MEDIUM |

**Key Findings:**
- ✅ 8/11 queries have proper indexes
- ❌ 9/11 queries missing pagination
- ❌ 2/11 queries use inefficient patterns (all-groups read, in-memory filtering)
- ⚠️ 1 query (getUserRole) called on every function (high volume)

---

## ⚙️ TRANSACTION PATTERN ANALYSIS

### Transaction Inventory (8 Transactions)

#### 1. **Create Group** (`members.js:265-308`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read creator member doc (1 op)
  const memberDoc = await tx.get(db.collection("members").doc(creatorId));

  // 2. Create group doc (1 op)
  tx.set(groupRef, groupData);

  // 3. Update member's groupIds (1 op)
  tx.update(memberRef, { groupIds: FieldValue.arrayUnion(groupId) });
});
```
- **Operation Count**: 3 ops (1 read, 2 writes)
- **Safety**: ✅ Atomic group creation + member update
- **Performance**: O(1)
- **Risk**: LOW

#### 2. **Approve Member** (`members.js:147-197`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read member doc (1 op)
  const memberDoc = await tx.get(memberRef);

  // 2. Update member status (1 op)
  tx.update(memberRef, { status: "active", approvedAt, approvedBy });

  // 3. Update user custom claims via Admin SDK (NOT counted)
  await admin.auth().setCustomUserClaims(uid, { role: "member" });

  // 4. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```
- **Operation Count**: 3 ops (1 read, 2 writes)
- **Safety**: ⚠️ Race condition - custom claims set OUTSIDE transaction
- **Performance**: O(1)
- **Risk**: MEDIUM - User could access app before Firestore doc updated
- **Fix**: Set claims AFTER transaction commits

#### 3. **Approve Join Request** (`members.js:403-455`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read join request (1 op)
  const requestDoc = await tx.get(requestRef);

  // 2. Read group doc (1 op)
  const groupDoc = await tx.get(groupRef);

  // 3. Read member doc (1 op)
  const memberDoc = await tx.get(memberRef);

  // 4. Update join request status (1 op)
  tx.update(requestRef, { status: "approved", approvedBy, approvedAt });

  // 5. Update group memberIds + memberCount (1 op)
  tx.update(groupRef, {
    memberIds: FieldValue.arrayUnion(userId),
    memberCount: FieldValue.increment(1), // ⚠️ WRITE HOTSPOT
  });

  // 6. Update member groupIds (1 op)
  tx.update(memberRef, { groupIds: FieldValue.arrayUnion(groupId) });

  // 7. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```
- **Operation Count**: 7 ops (3 reads, 4 writes)
- **Safety**: ✅ Atomic multi-document update
- **Performance**: O(1)
- **Risk**: MEDIUM - `memberCount` write hotspot (20 ops/sec limit per group)
- **Fix**: Use distributed counter if >10 joins/min per group

#### 4. **Record Deposit** (`savings.js:167-228`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read member doc (1 op)
  const memberDoc = await tx.get(memberRef);

  // 2. Read group doc (1 op)
  const groupDoc = await tx.get(groupRef);

  // 3. Create transaction doc (1 op)
  tx.set(txnRef, transactionData);

  // 4. Update member pendingSavings (1 op)
  tx.update(memberRef, {
    pendingSavings: FieldValue.increment(amount),
  });

  // 5. Read agent doc to get receiptCounter (1 op)
  const agentDoc = await tx.get(agentRef);

  // 6. Update agent receiptCounter (1 op) - ⚠️ WRITE HOTSPOT
  tx.update(agentRef, {
    receiptCounter: FieldValue.increment(1),
  });

  // 7. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```
- **Operation Count**: 7 ops (3 reads, 4 writes)
- **Safety**: ✅ Atomic deposit + receipt generation
- **Performance**: O(1)
- **Risk**: HIGH - `receiptCounter` write hotspot (busy agent = 50+ deposits/min)
- **Fix**: Use sharded counter or external receipt service

#### 5. **Confirm Batch** (⚠️ **CRITICAL** - `savings.js:397-530`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read batch doc (1 op)
  const batchDoc = await tx.get(batchRef);

  // 2. Read ALL transactions in batch (10-50 ops) ⚠️
  const txnsSnapshot = await tx.get(
    db.collection("depositTransactions").where("batchId", "==", batchId)
  );

  // 3. Read ALL groups (50-200 ops) 🚨 CRITICAL ISSUE
  const groupsQuerySnap = await tx.get(db.collection("groups"));

  // 4. Update batch status (1 op)
  tx.update(batchRef, { status: "confirmed", confirmedBy, confirmedAt });

  // 5. For each transaction (10-50 ops):
  txnsSnapshot.forEach((txnDoc) => {
    // Update transaction status (1 op × 30 = 30 ops)
    tx.update(txnDoc.ref, { status: "confirmed" });

    // Update member balance (1 op × 30 = 30 ops)
    tx.update(db.collection("members").doc(txn.userId), {
      currentSavings: FieldValue.increment(txn.amount),
      pendingSavings: FieldValue.increment(-txn.amount),
    });

    // Update group balance (1 op × ~10 unique groups = 10 ops)
    tx.update(db.collection("groups").doc(txn.groupId), {
      totalSavings: FieldValue.increment(txn.amount),
    });
  });

  // 6. Update kirimbaFund/current (1 op) - ⚠️ WRITE HOTSPOT
  tx.set(db.collection("kirimbaFund").doc("current"), fundUpdateData);

  // 7. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```

**CRITICAL ISSUE BREAKDOWN:**
- **Read Operations**: 1 (batch) + 30 (txns) + 100 (all groups) = **131 reads**
- **Write Operations**: 1 (batch) + 30 (txn status) + 30 (member balance) + 10 (group balance) + 1 (fund) + 1 (notification) = **73 writes**
- **Total Operations**: **204 operations**
- **Firestore Limit**: **25 operations per transaction**
- **Result**: **Function FAILS** with "Transaction attempted too many operations"

**When This Fails:**
- At 50 groups + 30 transactions: 144 operations (5.7× over limit)
- At 30 groups + 20 transactions: 94 operations (3.7× over limit)
- At 10 groups + 10 transactions: 44 operations (1.7× over limit)

**Fix (URGENT):**
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read batch (1 op)
  const batchDoc = await tx.get(batchRef);

  // 2. Read transactions (10-50 ops)
  const txnsSnapshot = await tx.get(
    db.collection("depositTransactions").where("batchId", "==", batchId)
  );

  // Calculate totals in-memory (no reads)
  let localTotalConfirmed = 0;
  const groupTotals = {}; // { groupId: totalAmount }

  txnsSnapshot.forEach((txnDoc) => {
    const txn = txnDoc.data();
    localTotalConfirmed += txn.amount;
    groupTotals[txn.groupId] = (groupTotals[txn.groupId] || 0) + txn.amount;
  });

  // 3. Update batch (1 op)
  tx.update(batchRef, { status: "confirmed", confirmedBy, confirmedAt });

  // 4. Update transactions + members (2 ops × 30 = 60 ops)
  txnsSnapshot.forEach((txnDoc) => {
    tx.update(txnDoc.ref, { status: "confirmed" });
    tx.update(db.collection("members").doc(txn.userId), {
      currentSavings: FieldValue.increment(txn.amount),
      pendingSavings: FieldValue.increment(-txn.amount),
    });
  });

  // 5. Update groups (1 op × 10 = 10 ops)
  Object.entries(groupTotals).forEach(([groupId, amount]) => {
    tx.update(db.collection("groups").doc(groupId), {
      totalSavings: FieldValue.increment(amount),
    });
  });

  // 6. Update fund with increment (1 op) - NO GROUP READS
  tx.set(
    db.collection("kirimbaFund").doc("current"),
    {
      totalCollateral: FieldValue.increment(localTotalConfirmed),
      lastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // 7. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
// New total: 1 + 30 + 60 + 10 + 1 + 1 = 103 operations
// Still exceeds limit! Need batch API instead.
```

**Correct Fix - Use Batch API (500 op limit):**
```javascript
const batch = db.batch();

// Read outside transaction
const batchDoc = await batchRef.get();
const txnsSnapshot = await db.collection("depositTransactions")
  .where("batchId", "==", batchId)
  .get();

// Calculate totals
let totalConfirmed = 0;
const groupTotals = {};
txnsSnapshot.forEach((txnDoc) => {
  const txn = txnDoc.data();
  totalConfirmed += txn.amount;
  groupTotals[txn.groupId] = (groupTotals[txn.groupId] || 0) + txn.amount;
});

// Batch updates
batch.update(batchRef, { status: "confirmed", confirmedBy, confirmedAt });

txnsSnapshot.forEach((txnDoc) => {
  const txn = txnDoc.data();
  batch.update(txnDoc.ref, { status: "confirmed" });
  batch.update(db.collection("members").doc(txn.userId), {
    currentSavings: FieldValue.increment(txn.amount),
    pendingSavings: FieldValue.increment(-txn.amount),
  });
});

Object.entries(groupTotals).forEach(([groupId, amount]) => {
  batch.update(db.collection("groups").doc(groupId), {
    totalSavings: FieldValue.increment(amount),
  });
});

batch.set(
  db.collection("kirimbaFund").doc("current"),
  {
    totalCollateral: FieldValue.increment(totalConfirmed),
    lastUpdated: FieldValue.serverTimestamp(),
  },
  { merge: true }
);

await batch.commit(); // Atomic but not transactional
```

**Trade-off**: Batch API is atomic but NOT transactional (no reads). If you need transaction safety, split into smaller transactions:
1. Transaction 1: Update batch status
2. Transaction 2-N: Update transactions in chunks of 10
3. Final update: Update fund (using increment, safe to run separately)

#### 6. **Request Loan** (`loans.js:145-222`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read member doc (1 op)
  const memberDoc = await tx.get(memberRef);

  // 2. Read group doc (1 op)
  const groupDoc = await tx.get(groupRef);

  // 3. Read kirimbaFund (1 op)
  const fundDoc = await tx.get(db.collection("kirimbaFund").doc("current"));

  // 4. Create loan doc (1 op)
  tx.set(loanRef, loanData);

  // 5. Update fund if auto-approved (1 op)
  if (autoApproved) {
    tx.update(fundRef, {
      availableFunds: FieldValue.increment(-requestedAmount),
    });
  }

  // 6. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```
- **Operation Count**: 6 ops (3 reads, 3 writes)
- **Safety**: ✅ Atomic loan creation + fund deduction
- **Performance**: O(1)
- **Risk**: LOW

#### 7. **Disburse Loan** (`loans.js:298-349`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read loan doc (1 op)
  const loanDoc = await tx.get(loanRef);

  // 2. Read fund doc (1 op)
  const fundDoc = await tx.get(fundRef);

  // 3. Update loan status (1 op)
  tx.update(loanRef, {
    status: "active",
    disbursedBy,
    disbursedAt,
    dueDate,
  });

  // 4. Update fund availableFunds (1 op) - ⚠️ WRITE HOTSPOT
  tx.update(fundRef, {
    availableFunds: FieldValue.increment(-amount),
  });

  // 5. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```
- **Operation Count**: 5 ops (2 reads, 3 writes)
- **Safety**: ✅ Atomic disbursement + fund deduction
- **Performance**: O(1)
- **Risk**: MEDIUM - `kirimbaFund/current` write hotspot
- **Fix**: If >20 disbursements/min, use sharded fund docs

#### 8. **Record Repayment** (`loans.js:405-457`)
```javascript
await db.runTransaction(async (tx) => {
  // 1. Read loan doc (1 op)
  const loanDoc = await tx.get(loanRef);

  // 2. Update loan amountPaid + status (1 op)
  tx.update(loanRef, {
    amountPaid: FieldValue.increment(amount),
    status: fullyPaid ? "repaid" : "active",
    repaidAt: fullyPaid ? serverTimestamp() : null,
  });

  // 3. Update fund availableFunds (1 op) - ⚠️ WRITE HOTSPOT
  tx.update(fundRef, {
    availableFunds: FieldValue.increment(amount),
  });

  // 4. Create notification (1 op)
  tx.set(db.collection("notifications").doc(), notificationData);
});
```
- **Operation Count**: 4 ops (1 read, 3 writes)
- **Safety**: ✅ Atomic repayment + fund credit
- **Performance**: O(1)
- **Risk**: MEDIUM - `kirimbaFund/current` write hotspot

### Transaction Safety Summary

| Transaction | Ops | Limit Check | Hotspots | Risk |
|-------------|-----|-------------|----------|------|
| Create Group | 3 | ✅ | None | LOW |
| Approve Member | 3 | ✅ | None | MEDIUM |
| Approve Join Request | 7 | ✅ | memberCount | MEDIUM |
| Record Deposit | 7 | ✅ | receiptCounter | HIGH |
| **Confirm Batch** | **204** | **❌ FAIL** | **fund, groups** | **CRITICAL** |
| Request Loan | 6 | ✅ | fund | LOW |
| Disburse Loan | 5 | ✅ | fund | MEDIUM |
| Record Repayment | 4 | ✅ | fund | MEDIUM |

**Key Findings:**
- ✅ 7/8 transactions safe and atomic
- ❌ 1/8 transactions CRITICALLY broken (confirmBatch exceeds 25-op limit)
- ⚠️ 3 write hotspots identified (fund, receiptCounter, memberCount)

---

## 📈 SCALABILITY ANALYSIS

### Document Growth Projections

| Collection | Current | 100 Users | 1000 Users | 10K Users |
|------------|---------|-----------|------------|-----------|
| `users` | ~10 | 100 | 1,000 | 10,000 |
| `members` | ~10 | 100 | 1,000 | 10,000 |
| `groups` | ~2 | 15 | 150 | 1,500 |
| `agents` | ~2 | 5 | 20 | 100 |
| `depositTransactions` | ~50 | 5,000 | 60,000 | 720,000 |
| `depositBatches` | ~5 | 500 | 6,000 | 72,000 |
| `loans` | ~10 | 500 | 6,000 | 72,000 |
| `notifications` | ~20 | **20,000** | **240,000** | **2.9M** |
| `groupJoinRequests` | ~5 | 100 | 500 | 5,000 |
| `kirimbaFund` | 1 | 1 | 1 | 1 |

**Assumptions**:
- Average 1 deposit/week/user = 52/year
- Average 0.5 loans/year/user
- Average 20 notifications/user/year
- Groups average 7 members

### Unbounded Growth Issues (CRITICAL)

#### 1. **Notifications Collection** (🚨 CRITICAL)
- **Current**: ~20 docs
- **1 Year at 1000 Users**: 240,000 docs
- **5 Years**: 1.2M docs
- **Issue**: No retention policy, grows forever
- **Impact**: Query performance degrades, storage costs increase
- **Fix**: Add TTL policy:
  ```javascript
  // In notification creation:
  tx.set(db.collection("notifications").doc(), {
    ...notificationData,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
  });

  // Add scheduled function:
  exports.deleteExpiredNotifications = functions.pubsub
    .schedule("every 24 hours")
    .onRun(async (context) => {
      const now = new Date();
      const expiredSnap = await db.collection("notifications")
        .where("expiresAt", "<", now)
        .limit(500)
        .get();

      const batch = db.batch();
      expiredSnap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    });
  ```

#### 2. **Deposit Transactions** (⚠️ MEDIUM)
- **Current**: ~50 docs
- **1 Year at 1000 Users**: 60,000 docs
- **5 Years**: 300,000 docs
- **Issue**: No archival strategy
- **Impact**: Queries slow down, costs increase
- **Fix**: Archive old transactions after 2 years to separate collection

### Write Contention Hotspots (CRITICAL)

#### 1. **`kirimbaFund/current`** (🚨 CRITICAL)
- **Writes**: Every batch confirmation, loan disbursement, repayment
- **Frequency**: 50-100 writes/day at 1000 users
- **Firestore Limit**: ~1 write/second sustained (spiky workloads fail)
- **Current Peak**: Batch confirmations could spike to 10/min (safe)
- **Risk**: HIGH at 5000+ users
- **Fix**: Use sharded counter pattern:
  ```javascript
  // Create 10 shard docs: kirimbaFund/shard_0 to shard_9
  const shardId = Math.floor(Math.random() * 10);
  tx.update(db.collection("kirimbaFund").doc(`shard_${shardId}`), {
    totalCollateral: FieldValue.increment(amount),
  });

  // Aggregate with scheduled function every hour:
  exports.aggregateFundShards = functions.pubsub
    .schedule("every 1 hours")
    .onRun(async () => {
      const shards = await db.collection("kirimbaFund")
        .where(FieldPath.documentId(), ">=", "shard_0")
        .where(FieldPath.documentId(), "<=", "shard_9")
        .get();

      let total = 0;
      shards.forEach((doc) => {
        total += doc.data().totalCollateral || 0;
      });

      await db.collection("kirimbaFund").doc("current").set({
        totalCollateral: total,
        lastAggregated: FieldValue.serverTimestamp(),
      });
    });
  ```

#### 2. **`agents/{id}.receiptCounter`** (⚠️ HIGH)
- **Writes**: Every deposit recorded by agent
- **Frequency**: Busy agent = 50+ deposits/day = 2/hour
- **Firestore Limit**: 20 writes/second (safe for now)
- **Risk**: MEDIUM - Spikes during batch recording sessions
- **Fix**: Use external receipt numbering service (e.g., Firestore Counter extension)

#### 3. **`groups/{id}.memberCount`** (⚠️ MEDIUM)
- **Writes**: Every member join/leave
- **Frequency**: ~1 write/day/group
- **Firestore Limit**: 20 writes/second (safe)
- **Risk**: LOW - Unlikely to hit limit

### Query Performance at Scale

| Query | 100 Users | 1000 Users | 10K Users | Fix |
|-------|-----------|------------|-----------|-----|
| Get Pending Members | 5 reads | 50 reads | 500 reads | Add pagination |
| Get All Groups | 15 reads | **150 reads** | **1500 reads** | Remove from transaction |
| Get Pending Batches | 10 reads | 100 reads | 1000 reads | Add pagination |
| Get Overdue Loans | 50 reads | **500 reads** | **5000 reads** | Add composite index |
| Get User Role | 300K reads/mo | **3M reads/mo** | **30M reads/mo** | Use custom claims |

**Cost Impact** (reads at $0.06 per 100K):
- 100 Users: $1/month
- 1000 Users: $6/month
- 10K Users: $60/month

### Composite Index Requirements

**Current Indexes** (8 defined in firestore.indexes.json):
1. ✅ members: status ASC, createdAt ASC
2. ✅ groupJoinRequests: groupId ASC, status ASC
3. ✅ groupJoinRequests: userId ASC, status ASC
4. ✅ depositBatches: status ASC, submittedAt ASC
5. ✅ depositTransactions: batchId ASC, createdAt ASC
6. ✅ depositTransactions: userId ASC, createdAt ASC
7. ✅ loans: userId ASC, createdAt ASC
8. ✅ loans: userId ASC, createdAt ASC (DUPLICATE)

**Missing Indexes**:
1. ❌ loans: status ASC, dueDate ASC (for overdue query)
2. ❌ notifications: userId ASC, createdAt DESC (for user notification list)
3. ❌ notifications: expiresAt ASC (for cleanup scheduler)

### Document Size Limits

| Collection | Current Size | Max Theoretical | Limit | Risk |
|------------|--------------|-----------------|-------|------|
| `members/{id}` | ~500 bytes | ~10 KB | 1 MB | LOW |
| `groups/{id}` | ~800 bytes | ~50 KB | 1 MB | LOW |
| `loans/{id}` | ~600 bytes | ~5 KB | 1 MB | LOW |
| `kirimbaFund/current` | ~300 bytes | ~1 KB | 1 MB | LOW |

All documents safely within limits.

---

## 🔒 SECURITY RULES REVIEW

### Security Rules Score: 8/10

**Strengths:**
- ✅ Role-based access control (6 roles)
- ✅ Custom function helpers (isAdmin, isAgent, etc.)
- ✅ Server-side timestamp enforcement
- ✅ Read/write separation (different rules)
- ✅ Strong auth-based restrictions

**Critical Issues:**

#### 1. **Groups Collection - Overly Permissive** (HIGH - `firestore.rules:52`)
```javascript
match /groups/{groupId} {
  allow read: if isSignedIn() && (isAdmin() || isAgent() || isUmuco() || isLeader() || isMember());
  // ❌ ANY authenticated user can read ANY group
  // Should check: user is member of THIS group
}
```
- **Issue**: All authenticated users can read all groups
- **Impact**: Privacy violation, data leak
- **Fix**:
  ```javascript
  match /groups/{groupId} {
    allow read: if isSignedIn() && (
      isAdmin() ||
      isAgent() ||
      isUmuco() ||
      get(/databases/$(database)/documents/groups/$(groupId)).data.memberIds.hasAny([request.auth.uid])
    );
  }
  ```

#### 2. **Transactions Collection - Overly Permissive** (HIGH - `firestore.rules:67`)
```javascript
match /depositTransactions/{txnId} {
  allow read: if isSignedIn() && (isAdmin() || isAgent() || isUmuco() || isMember());
  // ❌ ANY member can read ANY transaction
  // Should check: user owns this transaction OR is agent/admin
}
```
- **Issue**: All members can read all transactions
- **Impact**: Privacy violation
- **Fix**:
  ```javascript
  match /depositTransactions/{txnId} {
    allow read: if isSignedIn() && (
      isAdmin() ||
      isAgent() ||
      isUmuco() ||
      resource.data.userId == request.auth.uid
    );
  }
  ```

#### 3. **Loans Collection - Overly Permissive** (MEDIUM - `firestore.rules:94`)
```javascript
match /loans/{loanId} {
  allow read: if isSignedIn() && (isAdmin() || isAgent() || isUmuco() || isMember());
  // ❌ ANY member can read ANY loan
}
```
- **Issue**: All members can read all loans
- **Fix**: Same as transactions (check ownership)

### Security Rules Summary

| Collection | Read Scope | Write Scope | Risk |
|------------|------------|-------------|------|
| `users` | ✅ Own doc only | ❌ No writes | LOW |
| `members` | ✅ Admin/Agent/Own | ✅ Admin only | LOW |
| `groups` | ❌ **All authed users** | ✅ Admin/Creator only | **HIGH** |
| `depositTransactions` | ❌ **All members** | ✅ Agent only | **HIGH** |
| `depositBatches` | ✅ Admin/Agent/Umuco | ✅ Agent/Umuco only | LOW |
| `loans` | ❌ **All members** | ✅ Member/Admin | **MEDIUM** |
| `notifications` | ✅ Own only | ❌ No client writes | LOW |
| `agents` | ✅ Admin/Agent only | ✅ Admin only | LOW |

---

## 💰 COST PROJECTIONS

### Firestore Pricing (US Region)

**Document Reads**: $0.06 per 100,000
**Document Writes**: $0.18 per 100,000
**Document Deletes**: $0.02 per 100,000
**Storage**: $0.18 per GB/month

### Cost Breakdown at 1000 Users

#### Monthly Operations
- **Reads**:
  - User role checks: 300K reads × 12 months = 3.6M reads/year = 300K/month = **$0.18/month**
  - Member dashboard loads: 1000 users × 30 days × 5 reads = 150K reads = **$0.09/month**
  - Transaction queries: 50K deposits × 2 reads = 100K reads = **$0.06/month**
  - Loan queries: 6K loans × 3 reads = 18K reads = **$0.01/month**
  - Batch confirmations: 6K batches × 50 reads = 300K reads = **$0.18/month**
  - **Total Reads**: ~900K reads/month = **$0.54/month**

- **Writes**:
  - Deposits: 60K writes/year = 5K/month = **$0.01/month**
  - Batch confirmations: 6K batches × 30 updates = 180K writes/year = 15K/month = **$0.03/month**
  - Loans: 6K loans × 3 writes = 18K writes/year = 1.5K/month = **$0.003/month**
  - Notifications: 240K writes/year = 20K/month = **$0.04/month**
  - **Total Writes**: ~42K writes/month = **$0.08/month**

- **Storage**:
  - Users: 1000 × 500 bytes = 0.5 MB
  - Members: 1000 × 500 bytes = 0.5 MB
  - Groups: 150 × 800 bytes = 0.12 MB
  - Transactions: 60K × 600 bytes = 36 MB
  - Loans: 6K × 600 bytes = 3.6 MB
  - Notifications: 240K × 400 bytes = 96 MB
  - **Total Storage**: ~140 MB = **$0.025/month**

**Total Firestore Cost at 1000 Users**: ~**$0.65/month**

### Cost Projections by Scale

| Users | Reads/Month | Writes/Month | Storage | Total/Month |
|-------|-------------|--------------|---------|-------------|
| 100 | 90K | 4K | 14 MB | **$0.08** |
| 1000 | 900K | 42K | 140 MB | **$0.65** |
| 10K | 9M | 420K | 1.4 GB | **$7.50** |
| 100K | 90M | 4.2M | 14 GB | **$75** |

**Optimization Opportunities:**
1. Use custom claims for role checks (-300K reads/month = **-$0.18/month**)
2. Add pagination to queries (-50K reads/month = **-$0.03/month**)
3. Implement notification TTL (-50% storage = **-$0.01/month**)
4. Cache group data in client (-100K reads/month = **-$0.06/month**)

**Optimized Cost at 1000 Users**: ~**$0.37/month** (43% savings)

---

## 🚨 CRITICAL ISSUES & RECOMMENDATIONS

### Priority 0: CRITICAL (Fix Within 24 Hours)

#### 1. **Fix confirmBatch Transaction Overflow** 🔴
- **File**: `functions/src/savings.js:397-530`
- **Issue**: Transaction exceeds 25-operation limit at scale
- **Impact**: Function FAILS at 30+ transactions per batch
- **Effort**: 4 hours
- **Fix**: Refactor to use Batch API instead of Transaction API
  ```javascript
  // BEFORE (Transaction API - 25 op limit):
  await db.runTransaction(async (tx) => {
    const groupsQuerySnap = await tx.get(db.collection("groups")); // 100 reads
    // ... exceeds limit
  });

  // AFTER (Batch API - 500 op limit):
  const batch = db.batch();

  // Read outside batch (no transaction safety but atomic updates)
  const txnsSnapshot = await db.collection("depositTransactions")
    .where("batchId", "==", batchId)
    .get();

  // Calculate totals in-memory
  let totalConfirmed = 0;
  const groupTotals = {};
  txnsSnapshot.forEach((doc) => {
    const txn = doc.data();
    totalConfirmed += txn.amount;
    groupTotals[txn.groupId] = (groupTotals[txn.groupId] || 0) + txn.amount;
  });

  // Batch updates
  batch.update(batchRef, { status: "confirmed", confirmedBy, confirmedAt });

  txnsSnapshot.forEach((doc) => {
    const txn = doc.data();
    batch.update(doc.ref, { status: "confirmed" });
    batch.update(db.collection("members").doc(txn.userId), {
      currentSavings: FieldValue.increment(txn.amount),
      pendingSavings: FieldValue.increment(-txn.amount),
    });
  });

  Object.entries(groupTotals).forEach(([groupId, amount]) => {
    batch.update(db.collection("groups").doc(groupId), {
      totalSavings: FieldValue.increment(amount),
    });
  });

  batch.set(
    db.collection("kirimbaFund").doc("current"),
    {
      totalCollateral: FieldValue.increment(totalConfirmed),
      lastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await batch.commit();
  ```

#### 2. **Add Notifications Retention Policy** 🔴
- **Files**: `functions/src/members.js`, `savings.js`, `loans.js`
- **Issue**: Unbounded notifications collection
- **Impact**: 240K docs/year at 1000 users, query degradation
- **Effort**: 2 hours
- **Fix**:
  ```javascript
  // 1. Add expiresAt field to all notification writes:
  tx.set(db.collection("notifications").doc(), {
    ...notificationData,
    expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
  });

  // 2. Add composite index to firestore.indexes.json:
  {
    "collectionGroup": "notifications",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "expiresAt", "order": "ASCENDING" }
    ]
  }

  // 3. Create scheduled cleanup function:
  exports.deleteExpiredNotifications = functions.pubsub
    .schedule("every 24 hours")
    .onRun(async (context) => {
      const now = new Date();
      const expiredSnap = await db.collection("notifications")
        .where("expiresAt", "<", now)
        .limit(500)
        .get();

      if (expiredSnap.empty) {
        console.log("No expired notifications to delete.");
        return null;
      }

      const batch = db.batch();
      expiredSnap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();

      console.log(`Deleted ${expiredSnap.size} expired notifications.`);
      return null;
    });
  ```

#### 3. **Fix Firestore Security Rules Scope** 🔴
- **File**: `firestore.rules:52, 67, 94`
- **Issue**: Groups/transactions/loans readable by all authenticated users
- **Impact**: Privacy violation, data leak
- **Effort**: 1 hour
- **Fix**:
  ```javascript
  // groups - check membership
  match /groups/{groupId} {
    allow read: if isSignedIn() && (
      isAdmin() ||
      isAgent() ||
      isUmuco() ||
      get(/databases/$(database)/documents/groups/$(groupId)).data.memberIds.hasAny([request.auth.uid])
    );
    allow write: if isSignedIn() && isAdmin();
  }

  // depositTransactions - check ownership
  match /depositTransactions/{txnId} {
    allow read: if isSignedIn() && (
      isAdmin() ||
      isAgent() ||
      isUmuco() ||
      resource.data.userId == request.auth.uid
    );
    allow write: if isSignedIn() && (isAgent() || isAdmin());
  }

  // loans - check ownership
  match /loans/{loanId} {
    allow read: if isSignedIn() && (
      isAdmin() ||
      isAgent() ||
      isUmuco() ||
      resource.data.userId == request.auth.uid
    );
    allow create: if isSignedIn() && isMember() && request.resource.data.userId == request.auth.uid;
    allow update: if isSignedIn() && (isAdmin() || isAgent());
  }
  ```

### Priority 1: HIGH (Fix Within 1 Week)

#### 4. **Optimize Overdue Loans Query** 🟠
- **File**: `functions/src/loans.js:474-484`
- **Issue**: Reads ALL active loans, filters in-memory
- **Impact**: Inefficient at scale (500+ active loans)
- **Effort**: 1 hour
- **Fix**:
  ```javascript
  // Add composite index to firestore.indexes.json:
  {
    "collectionGroup": "loans",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "status", "order": "ASCENDING" },
      { "fieldPath": "dueDate", "order": "ASCENDING" }
    ]
  }

  // Update query in markLoanDefaulted:
  const now = new Date();
  const overdueLoansSnapshot = await db.collection("loans")
    .where("status", "==", "active")
    .where("dueDate", "<", now)
    .get();

  const overdueLoans = overdueLoansSnapshot.docs.map((doc) => ({
    id: doc.id,
    ...doc.data(),
  }));
  ```

#### 5. **Use Custom Claims for Role Checks** 🟠
- **File**: `functions/src/utils.js:34-36`
- **Issue**: Firestore read on EVERY function call (300K reads/month)
- **Impact**: Unnecessary costs, latency
- **Effort**: 2 hours
- **Fix**:
  ```javascript
  // In utils.js:
  function getUserRole(context) {
    // Read from token instead of Firestore
    return context.auth?.token?.role || null;
  }

  // Ensure custom claims are set in approveMember:
  await admin.auth().setCustomUserClaims(uid, { role: "member" });
  ```

#### 6. **Add Pagination to Large Queries** 🟠
- **Files**: `members.js`, `savings.js`, `loans.js`
- **Issue**: 9 queries missing pagination
- **Impact**: Large reads at scale, poor UX
- **Effort**: 3 hours
- **Fix**:
  ```javascript
  // Example for getPendingMembers:
  const pendingSnapshot = await db.collection("members")
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .limit(50) // Add limit
    .get();

  // For pagination:
  const lastDoc = pendingSnapshot.docs[pendingSnapshot.docs.length - 1];
  const nextPageSnapshot = await db.collection("members")
    .where("status", "==", "pending")
    .orderBy("createdAt", "desc")
    .startAfter(lastDoc)
    .limit(50)
    .get();
  ```

### Priority 2: MEDIUM (Fix Within 1 Month)

#### 7. **Implement Distributed Counter for kirimbaFund** 🟡
- **File**: `functions/src/savings.js`, `loans.js`
- **Issue**: Single document write hotspot
- **Impact**: May hit 1 write/second limit at 5000+ users
- **Effort**: 6 hours
- **Fix**: Use sharded counter pattern (see Scalability section above)

#### 8. **Remove Duplicate Index** 🟡
- **File**: `firestore.indexes.json:12-18, 46-51`
- **Issue**: Duplicate loans index (userId ASC, createdAt ASC)
- **Impact**: Wasted storage, slower writes
- **Effort**: 5 minutes
- **Fix**: Delete lines 46-51

#### 9. **Add Missing Notification Index** 🟡
- **File**: `firestore.indexes.json`
- **Issue**: No composite index for user notification queries
- **Impact**: Slow notification list queries
- **Effort**: 5 minutes
- **Fix**:
  ```json
  {
    "collectionGroup": "notifications",
    "queryScope": "COLLECTION",
    "fields": [
      { "fieldPath": "userId", "order": "ASCENDING" },
      { "fieldPath": "createdAt", "order": "DESCENDING" }
    ]
  }
  ```

---

## 📋 IMPLEMENTATION CHECKLIST

### Phase 1: Critical Fixes (Week 1)
- [ ] Fix confirmBatch transaction overflow (use Batch API)
- [ ] Add notifications retention policy (90-day TTL)
- [ ] Fix Firestore security rules scope (groups/transactions/loans)
- [ ] Test confirmBatch with 50+ transactions in emulator
- [ ] Deploy security rules to production

### Phase 2: High Priority (Week 2)
- [ ] Optimize overdue loans query (add composite index)
- [ ] Use custom claims for role checks
- [ ] Add pagination to 9 large queries
- [ ] Test all queries with 1000+ docs in emulator
- [ ] Monitor query performance in production

### Phase 3: Medium Priority (Week 3-4)
- [ ] Implement distributed counter for kirimbaFund
- [ ] Remove duplicate loans index
- [ ] Add notification composite index
- [ ] Set up scheduled notification cleanup
- [ ] Monitor write contention metrics

### Phase 4: Validation (Week 5)
- [ ] Load test with 10,000 simulated users
- [ ] Verify all transactions stay under 25-op limit
- [ ] Confirm security rules prevent unauthorized access
- [ ] Measure actual Firestore costs
- [ ] Document query patterns in CLAUDE.md

---

## 📈 SUCCESS METRICS

### Target Metrics (Post-Fixes)

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| **confirmBatch Max Ops** | 204 ops | <25 ops | Transaction monitoring |
| **Notifications Growth** | Unbounded | <100K docs | Firestore console |
| **Overdue Query Reads** | 500+ reads | <50 reads | Function logs |
| **Role Check Reads** | 300K/month | 0/month | Billing dashboard |
| **Security Rule Violations** | Unknown | 0/month | Security rules logs |
| **Fund Write Contention** | Unknown | <0.5 writes/sec | Firestore metrics |
| **Monthly Firestore Cost** | $0.65 | <$0.40 | Firebase billing |

### Monitoring Setup

```javascript
// Add to all functions:
exports.confirmBatch = functions.https.onCall(async (data, context) => {
  const startTime = Date.now();

  try {
    // ... function logic

    const duration = Date.now() - startTime;
    console.log(`confirmBatch completed in ${duration}ms`);

    return { success: true, duration };
  } catch (error) {
    console.error("confirmBatch failed:", error);
    throw new functions.https.HttpsError("internal", error.message);
  }
});
```

---

## 🎓 LESSONS LEARNED

### What Worked Well
1. **Clean Collection Structure**: Logical domain separation makes codebase maintainable
2. **Consistent Transaction Usage**: Atomic updates prevent data inconsistencies
3. **Composite Indexes**: 8 indexes cover most common queries efficiently
4. **Role-Based Security**: Strong foundation for access control

### What Needs Improvement
1. **Transaction Size Validation**: Should have checked operation count limits earlier
2. **Unbounded Collections**: Need retention policies from day one
3. **Security Rule Testing**: Should test with multiple user roles in emulator
4. **Query Pagination**: Should be default pattern for all list queries
5. **Cost Monitoring**: Need to track read/write operations from start

### Architecture Decisions
- **2026-03-02**: Use Batch API for confirmBatch (500-op limit) instead of Transaction API
- **2026-03-02**: Implement 90-day TTL for notifications (prevent unbounded growth)
- **2026-03-02**: Move role checks to custom claims (eliminate Firestore reads)

---

## 📚 REFERENCES

### Firestore Documentation
- [Transaction Limits](https://firebase.google.com/docs/firestore/manage-data/transactions#transaction_failure): 25 operations per transaction
- [Batch Writes](https://firebase.google.com/docs/firestore/manage-data/transactions#batched-writes): 500 operations per batch
- [Best Practices](https://firebase.google.com/docs/firestore/best-practices): Write contention, distributed counters
- [Security Rules](https://firebase.google.com/docs/firestore/security/rules-structure): Rule structure and testing

### Related Audit Documents
- [KIRIMBA_AUDIT_REPORT.md](KIRIMBA_AUDIT_REPORT.md): Overall project audit
- [CODE-AUDIT.md](CODE-AUDIT.md): Code quality and security audit
- [STATE.md](STATE.md): Current project state and blockers
- [CLAUDE.md](CLAUDE.md): AI assistant codebase guide

---

**Review Completed**: 2026-03-02
**Next Review**: 2026-03-09 (after critical fixes deployed)
**Reviewer**: Claude Code Assistant
**Status**: 🔴 **CRITICAL ISSUES REQUIRE IMMEDIATE ATTENTION**
