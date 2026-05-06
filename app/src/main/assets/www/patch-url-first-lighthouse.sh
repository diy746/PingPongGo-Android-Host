#!/usr/bin/env bash
set -euo pipefail

SRC="pg/signaling-server.js"
[ -f "$SRC" ] || SRC="signaling-server.js"

cp -a "$SRC" "$SRC.bak-url-first-$(date +%Y%m%d-%H%M%S)"

cat > "$SRC" <<'JS'
const http = require("http");
const crypto = require("crypto");
const { URL } = require("url");
const { WebSocketServer } = require("ws");

const PORT = process.env.SIGNAL_PORT || 8124;
const DEFAULT_LOBBY = "HOME";
const MAX_PLAYERS = 8;

const KNOWN_PLAYERS = new Set([
  "KAS", "JAR", "RAD", "BAB", "DZI", "JAN", "JAS", "KRZ",
  "BAR", "GRA", "GRZ", "STA", "JWB", "SUZ", "ZBY", "PRZ",
  "MAC", "LAS", "DOG", "RAM", "MIK", "MIL", "DAV", "AUR",
  "DVS", "GAT", "AND", "IZY", "ASI", "TOM", "TRN", "PIO",
  "PAW", "LUK", "BOG", "JAG", "JAC"
]);

const ACTIVE_TEST_PLAYERS = new Set([
  "KAS", "JAR", "RAD", "BAB", "DZI", "JAN", "JAS", "SUZ"
]);

const clients = new Map();        // peerId -> ws
const sessions = new Map();       // lobby:player -> ws
const lobbies = new Map();        // lobbyCode -> lobby

function id(prefix = "") {
  return prefix + crypto.randomBytes(4).toString("hex");
}

function norm(v) {
  return String(v || "").trim().toUpperCase();
}

function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

function getLobby(code) {
  code = norm(code || DEFAULT_LOBBY);
  let lobby = lobbies.get(code);

  if (!lobby) {
    lobby = {
      code,
      leader: null,
      leaderPlayer: null,
      peers: new Set(),
      players: new Set(),
      term: 1,
      maxPlayers: MAX_PLAYERS
    };
    lobbies.set(code, lobby);
  }

  return lobby;
}

function lobbyInfo(lobby) {
  return {
    code: lobby.code,
    leader: lobby.leader,
    leaderPlayer: lobby.leaderPlayer,
    term: lobby.term,
    maxPlayers: lobby.maxPlayers,
    players: [...lobby.peers],
    playerCodes: [...lobby.players]
  };
}

function broadcastLobby(lobby) {
  const info = lobbyInfo(lobby);
  for (const pid of lobby.peers) {
    send(clients.get(pid), {
      type: "lobbyUpdated",
      lobbyInfo: info
    });
  }
}

function key(lobby, player) {
  return `${lobby}:${player}`;
}

function replaceZombie(ws, lobbyCode, playerCode) {
  const k = key(lobbyCode, playerCode);
  const old = sessions.get(k);

  if (old && old !== ws) {
    console.log("REPLACE ZOMBIE", {
      lobby: lobbyCode,
      player: playerCode,
      old: old.id,
      fresh: ws.id
    });

    old.zombie = true;
    send(old, {
      type: "replaced",
      reason: "newer session for same lobby/player"
    });

    try { old.close(); } catch {}

    clients.delete(old.id);

    const oldLobby = old.lobby ? lobbies.get(old.lobby) : null;
    if (oldLobby) {
      oldLobby.peers.delete(old.id);
    }
  }

  sessions.set(k, ws);
}

function connectPeers(lobby, freshId) {
  const fresh = clients.get(freshId);
  if (!fresh) return;

  for (const pid of lobby.peers) {
    if (pid === freshId) continue;

    const other = clients.get(pid);
    if (!other) continue;

    if (pid === lobby.leader) {
      send(other, {
        type: "connect",
        id: freshId,
        playerCode: fresh.playerCode,
        polite: false,
        role: "leader"
      });

      send(fresh, {
        type: "connect",
        id: pid,
        playerCode: other.playerCode,
        polite: true,
        role: "joiner"
      });
    } else if (freshId === lobby.leader) {
      send(fresh, {
        type: "connect",
        id: pid,
        playerCode: other.playerCode,
        polite: false,
        role: "leader"
      });

      send(other, {
        type: "connect",
        id: freshId,
        playerCode: fresh.playerCode,
        polite: true,
        role: "joiner"
      });
    }
  }
}

