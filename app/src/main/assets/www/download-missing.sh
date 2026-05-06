#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

LIST="./download/har-missing-bodies.aria2.txt"
[ -f "$LIST" ] || LIST="./download/urls-ppg.txt"

mkdir -p ./download/fetched

if command -v aria2c >/dev/null 2>&1; then
  aria2c -x 8 -s 8 -j 4 --continue=true --auto-file-renaming=false \
    --allow-overwrite=true --dir=./download/fetched -i "$LIST" || true
elif command -v curl >/dev/null 2>&1; then
  while read -r u; do
    [ -z "$u" ] && continue
    curl -L --fail --retry 2 -O --output-dir ./download/fetched "$u" || true
  done < "$LIST"
elif command -v wget >/dev/null 2>&1; then
  wget -c -P ./download/fetched -i "$LIST" || true
else
  echo "Brak aria2c/curl/wget"
fi
