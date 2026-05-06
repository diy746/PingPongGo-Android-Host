const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const { execFile } = require("child_process");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.SIGNAL_PORT || 8124);
const CONFIG_PATH = process.env.PPG_LOBBY_CONFIG || "ppg-single-lobby.json";
const DEBUG = /^(1|true|yes)$/i.test(process.env.PPG_DEBUG || "1");
const STRICT_OFFER_DIRECTION = /^(1|true|yes)$/i.test(process.env.STRICT_OFFER_DIRECTION || "0");

function loadConfig() {
  const fallback = { maxPlayers: 2, lobbyId: "GUEST", invitePath: "index.html?id=GUEST", qrTimeoutMs: 180000 };
  try { return Object.assign(fallback, JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"))); }
  catch { return fallback; }
}
const CFG = loadConfig();
const FIXED_LOBBY = String(CFG.lobbyId || "GUEST");
const MAX_PLAYERS = Number(CFG.maxPlayers || 2);

const clients = new Map(); // id -> ws
const lobbies = new Map(); // code -> {code, peers:Set, leader, term, maxPlayers}
function log(...a){ if (DEBUG) console.log(...a); }
function id(prefix="p") { return prefix + crypto.randomBytes(4).toString("hex"); }
function send(ws, obj) { if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj)); }
function lobbyInfo(lobby){ return { code:lobby.code, leader:lobby.leader, term:lobby.term, players:[...lobby.peers], maxPlayers:lobby.maxPlayers }; }
function getClient(pid){ return clients.get(pid); }
function ensureLobby(hostId){
  let lobby = lobbies.get(FIXED_LOBBY);
  if (!lobby) {
    lobby = { code: FIXED_LOBBY, peers: new Set(), leader: hostId, term: 1, maxPlayers: MAX_PLAYERS };
    lobbies.set(FIXED_LOBBY, lobby);
  }
  if (!lobby.leader) lobby.leader = hostId;
  return lobby;
}
function removeFromLobby(ws, notify=true){
  if (!ws.lobby || !lobbies.has(ws.lobby)) return;
  const lobby = lobbies.get(ws.lobby);
  lobby.peers.delete(ws.id);
  if (notify) for (const pid of lobby.peers) send(getClient(pid), { type:"disconnect", id: ws.id });
  if (lobby.peers.size === 0) lobbies.delete(ws.lobby);
  else if (lobby.leader === ws.id) { lobby.leader = [...lobby.peers][0]; lobby.term++; broadcastLobby(lobby); }
  ws.lobby = null;
}
function broadcastLobby(lobby){ for (const pid of lobby.peers) send(getClient(pid), { type:"lobbyUpdated", lobbyInfo:lobbyInfo(lobby) }); }
function sameLobby(a,b){ return a && b && a.lobby && b.lobby && a.lobby === b.lobby; }
function isOffer(msg){ return msg && msg.type === "description" && msg.description && msg.description.type === "offer"; }

