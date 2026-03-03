# KIRIMBA BANKING - REVISED IMPLEMENTATION PLAN

**Plan Version**: 1.0
**Generated**: 2026-03-02
**Based On**: CODE-AUDIT.md, DATA-MODEL-REVIEW.md, SECURITY-REPORT.md, STATE.md
**Status**: 🔴 **CRITICAL FIXES REQUIRED BEFORE PRODUCTION**

---

## 📊 EXECUTIVE SUMMARY

Analysis of 4 comprehensive audit reports reveals **89 total issues** across code quality, data architecture, and security domains. Of these, **16 are CRITICAL** and **must be resolved immediately** before any production deployment.

### Current State

- **Overall Completion**: 30%
- **Backend Status**: 95% complete (1,859 lines) - Production-ready architecture
- **Frontend Status**: 10% complete (653 lines) - Auth scaffolds only
- **Security Grade**: D (51/100)
- **Firestore Architecture**: 6.1/10

### Implementation Timeline

```
┌─────────────┬──────────────┬──────────────┬──────────────┬──────────────┐
│  Phase 0    │   Phase 1    │   Phase 2    │   Phase 3    │   Phase 4    │
│  Security   │ Stabilize    │Infrastructure│   Frontend   │   Testing    │
│   2 days    │   1 week     │   2 weeks    │   5 weeks    │   2 weeks    │
│  34 hours   │  80 hours    │  60 hours    │  332 hours   │  64 hours    │
└─────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
                           10-12 weeks total (570 hours)
```

### Critical Path Dependencies

**MUST COMPLETE IN ORDER:**

1. **Phase 0** (Critical Security) → Unblocks production deployment
2. **Phase 1** (Backend Stabilization) → Unblocks frontend development
3. **Phase 2** (Infrastructure) → Unblocks efficient frontend work
4. **Phase 3** (Frontend Development) → Unblocks pilot launch
5. **Phase 4** (Testing & Launch) → Pilot ready

---

## 📋 ISSUE INVENTORY

### Total Issues by Severity

| Severity | Code | Data Model | Security | State | **Total** |
|----------|------|------------|----------|-------|-----------|
| 🔴 **CRITICAL (P0)** | 4 | 3 | 6 | 3 | **16** |
| 🟠 **HIGH (P1)** | 7 | 9 | 12 | 2 | **30** |
| 🟡 **MEDIUM (P2)** | 18 | 3 | 3 | 3 | **27** |
| 🟢 **LOW (P3)** | 12 | 1 | 1 | 2 | **16** |
| **TOTAL** | **41** | **16** | **22** | **10** | **89** |

### Critical Issues Breakdown

#### Security Vulnerabilities (6 CRITICAL)
1. **PIN Hashing** - SHA-256 without salt (offline brute force possible)
2. **PII in Logs** - User IDs exposed in Cloud Logging
3. **Cross-Group Fraud** - Agent can deposit to any group
4. **Race Condition** - Double-crediting in batch submission
5. **Data Leak** - All users can read all groups/transactions
6. **Transaction Overflow** - confirmBatch exceeds 25-op limit

#### Code Quality (4 CRITICAL)
1. **Zero Tests** - No unit, integration, or E2E tests
2. **Code Duplication** - 75% duplication across apps (648 lines)
3. **Vulnerable Dependency** - esbuild GHSA-67mh-4wv8-2f99
4. **Insecure PIN Hashing** - Same as security vulnerability

#### Data Model (3 CRITICAL)
1. **Transaction Overflow** - confirmBatch fails at 30+ transactions
2. **Unbounded Growth** - Notifications collection grows forever
3. **Write Contention** - kirimbaFund hotspot at scale

#### Project State (3 CRITICAL BLOCKERS)
1. **Firestore Rules** - Data leak risk (1 hour fix)
2. **Loan Scheduler** - markLoanDefaulted not configured (30 min fix)
3. **Fund Functions** - topUpFund, getFundStatus, getFundMovements missing (1 day)

---

## 🎯 PHASE 0: CRITICAL SECURITY FIXES (Days 0-2)

**Duration**: 2 calendar days
**Effort**: 34 hours (4.25 person-days)
**Team Size**: 2 developers (parallel execution)
**Blockers**: None
**Status**: 🔴 **MUST COMPLETE BEFORE ANY PRODUCTION DEPLOYMENT**

### Go/No-Go Criteria

- ✅ All 6 CRITICAL security vulnerabilities patched
- ✅ No data leak risks remain
- ✅ Transaction operations validated at scale (100+ transactions)
- ✅ Firestore security rules tested with all user roles
- ✅ Rollback plan documented and tested
- ✅ All Phase 0 tests passing (100% pass rate)

---

### 🔴 ISSUE 1: PIN Hashing Vulnerability

**ID**: SEC-CRIT-001, CODE-CRIT-001
**Severity**: CRITICAL (CVSS 9.1)
**Effort**: 8 hours
**Priority**: 1 (Fix first)

