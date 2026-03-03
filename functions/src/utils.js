"use strict";

const bcrypt = require("bcrypt");

const SALT_ROUNDS = 12; // 2^12 iterations for strong security
const MAX_PIN_ATTEMPTS = 3;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Hash a PIN using bcrypt with salt
 * @param {string|number} pin - 4-digit PIN
 * @returns {Promise<string>} Hashed PIN
 */
async function hashPIN(pin) {
  const normalizedPIN = String(pin).padStart(4, "0");
  return await bcrypt.hash(normalizedPIN, SALT_ROUNDS);
}

/**
 * Verify a PIN against a stored hash
 * @param {string|number} inputPIN - PIN to verify
 * @param {string} storedHash - Stored bcrypt hash
 * @returns {Promise<boolean>} True if PIN matches
 */
async function verifyPIN(inputPIN, storedHash) {
  const normalizedPIN = String(inputPIN).padStart(4, "0");
  return await bcrypt.compare(normalizedPIN, storedHash);
}

/**
 * Check if user has exceeded PIN attempt limit
 * @param {FirebaseFirestore.DocumentSnapshot} userDoc - User document
 * @returns {Object} Status of lockout
 */
function checkPINLockout(userDoc) {
  const user = userDoc.data();
  const now = Date.now();
  const lockoutUntil = user.pinLockoutUntil?.toMillis() || 0;

  if (now < lockoutUntil) {
    const remainingMin = Math.ceil((lockoutUntil - now) / 60000);
    return {
      locked: true,
      message: `Account locked. Try again in ${remainingMin} minutes.`,
    };
  }

  return { locked: false };
}

/**
 * Increment failed PIN attempts and lock account if threshold exceeded
 * @param {FirebaseFirestore.DocumentReference} userRef - User document reference
 * @param {number} currentAttempts - Current number of failed attempts
 * @returns {Promise<boolean>} True if account was locked
 */
async function incrementPINAttempts(userRef, currentAttempts = 0) {
  const newAttempts = currentAttempts + 1;

  if (newAttempts >= MAX_PIN_ATTEMPTS) {
    const now = Date.now();
    await userRef.update({
      pinLockoutUntil: new Date(now + LOCKOUT_DURATION_MS),
      pinAttempts: 0,
    });
    return true; // Account locked
  }

  await userRef.update({
    pinAttempts: newAttempts,
  });
  return false; // Not locked yet
}

function calculateCreditLimit(personalSavings) {
  return Number(personalSavings || 0) * 1.5;
}

function calculateInterest(amount, termDays) {
  const rates = {
    7: 0.06,
    14: 0.05,
    30: 0.04,
  };

  const rate = rates[termDays] || 0;
  const principal = Number(amount || 0);
  const interestAmount = Math.round(principal * rate);
  const totalDue = principal + interestAmount;

  return { rate, interestAmount, totalDue };
}

function generateGroupCode() {
  const suffix = Math.floor(100 + Math.random() * 900);
  return `KRM-${suffix}`;
}

async function generateReceiptNo(db, type = "TXN") {
  const year = new Date().getFullYear();
  const counterRef = db.collection("counters").doc(`${type.toUpperCase()}_${year}`);
  const seq = await db.runTransaction(async (tx) => {
    const snap = await tx.get(counterRef);
    const next = (snap.exists ? Number(snap.data().value || 0) : 0) + 1;
    tx.set(counterRef, { value: next, updatedAt: new Date() }, { merge: true });
    return next;
  });

  return `${type.toUpperCase()}-${year}-${String(seq).padStart(5, "0")}`;
}

module.exports = {
  hashPIN,
  verifyPIN,
  checkPINLockout,
  incrementPINAttempts,
  calculateCreditLimit,
  calculateInterest,
  generateGroupCode,
  generateReceiptNo,
  MAX_PIN_ATTEMPTS,
  LOCKOUT_DURATION_MS,
};
