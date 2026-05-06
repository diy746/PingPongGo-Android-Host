#!/usr/bin/env bash
set -euo pipefail

# 1) preferuj wlan0
if command -v ip >/dev/null 2>&1; then
  IP="$(ip -4 addr show wlan0 2>/dev/null | awk '/inet /{print $2}' | cut -d/ -f1 | head -1)"
  [ -n "${IP:-}" ] && { echo "$IP"; exit 0; }

  # 2) dowolny prywatny adres LAN, bez lo/docker
  IP="$(ip -4 -o addr show scope global 2>/dev/null \
    | awk '$2 !~ /^(lo|docker|br-|veth|virbr)/ {print $4}' \
    | cut -d/ -f1 \
    | grep -E '^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)' \
    | head -1)"
  [ -n "${IP:-}" ] && { echo "$IP"; exit 0; }
fi

# 3) fallback ifconfig
if command -v ifconfig >/dev/null 2>&1; then
  IP="$(ifconfig wlan0 2>/dev/null | awk '/inet /{print $2}' | head -1)"
  [ -n "${IP:-}" ] && { echo "$IP"; exit 0; }

  IP="$(ifconfig 2>/dev/null \
    | awk '/^[a-zA-Z0-9]/ {iface=$1} /inet / && iface !~ /^lo/ {print $2}' \
    | grep -E '^(10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.|192\.168\.)' \
    | head -1)"
  [ -n "${IP:-}" ] && { echo "$IP"; exit 0; }
fi

# 4) ostatecznie localhost
echo "127.0.0.1"