**Location**: [functions/src/utils.js:5-7](functions/src/utils.js#L5-L7)

**Current Vulnerability**:
```javascript
function hashPIN(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
  // ❌ No salt - rainbow table attack possible
  // ❌ SHA-256 too fast - brute force 10,000 PINs in <1 second
}
```

**Attack Scenario**:
1. Attacker obtains pinHash from Firestore (e.g., leaked credentials)
2. Attacker brute-forces all 10,000 4-digit PINs offline (<100ms)
3. Attacker gains access to ANY member account
4. Attacker requests fraudulent loans, views sensitive data

**Fix Implementation**:
```javascript
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12; // 2^12 iterations

async function hashPIN(pin) {
  const normalizedPIN = String(pin).padStart(4, '0');
  return await bcrypt.hash(normalizedPIN, SALT_ROUNDS);
}

async function verifyPIN(inputPIN, storedHash) {
  const normalizedPIN = String(inputPIN).padStart(4, '0');
  return await bcrypt.compare(normalizedPIN, storedHash);
}
```

**Migration Strategy**:
```javascript
// Mark all users for PIN reset
exports.migratePINHashes = functions.https.onCall(async (data, context) => {
  const usersSnap = await db.collection('users').get();
  const batch = db.batch();

  usersSnap.forEach((doc) => {
    batch.update(doc.ref, {
      pinHash: null,
      pinMigrationRequired: true,
      pinMigrationDate: FieldValue.serverTimestamp(),
    });
  });

  await batch.commit();
  return { migratedCount: usersSnap.size };
});
```

**Rate Limiting** (prevent brute force):
```javascript
const MAX_PIN_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

async function checkPINAttempts(userId) {
  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  const user = userSnap.data();

  const now = Date.now();
  const lockoutUntil = user.pinLockoutUntil?.toMillis() || 0;

  if (now < lockoutUntil) {
    const remainingMin = Math.ceil((lockoutUntil - now) / 60000);
    throw new Error(`Account locked. Try again in ${remainingMin} minutes.`);
  }

  const attempts = user.pinAttempts || 0;
  if (attempts >= MAX_PIN_ATTEMPTS) {
    await userRef.update({
      pinLockoutUntil: new Date(now + LOCKOUT_DURATION_MS),
      pinAttempts: 0,
    });
    throw new Error('Too many failed attempts. Account locked for 15 minutes.');
  }
}
```

**Testing Requirements**:
```javascript
describe('PIN Security', () => {
  test('Different PINs produce different hashes', async () => {
    const hash1 = await hashPIN('1234');
    const hash2 = await hashPIN('1234');
    expect(hash1).not.toBe(hash2); // bcrypt uses unique salt
  });

  test('PIN verification succeeds for correct PIN', async () => {
    const hash = await hashPIN('5678');
    expect(await verifyPIN('5678', hash)).toBe(true);
  });

  test('PIN verification fails for incorrect PIN', async () => {
    const hash = await hashPIN('5678');
    expect(await verifyPIN('9999', hash)).toBe(false);
  });

  test('Account locked after 3 failed attempts', async () => {
    // Simulate 3 failed PIN attempts
    for (let i = 0; i < 3; i++) {
      await attemptLogin(userId, 'wrongPIN');
    }

    // 4th attempt should throw lockout error
    await expect(attemptLogin(userId, 'correctPIN'))
      .rejects.toThrow('Account locked');
  });

  test('Hash time is reasonable (<500ms)', async () => {
    const start = Date.now();
    await hashPIN('1234');
    const duration = Date.now() - start;
    expect(duration).toBeLessThan(500);
  });
});
```

**Deployment Steps**:
1. Install bcrypt: `npm install --save bcrypt`
2. Deploy new hashPIN/verifyPIN functions
3. Run migratePINHashes (marks all users for reset)
4. Send SMS/notification to all users: "Please reset your PIN on next login"
5. Monitor error rates for 24 hours
6. Remove old SHA-256 code after 7 days

**Rollback Plan**:
- Keep SHA-256 fallback for 7 days
- If >10% users unable to login, revert to SHA-256
- Document: "Temporary security degradation for user access"

**Dependencies**:
- `bcrypt` package (production dependency)
- SMS notification service (optional)

**Files Modified**:
- `/Users/theo/kirimba-banking/functions/src/utils.js`
- `/Users/theo/kirimba-banking/functions/package.json`

---

### 🔴 ISSUE 2: PII Exposure in Console Logs

**ID**: SEC-CRIT-002
**Severity**: CRITICAL (CVSS 8.8)
**Effort**: 2 hours
**Priority**: 2

**Location**: [functions/index.js:60-86](functions/index.js#L60-L86)

**Current Vulnerability**:
```javascript
console.log(`User profile already exists for ${uid}, skipping create`);
console.log(`Wallet already exists for ${uid}, skipping create`);
console.log(`User initialization completed for ${uid}`);
console.error(`Error creating user/wallet for ${uid}:`, error);
```

**Issue**: User IDs logged to Cloud Logging, accessible for 30+ days, GDPR/POPIA violation

**Fix Implementation**:
```javascript
// ❌ BAD - Exposes UID
console.log(`User initialization completed for ${uid}`);

// ✅ GOOD - No PII
console.log('User initialization completed');

// ✅ BETTER - Structured logging without PII
functions.logger.info('User initialization completed', {
  hasProfile: userSnap.exists,
  hasWallet: walletSnap.exists,
  timestamp: new Date().toISOString(),
});
```

**Log Sanitization Helper**:
```javascript
function sanitizeLogData(data) {
  const sanitized = { ...data };
  const sensitiveFields = [
    'uid', 'userId', 'email', 'phone', 'phoneNumber',
    'nationalId', 'fullName', 'pinHash'
  ];

  sensitiveFields.forEach(field => {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  });

  return sanitized;
}

// Usage
console.log('User created', sanitizeLogData({ uid, email, phone }));
// Output: { uid: '[REDACTED]', email: '[REDACTED]', phone: '[REDACTED]' }
```

**Testing Requirements**:
```bash
# Find all UIDs in logs
grep -r "console.log.*uid" functions/src/
grep -r "console.error.*uid" functions/src/
grep -r "console.warn.*uid" functions/src/

# Verify no UIDs in output
npm run build
grep -r "console\\.log.*uid" functions/lib/
```

**Files Modified**:
- `/Users/theo/kirimba-banking/functions/index.js`
- `/Users/theo/kirimba-banking/functions/src/members.js`
- `/Users/theo/kirimba-banking/functions/src/savings.js`
- `/Users/theo/kirimba-banking/functions/src/loans.js`

---

### 🔴 ISSUE 3: Cross-Group Deposit Fraud

**ID**: SEC-CRIT-003
**Severity**: CRITICAL (CVSS 9.3)
**Effort**: 4 hours
**Priority**: 3

**Location**: [functions/src/savings.js:106-172](functions/src/savings.js#L106-L172)

**Current Vulnerability**:
```javascript
exports.recordDeposit = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const userId = String(data?.userId || "").trim(); // ❌ ATTACKER CONTROLLED
  // ❌ NO CHECK that userId belongs to agent's group

  const memberState = await getActiveMemberAndGroup(userId); // Gets ANY user
  // ... transaction created for arbitrary user/group
});
```

**Attack Scenario**:
1. Agent A assigned to Group X
2. Agent A identifies Member B in Group Y (via social engineering)
3. Agent A calls `recordDeposit({ userId: Member B, amount: 1000000 })`
4. System credits 1M BIF to Member B (wrong group)
5. Umuco confirms batch → funds permanently credited
6. Kirimba Fund loses 1M BIF

**Fix Implementation**:
```javascript
exports.recordDeposit = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const agentId = context.auth.uid;
  const userId = String(data?.userId || "").trim();
  const amount = parseAmount(data?.amount, AMOUNT_LIMITS.deposit);

  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }

  await db.runTransaction(async (tx) => {
    // ✅ Get agent's assigned groups
    const agentDoc = await tx.get(db.collection('agents').doc(agentId));
    if (!agentDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Agent profile not found');
    }

    const agentData = agentDoc.data();
    const allowedGroups = agentData.assignedGroups || [];

    if (allowedGroups.length === 0) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Agent not assigned to any groups'
      );
    }

    // ✅ Get member's group
    const memberDoc = await tx.get(db.collection('members').doc(userId));
    if (!memberDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Member not found');
    }

    const memberGroupId = memberDoc.data().groupId;

    // ✅ CRITICAL: Verify agent has access to member's group
    if (!allowedGroups.includes(memberGroupId)) {
      functions.logger.error('Cross-group deposit attempt blocked', {
        agentId: '[REDACTED]',
        userId: '[REDACTED]',
        memberGroupId,
        allowedGroups,
      });

      throw new functions.https.HttpsError(
        'permission-denied',
        'Agent cannot record deposits for this member'
      );
    }

    // Proceed with deposit...
  });
});
```

**Agent Schema Update**:
```javascript
// agents collection
{
  uid: "agent_123",
  fullName: "John Agent",
  assignedGroups: ["group_A", "group_C"], // ✅ Explicit assignments
  status: "active",
  createdAt: Timestamp,
}
```

**Testing Requirements**:
```javascript
describe('Cross-Group Authorization', () => {
  test('Agent can record deposit for own group', async () => {
    const agent = { uid: 'agent1', assignedGroups: ['groupA'] };
    const member = { uid: 'member1', groupId: 'groupA' };

    await expect(recordDeposit({ userId: member.uid, amount: 1000 }, agent))
      .resolves.toBeDefined();
  });

  test('Agent CANNOT record deposit for other group', async () => {
    const agent = { uid: 'agent1', assignedGroups: ['groupA'] };
    const member = { uid: 'member2', groupId: 'groupB' };

    await expect(recordDeposit({ userId: member.uid, amount: 1000 }, agent))
      .rejects.toThrow('permission-denied');
  });

  test('Unassigned agent cannot record any deposits', async () => {
    const agent = { uid: 'agent3', assignedGroups: [] };
    const member = { uid: 'member1', groupId: 'groupA' };

    await expect(recordDeposit({ userId: member.uid, amount: 1000 }, agent))
      .rejects.toThrow('not assigned to any groups');
  });
});
```

**Data Migration** (assign existing agents to groups):
```javascript
exports.assignAgentsToGroups = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.ADMIN]);

  // Get all groups
  const groupsSnap = await db.collection('groups').get();

  // Assign each group's creator as agent (if they're an agent)
  const batch = db.batch();

  for (const groupDoc of groupsSnap.docs) {
    const group = groupDoc.data();
    const agentId = group.createdBy || group.leaderId;

    if (agentId) {
      const agentRef = db.collection('agents').doc(agentId);
      batch.set(agentRef, {
        assignedGroups: FieldValue.arrayUnion(groupDoc.id),
      }, { merge: true });
    }
  }

  await batch.commit();
  return { success: true };
});
```

**Files Modified**:
- `/Users/theo/kirimba-banking/functions/src/savings.js`
- `/Users/theo/kirimba-banking/functions/src/members.js` (agent registration)

---

### 🔴 ISSUE 4: Race Condition in submitBatch

**ID**: SEC-CRIT-004, DATA-CRIT-04
**Severity**: CRITICAL (CVSS 9.0)
**Effort**: 4 hours
**Priority**: 4

**Location**: [functions/src/savings.js:174-261](functions/src/savings.js#L174-L261)

**Current Vulnerability**:
```javascript
exports.submitBatch = functions.https.onCall(async (data, context) => {
  const transactionIds = [...new Set(incomingIds)]; // ❌ Dedup outside transaction

  await db.runTransaction(async (tx) => {
    const txSnaps = await Promise.all(txRefs.map((ref) => tx.get(ref)));

    txSnaps.forEach((snap) => {
      if (snap.data().batchId) {
        // ❌ RACE CONDITION! Two calls can both see batchId === null
        throw httpsError("failed-precondition", "Already in batch");
      }
    });
  });
});
```

**Race Timeline**:
```
T0: Agent1 calls submitBatch([txn1, txn2])
T1: Agent2 calls submitBatch([txn1, txn2])  ← Same transactions!

T2: Agent1 reads txn1.batchId = null ✓
T3: Agent2 reads txn1.batchId = null ✓ ← Both see null!

T4: Agent1 creates batch1
T5: Agent2 creates batch2

T6: Agent1 sets txn1.batchId = batch1
T7: Agent2 sets txn1.batchId = batch2 ← OVERWRITES!

T8: Both batches committed
T9: When confirmed → deposits credited TWICE
```

**Fix Implementation**:
```javascript
exports.submitBatch = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.AGENT]);

  const agentId = context.auth.uid;
  const groupId = String(data?.groupId || "").trim();
  const incomingIds = Array.isArray(data?.transactionIds) ? data.transactionIds : [];
  const transactionIds = [...new Set(incomingIds.map(String).filter(Boolean))];

  // ✅ Client provides idempotency token
  const idempotencyToken = data.idempotencyToken ||
    `${agentId}_${groupId}_${Date.now()}`;

  // ✅ Check if already processed (idempotency)
  const existingBatch = await db.collection('depositBatches')
    .where('idempotencyToken', '==', idempotencyToken)
    .limit(1)
    .get();

  if (!existingBatch.empty) {
    const batch = existingBatch.docs[0].data();
    return {
      success: true,
      batchId: existingBatch.docs[0].id,
      alreadyExists: true,
      totalAmount: batch.totalAmount,
    };
  }

  const batchRef = db.collection("depositBatches").doc();
  let result = null;

  await db.runTransaction(async (tx) => {
    // ✅ ALL reads happen atomically in transaction
    const txRefs = transactionIds.map(id =>
      db.collection("depositTransactions").doc(id)
    );
    const txSnaps = await Promise.all(txRefs.map(ref => tx.get(ref)));

    // ✅ Atomic validation
    const alreadyBatched = txSnaps.filter(snap =>
      snap.exists && snap.data().batchId
    );

    if (alreadyBatched.length > 0) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `${alreadyBatched.length} transactions already in batch`
      );
    }

    // Calculate total
    let totalAmount = 0;
    txSnaps.forEach(snap => {
      totalAmount += Number(snap.data().amount || 0);
    });

    // ✅ Create batch WITHIN transaction
    tx.set(batchRef, {
      groupId,
      agentId,
      transactionIds,
      totalAmount,
      status: 'pending',
      idempotencyToken, // ✅ Store for idempotency
      submittedAt: FieldValue.serverTimestamp(),
      submittedBy: agentId,
    });

    // ✅ Update transactions atomically
    txRefs.forEach((ref) => {
      tx.update(ref, {
        batchId: batchRef.id,
        batchedAt: FieldValue.serverTimestamp(),
      });
    });

    result = {
      batchId: batchRef.id,
      totalAmount,
      transactionCount: transactionIds.length,
    };
  });

  return { success: true, ...result };
});
```

**Client-Side Integration**:
```javascript
import { v4 as uuidv4 } from 'uuid';

async function submitBatch(groupId, transactionIds) {
  const idempotencyToken = uuidv4(); // Generate once

  try {
    const result = await submitBatchFunction({
      groupId,
      transactionIds,
      idempotencyToken,
    });

    return result;
  } catch (error) {
    if (error.code === 'unavailable') {
      // Network error - retry with SAME token
      return await submitBatchFunction({
        groupId,
        transactionIds,
        idempotencyToken, // ✅ Same token = idempotent
      });
    }
    throw error;
  }
}
```

**Testing Requirements**:
```javascript
describe('submitBatch Race Condition', () => {
  test('Concurrent submissions create only one batch', async () => {
    const txnIds = ['txn1', 'txn2', 'txn3'];

    // Submit in parallel
    const [result1, result2] = await Promise.allSettled([
      submitBatch({ groupId: 'groupA', transactionIds: txnIds }),
      submitBatch({ groupId: 'groupA', transactionIds: txnIds }),
    ]);

    // One succeeds, one fails with "already in batch"
    expect([result1.status, result2.status]).toContain('rejected');
    expect([result1.status, result2.status]).toContain('fulfilled');
  });

  test('Idempotency token returns existing batch', async () => {
    const token = uuidv4();

    const result1 = await submitBatch({
      idempotencyToken: token,
      transactionIds: ['txn1'],
    });

    const result2 = await submitBatch({
      idempotencyToken: token, // ✅ Same token
      transactionIds: ['txn1'],
    });

    expect(result1.batchId).toBe(result2.batchId);
    expect(result2.alreadyExists).toBe(true);
  });
});
```

**Files Modified**:
- `/Users/theo/kirimba-banking/functions/src/savings.js`
- `/Users/theo/kirimba-banking/apps/agent/src/services/batch.js` (client)

---

### 🔴 ISSUE 5: confirmBatch Transaction Overflow

**ID**: DATA-CRIT-001
**Severity**: CRITICAL
**Effort**: 6 hours
**Priority**: 5

**Location**: [functions/src/savings.js:397-530](functions/src/savings.js#L397-L530)

**Current Vulnerability**:
```javascript
await db.runTransaction(async (tx) => {
  // ❌ Reads ALL groups (50-200 ops)
  const groupsQuerySnap = await tx.get(db.collection("groups"));

  // ❌ Reads ALL transactions in batch (10-50 ops)
  const txnsSnapshot = await tx.get(
    db.collection("depositTransactions").where("batchId", "==", batchId)
  );

  // Total: 50 groups + 30 txns + 30 members + 10 group updates + misc
  // = 144 operations
  // Firestore limit: 25 operations
  // Result: FUNCTION FAILS ❌
});
```

**When This Fails**:
- At 50 groups + 30 transactions: 144 operations (5.7× over limit)
- At 30 groups + 20 transactions: 94 operations (3.7× over limit)
- At 10 groups + 10 transactions: 44 operations (1.7× over limit)

**Fix Implementation** (use Batch API instead):
```javascript
exports.confirmBatch = functions.https.onCall(async (data, context) => {
  await requireRole(context, [ROLES.UMUCO]);

  const batchId = String(data?.batchId || "").trim();
  const batchRef = db.collection("depositBatches").doc(batchId);

  // ✅ Read OUTSIDE transaction (no 25-op limit on reads)
  const batchDoc = await batchRef.get();
  if (!batchDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Batch not found');
  }

  const batchData = batchDoc.data();
  if (batchData.status !== 'pending') {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Batch already ${batchData.status}`
    );
  }

  // ✅ Read ALL transactions (outside transaction)
  const txnsSnapshot = await db.collection("depositTransactions")
    .where("batchId", "==", batchId)
    .get();

  if (txnsSnapshot.empty) {
    throw new functions.https.HttpsError('not-found', 'No transactions in batch');
  }

  // ✅ Calculate totals IN-MEMORY (no Firestore reads)
  let totalConfirmed = 0;
  const memberUpdates = new Map(); // memberId -> amount
  const groupUpdates = new Map(); // groupId -> amount

  txnsSnapshot.forEach(doc => {
    const txn = doc.data();
    totalConfirmed += txn.amount;

    memberUpdates.set(txn.userId,
      (memberUpdates.get(txn.userId) || 0) + txn.amount
    );

    groupUpdates.set(txn.groupId,
      (groupUpdates.get(txn.groupId) || 0) + txn.amount
    );
  });

  // ✅ Use Batch API (500-op limit instead of 25)
  const batch = db.batch();

  // Update batch status (1 op)
  batch.update(batchRef, {
    status: 'confirmed',
    confirmedBy: context.auth.uid,
    confirmedAt: FieldValue.serverTimestamp(),
    totalAmount: totalConfirmed,
  });

  // Update transactions (N ops)
  txnsSnapshot.forEach(doc => {
    batch.update(doc.ref, {
      status: 'confirmed',
      confirmedAt: FieldValue.serverTimestamp(),
    });
  });

  // Update members (M ops)
  memberUpdates.forEach((amount, userId) => {
    batch.update(db.collection('members').doc(userId), {
      currentSavings: FieldValue.increment(amount),
      pendingSavings: FieldValue.increment(-amount),
    });
  });

  // Update groups (G ops)
  groupUpdates.forEach((amount, groupId) => {
    batch.update(db.collection('groups').doc(groupId), {
      totalSavings: FieldValue.increment(amount),
    });
  });

  // ✅ Update fund with increment (NO group reads needed)
  batch.set(
    db.collection('kirimbaFund').doc('current'),
    {
      totalCollateral: FieldValue.increment(totalConfirmed),
      lastUpdated: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  // Audit log (1 op)
  batch.set(db.collection('auditLog').doc(), {
    action: 'batch_confirmed',
    batchId,
    confirmedBy: context.auth.uid,
    totalAmount: totalConfirmed,
    transactionCount: txnsSnapshot.size,
    timestamp: FieldValue.serverTimestamp(),
  });

  // ✅ Commit batch (atomic, up to 500 ops)
  await batch.commit();

  return {
    success: true,
    totalAmount: totalConfirmed,
    transactionCount: txnsSnapshot.size,
  };
});
```

**Operation Count Analysis**:
```
Old: Transaction API (25-op limit)
  - Read all groups: 50 ops
  - Read transactions: 30 ops
  - Update batch: 1 op
  - Update transactions: 30 ops
  - Update members: 30 ops
  - Update groups: 10 ops
  - Update fund: 1 op
  TOTAL: 152 ops → FAILS ❌

New: Batch API (500-op limit)
  - Update batch: 1 op
  - Update transactions: 30 ops
  - Update members: 30 ops
  - Update groups: 10 ops
  - Update fund: 1 op
  - Audit log: 1 op
  TOTAL: 73 ops → SUCCEEDS ✅
```

**Testing Requirements**:
```javascript
describe('confirmBatch Scale Tests', () => {
  test('Handles 50 transactions', async () => {
    const txnIds = Array.from({ length: 50 }, (_, i) => `txn_${i}`);
    const batchId = await submitBatch({ transactionIds: txnIds });

    await expect(confirmBatch({ batchId }))
      .resolves.toBeDefined();
  });

  test('Handles 100 transactions', async () => {
    const txnIds = Array.from({ length: 100 }, (_, i) => `txn_${i}`);
    const batchId = await submitBatch({ transactionIds: txnIds });

    await expect(confirmBatch({ batchId }))
      .resolves.toBeDefined();
  });

  test('Handles 200 transactions (stress test)', async () => {
    const txnIds = Array.from({ length: 200 }, (_, i) => `txn_${i}`);
    const batchId = await submitBatch({ transactionIds: txnIds });

    const start = Date.now();
    await confirmBatch({ batchId });
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(10000); // <10s timeout
  });

  test('Fund balance updated correctly', async () => {
    const fundBefore = await getFundBalance();

    await confirmBatch({ batchId: 'batch_100k' });

    const fundAfter = await getFundBalance();
    expect(fundAfter).toBe(fundBefore + 100000);
  });
});
```

**Files Modified**:
- `/Users/theo/kirimba-banking/functions/src/savings.js`

---

### 🔴 ISSUE 6: Firestore Security Rules - Data Leak

**ID**: CFG-SEC-HIGH-001, DATA-CRIT-03
**Severity**: CRITICAL
**Effort**: 2 hours
**Priority**: 6

**Location**: [firestore.rules:52,67,94](firestore.rules#L52)

**Current Vulnerability**:
```javascript
match /groups/{groupId} {
  allow read: if isSignedIn() && (isAdmin() || isAgent() || isUmuco() || isLeader() || isMember());
  // ❌ ANY authenticated user can read ANY group
}

match /depositTransactions/{txnId} {
  allow read: if isSignedIn() && (isAdmin() || isAgent() || isUmuco() || isMember());
  // ❌ ANY member can read ANY transaction
}

match /loans/{loanId} {
  allow read: if isSignedIn() && (isAdmin() || isAgent() || isUmuco() || isMember());
  // ❌ ANY member can read ANY loan
}
```

**Fix Implementation**:
```javascript
match /groups/{groupId} {
  allow read: if isSignedIn() && (
    isAdmin() ||
    isAgent() ||
    isUmuco() ||
    // ✅ Member must BELONG to this group
    get(/databases/$(database)/documents/groups/$(groupId)).data.memberIds.hasAny([request.auth.uid])
  );
  allow write: if isSignedIn() && isAdmin();
}

match /depositTransactions/{txnId} {
  allow read: if isSignedIn() && (
    isAdmin() ||
    isAgent() ||
    isUmuco() ||
    // ✅ Member must OWN this transaction
    resource.data.userId == request.auth.uid
  );
  allow write: if isSignedIn() && (isAgent() || isAdmin());
}

match /loans/{loanId} {
  allow read: if isSignedIn() && (
    isAdmin() ||
    isAgent() ||
    isUmuco() ||
    // ✅ Member must OWN this loan
    resource.data.userId == request.auth.uid
  );
  allow create: if isSignedIn() && isMember() &&
    request.resource.data.userId == request.auth.uid;
  allow update: if isSignedIn() && (isAdmin() || isAgent());
}
```

**Testing Requirements**:
```bash
# Test Firestore Rules in Emulator
firebase emulators:start --only firestore

# Run rules tests
npm run test:rules
```

```javascript
// firestore.rules.test.js
describe('Firestore Security Rules', () => {
  test('Member can read own group', async () => {
    const db = getFirestore('member_user_id');
    const groupRef = doc(db, 'groups', 'groupA');

    // groupA.memberIds contains member_user_id
    await expect(getDoc(groupRef)).resolves.toBeDefined();
  });

  test('Member CANNOT read other groups', async () => {
    const db = getFirestore('member_user_id');
    const groupRef = doc(db, 'groups', 'groupB');

    // groupB.memberIds does NOT contain member_user_id
    await expect(getDoc(groupRef)).rejects.toThrow('permission-denied');
  });

  test('Member can read own transactions', async () => {
    const db = getFirestore('member_user_id');
    const txnRef = doc(db, 'depositTransactions', 'txn_owned_by_member');

    await expect(getDoc(txnRef)).resolves.toBeDefined();
  });

  test('Member CANNOT read other transactions', async () => {
    const db = getFirestore('member_user_id');
    const txnRef = doc(db, 'depositTransactions', 'txn_owned_by_other');

    await expect(getDoc(txnRef)).rejects.toThrow('permission-denied');
  });
});
```

**Deployment**:
```bash
# Deploy rules to production
firebase deploy --only firestore:rules

# Verify rules active
firebase firestore:rules get
```

**Files Modified**:
- `/Users/theo/kirimba-banking/firestore.rules`

---

### 🔴 ISSUE 7: Notifications Unbounded Growth

**ID**: DATA-CRIT-002
**Severity**: CRITICAL
**Effort**: 3 hours
**Priority**: 7

**Location**: All notification writes across codebase

**Current Issue**:
- No TTL policy on notifications
- Grows to 240K docs/year at 1K users
- Query performance degrades over time
- Unlimited storage costs

**Fix Implementation**:

**Step 1**: Add TTL field to all notification writes
```javascript
// In all functions that create notifications
tx.set(db.collection('notifications').doc(), {
  userId: targetUserId,
  type: 'deposit_confirmed',
  message: 'Your deposit has been confirmed',
  amount: amount,
  createdAt: FieldValue.serverTimestamp(),
  expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // ✅ 90 days TTL
  read: false,
});
```

**Step 2**: Add Firestore index for cleanup
```json
// firestore.indexes.json
{
  "collectionGroup": "notifications",
  "queryScope": "COLLECTION",
  "fields": [
    { "fieldPath": "expiresAt", "order": "ASCENDING" }
  ]
}
```

**Step 3**: Create scheduled cleanup function
```javascript
exports.deleteExpiredNotifications = functions.pubsub
  .schedule('every 24 hours')
  .timeZone('Africa/Bujumbura')
  .onRun(async (context) => {
    const now = new Date();

    // Delete in batches of 500 (Firestore limit)
    let deletedCount = 0;

    while (true) {
      const expiredSnap = await db.collection('notifications')
        .where('expiresAt', '<', now)
        .limit(500)
        .get();

      if (expiredSnap.empty) break;

      const batch = db.batch();
      expiredSnap.forEach(doc => batch.delete(doc.ref));
      await batch.commit();

      deletedCount += expiredSnap.size;

      if (expiredSnap.size < 500) break;
    }

    console.log(`Deleted ${deletedCount} expired notifications`);
    return { deletedCount };
  });
```

**Testing Requirements**:
```javascript
describe('Notification TTL', () => {
  test('New notifications have expiresAt field', async () => {
    const notifRef = db.collection('notifications').doc();
    await notifRef.set({
      userId: 'user123',
      message: 'Test',
      createdAt: FieldValue.serverTimestamp(),
      expiresAt: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
    });

    const notif = (await notifRef.get()).data();
    expect(notif.expiresAt).toBeDefined();
  });

  test('Cleanup function deletes expired notifications', async () => {
    // Create expired notification
    const expiredRef = db.collection('notifications').doc();
    await expiredRef.set({
      userId: 'user123',
      message: 'Expired',
      expiresAt: new Date(Date.now() - 1000), // 1 second ago
    });

    // Run cleanup
    await deleteExpiredNotifications();

    // Verify deleted
    const doc = await expiredRef.get();
    expect(doc.exists).toBe(false);
  });
});
```

**Files Modified**:
- `/Users/theo/kirimba-banking/functions/src/members.js` (notification writes)
- `/Users/theo/kirimba-banking/functions/src/savings.js` (notification writes)
- `/Users/theo/kirimba-banking/functions/src/loans.js` (notification writes)
- `/Users/theo/kirimba-banking/functions/index.js` (export cleanup function)
- `/Users/theo/kirimba-banking/firestore.indexes.json` (add index)

---

### Phase 0 Summary

**Total Effort**: 34 hours (4.25 person-days)

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| PIN Hashing | CRITICAL | 8h | 1 |
| PII in Logs | CRITICAL | 2h | 2 |
| Cross-Group Fraud | CRITICAL | 4h | 3 |
| Race Condition | CRITICAL | 4h | 4 |
| Transaction Overflow | CRITICAL | 6h | 5 |
| Security Rules | CRITICAL | 2h | 6 |
| Notifications TTL | CRITICAL | 3h | 7 |
| **Testing & Deployment** | - | 5h | - |

**Deployment Order**:
1. Deploy log sanitization (no user impact)
2. Deploy security rules (test in staging first)
3. Deploy confirmBatch refactor + notifications TTL
4. Deploy race condition fix + group authorization
5. Deploy PIN hashing + force PIN reset (notify users)

**Success Metrics**:
- ✅ 0 CRITICAL security issues remaining
- ✅ confirmBatch handles 200+ transactions
- ✅ 100% of Phase 0 tests passing
- ✅ No production errors for 24 hours post-deploy
- ✅ <5% user complaints about PIN reset

---

## 🟠 PHASE 1: HIGH PRIORITY STABILIZATION (Week 1)

**Duration**: 5 calendar days
**Effort**: 80 hours (10 person-days)
**Team Size**: 2 developers
**Blockers**: Phase 0 completion
**Status**: Scheduled to start after Phase 0

### Go/No-Go Criteria

- ✅ Backend production-ready (100% complete)
- ✅ All HIGH security issues resolved
- ✅ Auth system fully functional with PIN verification
- ✅ PII encrypted at rest
- ✅ Comprehensive audit logging operational
- ✅ Missing fund management functions implemented
- ✅ All Phase 1 tests passing (100%)

---

### Issues Addressed (20 issues)

#### Backend Code Quality (15 hours)

**8. Code Duplication** (4 hours)
- Extract `getUserRole()` to shared utils
- Remove 3× duplication in members.js, savings.js, loans.js

**9. Function Complexity** (8 hours)
- Refactor confirmBatch into smaller functions
- Extract validation logic, calculation logic, update logic

**10. N+1 Query Pattern** (3 hours)
- Batch fetch members upfront in confirmBatch
- Reduce Firestore reads by 30×

#### Security Improvements (40 hours)

**11. Custom Claims + PIN Auth** (12 hours)
- Implement server-side PIN verification
- Use custom tokens instead of direct Firebase auth
- Add signInWithPIN() function

**12. Session Management** (6 hours)
- Add activeSessions collection
- Implement session tracking + revocation
- Add logout-all-devices function

**13. PII Encryption** (16 hours)
- Implement field-level encryption with AES-256-GCM
- Use Google Secret Manager for key management
- Migrate existing PII to encrypted format
- Implement key rotation schedule

**14. Input Validation & Rate Limiting** (6 hours)
- Add amount limits (min/max)
- Implement per-user rate limiting
- Add request complexity limits

#### Data Model Optimizations (6 hours)

**15. Overdue Loans Query** (2 hours)
- Add composite index (status ASC, dueDate ASC)
- Query directly instead of in-memory filtering

**16. Custom Claims for Roles** (3 hours)
- Use token claims instead of Firestore reads
- Save 300K reads/month (-$0.18/month)

**17. Missing Indexes** (1 hour)
- Add 3 missing Firestore indexes

#### Missing Functionality (9 hours)

**18. Fund Management Functions** (8 hours)
- Create fund.js module
- Implement topUpFund, getFundStatus, getFundMovements

**19. Loan Default Scheduler** (1 hour)
- Configure schedule in firebase.json
- Test markLoanDefaulted execution

#### Comprehensive Testing (10 hours)

**20. Audit Logging** (6 hours)
- Create immutable auditLog collection
- Log all financial operations
- Add audit query functions

---

### Phase 1 Detailed Tasks

*[Similar detailed breakdown for each of the 20 issues above]*

---

## 🔧 PHASE 2: INFRASTRUCTURE & BACKEND IMPROVEMENTS (Week 2-3)

**Duration**: 10 calendar days
**Effort**: 60 hours (7.5 person-days)
**Blockers**: Phase 1 completion

### Issues Addressed (10 issues)

1. Frontend code duplication (12h) - Create shared services package
2. Error boundaries (4h) - Add React error boundaries
3. Security headers (2h) - CSP, HSTS, X-Frame-Options
4. Environment variable security (1h) - Remove hardcoded flags
5. Error message sanitization (4h) - Prod vs dev messages
6. Distributed counter for fund (8h) - Sharded counter pattern
7. Pagination for queries (6h) - Add to 9 large queries
8. Testing infrastructure (16h) - Vitest + RTL setup
9. Monitoring & alerting (8h) - Firebase Performance
10. CI/CD pipeline (6h) - GitHub Actions

---

## 🎨 PHASE 3: FRONTEND DEVELOPMENT (Week 4-8)

**Duration**: 25 calendar days
**Effort**: 332 hours (41.5 person-days)
**Blockers**: Phase 2 completion

### Week 4-5: Agent Interface (100 hours)

**Critical Path - Blocks pilot launch**

1. Dashboard with quick actions (16h)
2. Find member + record deposit (16h)
3. Record withdrawal (12h)
4. Submit batch (12h)
5. Disburse loan (12h)
6. Record repayment (12h)
7. Testing (20h)

### Week 6: Umuco Dashboard (72 hours)

1. Batch list with filters (16h)
2. Confirm batch flow (20h)
3. Flag batch (12h)
4. Confirmed history (12h)
5. Testing (12h)

### Week 7: Admin Portal (80 hours)

1. Member approval queue (16h)
2. Group management (12h)
3. Fund management UI (16h)
4. Loans overview (12h)
5. Agents management (8h)
6. Testing (16h)

### Week 8: Member App (80 hours)

1. Savings dashboard (16h)
2. Loan request (16h)
3. Transactions history (12h)
4. Join group (12h)
5. Notifications (8h)
6. Testing (16h)

---

## 🧪 PHASE 4: TESTING & LAUNCH PREP (Week 9-10)

**Duration**: 10 calendar days
**Effort**: 64 hours (8 person-days)
**Blockers**: Phase 3 completion

1. Integration testing (16h)
2. Security audit (8h)
3. Performance testing (12h)
4. User acceptance testing (16h)
5. Documentation (12h)
6. Deployment prep (8h)

---

## 📊 CONSOLIDATED EFFORT ESTIMATES

### By Phase

| Phase | Duration | Effort (Hours) | Effort (Days) | Team Size |
|-------|----------|----------------|---------------|-----------|
| **Phase 0: Critical Security** | 2 days | 34 | 4.25 | 2 devs |
| **Phase 1: Stabilization** | 5 days | 80 | 10.0 | 2 devs |
| **Phase 2: Infrastructure** | 10 days | 60 | 7.5 | 2 devs |
| **Phase 3: Frontend** | 25 days | 332 | 41.5 | 2 devs |
| **Phase 4: Testing & Launch** | 10 days | 64 | 8.0 | 2 devs |
| **TOTAL** | **52 days** | **570** | **71.25** | - |

### By Severity

| Priority | Issues | Effort (Hours) | % of Total |
|----------|--------|----------------|------------|
| CRITICAL (P0) | 16 | 98 | 17% |
| HIGH (P1) | 30 | 184 | 32% |
| MEDIUM (P2) | 27 | 120 | 21% |
| LOW (P3) | 16 | 40 | 7% |
| Testing | - | 108 | 19% |
| Deployment | - | 20 | 4% |
| **TOTAL** | **89** | **570** | **100%** |

### By Category

| Category | Effort (Hours) | % of Total |
|----------|----------------|------------|
| Security | 158 | 28% |
| Frontend Development | 332 | 58% |
| Backend Improvements | 48 | 8% |
| Testing | 108 | 19% |
| DevOps | 34 | 6% |

---

## 🗺️ DEPENDENCY GRAPH

```
START
  ↓
Phase 0 (2 days) - Parallel execution:
  ├─ PIN Security (8h) ────────────┐
  ├─ PII Logs (2h) ────────────────┤
  ├─ Group Auth (4h) ──────────────┤
  ├─ Race Condition (4h) ──────────┤
  ├─ confirmBatch (6h) ────────────┤→ Testing (5h)
  ├─ Security Rules (2h) ──────────┤
  └─ Notifications TTL (3h) ───────┘
  ↓
Phase 1 (1 week) - Sequential dependencies:
  ├─ Backend Refactoring (15h)
  │   ↓
  ├─ Auth System Overhaul (18h) ← Depends on PIN fix
  │   ↓
  ├─ PII Encryption (16h) ← Depends on auth
  │   ↓
  ├─ Missing Functions (9h)
  │   ↓
  └─ Testing (10h)
  ↓
Phase 2 (2 weeks) - Can partially overlap:
  ├─ Shared Components (12h)
  │   ↓
  ├─ Testing Infrastructure (16h) ← CRITICAL for Phase 3
  │   ↓
  ├─ Security Headers (2h)
  ├─ Rate Limiting (6h)
  └─ Monitoring (8h)
  ↓
Phase 3 (5 weeks) - MUST be sequential:
  ├─ Agent Interface (100h) ← BLOCKS pilot launch
  │   ↓
  ├─ Umuco Dashboard (72h) ← BLOCKS batch confirmation
  │   ↓
  ├─ Admin Portal (80h)
  │   ↓
  └─ Member App (80h)
  ↓
Phase 4 (2 weeks) - Parallel testing:
  ├─ Integration Tests (16h)
  ├─ Security Audit (8h)
  ├─ Performance Tests (12h)
  └─ UAT (16h)
  ↓
PILOT LAUNCH
```

---

## ⚠️ RISK MITIGATION STRATEGIES

### Critical Risks

#### 1. PIN Migration Failure (HIGH RISK)
**Risk**: Users unable to log in after bcrypt migration

**Mitigation**:
- Gradual rollout: 5% → 50% → 100%
- Keep SHA-256 fallback for 7 days
- Send SMS notification before migration
- Provide manual PIN reset via admin portal

**Rollback Plan**:
- Revert to SHA-256 if >10% users cannot login
- Document: "Temporary security degradation for access"

#### 2. confirmBatch Breaking Existing Batches (HIGH RISK)
**Risk**: In-progress batches fail after deployment

**Mitigation**:
- Complete all pending confirmations before deploy
- Add backward compatibility for 24 hours
- Keep old function as confirmBatchLegacy

**Rollback Plan**:
- Route to legacy function if errors >5%
- Fix issues within 24 hours or full rollback

#### 3. Frontend Development Delays (MEDIUM RISK)
**Risk**: 5-week estimate may slip

**Mitigation**:
- Build Agent interface first (critical path)
- Use component library (shadcn/ui) for speed
- Reduce scope if needed (defer member app)

**Contingency**:
- Pilot with Agent + Umuco interfaces only
- Launch Member app post-pilot

#### 4. Data Migration Errors (HIGH RISK)
**Risk**: Data loss during PII encryption migration

**Mitigation**:
- Full Firestore export before migration
- Encrypt in batches (100 users at a time)
- Verify decryption before marking complete
- Keep plaintext fields for 7 days

**Rollback Plan**:
- Restore from Firestore export
- Decrypt all fields back to plaintext
- Retry migration with fixes

---

## ✅ GO/NO-GO CRITERIA

### Phase 0 Go Criteria
- [ ] All 6 CRITICAL security issues resolved
- [ ] confirmBatch tested with 200 transactions
- [ ] Security rules prevent data leaks
- [ ] No regressions in existing functions
- [ ] Rollback plan documented
- [ ] All Phase 0 tests passing (100%)

### Phase 1 Go Criteria
- [ ] All HIGH security issues resolved
- [ ] Backend 100% production-ready
- [ ] Auth flow tested end-to-end
- [ ] PII encrypted at rest
- [ ] Audit logging operational
- [ ] Fund management functions deployed

### Phase 2 Go Criteria
- [ ] Testing infrastructure complete
- [ ] Monitoring alerts configured
- [ ] CI/CD pipeline operational
- [ ] Shared components library created
- [ ] Performance tests passing

### Phase 3 Go Criteria
- [ ] Agent interface deployed (critical path)
- [ ] Umuco dashboard deployed
- [ ] Admin portal deployed
- [ ] Member app deployed
- [ ] E2E tests passing

### Phase 4 Go Criteria (Pilot Launch)
- [ ] All critical bugs fixed
- [ ] Security audit passed
- [ ] Performance tests passed (1000 users)
- [ ] UAT completed with 5 pilot groups
- [ ] Incident response plan documented
- [ ] Backup/restore tested

---

## 📈 SUCCESS METRICS

### Technical Metrics

| Metric | Current | Target | Measurement |
|--------|---------|--------|-------------|
| Security Grade | D (51/100) | A (90+/100) | Audit score |
| Test Coverage | 0% | 80% | Code coverage |
| CRITICAL Issues | 16 | 0 | Issue tracker |
| HIGH Issues | 30 | 0 | Issue tracker |
| Backend Completion | 95% | 100% | Feature checklist |
| Frontend Completion | 10% | 100% | Feature checklist |
| Transaction Latency | Unknown | <2s | Firebase Performance |
| Error Rate | Unknown | <1% | Cloud Logging |

### Business Metrics

| Metric | Pilot Target | Measurement |
|--------|--------------|-------------|
| Groups Onboarded | 5-15 | Admin dashboard |
| Members Enrolled | 30-100 | User count |
| Deposits Processed | 500+ | Transaction count |
| Loans Disbursed | 50+ | Loan count |
| Agent Satisfaction | 4/5 | Survey |
| Uptime | 99.5% | Firebase Status |

---

## 📁 FILES IMPACTED BY PHASE

### Phase 0 (Critical Security)
```
functions/src/utils.js - PIN hashing
functions/index.js - PII logs
functions/src/savings.js - group auth, race condition, confirmBatch
firestore.rules - security scope
functions/src/members.js - notifications TTL
firestore.indexes.json - expiresAt index
functions/package.json - bcrypt dependency
```

### Phase 1 (Stabilization)
```
functions/src/utils.js - shared getUserRole
functions/src/savings.js - refactor confirmBatch
functions/src/auth.js - NEW: PIN auth
functions/src/encryption.js - NEW: PII encryption
functions/src/fund.js - NEW: fund management
firebase.json - scheduler config
apps/*/src/services/auth.js - custom token flow
```

### Phase 2 (Infrastructure)
```
packages/shared-services/ - NEW: shared code
firebase.json - security headers
.github/workflows/ - NEW: CI/CD
vitest.config.js - NEW: testing
apps/*/src/components/ErrorBoundary.jsx - NEW
```

### Phase 3 (Frontend)
```
apps/agent/src/* - all pages/components
apps/umuco/src/* - all pages/components
apps/admin/src/* - all pages/components
apps/member/src/* - all pages/components
```

---

## 📞 PROJECT CONTACTS

- **Project Lead**: Theo
- **Technical Lead**: [To be assigned]
- **Security Reviewer**: [External auditor TBD]
- **Pilot Coordinator**: [To be assigned]

---

## 📚 RELATED DOCUMENTS

- [CODE-AUDIT.md](CODE-AUDIT.md) - Code quality audit findings
- [DATA-MODEL-REVIEW.md](DATA-MODEL-REVIEW.md) - Firestore architecture review
- [SECURITY-REPORT.md](SECURITY-REPORT.md) - Security vulnerability assessment
- [STATE.md](STATE.md) - Current project state tracker
- [CLAUDE.md](CLAUDE.md) - AI assistant codebase guide

---

## 🔄 NEXT STEPS

### This Week (Week 0)
1. ✅ Review and approve this implementation plan
2. ✅ Set up project tracking (GitHub Projects or Jira)
3. ✅ Assign team members to Phase 0 tasks
4. ✅ Schedule Phase 0 kickoff meeting
5. ✅ Backup Firestore database

### Next Week (Week 1)
1. Execute Phase 0 (Critical Security Fixes)
2. Daily standups to track progress
3. Deploy to staging environment
4. Begin Phase 1 planning

### Week 2-3
1. Complete Phase 1 (Stabilization)
2. Begin Phase 2 (Infrastructure)
3. Set up testing infrastructure
4. Configure monitoring & alerting

### Week 4-8
1. Frontend development (Phase 3)
2. Weekly demos to stakeholders
3. Collect pilot group feedback
4. Iterate based on feedback

### Week 9-10
1. Testing & launch prep (Phase 4)
2. Security audit
3. Performance testing
4. UAT with pilot groups
5. **PILOT LAUNCH** 🚀

---

**Plan Status**: 🔴 **AWAITING APPROVAL**
**Last Updated**: 2026-03-02
**Next Review**: After Phase 0 completion (2026-03-04)
**Total Implementation Time**: 10-12 weeks (570 hours)

