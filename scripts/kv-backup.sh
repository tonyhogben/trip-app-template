#!/usr/bin/env bash
# Dumps every key in the TRIP_KV namespace to backups/<timestamp>/ (values as files).
# Uses kv list once plus one get per key, so run it rarely (for example at wind down).
# Usage: KV_NAMESPACE_ID=<your namespace id> ./scripts/kv-backup.sh
# Written for wrangler 3 (package.json). On wrangler 4+, add --remote to both kv commands.
set -euo pipefail
: "${KV_NAMESPACE_ID:?Set KV_NAMESPACE_ID (Cloudflare dashboard > Storage and Databases > KV)}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/backups/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$OUT/values"
npx wrangler kv key list --namespace-id "$KV_NAMESPACE_ID" > "$OUT/keys.json"
node -e 'for (const k of JSON.parse(require("fs").readFileSync(process.argv[1]))) console.log(k.name)' "$OUT/keys.json" |
while IFS= read -r key; do
  safe="$(printf '%s' "$key" | tr '/:' '__')"
  npx wrangler kv key get "$key" --namespace-id "$KV_NAMESPACE_ID" > "$OUT/values/$safe"
done
echo "Backed up $(ls "$OUT/values" | wc -l) keys to $OUT"
