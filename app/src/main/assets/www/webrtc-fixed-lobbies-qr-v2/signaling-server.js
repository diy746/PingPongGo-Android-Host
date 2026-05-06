const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.SIGNAL_PORT || 8124);
const CONFIG_PATH = process.env.LOBBIES_CONFIG || path.join(__dirname, "lobbies.json");
const DEBUG = /^(1|true|yes|on)$/i.test(process.env.SIGNAL_DEBUG || "1");

// Default relaxed: keep game experience first. Set STRICT_OFFER_DIRECTION=1 to drop offers from non-leader.
const STRICT_OFFER_DIRECTION = /^(1|true|yes|on)$/i.test(process.env.STRICT_OFFER_DIRECTION || "0");

// Emergency playground mode. Still no random generation; it only permits 3-letter codes not listed in JSON.
const ALLOW_ANY_3_LETTER_LOBBY = /^(1|true|yes|on)$/i.test(process.env.ALLOW_ANY_3_LETTER_LOBBY || "0");

function loadConfig() {
  const fallback = {
    maxPlayers: 2,
    allowedLobbies: ["KAS","JAR","RAD","BAB","DZI","JAN","JAS","KRZ","BAR","GRA","GRZ","STA","JWB","SUZ","ZBY","PRZ","MAC","LAS","DOG","RAM"],
  };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf8");
    const cfg = JSON.parse(raw);
    return {
      maxPlayers: Number(cfg.maxPlayers || fallback.maxPlayers) || 2,
      allowedLobbies: Array.isArray(cfg.allowedLobbies) ? cfg.allowedLobbies : fallback.allowedLobbies,
    };
  } catch (err) {
    console.warn(`[config] could not read ${CONFIG_PATH}; using fallback:`, err.message);
    return fallback;
  }
}

const config = loadConfig();
const MAX_PLAYERS = Math.max(2, Number(config.maxPlayers || 2));
const allowedLobbies = new Set(config.allowedLobbies.map(normalizeLobby).filter(Boolean));

const clients = new Map(); // peer id -> ws
const lobbies = new Map(); // code -> { code, peers:Set, leader, term, maxPlayers }

function log(...args) { if (DEBUG) console.log(...args); }
function makeId(prefix = "") { return prefix + crypto.randomBytes(4).toString("hex"); }
function normalizeLobby(value) {
  if (typeof value !== "string") return "";
  const code = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
}
function isAllowedLobby(code) {
  return allowedLobbies.has(code) || (ALLOW_ANY_3_LETTER_LOBBY && /^[A-Z]{3}$/.test(code));
}
function send(ws, obj) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}
function error(ws, rid, code, message, extra = {}) {
  send(ws, { type: "error", rid, code, message, error: extra });
}
function lobbyInfo(lobby) {
  return {
    code: lobby.code,
    leader: lobby.leader,
    term: lobby.term,
    players: [...lobby.peers],
    maxPlayers: lobby.maxPlayers,
  };
}
function broadcastLobby(lobby) {
  const info = lobbyInfo(lobby);
  for (const pid of lobby.peers) {
    send(clients.get(pid), { type: "lobbyUpdated", lobbyInfo: info });
  }
}
function ensureHello(ws, msg) {
  if (!ws.id) {
    error(ws, msg.rid, "missing-hello", "Send hello before signaling requests.");
    return false;
  }
  return true;
}
function removeFromLobby(ws, notify = true) {
  if (!ws.lobby || !lobbies.has(ws.lobby)) { ws.lobby = null; return; }
  const oldCode = ws.lobby;
  const lobby = lobbies.get(oldCode);
  lobby.peers.delete(ws.id);
  if (notify) {
    for (const pid of lobby.peers) send(clients.get(pid), { type: "disconnect", id: ws.id });
  }
  if (lobby.peers.size === 0) {
    lobbies.delete(oldCode);
    log("[lobby] removed empty", oldCode);
  } else {
    if (lobby.leader === ws.id) {
      lobby.leader = [...lobby.peers][0];
      lobby.term += 1;
      for (const pid of lobby.peers) send(clients.get(pid), { type: "leader", leader: lobby.leader, term: lobby.term });
    }
    broadcastLobby(lobby);
  }
  ws.lobby = null;
}
function getRequestedLobby(msg) {
  return normalizeLobby(msg.lobby || msg.code || msg.id || msg.invite || msg.lobbyCode || "");
}
function createOrReuseLobby(code, ws) {
  let lobby = lobbies.get(code);
  if (!lobby) {
    lobby = { code, peers: new Set(), leader: ws.id, term: 1, maxPlayers: MAX_PLAYERS };
    lobbies.set(code, lobby);
    log("[lobby] created", code, "leader", ws.id);
  }
  return lobby;
}
function addPeerToLobby(lobby, ws) {
  removeFromLobby(ws, false);
  lobby.peers.add(ws.id);
  ws.lobby = lobby.code;
}
function sameLobby(sourceId, recipientId) {
  const source = clients.get(sourceId);
  const target = clients.get(recipientId);
  return !!source && !!target && source.lobby && source.lobby === target.lobby && lobbies.has(source.lobby);
}

