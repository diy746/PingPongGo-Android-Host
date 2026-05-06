#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "backup-single-lobby-$TS"
for f in index.html netlib.js signaling-server.js game-cdn.poki.com/scripts/v2/poki-sdk.js; do [ -f "$f" ] && cp -a "$f" "backup-single-lobby-$TS/$(basename "$f").bak"; done
cp -a files/signaling-server.js ./signaling-server.js
cp -a files/ppg-single-lobby.json ./ppg-single-lobby.json
cp -a files/qr-overlay.js ./qr-overlay.js
cp -a files/ppg-cheat-loader.js ./ppg-cheat-loader.js
[ -f ppg-cheat.json ] || cp -a files/ppg-cheat.json ./ppg-cheat.json
/usr/bin/python3 - <<'PY'
from pathlib import Path
p=Path('netlib.js')
s=p.read_text()
old='V="ws://192.168.6.163:8124/v0/signaling"'
if old in s:
    s=s.replace(old, 'V=(typeof window!="undefined"?(window.location.protocol==="https:"?"wss://":"ws://")+window.location.hostname+":8124/v0/signaling":"ws://127.0.0.1:8124/v0/signaling")')
p.write_text(s)
PY
/usr/bin/python3 - <<'PY'
from pathlib import Path
p=Path('index.html')
s=p.read_text()
# Remove old one-off WS test if present; it hardcoded one LAN IP.
import re
s=re.sub(r'\s*<script>console\.log\("WS TEST START"\);.*?</script>', '', s, flags=re.S)
needle='<script src="netlib.js"></script>'
inject='<script src="ppg-cheat-loader.js"></script>\n\t<script src="qr-overlay.js"></script>\n\t<script src="netlib.js"></script>'
if 'ppg-cheat-loader.js' not in s:
    s=s.replace(needle, inject)
p.write_text(s)
PY
echo "Patched. Backup: backup-single-lobby-$TS"
