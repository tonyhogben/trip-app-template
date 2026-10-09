/**
 * Shared auth + response helpers for every Pages Function.
 *
 * Two kinds of caller:
 *  - Crew (the web app): sends X-Trip-Auth = SHA-256 hex of the trip passcode.
 *    The expected value lives ONLY in the TRIP_PASS_HASH env var (never in code).
 *  - Agent (your AI builder or automation): sends Authorization: Bearer <AGENT_TOKEN>
 *    when AGENT_TOKEN is set. If AGENT_TOKEN is not set, the agent uses X-Trip-Auth
 *    like the crew (this is how the original trip ran).
 */

export function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...extra,
    },
  });
}

function safeEqual(a, b) {
  a = String(a || "");
  b = String(b || "");
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function expectedHash(env) {
  const h = String(env.TRIP_PASS_HASH || "").trim().toLowerCase();
  return /^[0-9a-f]{64}$/.test(h) ? h : "";
}

/** True when TRIP_PASS_HASH is configured. Endpoints return 503 otherwise. */
export function isConfigured(env) {
  return !!expectedHash(env);
}

export function isCrew(request, env) {
  const expected = expectedHash(env);
  if (!expected) return false;
  const got = (request.headers.get("X-Trip-Auth") || "").trim().toLowerCase();
  return safeEqual(got, expected);
}

export function isAgent(request, env) {
  const token = String(env.AGENT_TOKEN || "").trim();
  if (!token) return false;
  const m = (request.headers.get("Authorization") || "").match(/^Bearer\s+(.+)$/i);
  return !!m && safeEqual(m[1].trim(), token);
}

/** Read access: crew or agent. */
export function canRead(request, env) {
  return isCrew(request, env) || isAgent(request, env);
}

/** Status updates: agent only when AGENT_TOKEN is set, otherwise anyone with the passcode. */
export function canSetStatus(request, env) {
  return String(env.AGENT_TOKEN || "").trim() ? isAgent(request, env) : isCrew(request, env);
}

/** Wrap mode switch on the server: FEATURE_REQUESTS_CLOSED=1 rejects new requests. */
export function requestsClosed(env) {
  return /^(1|true|yes|on)$/i.test(String(env.FEATURE_REQUESTS_CLOSED || "").trim());
}

/** Common guard. Returns a Response to send back, or null to carry on. */
export function guard(request, env, { methods, check = canRead, kv = true } = {}) {
  if (methods && !methods.includes(request.method)) return json({ error: "method not allowed" }, 405);
  if (!isConfigured(env)) return json({ error: "TRIP_PASS_HASH is not set" }, 503);
  if (!check(request, env)) return json({ error: "unauthorized" }, 401);
  if (kv && !env.TRIP_KV) return json({ error: "TRIP_KV binding missing" }, 503);
  return null;
}