const server = http.createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, lobbies: [...allowedLobbies], active: [...lobbies.keys()] }));
    return;
  }
  res.writeHead(404); res.end("not found\n");
});
const wss = new WebSocketServer({ server, path: "/v0/signaling" });

wss.on("connection", (ws) => {
  ws.id = null; ws.secret = null; ws.lobby = null;

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return; }
    log("IN", ws.id || "-", msg.type, msg);

    if (msg.type === "hello") {
      ws.id = msg.id || makeId("p");
      ws.secret = msg.secret || makeId("s");
      clients.set(ws.id, ws);
      send(ws, { type: "welcome", id: ws.id, secret: ws.secret });
      return;
    }
    if (msg.type === "ping") { send(ws, { type: "ping" }); return; }
    if (msg.type === "credentials") { send(ws, { type: "credentials" }); return; }
    if (msg.type === "close" || msg.type === "leave" || msg.type === "disconnected") { removeFromLobby(ws, true); return; }
    if (!ensureHello(ws, msg)) return;

    if (msg.type === "create") {
      const code = getRequestedLobby(msg);
      if (!code || !isAllowedLobby(code)) {
        error(ws, msg.rid, "lobby-not-found", `Lobby id must be an allowed 3-letter code. Requested: ${msg.lobby || msg.code || msg.id || "missing"}`);
        return;
      }
      const lobby = createOrReuseLobby(code, ws);
      if (!lobby.peers.has(ws.id) && lobby.peers.size >= lobby.maxPlayers) {
        error(ws, msg.rid, "lobby-is-full", `Lobby ${code} already has ${lobby.maxPlayers} players.`);
        return;
      }
      addPeerToLobby(lobby, ws);
      send(ws, { type: "joined", rid: msg.rid, lobbyInfo: lobbyInfo(lobby) });
      broadcastLobby(lobby);
      return;
    }

    if (msg.type === "join") {
      const code = getRequestedLobby(msg);
      if (!code || !isAllowedLobby(code) || !lobbies.has(code)) {
        error(ws, msg.rid, "lobby-not-found", `Lobby ${code || "missing"} is not active. Host must create it first.`);
        return;
      }
      const lobby = lobbies.get(code);
      if (!lobby.peers.has(ws.id) && lobby.peers.size >= lobby.maxPlayers) {
        error(ws, msg.rid, "lobby-is-full", `Lobby ${code} already has ${lobby.maxPlayers} players.`);
        return;
      }
      addPeerToLobby(lobby, ws);
      send(ws, { type: "joined", rid: msg.rid, lobbyInfo: lobbyInfo(lobby) });

      // Host is impolite/offerer, guest is polite/answerer. This matches perfect-negotiation expectations.
      for (const pid of lobby.peers) {
        if (pid === ws.id) continue;
        send(clients.get(pid), { type: "connect", id: ws.id, polite: false });
        send(ws, { type: "connect", id: pid, polite: true });
      }
      broadcastLobby(lobby);
      return;
    }

    if (msg.type === "description" || msg.type === "candidate") {
      if (!sameLobby(msg.source || ws.id, msg.recipient)) {
        error(ws, msg.rid, "missing-recipient", "Recipient is missing or not in the same lobby.", { recipient: msg.recipient });
        return;
      }
      const sourceId = msg.source || ws.id;
      const lobby = lobbies.get(ws.lobby);
      if (STRICT_OFFER_DIRECTION && msg.type === "description" && msg.description && msg.description.type === "offer" && sourceId !== lobby.leader) {
        log("[anti-glare] dropped non-leader offer", { lobby: lobby.code, sourceId, leader: lobby.leader, recipient: msg.recipient });
        return;
      }
      send(clients.get(msg.recipient), { ...msg, source: sourceId });
      return;
    }

    if (msg.type === "event") {
      if (!ws.lobby || !lobbies.has(ws.lobby)) return;
      for (const pid of lobbies.get(ws.lobby).peers) if (pid !== ws.id) send(clients.get(pid), msg);
      return;
    }

    // Compatibility: ignore unsupported analytics packets instead of killing the game.
    log("[ignored]", msg.type);
  });

  ws.on("close", () => {
    if (ws.id) clients.delete(ws.id);
    removeFromLobby(ws, true);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`local netlib signaling ws://0.0.0.0:${PORT}/v0/signaling`);
  console.log(`[config] maxPlayers=${MAX_PLAYERS} allowed=${[...allowedLobbies].join(",")}`);
  console.log(`[mode] debug=${DEBUG} strictOfferDirection=${STRICT_OFFER_DIRECTION} allowAny3LetterLobby=${ALLOW_ANY_3_LETTER_LOBBY}`);
});
