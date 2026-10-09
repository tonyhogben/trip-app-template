import { guard, json } from "../_auth.js";
import { cleanId, parseJson } from "../_util.js";
import { CHECKIN_VERSION_KEY, placeKey } from "../_checkins.js";

/**
 * GET /api/checkins?places=a,b,c&since=<version>
 * Unchanged since your last poll = one KV read. Otherwise one read per place (max 30).
 */
export async function onRequest({ request, env }) {
  const denied = guard(request, env, { methods: ["GET"] });
  if (denied) return denied;
  const kv = env.TRIP_KV;
  const url = new URL(request.url);
  const version = (await kv.get(CHECKIN_VERSION_KEY)) || "0";
  const since = url.searchParams.get("since");
  if (since && since === version) return json({ unchanged: true, version });

  const places = [...new Set((url.searchParams.get("places") || "").split(",").map((p) => cleanId(p, 40)).filter(Boolean))].slice(0, 30);
  const out = {};
  await Promise.all(
    places.map(async (p) => {
      const list = parseJson(await kv.get(placeKey(p)), []);
      out[p] = Array.isArray(list) ? list : [];
    })
  );
  return json({ version, places: out });
}
