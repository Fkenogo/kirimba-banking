const SUPPORTED_PHONE_REGEX = /^(\+257\d{8}|\+250\d{9}|\+256\d{9})$/;

export function normalizePhoneE164(rawPhone) {
  if (typeof rawPhone !== "string") return "";
  const compact = rawPhone.trim().replace(/[\s-]+/g, "");
  if (!compact) return "";
  return compact.startsWith("+") ? compact : `+${compact}`;
}

export function isValidSupportedPhone(rawPhone) {
  const normalized = normalizePhoneE164(rawPhone);
  return SUPPORTED_PHONE_REGEX.test(normalized);
}

export function phoneToAuthEmail(rawPhone) {
  return `${normalizePhoneE164(rawPhone)}@kirimba.app`;
}

export const PHONE_VALIDATION_MESSAGE =
  "Enter a valid phone number in international format, e.g. +25766123456";
