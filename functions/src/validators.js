"use strict";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePhone(phone) {
  if (!isNonEmptyString(phone)) {
    return "";
  }

  const trimmed = phone.trim();
  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  return `+${trimmed}`;
}

function isValidBurundiPhone(phone) {
  const normalized = normalizePhone(phone);
  return /^\+257\d{8}$/.test(normalized);
}

function isValidPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

module.exports = {
  assert,
  isNonEmptyString,
  normalizePhone,
  isValidBurundiPhone,
  isValidPin,
};
