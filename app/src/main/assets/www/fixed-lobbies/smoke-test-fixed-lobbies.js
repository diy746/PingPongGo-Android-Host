#!/usr/bin/env node
/*
 * Minimal smoke test for the fixed-lobby signaling server.
 * Run server first:
 *   SIGNAL_DEBUG=1 node signaling-server.js
 *
 * Then:
 *   node smoke-test-fixed-lobbies.js
 */
const WebSocket = require("ws");

const URL = process.env.SIGNAL_URL || "ws://127.0.0.1:8124/v0/signaling";
const LOBBY = process.env.LOBBY || "KAS";

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makePeer(name) {
  const ws = new WebSocket(URL);
  const messages = [];

  ws.on("message", (buf) => {
    const msg = JSON.parse(buf.toString());
    messages.push(msg);
    console.log(name, "<-", msg);
  });

  return new Promise((resolve, reject) => {
    ws.once("open", () => {
      ws.send(JSON.stringify({ type: "hello" }));
      resolve({ ws, messages, name });
    });
    ws.once("error", reject);
  });
}

(async () => {
  const a = await makePeer("A");
  const b = await makePeer("B");
  await wait(200);

  a.ws.send(JSON.stringify({ type: "join", id: LOBBY }));
  await wait(200);
  b.ws.send(JSON.stringify({ type: "join", id: LOBBY }));

  await wait(1000);

  const aJoined = a.messages.some((m) => m.type === "joined" && m.lobbyInfo && m.lobbyInfo.code === LOBBY);
  const bJoined = b.messages.some((m) => m.type === "joined" && m.lobbyInfo && m.lobbyInfo.code === LOBBY);
  const sawConnect = a.messages.concat(b.messages).some((m) => m.type === "connect");

  a.ws.close();
  b.ws.close();

  if (!aJoined || !bJoined || !sawConnect) {
    console.error("FAIL", { aJoined, bJoined, sawConnect });
    process.exit(1);
  }

  console.log("PASS fixed lobby smoke test:", LOBBY);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
