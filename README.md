# PingPongGo Android Host Helper

Minimal Android helper app for offline/LAN PingPongGo testing.

## Purpose

Phone A acts as HOST:

- creates/uses Android hotspot manually
- runs local HTTP server on port `8123`
- runs WebSocket signaling server on port `8124`
- serves existing HTML5 game files from `app/src/main/assets/www/`
- shows QR invite for guest
- exposes manual ZIP download at `/download/PingPongGo-LAN.zip`

Phone B acts as GUEST:

- connects to Phone A hotspot
- scans QR
- opens browser game
- joins fixed lobby `GUEST`

## Important

This starter package contains placeholder game files only. Replace:

```text
app/src/main/assets/www/index.html
app/src/main/assets/www/app.js
app/src/main/assets/www/assets/...
```

with the real PingPongGo HTML5 files.

Keep these helper scripts in `assets/www/` and reference them from the real `index.html`:

```html
<script src="ppg-lan-patch.js"></script>
<script src="ppg-lan-autojoin.js"></script>
```

Recommended placement: after local Poki/offline shim, before or after `app.js` depending on when `netLib` appears. The scripts poll for `window.netLib`.

## Build APK on GitHub

1. Create private GitHub repo.
2. Upload this whole folder.
3. Push to `main`.
4. Open GitHub → Actions → Build Android APK.
5. Download artifact `PingPongGo-Host-debug-apk`.
6. Install APK on host Android phone.

## Offline test

1. Phone A: enable hotspot manually.
2. Phone A: open PingPongGo LAN Host app.
3. Phone B: connect to Phone A hotspot.
4. Phone B: scan guest QR.
5. Browser opens `http://HOST_IP:8123/index.html?id=GUEST&signal=ws://HOST_IP:8124/v0/signaling`.

## Status

This is a starter/test skeleton. The WebSocket signaling relay is intentionally minimal and may need adjustment to match the exact current `netlib` protocol after browser console testing.
# PingPongGo-Android-Host
