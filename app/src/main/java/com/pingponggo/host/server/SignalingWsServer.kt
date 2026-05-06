package com.pingponggo.host.server

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class SignalingWsServer(port: Int) : NanoWSD("0.0.0.0", port) {
    private val peers = ConcurrentHashMap<WebSocket, String>()
    private val sockets = ConcurrentHashMap<String, WebSocket>()
    private var hostId: String? = null
    private var guestId: String? = null

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket {
        return object : WebSocket(handshake) {
            override fun onOpen() {
                val id = "p" + UUID.randomUUID().toString().take(8)
                peers[this] = id
                sockets[id] = this
                sendSafe(json("welcome", mapOf("peerId" to id, "id" to id)))
            }

            override fun onMessage(message: WebSocketFrame) {
                val text = message.textPayload ?: return
                val id = peers[this] ?: return
                handleIncoming(this, id, text)
            }

            override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
                val id = peers.remove(this) ?: return
                sockets.remove(id)
                if (hostId == id) hostId = null
                if (guestId == id) guestId = null
            }

            override fun onPong(pong: WebSocketFrame) {}
            override fun onException(exception: IOException) {}
        }
    }

    private fun handleIncoming(ws: WebSocket, peerId: String, text: String) {
        val type = Regex("\"type\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1) ?: "unknown"
        val role = Regex("\"role\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1)
        val receiverId = Regex("\"receiverId\"\\s*:\\s*\"([^\"]+)\"").find(text)?.groupValues?.get(1)

        when (type) {
            "hello" -> {
                if (role == "host") hostId = peerId
                if (role == "guest") guestId = peerId
                ws.sendSafe(json("credentials", mapOf("peerId" to peerId, "id" to peerId)))
            }
            "create" -> {
                hostId = peerId
                ws.sendSafe(json("lobby", mapOf("code" to "GUEST", "peerId" to peerId)))
            }
            "join" -> {
                if (guestId != null && guestId != peerId) {
                    ws.sendSafe(json("error", mapOf("reason" to "Lobby full")))
                    return
                }
                guestId = peerId
                val h = hostId
                if (h == null) {
                    ws.sendSafe(json("error", mapOf("reason" to "Host not ready")))
                } else {
                    sockets[h]?.sendSafe(json("join-request", mapOf("peerId" to peerId, "senderId" to peerId)))
                    ws.sendSafe(json("accepted", mapOf("hostId" to h, "peerId" to h)))
                }
            }
            "ping" -> ws.sendSafe(json("pong", mapOf("peerId" to peerId)))
            "description", "candidate", "connected", "accept", "pong" -> {
                val target = receiverId ?: if (peerId == hostId) guestId else hostId
                if (target != null) sockets[target]?.sendSafe(text)
            }
            else -> {
                val target = receiverId ?: if (peerId == hostId) guestId else hostId
                if (target != null) sockets[target]?.sendSafe(text)
            }
        }
    }

    private fun WebSocket.sendSafe(s: String) {
        try { send(s) } catch (_: Exception) {}
    }

    private fun json(type: String, fields: Map<String, String>): String {
        val body = fields.entries.joinToString(",") { "\"${it.key}\":\"${it.value}\"" }
        return "{\"type\":\"$type\",$body}"
    }
}
