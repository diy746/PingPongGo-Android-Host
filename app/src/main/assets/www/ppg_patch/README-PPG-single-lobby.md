# PPG single stable LAN lobby patch

## Findings

- `INVITE LINK EXPIRED!` is not present in the uploaded `app.js`, `netlib.js`, local `poki-sdk.js`, or `signaling-server.js`. It is therefore not emitted by the local signaling server or QR overlay. In the original online Poki flow it is produced by the expiring shareable invite URL mechanism. The local mock `game-cdn.poki.com/scripts/v2/poki-sdk.js` implements `PokiSDK.shareableURL(data)` by returning the current URL plus `?id=<data.id>`.
- The click Invite path is: `initNetworkScreen()` -> `netLib.connect("createLobby")` -> `Elements.NetLib.createNetwork()` -> `network ready` -> `createLobby()` -> `network.create({codeFormat:"short", public:true, maxPlayers:2})` -> server `create` -> client receives `joined` -> netlib emits `lobby` -> app calls `PokiSDK.shareableURL({id:lobbyCode})` -> panel displays `netLib.shareURL`.
- The guest path is: `loadLang()` reads `PokiSDK.getURLParam("id")`; if present it sets `netLib.lobbyCode = id`. `initSplash()` then calls `initPvpPrep()` instead of the normal start screen. That later calls `netLib.connect("joinLobby")` and `network.join(netLib.lobbyCode)`.
- Host and guest are already distinguished by the app: host has `playerNum=0` from `createLobby`; guest has `playerNum=1` from `joinLobby`. The patch keeps this.
- QR is best triggered by replacing `PokiSDK.shareableURL` because this is exactly where the app has finished creating the lobby and has the Invite Player panel open. The patch does this in `qr-overlay.js` without editing `app.js`.
- Second-player join/connection is known in two stages: signaling `lobbyUpdated`/`connect`, then WebRTC data channel `connected`. The overlay hides QR on either stage.
- WebRTC glare is mostly frontend behavior: netlib creates peers on both sides and each side can generate an offer after `negotiationneeded`. The server only orders/relays `connect`, `description`, and `candidate`. `STRICT_OFFER_DIRECTION=1` adds a server-side guard that drops non-host offer descriptions.
- Save data is `localStorage.ppgv8`, a comma-separated integer array. Important indexes: gems `[0]`, level `[1]`, rank `[9]`, career games `[10]`, career sets `[11]`, audio `[12]`, PvP wins `[13]`, bats start at index `56`, bat count `57`, bat state `0=locked`, `1=unlocked`, `2=selected`.

## Patch files

- `files/signaling-server.js`: fixed single lobby server with max 2 players, stable `GUEST` lobby, optional strict offer direction, debug env, and optional `/qr.svg` endpoint using local `qrencode` when installed.
- `files/ppg-single-lobby.json`: single lobby config.
- `files/qr-overlay.js`: stable URL/QR overlay, host-only, default 180s timeout.
- `files/ppg-cheat-loader.js`: optional local cheat loader that waits before game init and patches `localStorage.ppgv8` safely.
- `files/ppg-cheat.json`: example cheat config.
- `tools/apply-single-lobby-patch.sh`: copies files and patches `index.html` + dynamic signaling URL in `netlib.js`.

## Apply to clean original

From inside a clean extracted game directory, copy this patch folder into it, then run:

```bash
cp -a /path/to/ppg_patch/files ./files
cp -a /path/to/ppg_patch/tools/apply-single-lobby-patch.sh ./
chmod +x apply-single-lobby-patch.sh
./apply-single-lobby-patch.sh .
```

Or from outside:

```bash
cd /path/to/template-ppg-working-lan-multiplayer
cp -a /path/to/ppg_patch/files ./files
cp -a /path/to/ppg_patch/tools/apply-single-lobby-patch.sh ./
chmod +x apply-single-lobby-patch.sh
./apply-single-lobby-patch.sh .
```

## Run

```bash
# terminal 1, from game directory
PPG_DEBUG=1 STRICT_OFFER_DIRECTION=0 SIGNAL_PORT=8124 node signaling-server.js

# terminal 2, from game directory
python3 -m http.server 8123 --bind 0.0.0.0
```

Optional strict anti-glare test:

```bash
PPG_DEBUG=1 STRICT_OFFER_DIRECTION=1 SIGNAL_PORT=8124 node signaling-server.js
```

## Test

1. Open host browser:
   `http://YOUR_LAN_IP:8123/index.html`
2. Click the PvP/Invite flow until the Invite Player screen appears.
3. Expected host behavior:
   - invite link shown as `http://YOUR_LAN_IP:8123/index.html?id=GUEST`
   - QR appears top-left for about 180 seconds
   - server log shows `CREATE/REUSE SINGLE LOBBY GUEST host ...`
4. Open guest/mobile:
   `http://YOUR_LAN_IP:8123/index.html?id=GUEST`
5. Expected guest behavior:
   - guest joins existing lobby
   - no QR on guest
   - server log shows `JOIN SINGLE LOBBY GUEST guest ...`
   - QR disappears on host after `connect`, `lobbyUpdated` with 2 players, or WebRTC `connected`

## Rollback

The apply script creates `backup-single-lobby-YYYYMMDD-HHMMSS`. To rollback manually:

```bash
cd /path/to/game
cp backup-single-lobby-*/index.html.bak index.html
cp backup-single-lobby-*/netlib.js.bak netlib.js
cp backup-single-lobby-*/signaling-server.js.bak signaling-server.js
rm -f ppg-single-lobby.json qr-overlay.js ppg-cheat-loader.js
# remove ppg-cheat.json only if you do not want local cheats anymore
```
