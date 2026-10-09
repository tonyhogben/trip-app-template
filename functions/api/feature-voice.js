import { guard, json, requestsClosed } from "../_auth.js";
import { MAX_ITEMS, audioKey, countItems, putRequest } from "../_features.js";
import { notifyAgent } from "../_notify.js";
import { cleanName, cleanText, newId } from "../_util.js";

const MAX_AUDIO = 4_000_000; // about 4 MB, a few minutes of speech

/**
 * POST /api/feature-voice  multipart: audio (file), title?, details?, name?, transcript?
 * Stores the memo in KV and creates a request with audioKey set. The agent fetches the
 * audio from /api/feature-audio/<audioKey> and transcribes it if there is no transcript.
 */
export async function onRequest(context) {
  const { request, env } = context;
  const denied = guard(request, env, { methods: ["POST"] });
  if (denied) return denied;
  if (requestsClosed(env)) return json({ error: "Feature requests are closed. That's a wrap." }, 403);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ error: "expected multipart form" }, 400);
  }
  const file = form.get("audio");
  if (!file || typeof file === "string") return json({ error: "audio required" }, 400);
  const type = (file.type || "audio/webm").toLowerCase().split(";")[0].trim();
  if (!type.startsWith("audio/")) return json({ error: "audio only" }, 400);
  if (file.size > MAX_AUDIO) return json({ error: "voice memo too big (max about 4 MB)" }, 400);
  if (file.size < 1500) return json({ error: "No audio was captured. Check mic access and try again." }, 400);
  if ((await countItems(env.TRIP_KV)) >= MAX_ITEMS) return json({ error: "feature list full" }, 400);

  const audioId = newId(16);
  await env.TRIP_KV.put(audioKey(audioId), await file.arrayBuffer(), { metadata: { contentType: type } });

  const item = {
    id: newId(12),
    createdAt: Date.now(),
    name: cleanName(form.get("name") || ""),
    title: cleanText(form.get("title") || "", 80) || "Voice memo",
    text: cleanText(form.get("details") || "", 800),
    transcript: cleanText(form.get("transcript") || "", 2000),
    audioKey: audioId,
    audioType: type,
    status: "open",
  };
  await putRequest(env.TRIP_KV, item);
  context.waitUntil(notifyAgent(env, item, new URL(request.url).origin));
  return json({ ok: true, item });
}
