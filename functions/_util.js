/** Input cleaning helpers shared by the API. */

export function cleanName(raw) {
  if (typeof raw !== "string") return "";
  return raw
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s'-]/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

export function cleanText(raw, max) {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\s+/g, " ").slice(0, max);
}

export function cleanId(raw, max = 32) {
  return String(raw || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, max);
}

export function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function newId(len = 12) {
  return crypto.randomUUID().replace(/-/g, "").slice(0, len);
}
