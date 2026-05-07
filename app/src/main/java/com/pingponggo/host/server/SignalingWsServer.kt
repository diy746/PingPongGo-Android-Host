package com.pingponggo.host.server

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

class SignalingWsServer(port: Int) : NanoWSD("0.0.0.0", port) {

    private enum class Phase { IDLE, INVITING, HANDSHAKING, PLAYING }

    private val clients = ConcurrentHashMap<String, WebSocket>()
    private val socketIds = ConcurrentHashMap<WebSocket, String>()

    @Volatile private var phase: Phase = Phase.IDLE
    @Volatile private var hostId: String? = null
    @Volatile private var guestId: String? = null
    @Volatile private var session: Long = System.currentTimeMillis()

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket {
        return object : WebSocket(handshake) {
            override fun onOpen() {
                val id = "p" + UUID.randomUUID().toString().replace("-", "").take(8)
                socketIds[this] = id
                clients[id] = this
                log("OPEN $id phase=$phase session=$session")
            }

            override fun onMessage(message: WebSocketFrame) {
                val text = message.textPayload ?: return
                val selfId = socketIds[this] ?: return
                val type = extract(text, "type") ?: return

                log("IN $selfId type=$type phase=$phase $text")

                when (type) {
                    "hello" -> {
                        sendJson(this, """{"type":"welcome","id":"$selfId","peerId":"$selfId","secret":"s$selfId","session":$session}""")
                        sendJson(this, """{"type":"credentials","id":"$selfId","peerId":"$selfId","session":$session}""")
                    }

                    "credentials" -> {
                        sendJson(this, """{"type":"credentials","id":"$selfId","peerId":"$selfId","session":$session}""")
                    }

                    "ping" -> sendJson(this, """{"type":"ping","session":$session}""")
                    "pong" -> sendJson(this, """{"type":"pong","session":$session}""")

                    "create" -> handleCreate(this, selfId)
                    "join" -> handleJoin(this, selfId)

                    "connected" -> {
                        // Some netlib builds send this after DataChannel establishment.
                        relayToOther(selfId, text)
                        markPlaying("ws-connected-from-$selfId")
                    }

                    "leave", "ppgQuit", "match-ended" -> {
                        relayToOther(selfId, text)
                        resetSession("leave/$type from $selfId")
                    }

                    "description", "candidate", "event" -> {
                        relayByRecipientOrOther(selfId, text)
                    }

                    else -> {
                        // Be generous: the signaling server is only a bootstrap relay.
                        relayByRecipientOrOther(selfId, text)
                    }
                }
            }

            override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
                val id = socketIds.remove(this) ?: return
                clients.remove(id)
                log("CLOSE $id phase=$phase reason=$reason")

                // During PLAYING, WebRTC/DataChannel owns the match. A stale signaling close must not kill the game.
                if (phase == Phase.PLAYING) return

                if (id == hostId || id == guestId) {
                    resetSession("bootstrap socket closed: $id")
                }
            }

            override fun onPong(pong: WebSocketFrame) {}

            override fun onException(exception: IOException) {
                log("WS EXCEPTION ${exception.message}")
            }
        }
    }

    @Synchronized
    private fun handleCreate(ws: WebSocket, selfId: String) {
        if (phase == Phase.PLAYING) {
            sendJson(ws, """{"type":"error","code":"match-in-progress","reason":"A match is already playing"}""")
            log("REFUSE create from $selfId because phase=PLAYING")
            return
        }

        hostId = selfId
        guestId = null
        phase = Phase.INVITING
        session = System.currentTimeMillis()

        val info = lobbyInfo()
        sendJson(ws, """{"type":"joined","code":"GUEST","lobbyInfo":$info,"session":$session}""")
        sendJson(ws, """{"type":"lobby","code":"GUEST","lobbyInfo":$info,"session":$session}""")
        log("INVITE READY host=$selfId code=GUEST session=$session")
    }

    @Synchronized
    private fun handleJoin(ws: WebSocket, selfId: String) {
        if (phase == Phase.PLAYING) {
            sendJson(ws, """{"type":"error","code":"match-in-progress","reason":"A match is already playing"}""")
            log("REFUSE join from $selfId because phase=PLAYING")
            return
        }

        val h = hostId
        if (h == null) {
            sendJson(ws, """{"type":"error","code":"host-not-ready","reason":"No active invitation"}""")
            log("REFUSE join from $selfId because no host")
            return
        }

        if (selfId == h) {
            sendJson(ws, """{"type":"error","code":"host-cannot-join","reason":"Host cannot join itself"}""")
            log("REFUSE join from host socket $selfId")
            return
        }

        guestId = selfId
        phase = Phase.HANDSHAKING

        val host = clients[h]
        if (host == null) {
            resetSession("host socket missing before handshake")
            sendJson(ws, """{"type":"error","code":"host-not-ready","reason":"Host socket missing"}""")
            return
        }

        val info = lobbyInfo()
        sendJson(ws, """{"type":"joined","code":"GUEST","lobbyInfo":$info,"session":$session}""")
        sendJson(host, """{"type":"lobbyUpdated","lobbyInfo":$info,"session":$session}""")
        sendJson(ws, """{"type":"lobbyUpdated","lobbyInfo":$info,"session":$session}""")

        // The only purpose of signaling: tell both peers to start the WebRTC handshake.
        sendJson(host, """{"type":"connect","id":"$selfId","polite":false,"session":$session}""")
        sendJson(ws, """{"type":"connect","id":"$h","polite":true,"session":$session}""")

        log("HANDSHAKE START host=$h guest=$selfId session=$session")
    }

    @Synchronized
    fun markPlaying(reason: String = "connected") {
        if (phase != Phase.PLAYING) {
            phase = Phase.PLAYING
            log("PLAYING: $reason host=$hostId guest=$guestId session=$session")
        }
    }

    @Synchronized
    fun resetSession(reason: String = "manual reset") {
        val oldHost = hostId
        val oldGuest = guestId
        hostId = null
        guestId = null
        phase = Phase.IDLE
        session = System.currentTimeMillis()
        log("RESET SESSION: $reason oldHost=$oldHost oldGuest=$oldGuest newSession=$session")
    }

    private fun relayByRecipientOrOther(selfId: String, text: String) {
        val target = extract(text, "recipient")
            ?: extract(text, "receiverId")
            ?: extract(text, "to")
            ?: otherPeer(selfId)

        if (target != null) {
            clients[target]?.let { sendJson(it, text) }
            log("RELAY $selfId -> $target")
        } else {
            log("NO TARGET for relay from $selfId")
        }
    }

    private fun relayToOther(selfId: String, text: String) {
        val target = otherPeer(selfId)
        if (target != null) clients[target]?.let { sendJson(it, text) }
    }

    private fun otherPeer(id: String): String? = when (id) {
        hostId -> guestId
        guestId -> hostId
        else -> null
    }

    private fun lobbyInfo(): String {
        val players = listOfNotNull(hostId, guestId).joinToString(",") { "\"$it\"" }
        val leader = hostId ?: ""
        return """{"code":"GUEST","leader":"$leader","term":1,"players":[$players],"maxPlayers":2,"phase":"$phase"}"""
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
        val pattern = """"$key"\s*:\s*"([^"]+)"""".toRegex()
        return pattern.find(json)?.groupValues?.getOrNull(1)
    }

    private fun log(msg: String) {
        android.util.Log.d("PPG-SIGNAL", msg)
        println("PPG-SIGNAL $msg")
    }
}
