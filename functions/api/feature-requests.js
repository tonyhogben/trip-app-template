import { guard, json, isAgent, requestsClosed } from "../_auth.js";
import { STATUSES, getVersion, listRequests, repairIndex } from "../_features.js";

/**
 * GET /api/feature-requests
 *   ?status=open|building|done|blocked   optional filter
 *   ?since=<version>                     if nothing changed, returns { unchanged: true } after ONE KV read
 *   ?repair=1                            agent only: rebuild the index with kv.list (rarely needed)
 */
export async function onRequest({ request, env }) {
  const denied = guard(request, env, { methods: ["GET"] });
  if (denied) return denied;
  const kv = env.TRIP_KV;
  const url = new URL(request.url);

  if (url.searchParams.get("repair") === "1") {
    if (!isAgent(request, env)) return json({ error: "repair needs the agent token" }, 401);
    const ids = await repairIndex(kv);
    return json({ ok: true, count: ids.length });
  }

  const version = await getVersion(kv);
  const since = url.searchParams.get("since");
  if (since && since === version) return json({ unchanged: true, version, requestsClosed: requestsClosed(env) });

  const all = await listRequests(kv);
  const filter = (url.searchParams.get("status") || "").trim().toLowerCase();
  let items = STATUSES.has(filter) ? all.filter((i) => i.status === filter) : all.slice();
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)); // newest first
  const count = (s) => all.filter((i) => i.status === s).length;

  return json({
    items,
    openCount: count("open"),
    buildingCount: count("building"),
    doneCount: count("done"),
    blockedCount: count("blocked"),
    version,
    requestsClosed: requestsClosed(env),
    polledAt: Date.now(),
  });
}
