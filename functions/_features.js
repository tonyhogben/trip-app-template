/**
 * Feature request storage in KV (binding TRIP_KV).
 *
 * Keys:
 *   feat:req:<id>    one JSON object per request (status updates only touch this key)
 *   feat:ids         JSON array of ids, oldest first (the index)
 *   feat:version     changes on every write; clients send it back as ?since= so an
 *                    unchanged list costs ONE KV read instead of one per request
 *   feat:audio:<id>  voice memo bytes (metadata.contentType)
 *
 * Design notes from the original trip:
 *  - One blob holding every request raced when two people submitted at once, so each
 *    request has its own key and the index is merged on write.
 *  - kv.list() is the scarcest KV operation (1,000 a day on the free plan), so it is
 *    only used by repairIndex(), which an agent calls by hand if the index ever drifts.
 */

import { cleanId, parseJson } from "./_util.js";

export const IDS_KEY = "feat:ids";
export const VERSION_KEY = "feat:version";
export const MAX_ITEMS = 200;
export const STATUSES = new Set(["open", "building", "done", "blocked"]);

export const reqKey = (id) => `feat:req:${id}`;
export const audioKey = (id) => `feat:audio:${id}`;

function dedupe(ids) {
  return [...new Set(ids.filter(Boolean))];
}

export function normalizeStatus(status) {
  const st = String(status || "open").toLowerCase();
  return STATUSES.has(st) ? st : "open";
}

export async function readIds(kv) {
  const parsed = parseJson(await kv.get(IDS_KEY), []);
  return Array.isArray(parsed) ? dedupe(parsed.map((x) => cleanId(x))) : [];
}

export async function getVersion(kv) {
  return (await kv.get(VERSION_KEY)) || "0";
}

export async function bumpVersion(kv) {
  const v = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  await kv.put(VERSION_KEY, v);
  return v;
}

/** Read, union, write. A rare duplicate is fine because readers de-dupe. */
async function appendId(kv, id) {
  const current = await readIds(kv);
  if (current.includes(id)) return current;
  const merged = dedupe([...current, id]);
  await kv.put(IDS_KEY, JSON.stringify(merged));
  return merged;
}

export async function countItems(kv) {
  return (await readIds(kv)).length;
}

export async function putRequest(kv, item) {
  await kv.put(reqKey(item.id), JSON.stringify(item));
  await appendId(kv, item.id);
  await bumpVersion(kv);
  return item;
}

export async function getRequest(kv, id) {
  const item = parseJson(await kv.get(reqKey(id)), null);
  if (!item || typeof item !== "object") return null;
  return { ...item, status: normalizeStatus(item.status) };
}

export async function updateRequest(kv, id, mutator) {
  const item = await getRequest(kv, id);
  if (!item) return null;
  const next = mutator({ ...item });
  if (!next || typeof next !== "object") return null;
  next.id = id;
  await kv.put(reqKey(id), JSON.stringify(next));
  await bumpVersion(kv);
  return { ...next, status: normalizeStatus(next.status) };
}

export async function listRequests(kv) {
  const ids = await readIds(kv);
  const items = await Promise.all(ids.map((id) => getRequest(kv, id)));
  return items.filter(Boolean);
}

/** Agent-only maintenance: rebuild feat:ids from the feat:req: keys (uses kv.list). */
export async function repairIndex(kv) {
  const found = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: "feat:req:", cursor, limit: 1000 });
    for (const k of page.keys || []) found.push(cleanId(k.name.slice("feat:req:".length)));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  const merged = dedupe([...(await readIds(kv)), ...found]);
  await kv.put(IDS_KEY, JSON.stringify(merged));
  await bumpVersion(kv);
  return merged;
}
