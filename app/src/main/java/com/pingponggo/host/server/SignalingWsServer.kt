package com.pingponggo.host.server

import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import java.io.IOException
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/**
 * PingPongGo LAN signaling server.
 *
 * SMART RULE:
 * - Signaling is BOOTSTRAP ONLY.
 * - Before WebRTC is established: be permissive and connect host/guest as soon as possible.
 * - After WebRTC is established: do not let stale signaling socket closes kill the game.
 * - A match ends through browser lifecycle message /__match-ended, then this server resets to IDLE.
 */
class SignalingWsServer(port: Int) : NanoWSD("0.0.0.0", port) {

    enum class Phase { IDLE, INVITING, HANDSHAKING, PLAYING }

    private val clients = ConcurrentHashMap<String, WebSocket>()
    private val socketIds = ConcurrentHashMap<WebSocket, String>()

    @Volatile private var phase: Phase = Phase.IDLE
    @Volatile private var hostId: String? = null
    @Volatile private var guestId: String? = null

    companion object {
        @Volatile private var active: SignalingWsServer? = null

        fun markPlaying() {
            active?.markPlayingInternal()
        }

        fun resetSession() {
            active?.resetSessionInternal("external-reset")
        }

        fun status(): String {
            return active?.statusJson() ?: "{\"phase\":\"STOPPED\"}"
        }
    }

    init {
        active = this
    }

