const { randomInt } = require("crypto");

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function randomString(length = 8) {
  let output = "";

  for (let i = 0; i < length; i += 1) {
    output += ALPHANUMERIC[randomInt(0, ALPHANUMERIC.length)];
  }

  return output;
}

function generateUserId() {
  return `user_${randomString(5)}`;
}

function generatePrivateSessionId() {
  return `private_${randomString(10)}`;
}

function generatePassword() {
  return randomString(8);
}

function sanitizeText(value, maxLength = 2000) {
  if (typeof value !== "string") {
    return "";
  }

  const cleaned = value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, maxLength);
}

function parseInteger(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateDurationMinutes(value) {
  const duration = parseInteger(value);

  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) {
    const error = new Error("Invalid duration. Use 5 to 1440 minutes.");
    error.code = "INVALID_DURATION";
    throw error;
  }

  return duration;
}

function validateMaxParticipants(value) {
  const maxParticipants = parseInteger(value);

  if (!Number.isInteger(maxParticipants) || maxParticipants < 2 || maxParticipants > 50) {
    const error = new Error("Invalid participant limit. Use 2 to 50.");
    error.code = "INVALID_MAX_PARTICIPANTS";
    throw error;
  }

  return maxParticipants;
}

function isWithinEditWindow(timestamp, windowMinutes = 10) {
  const ts = new Date(timestamp).getTime();

  if (Number.isNaN(ts)) {
    return false;
  }

  return Date.now() - ts <= windowMinutes * 60 * 1000;
}

function buildSessionLink(sessionId, origin = "", socketUrl = "") {
  const normalizedOrigin = origin ? origin.replace(/\/+$/, "") : "";
  const normalizedSocketUrl = socketUrl ? socketUrl.replace(/\/+$/, "") : "";
  const params = new URLSearchParams();

  params.set("session", sessionId);

  if (normalizedSocketUrl) {
    params.set("socketUrl", normalizedSocketUrl);
  }

  const query = params.toString();

  return normalizedOrigin ? `${normalizedOrigin}/?${query}` : `/?${query}`;
}

function normalizeUserId(input) {
  const cleaned = sanitizeText(input, 32);
  return cleaned ? cleaned.replace(/[^a-zA-Z0-9_]/g, "") : "";
}

module.exports = {
  buildSessionLink,
  generatePassword,
  generatePrivateSessionId,
  generateUserId,
  isWithinEditWindow,
  normalizeUserId,
  randomString,
  sanitizeText,
  validateDurationMinutes,
  validateMaxParticipants,
};
