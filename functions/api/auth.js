import { guard, json, requestsClosed } from "../_auth.js";

/**
 * POST /api/auth  (header X-Trip-Auth)
 * Lets the passcode gate check a hash without the real hash ever shipping to the browser.
 * No KV access, so it costs nothing against KV limits (still works in archive mode).
 */
export async function onRequest({ request, env }) {
  const denied = guard(request, env, { methods: ["GET", "POST"], kv: false });
  if (denied) return denied;
  return json({ ok: true, requestsClosed: requestsClosed(env) });
}
