import { canSetStatus, guard, json } from "../_auth.js";
import { STATUSES, updateRequest } from "../_features.js";
import { cleanId, cleanText } from "../_util.js";

/**
 * POST or PATCH /api/feature-status  JSON { id, status, note? }
 * The agent calls this to move a request through open -> building -> done (or blocked).
 * Auth: Authorization: Bearer <AGENT_TOKEN> when AGENT_TOKEN is set, otherwise X-Trip-Auth.
 * Only rewrites feat:req:<id>, never other requests.
 */
export async function onRequest({ request, env }) {
  const denied = guard(request, env, { methods: ["POST", "PATCH"], check: canSetStatus });
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const id = cleanId(body.id);
  const status = String(body.status || "").trim().toLowerCase();
  if (!id) return json({ error: "id required" }, 400);
  if (!STATUSES.has(status)) return json({ error: "status must be open|building|done|blocked" }, 400);
  const note = cleanText(body.note || "", 200);

  const item = await updateRequest(env.TRIP_KV, id, (cur) => {
    cur.status = status;
    cur.statusUpdatedAt = Date.now();
    if (note) cur.statusNote = note;
    else if (body.note === "") delete cur.statusNote;
    return cur;
  });
  if (!item) return json({ error: "not found" }, 404);
  return json({ ok: true, item });
}
