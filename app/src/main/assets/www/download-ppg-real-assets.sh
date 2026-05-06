#!/usr/bin/env bash
set -euo pipefail

BASE1="https://6caab5cb-54d2-4c8f-aefe-0b0847f7cec6.gdn.poki.com/fd2b713f-fda7-4de7-bd92-9ac98f0f9e69"
BASE2="https://games.poki.com/458768/6caab5cb-54d2-4c8f-aefe-0b0847f7cec6"

mkdir -p download

{
  grep -E '^(assets/|bin/assets/|fonts/BenchNine)' logs/referenced-assets.txt || true
} | sed 's#\\u002F#/#g' | sort -u > download/ppg-real-assets.txt

echo "Assetów do próby pobrania:"
wc -l download/ppg-real-assets.txt

fetch_one() {
  rel="$1"
  mkdir -p "$(dirname "$rel")"

  for base in "$BASE1" "$BASE2"; do
    url="$base/$rel"
    echo "TRY $url"
    if command -v aria2c >/dev/null 2>&1; then
      aria2c -q -x 4 -s 4 --allow-overwrite=true -o "$(basename "$rel")" -d "$(dirname "$rel")" "$url" && return 0
    elif command -v curl >/dev/null 2>&1; then
      curl -L --fail --retry 2 -o "$rel" "$url" && return 0
    elif command -v wget >/dev/null 2>&1; then
      wget -O "$rel" "$url" && return 0
    fi
  done

  echo "FAIL $rel" >> download/ppg-real-assets.failed.txt
  return 0
}

rm -f download/ppg-real-assets.failed.txt

while read -r rel; do
  [ -z "$rel" ] && continue
  [ -f "$rel" ] && continue
  fetch_one "$rel"
done < download/ppg-real-assets.txt

echo
echo "FAILED:"
[ -f download/ppg-real-assets.failed.txt ] && cat download/ppg-real-assets.failed.txt || echo "none"
