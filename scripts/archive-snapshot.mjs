#!/usr/bin/env node
// Saves the full feature request list to src/archive/features.json for archive mode.
// Usage: TRIP_URL=https://your-app.pages.dev TRIP_PASSCODE=... node scripts/archive-snapshot.mjs
// (or set TRIP_PASS_HASH instead of TRIP_PASSCODE)
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const base = (process.env.TRIP_URL || "").replace(/\/$/, "");
const hash = process.env.TRIP_PASS_HASH || (process.env.TRIP_PASSCODE ? createHash("sha256").update(process.env.TRIP_PASSCODE).digest("hex") : "");
if (!base || !hash) {
  console.error("Set TRIP_URL and TRIP_PASSCODE (or TRIP_PASS_HASH).");
  process.exit(1);
}
const res = await fetch(base + "/api/feature-requests", { headers: { "X-Trip-Auth": hash } });
if (!res.ok) {
  console.error("Request failed:", res.status, await res.text());
  process.exit(1);
}
const data = await res.json();
const out = {
  archivedAt: new Date().toISOString(),
  items: (data.items || []).map(({ id, createdAt, name, title, text, transcript, status, statusNote }) => ({ id, createdAt, name, title, text, transcript, status, statusNote })),
};
const file = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "archive", "features.json");
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out, null, 2));
console.log(`Saved ${out.items.length} requests to ${file}`);
