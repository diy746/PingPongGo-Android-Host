package com.pingponggo.host.server

import android.util.Log
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Brutal fixed-lobby LAN signaling for PingPongGo.
 *
 * Design rule:
 * - Table tennis always has two gameplay slots.
 * - Network can only replace CPU opponent with one GUEST human.
 * - First browser that creates/invites is HOST.
 * - Browser with ?id=GUEST joins as GUEST.
 * - As soon as the second peer appears, we send connect to both sides.
 * - Relay description/candidate/event/unknown payloads to the other peer.
 * - No random codes, no online relay, no approval dialog.
 */
class SignalingWsServer(port: Int) : NanoWSD("0.0.0.0", port) {

    private val clients = ConcurrentHashMap<String, WebSocket>()
    private val socketIds = ConcurrentHashMap<WebSocket, String>()

    @Volatile private var hostId: String? = null
    @Volatile private var guestId: String? = null

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket {
        return object : WebSocket(handshake) {
            override fun onOpen() {
                val id = "p" + UUID.randomUUID().toString().replace("-", "").take(8)
                socketIds[this] = id
                clients[id] = this
                log("OPEN $id uri=${handshake.uri}")
            }

            override fun onMessage(message: WebSocketFrame) {
                val text = message.textPayload ?: return
                val selfId = socketIds[this] ?: return
                handle(this, selfId, text)
            }

            override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
                val id = socketIds.remove(this) ?: return
                clients.remove(id)

                if (hostId == id) hostId = null
                if (guestId == id) guestId = null

                broadcast(json("disconnect", "id" to id))
                broadcast(lobbyUpdated())
                log("CLOSE $id reason=$reason")
            }

            override fun onPong(pong: WebSocketFrame) {}

            override fun onException(exception: IOException) {
                log("EXCEPTION ${exception.message}")
            }
        }
    }

    private fun handle(ws: WebSocket, selfId: String, text: String) {
        val type = extract(text, "type") ?: "unknown"
        log("IN $selfId $type $text")

        when (type) {
            "hello" -> {
                val requestedId = extract(text, "id")
                if (!requestedId.isNullOrBlank() && requestedId != selfId && !clients.containsKey(requestedId)) {
                    clients.remove(selfId)
                    socketIds[ws] = requestedId
                    clients[requestedId] = ws
                    handle(ws, requestedId, text)
                    return
                }

                send(ws, json("welcome", "id" to selfId, "peerId" to selfId, "secret" to "s$selfId"))
                send(ws, json("credentials", "id" to selfId, "peerId" to selfId, "secret" to "s$selfId"))
            }

            "credentials" -> {
                send(ws, json("credentials", "id" to selfId, "peerId" to selfId, "secret" to "s$selfId"))
            }

            "ping" -> send(ws, json("ping"))
            "pong" -> send(ws, json("pong"))

            "create" -> {
                // Invitation sent. This peer becomes HOST. Always fixed code GUEST.
                hostId = selfId
                if (guestId == selfId) guestId = null

                val joined = jsonWithLobby("joined", rid = extract(text, "rid"))
                send(ws, joined)
                send(ws, lobbyUpdated())
                log("HOST INVITE ACCEPTED host=$selfId code=GUEST")

                // If a guest was already waiting due refresh/order, connect immediately.
                connectIfPossible()
            }

            "join" -> {
                // Accept ANY join attempt. Latest non-host peer becomes current GUEST.
                if (hostId == null) {
                    // If guest hits first in a test, keep it waiting, but do not fail.
                    guestId = selfId
                    send(ws, jsonWithLobby("joined", rid = extract(text, "rid")))
                    send(ws, lobbyUpdated())
                    log("GUEST WAITING guest=$selfId code=GUEST")
                    return
                }

                if (selfId != hostId) {
                    guestId = selfId
                }

                send(ws, jsonWithLobby("joined", rid = extract(text, "rid")))
                broadcast(lobbyUpdated())
                log("GUEST ACCEPTED guest=$selfId host=$hostId code=GUEST")
                connectIfPossible()
            }

            "leave", "disconnect" -> {
                if (selfId == guestId) guestId = null
                if (selfId == hostId) hostId = null
                broadcast(lobbyUpdated())
            }

            "description", "candidate", "event", "connected" -> relay(text, selfId)

            else -> {
                // netlib variants differ; for test mode, relay everything unknown to the other side.
                relay(text, selfId)
            }
        }
    }

    private fun connectIfPossible() {
        val h = hostId
        val g = guestId
        val host = h?.let { clients[it] }
        val guest = g?.let { clients[it] }

        if (h == null || g == null || host == null || guest == null || h == g) return

        val info = lobbyInfoJson()
        send(host, """{"type":"lobbyUpdated","lobbyInfo":$info}""")
        send(guest, """{"type":"lobbyUpdated","lobbyInfo":$info}""")

        // This is the important handshake trigger used by local netlib signaling.
        send(host, """{"type":"connect","id":"$g","polite":false}""")
        send(guest, """{"type":"connect","id":"$h","polite":true}""")

        log("CONNECT SENT host=$h guest=$g")
    }

    private fun relay(text: String, selfId: String) {
        val targetId = extract(text, "recipient")
            ?: extract(text, "receiverId")
            ?: extract(text, "to")
            ?: otherPeer(selfId)

        if (targetId == null) {
            log("NO TARGET for $selfId $text")
            return
        }

        val target = clients[targetId]
        if (target == null) {
            log("TARGET MISSING $targetId for $selfId")
            return
        }

        send(target, text)
        log("RELAY $selfId -> $targetId")
    }

    private fun otherPeer(id: String): String? = when (id) {
        hostId -> guestId
        guestId -> hostId
        else -> null
    }

    private fun lobbyInfoJson(): String {
        val h = hostId
        val g = guestId
        val players = listOfNotNull(h, g).distinct().joinToString(",") { "\"$it\"" }
        val leader = h ?: ""
        return """{"code":"GUEST","leader":"$leader","term":1,"players":[$players],"maxPlayers":2}"""
    }

    private fun lobbyUpdated(): String = """{"type":"lobbyUpdated","lobbyInfo":${lobbyInfoJson()}}"""

    private fun jsonWithLobby(type: String, rid: String? = null): String {
        val ridPart = if (rid.isNullOrBlank()) "" else ",\"rid\":\"$rid\""
        return """{"type":"$type","code":"GUEST"$ridPart,"lobbyInfo":${lobbyInfoJson()}}"""
    }

    private fun json(type: String, vararg pairs: Pair<String, String>): String {
        val extra = pairs.joinToString(",") { (k, v) -> "\"$k\":\"${escape(v)}\"" }
        return if (extra.isBlank()) """{"type":"$type"}""" else """{"type":"$type",$extra}"""
    }

    private fun send(ws: WebSocket, text: String) {
        try {
            ws.send(text)
            log("OUT $text")
        } catch (e: Exception) {
            log("SEND ERROR ${e.message}")
        }
    }

    private fun broadcast(text: String) {
        clients.values.forEach { send(it, text) }
    }

    private fun extract(json: String, key: String): String? {
        val pattern = Regex("\"" + Regex.escape(key) + "\"\\s*:\\s*\"([^\"]+)\"")
        return pattern.find(json)?.groupValues?.getOrNull(1)
    }

    private fun escape(value: String): String = value.replace("\\", "\\\\").replace("\"", "\\\"")

    private fun log(msg: String) {
        Log.d("PPG-SIGNAL", msg)
        println("PPG-SIGNAL $msg")
    }
}
