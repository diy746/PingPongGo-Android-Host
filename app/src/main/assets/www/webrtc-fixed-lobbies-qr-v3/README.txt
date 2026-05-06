WebRTC fixed 3-letter lobby + host-only QR patch v2

Replace these files in your game folder:
  signaling-server.js
  lobbies.json
  app.js
  qr-overlay.js

Behavior:
  - Host creates/reuses only fixed 3-letter lobby IDs from lobbies.json.
  - Default host lobby is KAS when no ?id=XXX is provided.
  - You can set another host default in browser console before starting PVP:
      window.PPG_LOBBY_ID = "JAR"
    or use localStorage:
      localStorage.setItem("ppgLobbyCode", "JAR")
  - Invite links still use index.html?id=XXX.
  - QR appears only on host side after shareable URL is created.
  - QR hides when a peer connects, when guest acceptance flow starts, or on disconnect/back.
  - Guest joining with ?id=XXX never shows QR.
  - Server never generates random lobby codes.
  - Empty lobbies are removed from RAM but remain valid because lobbies.json allows them.

Run:
  npm install ws
  SIGNAL_DEBUG=1 node signaling-server.js

Anti-glare options:
  Default relaxed mode:
    STRICT_OFFER_DIRECTION=0 node signaling-server.js

  Strict mode, only lobby leader/host offer is relayed:
    STRICT_OFFER_DIRECTION=1 node signaling-server.js

Emergency relaxed lobby list for testing only:
  ALLOW_ANY_3_LETTER_LOBBY=1 node signaling-server.js

Examples:
  Host/default:
    http://YOUR-LAN-IP:8123/index.html
    creates KAS unless browser localStorage/window override is set.

  Guest:
    http://YOUR-LAN-IP:8123/index.html?id=KAS

  Host can also create a specific lobby by opening:
    http://YOUR-LAN-IP:8123/index.html?id=JAR
    then starting PVP from that page.

V3 HOTFIX:
- Host invite link no longer uses PokiSDK.shareableURL().
- Host link is built directly as location.origin + location.pathname + ?id=LOBBY.
- This avoids instant "invite link expired" behavior outside Poki hosting.
- QR/link remains visible for 180 seconds, or hides earlier when the second peer connects.
- Guest join timeout is also 180 seconds instead of 10 seconds.
