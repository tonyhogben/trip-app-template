#!/usr/bin/env bash
# End-to-end check against a running app (local wrangler pages dev or a deployment).
# Usage: BASE=http://localhost:8788 PASSCODE=letmein ./scripts/smoke-test.sh
set -euo pipefail
BASE="${BASE:-http://localhost:8788}"
PASSCODE="${PASSCODE:?Set PASSCODE}"
HASH="$(node "$(dirname "$0")/hash-passcode.mjs" "$PASSCODE")"
AUTH=(-H "X-Trip-Auth: $HASH")
AGENT=()
[ -n "${AGENT_TOKEN:-}" ] && AGENT=(-H "Authorization: Bearer $AGENT_TOKEN") || AGENT=("${AUTH[@]}")
j() { curl -sS -w '\n' "$@"; }

echo "1. wrong passcode is rejected (expect 401)"; curl -sS -o /dev/null -w "%{http_code}\n" -X POST -H "X-Trip-Auth: nope" "$BASE/api/auth"
echo "2. right passcode";            j -X POST "${AUTH[@]}" "$BASE/api/auth"
echo "3. create a request";          ID="$(curl -sS -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"title":"Smoke test request","details":"Created by smoke-test.sh","name":"Person A"}' "$BASE/api/feature-request" | node -pe 'JSON.parse(require("fs").readFileSync(0)).item.id')"; echo "   id=$ID"
echo "4. list open";                 LIST="$(curl -sS "${AUTH[@]}" "$BASE/api/feature-requests?status=open")"; echo "$LIST" | head -c 300; echo
VER="$(echo "$LIST" | node -pe 'JSON.parse(require("fs").readFileSync(0)).version')"
echo "5. unchanged poll (1 KV read)"; j "${AUTH[@]}" "$BASE/api/feature-requests?since=$VER"
echo "6. agent marks building";      j -X POST "${AGENT[@]}" -H 'Content-Type: application/json' -d "{\"id\":\"$ID\",\"status\":\"building\"}" "$BASE/api/feature-status"
echo "7. agent marks done";          j -X POST "${AGENT[@]}" -H 'Content-Type: application/json' -d "{\"id\":\"$ID\",\"status\":\"done\",\"note\":\"Shipped in the smoke test\"}" "$BASE/api/feature-status"
echo "8. check in";                  j -X POST "${AUTH[@]}" -H 'Content-Type: application/json' -d '{"placeId":"d1-arrive","name":"Person A"}' "$BASE/api/checkin"
echo "9. read check-ins";            j "${AUTH[@]}" "$BASE/api/checkins?places=d1-arrive,d1-dinner"
echo "Done."
