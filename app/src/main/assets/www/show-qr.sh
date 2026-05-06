#!/usr/bin/env bash
set -euo pipefail

IP="${1:-$(./get-lan-ip.sh)}"
CODE="${2:-}"

if [ -z "$CODE" ]; then
  echo "Usage:"
  echo "  ./show-qr.sh [IP] CODE"
  echo
  echo "Example:"
  echo "  ./show-qr.sh $IP Q2W5"
  exit 1
fi

URL="http://$IP:8123/index.html?id=$CODE"

echo
echo "JOIN LINK:"
echo "$URL"
echo

if command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "$URL"
else
  echo "qrencode not installed."
  echo "Install:"
  echo "  sudo pacman -S qrencode"
fi