const server = http.createServer((req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
  if (u.pathname === "/health") { res.writeHead(200, {"content-type":"text/plain"}); res.end("ok\n"); return; }
  if (u.pathname === "/qr.svg") {
    const text = u.searchParams.get("url") || "";
    if (!text) { res.writeHead(400); res.end("missing url"); return; }
    execFile("qrencode", ["-t", "SVG", "-m", "1", "-s", "5", text], {timeout: 3000, maxBuffer: 1024*1024}, (err, stdout) => {
      res.setHeader("access-control-allow-origin", "*");
      res.setHeader("cache-control", "no-store");
      if (err) {
        res.writeHead(503, {"content-type":"image/svg+xml"});
        res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="150" height="150"><rect width="100%" height="100%" fill="white"/><text x="10" y="25" font-size="12">qrencode missing</text><text x="10" y="45" font-size="10">install qrencode</text></svg>`);
      } else { res.writeHead(200, {"content-type":"image/svg+xml"}); res.end(stdout); }
    });
    return;
  }
  res.writeHead(404); res.end("not found\n");
});
const wss = new WebSocketServer({ server, path: "/v0/signaling" });

wss.on("connection", (ws) => {
  ws.id = null; ws.secret = null; ws.lobby = null;
  ws.on("message", (buf) => {
    let msg; try { msg = JSON.parse(buf.toString()); } catch { return; }
    log("IN", ws.id || "-", msg.type, msg);
    if (msg.type === "hello") { ws.id = msg.id || id("p"); ws.secret = msg.secret || id("s"); clients.set(ws.id, ws); send(ws, {type:"welcome", id:ws.id, secret:ws.secret}); return; }
    if (!ws.id) { send(ws, {type:"error", code:"not-ready", message:"send hello first", rid:msg.rid}); return; }
    if (msg.type === "ping") { send(ws, {type:"ping"}); return; }
    if (msg.type === "credentials") { send(ws, {type:"credentials"}); return; }
    if (msg.type === "list") { send(ws, {type:"lobbies", lobbies:[...lobbies.values()].map(lobbyInfo), rid:msg.rid}); return; }
    if (msg.type === "create") {
      removeFromLobby(ws, false);
      const lobby = ensureLobby(ws.id);
      if (!lobby.peers.has(ws.id) && lobby.peers.size >= lobby.maxPlayers) { send(ws, {type:"error", code:"lobby-is-full", message:"lobby full", rid:msg.rid}); return; }
      lobby.leader = ws.id; lobby.peers.add(ws.id); ws.lobby = FIXED_LOBBY;
      send(ws, {type:"joined", rid:msg.rid, lobbyInfo:lobbyInfo(lobby)});
      broadcastLobby(lobby);
      fs.writeFileSync("current-lobby.txt", FIXED_LOBBY + "\n");
      log("CREATE/REUSE SINGLE LOBBY", FIXED_LOBBY, "host", ws.id);
      return;
    }
    if (msg.type === "join") {
      const requested = msg.lobby || msg.code || msg.id || FIXED_LOBBY;
      const lobby = lobbies.get(FIXED_LOBBY);
      if (requested !== FIXED_LOBBY || !lobby || lobby.peers.size === 0) { send(ws, {type:"error", code:"lobby-not-found", message:"host has not clicked Invite yet", rid:msg.rid}); return; }
      if (!lobby.peers.has(ws.id) && lobby.peers.size >= lobby.maxPlayers) { send(ws, {type:"error", code:"lobby-is-full", message:"lobby full", rid:msg.rid}); return; }
      removeFromLobby(ws, false); lobby.peers.add(ws.id); ws.lobby = FIXED_LOBBY;
      send(ws, {type:"joined", rid:msg.rid, lobbyInfo:lobbyInfo(lobby)});
      for (const pid of lobby.peers) if (pid !== ws.id) { send(getClient(pid), {type:"connect", id:ws.id, polite:false}); send(ws, {type:"connect", id:pid, polite:true}); }
      broadcastLobby(lobby); log("JOIN SINGLE LOBBY", FIXED_LOBBY, "guest", ws.id); return;
    }
    if (msg.type === "leave" || msg.type === "close" || msg.type === "disconnected") { removeFromLobby(ws, true); return; }
    if (msg.type === "connected") { const target = getClient(msg.id); if (sameLobby(ws,target)) send(target, {type:"connected", id:ws.id}); return; }
    if (msg.type === "description" || msg.type === "candidate") {
      const target = getClient(msg.recipient);
      if (!target || !sameLobby(ws, target)) { send(ws, {type:"error", code:"missing-recipient", recipient:msg.recipient}); return; }
      if (STRICT_OFFER_DIRECTION && isOffer(msg)) {
        const lobby = lobbies.get(ws.lobby);
        if (lobby && ws.id !== lobby.leader) { log("DROP guest offer in strict mode", ws.id, "->", msg.recipient); return; }
      }
      send(target, msg); return;
    }
    if (msg.type === "event") { if (ws.lobby && lobbies.has(ws.lobby)) for (const pid of lobbies.get(ws.lobby).peers) if (pid !== ws.id) send(getClient(pid), msg); return; }
  });
  ws.on("close", () => { if (ws.id) clients.delete(ws.id); removeFromLobby(ws, true); });
});
server.listen(PORT, "0.0.0.0", () => {
  console.log(`local netlib signaling ws://0.0.0.0:${PORT}/v0/signaling lobby=${FIXED_LOBBY} max=${MAX_PLAYERS} strictOffer=${STRICT_OFFER_DIRECTION?1:0}`);
});
