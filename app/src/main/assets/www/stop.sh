#!/usr/bin/env bash
set -euo pipefail
BASE="$(cd "$(dirname "$0")" && pwd)"
touch "$BASE/.stop"
for f in "$BASE"/.{server,browser}.pid; do
  [ -f "$f" ] || continue
  pid="$(cat "$f" 2>/dev/null || true)"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  rm -f "$f"
done
