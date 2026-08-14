#!/usr/bin/env bash
# Fetch a data pack into ./media (precinct GeoJSON + optional NYT night files).
# Does not print or require secrets. Set ELECTIONTRACE_DATA_URL to a tarball/zip URL
# you host (GitHub Release recommended).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${ROOT}/media"
URL="${1:-${ELECTIONTRACE_DATA_URL:-}}"

usage() {
  cat <<EOF
Usage: $(basename "$0") [archive-url]

Downloads a .tar.gz / .tgz / .zip data pack and unpacks it into media/.
If no URL is given, uses \$ELECTIONTRACE_DATA_URL.

Example (after you publish a GitHub Release):
  ELECTIONTRACE_DATA_URL=https://github.com/areveur51/ElectionTrace/releases/download/data-2020/electiontrace-data.tar.gz \\
    ./scripts/fetch-data.sh

The pack should contain:
  precincts-with-results.geojson.gz   (or any *.geojson / *.geojson.gz)
  nyt-election-data/*.json            (optional night files)
EOF
}

if [[ -z "$URL" || "$URL" == "-h" || "$URL" == "--help" ]]; then
  usage
  exit 2
fi

mkdir -p "$DEST"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
echo "Downloading data pack…"
curl -fL --retry 3 -o "$tmp/pack.bin" "$URL"
file_guess="$(file -b "$tmp/pack.bin" || true)"
case "$file_guess" in
  *Zip*|*zip*) unzip -q -o "$tmp/pack.bin" -d "$tmp/out" ;;
  *) mkdir -p "$tmp/out" && tar -xzf "$tmp/pack.bin" -C "$tmp/out" ;;
esac
# Flatten a single top-level folder if the archive used one.
if [[ "$(find "$tmp/out" -mindepth 1 -maxdepth 1 | wc -l)" -eq 1 && -d "$(find "$tmp/out" -mindepth 1 -maxdepth 1)" ]]; then
  src="$(find "$tmp/out" -mindepth 1 -maxdepth 1 -type d)"
else
  src="$tmp/out"
fi
cp -a "$src"/. "$DEST"/
echo "Unpacked into $DEST"
ls -lh "$DEST" | sed -n '1,20p'
