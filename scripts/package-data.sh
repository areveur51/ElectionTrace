#!/usr/bin/env bash
# Maintainer helper: pack local media dumps for a GitHub Release.
# Never includes .env, TLS keys, logs, or the git tree.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-${ROOT}/dist/electiontrace-data.tar.gz}"
mkdir -p "$(dirname "$OUT")"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
stage="$tmp/electiontrace-data"
mkdir -p "$stage/nyt-election-data"

shopt -s nullglob
copied=0
for f in "${ROOT}/media/"*.geojson "${ROOT}/media/"*.geojson.gz; do
  cp -a "$f" "$stage/"
  copied=1
done
for f in "${ROOT}/media/nyt-election-data/"*.json; do
  cp -a "$f" "$stage/nyt-election-data/"
  copied=1
done
if [[ "$copied" -eq 0 ]]; then
  echo "No precinct GeoJSON or night JSON under media/. Nothing to pack." >&2
  exit 1
fi
tar -czf "$OUT" -C "$tmp" electiontrace-data
echo "Wrote $OUT"
ls -lh "$OUT"