    override fun openWebSocket(handshake: NanoHTTPD.IHTTPSession): WebSocket {
        return object : WebSocket(handshake) {

            override fun onOpen() {
                val id = "p" + UUID.randomUUID().toString().replace("-", "").take(8)
                socketIds[this] = id
                clients[id] = this
                log("OPEN $id phase=$phase")
            }

            override fun onMessage(message: WebSocketFrame) {
                val text = message.textPayload ?: return
                val selfId = socketIds[this] ?: return
                val type = extract(text, "type") ?: return

                log("IN $selfId $type $text")

                when (type) {
                    "hello" -> {
                        // Netlib expects welcome/credentials style messages. Send both.
                        sendJson(this, """{"type":"welcome","id":"$selfId","peerId":"$selfId","secret":"s$selfId"}""")
                        sendJson(this, """{"type":"credentials","id":"$selfId","peerId":"$selfId"}""")
                    }

                    "credentials" -> {
                        sendJson(this, """{"type":"credentials","id":"$selfId","peerId":"$selfId"}""")
                    }

                    "ping" -> sendJson(this, """{"type":"ping"}""")
                    "pong" -> sendJson(this, """{"type":"pong"}""")

                    "create" -> {
                        // Be permissive: any new create starts/restarts the invitation unless already playing.
                        if (phase != Phase.PLAYING || hostId == null || hostId == selfId) {
                            hostId = selfId
                            guestId = null
                            phase = Phase.INVITING
                        }

                        val info = lobbyInfo()
                        sendJson(this, """{"type":"joined","code":"GUEST","lobbyInfo":$info}""")
                        sendJson(this, """{"type":"lobby","code":"GUEST","lobbyInfo":$info}""")
                        sendJson(this, """{"type":"lobbyUpdated","lobbyInfo":$info}""")

                        log("INVITE READY host=$hostId lobby=GUEST phase=$phase")

                        // If guest was already waiting, connect immediately.
                        maybeConnectPeers("create")
                    }

                    "join" -> {
                        // Fixed single lobby. A refreshed guest replaces stale guest while not PLAYING.
                        val h = hostId
                        if (h == null || clients[h] == null) {
                            guestId = selfId
                            phase = Phase.INVITING
                            sendJson(this, """{"type":"joined","code":"GUEST","lobbyInfo":${lobbyInfo()}}""")
                            sendJson(this, """{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
                            log("GUEST WAITING $selfId, no host yet")
                            return
                        }

                        if (selfId == h) {
                            // Do not let the same socket be both sides.
                            sendJson(this, """{"type":"error","code":"self-join","reason":"Host cannot join itself"}""")
                            log("REFUSED self join $selfId")
                            return
                        }

                        if (phase != Phase.PLAYING || guestId == null || guestId == selfId) {
                            guestId = selfId
                            phase = Phase.HANDSHAKING
                        }

                        val info = lobbyInfo()
                        sendJson(this, """{"type":"joined","code":"GUEST","lobbyInfo":$info}""")
                        broadcast("""{"type":"lobbyUpdated","lobbyInfo":$info}""")

                        maybeConnectPeers("join")
                    }

                    "leave" -> {
                        if (selfId == hostId) hostId = null
                        if (selfId == guestId) guestId = null
                        if (hostId == null && guestId == null) phase = Phase.IDLE
                        broadcast("""{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
                    }

                    "connected" -> {
                        markPlayingInternal()
                        relayToOtherOrRecipient(selfId, text, type)
                    }

                    "description", "candidate", "event" -> {
                        relayToOtherOrRecipient(selfId, text, type)
                    }

                    else -> {
                        // Be forgiving: unknown netlib messages relay to the peer.
                        relayToOtherOrRecipient(selfId, text, type)
                    }
                }
            }

            override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
                val id = socketIds.remove(this) ?: return
                clients.remove(id)

                log("CLOSE $id phase=$phase reason=$reason")

                if (phase == Phase.PLAYING) {
                    // Signaling socket closing after WebRTC is established is not proof the match ended.
                    // Browser heartbeat/ppgTableQuit decides real abandon/quit.
                    if (id == hostId) hostId = null
                    if (id == guestId) guestId = null
                    return
                }

                if (id == hostId) hostId = null
                if (id == guestId) guestId = null
                if (hostId == null && guestId == null) phase = Phase.IDLE

                broadcast("""{"type":"disconnect","id":"$id"}""")
                broadcast("""{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
            }

            override fun onPong(pong: WebSocketFrame) {}
            override fun onException(exception: IOException) { log("WS EXCEPTION ${exception.message}") }
        }
    }

    private fun maybeConnectPeers(source: String) {
        val h = hostId
        val g = guestId
        val host = if (h != null) clients[h] else null
        val guest = if (g != null) clients[g] else null

        if (h == null || g == null || host == null || guest == null || h == g) {
            log("CONNECT WAIT source=$source host=$h guest=$g phase=$phase")
            return
        }

        phase = Phase.HANDSHAKING
        val info = lobbyInfo()

        // This mirrors the working Node server pattern: send connect to both sides immediately.
        sendJson(host, """{"type":"connect","id":"$g","polite":false,"lobbyInfo":$info}""")
        sendJson(guest, """{"type":"connect","id":"$h","polite":true,"lobbyInfo":$info}""")
        sendJson(host, """{"type":"lobbyUpdated","lobbyInfo":$info}""")
        sendJson(guest, """{"type":"lobbyUpdated","lobbyInfo":$info}""")

        log("AUTO ACCEPT source=$source host=$h guest=$g phase=$phase")
    }

    private fun relayToOtherOrRecipient(selfId: String, text: String, type: String) {
        val targetId = extract(text, "recipient")
            ?: extract(text, "receiverId")
            ?: extract(text, "target")
            ?: otherPeer(selfId)

        if (targetId == null) {
            log("RELAY DROP $type from=$selfId no target")
            return
        }

        val target = clients[targetId]
        if (target == null) {
            log("RELAY MISS $type from=$selfId to=$targetId")
            return
        }

        sendJson(target, text)
        log("RELAY $type $selfId -> $targetId")
    }

    private fun otherPeer(id: String): String? = when (id) {
        hostId -> guestId
        guestId -> hostId
        else -> null
    }

    private fun markPlayingInternal() {
        if (phase != Phase.PLAYING) {
            phase = Phase.PLAYING
            log("PHASE PLAYING: signaling bootstrap complete")
        }
    }

    private fun resetSessionInternal(reason: String) {
        log("RESET SESSION reason=$reason host=$hostId guest=$guestId phase=$phase")
        hostId = null
        guestId = null
        phase = Phase.IDLE
        broadcast("""{"type":"lobbyUpdated","lobbyInfo":${lobbyInfo()}}""")
    }

    private fun lobbyInfo(): String {
        val players = listOfNotNull(hostId, guestId).joinToString(",") { "\"$it\"" }
        val leader = hostId ?: ""
        return """{"code":"GUEST","leader":"$leader","term":1,"players":[$players],"maxPlayers":2,"phase":"$phase"}"""
    }

    private fun statusJson(): String = lobbyInfo()

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
        val pattern = Regex("\\\"$key\\\"\\s*:\\s*\\\"([^\\\"]+)\\\"")
        return pattern.find(json)?.groupValues?.getOrNull(1)
    }

    private fun log(msg: String) {
        android.util.Log.d("PPG-SIGNAL", msg)
        println("PPG-SIGNAL $msg")
    }
}
