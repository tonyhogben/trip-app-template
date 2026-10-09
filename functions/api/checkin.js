import { guard, json } from "../_auth.js";
import { CHECKIN_VERSION_KEY, placeKey } from "../_checkins.js";
import { cleanId, cleanName, parseJson } from "../_util.js";

const MAX_PER_PLACE = 24;
const COOLDOWN_MS = 20_000;

/** POST /api/checkin  JSON { placeId, name }  ("I'm here" on an agenda item) */
export async function onRequest({ request, env }) {
  const denied = guard(request, env, { methods: ["POST"] });
  if (denied) return denied;
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }
  const placeId = cleanId(body.placeId, 40);
  const name = cleanName(body.name);
  if (!placeId) return json({ error: "placeId required" }, 400);
  if (name.length < 2) return json({ error: "name required" }, 400);

  const kv = env.TRIP_KV;
  let list = parseJson(await kv.get(placeKey(placeId)), []);
  if (!Array.isArray(list)) list = [];
  const now = Date.now();
  const dupe = list.find((e) => e && String(e.name).toLowerCase() === name.toLowerCase() && now - (e.at || 0) < COOLDOWN_MS);
  if (dupe) return json({ ok: true, checkins: list, deduped: true });

  list.push({ name, at: now });
  list = list.slice(-MAX_PER_PLACE);
  await kv.put(placeKey(placeId), JSON.stringify(list));
  await kv.put(CHECKIN_VERSION_KEY, now.toString(36));
  return json({ ok: true, checkins: list });
}
