# Fixed 3-letter lobby patch for Ping Pong Go WebRTC

This is a drop-in replacement for `signaling-server.js` plus a new `lobby-config.json`.

## What changed

- Lobby IDs are no longer randomly generated.
- Only 3-letter lobby IDs from `lobby-config.json` are accepted.
- `index.html?id=KAS` remains the invite/QR URL format.
- `join("KAS")` creates/reuses the allowed in-memory lobby when it is empty.
- `create` also works only if the message contains an allowed `id`, `code`, or `lobby`.
- Missing or disallowed lobby ID returns `lobby-not-found`.
- More than 2 players returns `lobby-is-full`.
- `description` and `candidate` are relayed only between peers in the same lobby.
- SDP offers from non-leader peers are dropped by default to reduce glare.

## Install

From your game folder:

```bash
cp signaling-server.js signaling-server.random-backup.js
cp /path/to/this/signaling-server.js ./signaling-server.js
cp /path/to/this/lobby-config.json ./lobby-config.json
npm install ws
node signaling-server.js
```

Debug mode:

```bash
SIGNAL_DEBUG=1 node signaling-server.js
```

Custom port:

```bash
SIGNAL_PORT=8124 node signaling-server.js
```

Custom config path:

```bash
LOBBY_CONFIG=/opt/PingPongG0/lobby-config.json node signaling-server.js
```

## Use

Open the same allowed lobby on two devices/browsers:

```text
http://YOUR-LAN-IP:8123/index.html?id=KAS
```

The first peer that joins `KAS` becomes lobby leader. The second peer joins the same lobby. The frontend QR overlay should keep using the current URL, so the QR code remains `index.html?id=KAS`.

## Health/debug endpoints

```bash
curl http://127.0.0.1:8124/health
SIGNAL_DEBUG=1 node signaling-server.js
curl http://127.0.0.1:8124/debug/lobbies
```

## Important note about the old Create/PVP button

Your current `app.js` calls:

```js
this.network.create({codeFormat:"short", public:true, maxPlayers:2})
```

That does not include a fixed code. Because random lobby generation is now disabled, that old no-code create request is rejected.

The no-frontend-change flow is:

```text
open index.html?id=KAS on player 1
open index.html?id=KAS on player 2, or scan the QR generated from that URL
```

If later you want the old create button to create a specific fixed lobby, the frontend must pass `code`, `id`, or `lobby` in the `create` message. This package does not modify `app.js`.
