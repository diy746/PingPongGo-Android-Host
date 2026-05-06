package com.pingponggo.host

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import com.pingponggo.host.network.IpDetector
import com.pingponggo.host.server.GameHttpServer
import com.pingponggo.host.server.SignalingWsServer
import com.pingponggo.host.ui.HostScreen
import fi.iki.elonen.NanoHTTPD

class MainActivity : ComponentActivity() {
    private var httpServer: GameHttpServer? = null
    private var wsServer: SignalingWsServer? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val httpPort = 8123
        val wsPort = 8124
        val ip = IpDetector.detectLanIp() ?: "192.168.43.1"
        val guestUrl = "http://$ip:$httpPort/index.html?id=GUEST"
        val zipUrl = "http://$ip:$httpPort/download/PingPongGo-LAN.zip"

        httpServer = GameHttpServer(this, httpPort).also {
            it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
        }
        wsServer = SignalingWsServer(wsPort).also {
            it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
        }

        setContent {
            HostScreen(
                ip = ip,
                guestUrl = guestUrl,
                zipUrl = zipUrl,
                httpPort = httpPort,
                wsPort = wsPort
            )
        }
    }

    override fun onDestroy() {
        wsServer?.stop()
        httpServer?.stop()
        super.onDestroy()
    }
}