function attach(ws, lobbyCode, playerCode, wantLeader) {
  lobbyCode = norm(lobbyCode || DEFAULT_LOBBY);
  playerCode = norm(playerCode);

  if (!playerCode) {
    send(ws, {
      type: "error",
      error: "MISSING_PLAYER_IN_URL",
      example: "?join=HOME&player=SUZ"
    });
    return false;
  }

  if (!KNOWN_PLAYERS.has(playerCode)) {
    send(ws, {
      type: "error",
      error: "UNKNOWN_PLAYER",
      player: playerCode,
      allowed: [...KNOWN_PLAYERS]
    });
    return false;
  }

  if (!ACTIVE_TEST_PLAYERS.has(playerCode)) {
    send(ws, {
      type: "error",
      error: "PLAYER_NOT_ENABLED_FOR_8_TEST",
      player: playerCode,
      enabled: [...ACTIVE_TEST_PLAYERS]
    });
    return false;
  }

  const lobby = getLobby(lobbyCode);

  if (!lobby.players.has(playerCode) && lobby.players.size >= lobby.maxPlayers) {
    send(ws, {
      type: "error",
      error: "LOBBY_FULL",
      lobby: lobbyCode,
      maxPlayers: lobby.maxPlayers
    });
    return false;
  }

  ws.id = ws.id || id("p");
  ws.secret = ws.secret || id("s");
  ws.lobby = lobbyCode;
  ws.playerCode = playerCode;
  ws.lastSeen = Date.now();

  replaceZombie(ws, lobbyCode, playerCode);

  clients.set(ws.id, ws);
  lobby.peers.add(ws.id);
  lobby.players.add(playerCode);

  if (wantLeader || !lobby.leader || !clients.has(lobby.leader)) {
    lobby.leader = ws.id;
    lobby.leaderPlayer = playerCode;
    lobby.term++;
  }

  send(ws, {
    type: "welcome",
    id: ws.id,
    secret: ws.secret,
    playerCode,
    lobbyCode
  });

  send(ws, {
    type: "joined",
    lobbyInfo: lobbyInfo(lobby)
  });

  broadcastLobby(lobby);
  connectPeers(lobby, ws.id);

  console.log("ATTACHED", {
    lobby: lobbyCode,
    player: playerCode,
    peer: ws.id,
    leader: lobby.leader,
    leaderPlayer: lobby.leaderPlayer
  });

  return true;
}

function detach(ws) {
  if (!ws || !ws.id) return;

  clients.delete(ws.id);

  if (ws.lobby && ws.playerCode) {
    const k = key(ws.lobby, ws.playerCode);
    if (sessions.get(k) === ws) sessions.delete(k);
  }

  const lobby = ws.lobby ? lobbies.get(ws.lobby) : null;
  if (!lobby) return;

  lobby.peers.delete(ws.id);
  lobby.players.delete(ws.playerCode);

  if (lobby.leader === ws.id) {
    const next = [...lobby.peers][0] || null;
    lobby.leader = next;
    const nextWs = next ? clients.get(next) : null;
    lobby.leaderPlayer = nextWs ? nextWs.playerCode : null;
    lobby.term++;
  }

  for (const pid of lobby.peers) {
    send(clients.get(pid), {
      type: "disconnect",
      id: ws.id,
      playerCode: ws.playerCode
    });
  }

  broadcastLobby(lobby);
}

const server = http.createServer();
const wss = new WebSocketServer({ server, path: "/v0/signaling" });

