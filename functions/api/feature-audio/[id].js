import { guard } from "../../_auth.js";
import { audioKey } from "../../_features.js";
import { cleanId } from "../../_util.js";

/** GET /api/feature-audio/<audioKey>  -> the voice memo bytes */
export async function onRequest({ request, env, params }) {
  const denied = guard(request, env, { methods: ["GET"] });
  if (denied) return denied;
  const id = cleanId(params.id);
  if (!id) return new Response("not found", { status: 404 });
  const hit = await env.TRIP_KV.getWithMetadata(audioKey(id), { type: "arrayBuffer" });
  if (!hit || !hit.value) return new Response("not found", { status: 404 });
  const type = (hit.metadata && hit.metadata.contentType) || "audio/webm";
  return new Response(hit.value, {
    headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" },
  });
}
