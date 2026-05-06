package com.pingponggo.host.signaling

import fi.iki.elonen.NanoWSD
import kotlinx.serialization.Serializable

@Serializable
data class Peer(
    val id: String,
    val role: String,
    @kotlinx.serialization.Transient val socket: NanoWSD.WebSocket? = null
)

class Lobby(
    val code: String = "GUEST",
    val maxPlayers: Int = 2
) {
    var host: Peer? = null
    var guest: Peer? = null

    fun add(peer: Peer): Boolean {
        if (peer.role == "host" && host == null) { host = peer; return true }
        if (peer.role == "guest" && guest == null) { guest = peer; return true }
        return false
    }

    fun remove(peerId: String) {
        if (host?.id == peerId) host = null
        if (guest?.id == peerId) guest = null
    }
}
