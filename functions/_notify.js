/**
 * Optional webhook forwarder: POSTs every new feature request to your AI agent.
 *
 * Env vars (set as encrypted secrets in Cloudflare, never in code):
 *   FEATURE_WEBHOOK_URL   https URL of the agent / automation trigger. Unset = no webhook.
 *   FEATURE_WEBHOOK_AUTH  optional value for the Authorization header, for example
 *                         "Bearer abc123". People often paste the whole header line
 *                         ("Authorization: Bearer abc123"), which some receivers reject,
 *                         so a leading "Authorization:" is stripped. This was a real bug
 *                         on the original trip and the fix is kept here.
 *   TRIP_SLUG             optional label sent as "source" so one agent can serve many trips.
 *
 * Fire and forget: a failed webhook never fails the request (it is already saved in KV),
 * and the agent can always catch up with GET /api/feature-requests?status=open.
 */

export function webhookAuthHeader(raw) {
  if (!raw || typeof raw !== "string") return "";
  let auth = raw.trim();
  if (/^authorization\s*:/i.test(auth)) auth = auth.split(":").slice(1).join(":").trim();
  return auth;
}

export async function notifyAgent(env, item, origin) {
  const url = env.FEATURE_WEBHOOK_URL;
  if (!url || typeof url !== "string" || !url.startsWith("https://")) return;
  const headers = { "Content-Type": "application/json" };
  const auth = webhookAuthHeader(env.FEATURE_WEBHOOK_AUTH);
  if (auth) headers.Authorization = auth;
  const body = JSON.stringify({
    source: env.TRIP_SLUG || "trip-app",
    event: "feature-request",
    id: item.id,
    name: item.name || "",
    title: item.title || "",
    text: item.text || "",
    transcript: item.transcript || "",
    audioKey: item.audioKey || null,
    status: item.status || "open",
    createdAt: item.createdAt || Date.now(),
    // Where the agent reports back. Same auth rules as the rest of the API.
    callback: origin
      ? {
          appUrl: origin + "/",
          statusUrl: origin + "/api/feature-status",
          listUrl: origin + "/api/feature-requests?status=open",
          audioUrl: item.audioKey ? origin + "/api/feature-audio/" + item.audioKey : null,
        }
      : null,
  });
  try {
    await fetch(url, { method: "POST", headers, body });
  } catch {
    // ignore: the request is stored and can be polled
  }
}
