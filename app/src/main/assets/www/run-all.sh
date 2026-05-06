#!/usr/bin/env bash
set -euo pipefail

BASE="$(cd "$(dirname "$0")" && pwd)"
cd "$BASE"

mkdir -p logs

# stop tylko stare PID-y z naszych plików
for f in .server.pid .signaling.pid .browser.pid; do
  [ -f "$f" ] || continue
  pid="$(cat "$f" 2>/dev/null || true)"
  [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  rm -f "$f"
done

node "$BASE/signaling-server.js" > logs/signaling.log 2>&1 &
echo $! > .signaling.pid

frankenphp php-server -l 0.0.0.0:8123 -r "$BASE" > logs/server.log 2>&1 &
echo $! > .server.pid

sleep 1

IP="$("$BASE/get-lan-ip.sh")"
URL="http://$IP:8123/index.html"

echo "OPEN: $URL"
echo "STATUS:"
ss -ltnp | grep -E ':8123|:8124' || true

brave --user-data-dir="$BASE/.browser-profile" "$URL" > logs/browser.log 2>&1 &
echo $! > .browser.pid
