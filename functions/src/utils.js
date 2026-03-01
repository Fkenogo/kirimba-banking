"use strict";

const crypto = require("crypto");

function hashPIN(pin) {
  return crypto.createHash("sha256").update(String(pin)).digest("hex");
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
  calculateCreditLimit,
  calculateInterest,
  generateGroupCode,
  generateReceiptNo,
};