wss.on("connection", (ws, req) => {
  ws.id = null;
  ws.secret = null;
  ws.lobby = null;
  ws.playerCode = null;
  ws.zombie = false;
  ws.lastSeen = Date.now();

  let urlLobby = DEFAULT_LOBBY;
  let urlPlayer = "";

  try {
    const ref = req.headers.referer || "";
    const u = ref ? new URL(ref) : null;

    if (u) {
      urlLobby = norm(
        u.searchParams.get("join") ||
        u.searchParams.get("lobby") ||
        u.searchParams.get("room") ||
        DEFAULT_LOBBY
      );

      urlPlayer = norm(
        u.searchParams.get("player") ||
        u.searchParams.get("p")
      );
    }

    console.log("URL-FIRST", {
      referer: ref,
      lobby: urlLobby,
      player: urlPlayer
    });
  } catch (e) {
    console.log("URL parse failed", e.message);
  }

  // Fast path: no need to wait for modified hello.
  // If URL has player, attach immediately.
  if (urlPlayer) {
    const wantLeader = !lobbies.has(urlLobby) || !getLobby(urlLobby).leader;
    attach(ws, urlLobby, urlPlayer, wantLeader);
  } else {
    send(ws, {
      type: "needPlayerUrl",
      example: "?join=HOME&player=SUZ",
      enabled: [...ACTIVE_TEST_PLAYERS]
    });
  }

  ws.on("message", (buf) => {
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      return;
    }

    ws.lastSeen = Date.now();

    if (ws.zombie) {
      console.log("DROP zombie", ws.id, msg.type);
      return;
    }

    console.log("IN", ws.id || "-", ws.playerCode || "-", msg.type, msg);

    if (msg.type === "hello") {
      // Old client still sends hello. Do not require anything from it.
      if (!ws.id && urlPlayer) {
        attach(ws, urlLobby, urlPlayer, false);
      } else {
        send(ws, {
          type: "welcome",
          id: ws.id,
          secret: ws.secret,
          playerCode: ws.playerCode,
          lobbyCode: ws.lobby
        });
      }
      return;
    }

    if (!ws.id) {
      send(ws, {
        type: "error",
        error: "NOT_ATTACHED",
        example: "?join=HOME&player=SUZ"
      });
      return;
    }

    if (msg.type === "ping") {
      send(ws, { type: "ping" });
      return;
    }

    if (msg.type === "credentials") {
      send(ws, {
        type: "credentials",
        id: ws.id,
        playerCode: ws.playerCode,
        lobbyCode: ws.lobby
      });
      return;
    }

    if (msg.type === "create") {
      // Old frontend may still send create. Reuse URL lobby/player, do not create random lobby.
      const lobbyCode = norm(urlLobby || msg.lobby || msg.code || DEFAULT_LOBBY);
      attach(ws, lobbyCode, ws.playerCode || urlPlayer, true);
      return;
    }

    if (msg.type === "join") {
      // Old frontend may send another join. Reuse URL lobby/player.
      const lobbyCode = norm(urlLobby || msg.lobby || msg.code || DEFAULT_LOBBY);
      attach(ws, lobbyCode, ws.playerCode || urlPlayer, false);
      return;
    }

    if (msg.type === "leave" || msg.type === "close") {
      detach(ws);
      return;
    }

    if (msg.type === "description" || msg.type === "candidate") {
      const lobby = ws.lobby ? lobbies.get(ws.lobby) : null;
      const target = clients.get(msg.recipient);

      if (!lobby || !target || target.lobby !== ws.lobby) {
        console.log("DROP stale/cross-lobby signal", {
          from: ws.id,
          to: msg.recipient,
          type: msg.type,
          lobby: ws.lobby
        });
        return;
      }

      if (msg.type === "description" && msg.description?.type === "offer" && lobby.leader !== ws.id) {
        console.log("DROP non-leader offer", {
          from: ws.id,
          player: ws.playerCode,
          leader: lobby.leader,
          lobby: ws.lobby
        });
        return;
      }

      if (msg.type === "description" && msg.description?.type === "answer" && lobby.leader === ws.id) {
        console.log("DROP leader answer", {
          from: ws.id,
          player: ws.playerCode,
          lobby: ws.lobby
        });
        return;
      }

      send(target, {
        ...msg,
        source: ws.id,
        sourcePlayerCode: ws.playerCode,
        lobby: ws.lobby
      });
      return;
    }

    if (msg.type === "event") {
      const lobby = ws.lobby ? lobbies.get(ws.lobby) : null;
      if (!lobby) return;

      for (const pid of lobby.peers) {
        if (pid !== ws.id) {
          send(clients.get(pid), {
            ...msg,
            source: ws.id,
            sourcePlayerCode: ws.playerCode
          });
        }
      }
      return;
    }
  });

  ws.on("close", () => {
    if (ws.zombie) return;
    detach(ws);
  });
});

setInterval(() => {
  const now = Date.now();

  for (const [pid, ws] of clients) {
    if (now - ws.lastSeen > 45000) {
      console.log("TIMEOUT", pid, ws.playerCode);
      ws.zombie = true;
      try { ws.close(); } catch {}
      detach(ws);
    }
  }
}, 10000);

getLobby(DEFAULT_LOBBY);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`URL-first family lighthouse ws://0.0.0.0:${PORT}/v0/signaling`);
  console.log(`Use: http://SERVER:8123/index.html?join=HOME&player=SUZ`);
  console.log(`Enabled test players: ${[...ACTIVE_TEST_PLAYERS].join(", ")}`);
});
JS

echo "OK patched $SRC"
echo "Run:"
echo "  pkill -f signaling-server.js || true"
echo "  node $SRC"
