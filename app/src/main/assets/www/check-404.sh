#!/usr/bin/env bash
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

echo "== expected files from index/app refs =="
grep -RhoE '["'\'']([^"'\'']+\.(js|json|png|jpg|jpeg|mp3|ogg|ttf|woff2?))["'\'']' . \
  | tr -d "\"'" \
  | sed 's#^\./##' \
  | sort -u > logs/referenced-assets.txt || true

while read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    http*|//*|data:*) continue ;;
  esac
  [ -e "$f" ] || echo "MISSING: $f"
done < logs/referenced-assets.txt | tee logs/missing-local.txt
