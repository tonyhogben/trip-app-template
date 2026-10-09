#!/usr/bin/env bash
# Copies src/ to dist/ and stamps a build id into index.html and sw.js.
# The build id drives the "New version ready" prompt and the service worker cache.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="${1:-$ROOT/dist}"
BUILD_ID="$(date -u +%Y%m%d%H%M%S)-$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null || echo local)"

rm -rf "$DIST"
mkdir -p "$DIST"
cp -R "$ROOT/src/." "$DIST/"
find "$DIST" -name 'README.md' -delete
sed -i.bak "s|__BUILD_ID__|${BUILD_ID}|g" "$DIST/index.html" "$DIST/sw.js"
rm -f "$DIST"/*.bak
echo "Built $DIST (build $BUILD_ID)"
