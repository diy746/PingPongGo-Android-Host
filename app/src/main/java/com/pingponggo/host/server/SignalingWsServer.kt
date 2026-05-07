package com.pingponggo.host.server

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * Smart bootstrap-only signaling server for PingPongGo LAN.
 *
 * Purpose:
 * - create exactly one fixed lobby: GUEST
 * - accept the first/active guest immediately
 * - send connect messages to both peers
 * - relay SDP/candidates/events while WebRTC is bootstrapping
 * - after WebRTC is established, do NOT let signaling socket close kill gameplay
 *
 * The WebSocket server is only a matchmaker/handshake helper.
 * Gameplay must continue over WebRTC DataChannel after connection.
 */
class SignalingWsServer(port: Int) : NanoWSD("0.0.0.0", port) {

    private val clients = ConcurrentHashMap<String, WebSocket>()
    private val socketIds = ConcurrentHashMap<WebSocket, String>()

    @Volatile private var hostId: String? = null
    @Volatile private var guestId: String? = null
    @Volatile private var webRtcEstablished: Boolean = false

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket {
        return object : WebSocket(handshake) {
            override fun onOpen() {
                val id = "p" + UUID.randomUUID().toString().replace("-", "").take(8)
                socketIds[this] = id
                clients[id] = this
                log("OPEN $id")
            }

            override fun onMessage(message: WebSocketFrame) {
                val text = message.textPayload ?: return
                val selfId = socketIds[this] ?: return
                val type = extract(text, "type") ?: return

                log("IN $selfId $type $text")

                when (type) {
                    "hello" -> {
                        sendJson(this, """{"type":"welcome","id":"$selfId","peerId":"$selfId","secret":"s$selfId"}""")
                        sendJson(this, """{"type":"credentials","id":"$selfId","peerId":"$selfId"}""")
                    }

                    "credentials" -> {
                        sendJson(this, """{"type":"credentials","id":"$selfId","peerId":"$selfId"}""")
                    }

                    "ping" -> sendJson(this, """{"type":"ping"}""")
                    "pong" -> sendJson(this, """{"type":"pong"}""")

                    "create" -> {
                        // One active host per server. A refreshed same host may recreate.
                        val existingHost = hostId
                        if (existingHost != null && existingHost != selfId && clients.containsKey(existingHost) && !webRtcEstablished) {
                            sendJson(this, """{"type":"error","code":"host-already-exists","reason":"Host already exists"}""")
                            log("REFUSED create from $selfId; current host=$existingHost")
                            return
                        }

                        hostId = selfId
                        if (!webRtcEstablished) guestId = null

                        val info = lobbyInfo()
                        sendJson(this, """{"type":"joined","code":"GUEST","lobbyInfo":$info}""")
                        sendJson(this, """{"type":"lobby","code":"GUEST","lobbyInfo":$info}""")
                        sendJson(this, """{"type":"lobbyUpdated","lobbyInfo":$info}""")
                        log("HOST READY $selfId lobby=GUEST")
                    }

                    "join" -> {
                        if (selfId == hostId) {
                            sendJson(this, """{"type":"error","code":"host-cannot-join","reason":"Host cannot join as guest"}""")
                            log("REFUSED host joining itself $selfId")
                            return
                        }

                        val h = hostId
                        if (h == null || !clients.containsKey(h)) {
                            // Guest can wait, but cannot become host through join.
                            guestId = selfId
                            sendJson(this, """{"type":"joined","code":"GUEST","lobbyInfo":${lobbyInfo()}}""")
                            sendJson(this, """{"type":"error","code":"host-not-ready","reason":"Host not ready yet"}""")
                            log("JOIN waiting guest=$selfId; host not ready")
                            return
                        }

                        // Smart behavior: refreshed guest replaces stale/previous guest during bootstrap.
                        guestId = selfId
                        val info = lobbyInfo()

                        sendJson(this, """{"type":"joined","code":"GUEST","lobbyInfo":$info}""")
                        sendJson(this, """{"type":"lobbyUpdated","lobbyInfo":$info}""")
                        clients[h]?.let { sendJson(it, """{"type":"lobbyUpdated","lobbyInfo":$info}""") }

                        // Critical bootstrap: force handshake immediately. No approval screen, no random code.
                        clients[h]?.let { sendJson(it, """{"type":"connect","id":"$selfId","polite":false}""") }
                        sendJson(this, """{"type":"connect","id":"$h","polite":true}""")

                        log("ACCEPTED guest=$selfId host=$h lobby=GUEST")
                    }

                    "description", "candidate" -> {
                        val targetId = extract(text, "recipient")
                            ?: extract(text, "receiverId")
                            ?: otherPeer(selfId)

                        if (targetId != null) {
                            clients[targetId]?.let {
                                sendJson(it, text)
                                log("RELAY $type $selfId -> $targetId")
                            } ?: log("RELAY target missing for $type: $targetId")
                        }
                    }

                    "connected" -> {
                        webRtcEstablished = true
                        relayToOther(selfId, text)
                        broadcast("""{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
                        log("WEBRTC ESTABLISHED host=$hostId guest=$guestId; signaling now disposable")
                    }

                    "event" -> relayToOther(selfId, text)

                    "leave", "quit" -> {
                        // Explicit user action still tears down state.
                        if (hostId == selfId) hostId = null
                        if (guestId == selfId) guestId = null
                        webRtcEstablished = false
                        relayToOther(selfId, """{"type":"disconnect","id":"$selfId","reason":"explicit-leave"}""")
                        broadcast("""{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
                        log("EXPLICIT LEAVE $selfId")
                    }

                    else -> {
                        // Smart bootstrap relay: if netlib sends extra/unknown handshake messages, pass them through.
                        val targetId = extract(text, "recipient")
                            ?: extract(text, "receiverId")
                            ?: otherPeer(selfId)
                        if (targetId != null) {
                            clients[targetId]?.let {
                                sendJson(it, text)
                                log("RELAY unknown:$type $selfId -> $targetId")
                            }
                        }
                    }
                }
            }

            override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
                val id = socketIds.remove(this) ?: return
                clients.remove(id)
                log("CLOSE $id code=$code reason=$reason established=$webRtcEstablished")

                if (webRtcEstablished) {
                    // Key smart behavior: signaling close after WebRTC is established must not kill gameplay.
                    log("SUPPRESS disconnect broadcast after established WebRTC for $id")
                    return
                }

                if (hostId == id) hostId = null
                if (guestId == id) guestId = null
                relayToOther(id, """{"type":"disconnect","id":"$id","reason":"socket-close-before-established"}""")
                broadcast("""{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
            }

            override fun onPong(pong: WebSocketFrame) {}

            override fun onException(exception: IOException) {
                log("WS EXCEPTION ${exception.message}")
            }
        }
    }

    private fun otherPeer(id: String): String? = when (id) {
        hostId -> guestId
        guestId -> hostId
        else -> null
    }

    private fun relayToOther(fromId: String, text: String) {
        val targetId = otherPeer(fromId)
        if (targetId != null) clients[targetId]?.let { sendJson(it, text) }
    }

    private fun lobbyInfo(): String {
        val players = listOfNotNull(hostId, guestId).joinToString(",") { "\"$it\"" }
        val leader = hostId ?: ""
        val established = if (webRtcEstablished) "true" else "false"
        return """{"code":"GUEST","leader":"$leader","term":1,"players":[$players],"maxPlayers":2,"established":$established}"""
    }

    private fun broadcast(text: String) {
        clients.values.forEach { sendJson(it, text) }
    }

    private fun sendJson(ws: WebSocket, text: String) {
        try {
            ws.send(text)
            log("OUT $text")
        } catch (e: Exception) {
            log("SEND ERROR ${e.message}")
        }
    }

    private fun extract(json: String, key: String): String? {
        return """"$key"\s*:\s*"([^"]+)""".toRegex().find(json)?.groupValues?.getOrNull(1)
    }

    private fun log(msg: String) {
        android.util.Log.d("PPG-SIGNAL", msg)
        println("PPG-SIGNAL $msg")
    }
}
