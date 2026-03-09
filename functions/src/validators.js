"use strict";

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizePhone(phone) {
  if (!isNonEmptyString(phone)) {
    return "";
  }

  const compact = phone.trim().replace(/[\s-]+/g, "");
  const trimmed = compact;
  if (trimmed.startsWith("+")) {
    return trimmed;
  }

  return `+${trimmed}`;
}

function isValidProvisioningPhone(phone) {
  const normalized = normalizePhone(phone);
  const supportedPatterns = [
    /^\+257\d{8}$/, // Burundi: +257 + 8 digits
    /^\+250\d{9}$/, // Rwanda: +250 + 9 digits
    /^\+256\d{9}$/, // Uganda: +256 + 9 digits
  ];

  return supportedPatterns.some((pattern) => pattern.test(normalized));
}

function isValidBurundiPhone(phone) {
  const normalized = normalizePhone(phone);
  return /^\+257\d{8}$/.test(normalized);
}

function isValidPin(pin) {
  return typeof pin === "string" && /^\d{6}$/.test(pin);
}

function phoneToAuthEmail(phone) {
  const normalized = normalizePhone(phone);
  return `${normalized}@kirimba.app`;
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
  isValidProvisioningPhone,
  isValidBurundiPhone,
  isValidPin,
  phoneToAuthEmail,
};
