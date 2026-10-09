import { guard, json, requestsClosed } from "../_auth.js";
import { MAX_ITEMS, countItems, putRequest } from "../_features.js";
import { notifyAgent } from "../_notify.js";
import { cleanName, cleanText, newId } from "../_util.js";

/** POST /api/feature-request  JSON { title, details?, name? }  -> new request, status "open" */
export async function onRequest(context) {
  const { request, env } = context;
  const denied = guard(request, env, { methods: ["POST"] });
  if (denied) return denied;
  if (requestsClosed(env)) return json({ error: "Feature requests are closed. That's a wrap." }, 403);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const title = cleanText(body.title, 80);
  if (title.length < 2) return json({ error: "title required" }, 400);
  if ((await countItems(env.TRIP_KV)) >= MAX_ITEMS) return json({ error: "feature list full" }, 400);

  const item = {
    id: newId(12),
    createdAt: Date.now(),
    name: cleanName(body.name || ""),
    title,
    text: cleanText(body.details, 800),
    transcript: "",
    audioKey: null,
    status: "open",
  };
  await putRequest(env.TRIP_KV, item);
  context.waitUntil(notifyAgent(env, item, new URL(request.url).origin));
  return json({ ok: true, item });
}
