package com.pingponggo.host

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import com.pingponggo.host.network.IpDetector
import com.pingponggo.host.qr.QrGenerator
import com.pingponggo.host.server.GameHttpServer
import com.pingponggo.host.server.SignalingWsServer

class MainActivity : Activity() {
    private var httpServer: GameHttpServer? = null
    private var wsServer: SignalingWsServer? = null

    private val httpPort = 8123
    private val wsPort = 8124

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val ip = IpDetector.detectLanIp() ?: "192.168.43.1"
        val hostUrl = "http://$ip:$httpPort/index.html"
        val guestUrl = "http://$ip:$httpPort/index.html?id=GUEST"
        val guestUrlWithSignal = "$guestUrl&signal=ws://$ip:$wsPort/v0/signaling"
        val testUrl = "http://$ip:$httpPort/ppg-test.html"
        val zipUrl = "http://$ip:$httpPort/download/PingPongGo-LAN.zip"

        val status = StringBuilder()
        try {
            httpServer = GameHttpServer(this, httpPort).also { it.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, false) }
            status.append("HTTP OK on :$httpPort\n")
        } catch (e: Exception) {
            status.append("HTTP ERROR: ${e.message}\n")
        }

        try {
            wsServer = SignalingWsServer(wsPort).also { it.start(fi.iki.elonen.NanoHTTPD.SOCKET_READ_TIMEOUT, false) }
            status.append("WebSocket OK on :$wsPort\n")
        } catch (e: Exception) {
            status.append("WebSocket ERROR: ${e.message}\n")
        }

        setContentView(buildUi(ip, hostUrl, guestUrlWithSignal, testUrl, zipUrl, status.toString()))
    }

    private fun buildUi(
        ip: String,
        hostUrl: String,
        guestUrl: String,
        testUrl: String,
        zipUrl: String,
        status: String
    ): ScrollView {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 32, 32, 32)
            gravity = Gravity.CENTER_HORIZONTAL
        }

        fun label(text: String, size: Float = 16f): TextView = TextView(this).apply {
            this.text = text
            textSize = size
            setPadding(0, 8, 0, 8)
        }

        root.addView(label("PingPongGo LAN Host", 24f))
        root.addView(label("Detected IP: $ip"))
        root.addView(label(status))

        val qrBitmap = QrGenerator.create(guestUrl, 768)
        root.addView(ImageView(this).apply {
            setImageBitmap(qrBitmap)
            adjustViewBounds = true
            maxWidth = 720
            maxHeight = 720
        })

        root.addView(label("HOST URL:\n$hostUrl"))
        root.addView(label("GUEST QR URL:\n$guestUrl"))
        root.addView(label("TEST URL:\n$testUrl"))
        root.addView(label("ZIP URL:\n$zipUrl"))

        root.addView(Button(this).apply {
            text = "Copy Guest URL"
            setOnClickListener { copyText("Guest URL", guestUrl) }
        })

        root.addView(Button(this).apply {
            text = "Open Host Game on this phone"
            setOnClickListener { openUrl(hostUrl) }
        })

        root.addView(Button(this).apply {
            text = "Open Test Page"
            setOnClickListener { openUrl(testUrl) }
        })

        root.addView(label("Instructions:\n1. Enable hotspot on this phone.\n2. Connect guest phone to hotspot.\n3. Guest scans QR.\n4. Game opens as id=GUEST.\n\nNo internet, no Termux, no Node.js."))

        return ScrollView(this).apply { addView(root) }
    }

    private fun copyText(label: String, value: String) {
        val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        cm.setPrimaryClip(ClipData.newPlainText(label, value))
        Toast.makeText(this, "Copied", Toast.LENGTH_SHORT).show()
    }

    private fun openUrl(url: String) {
        startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url)))
    }

    override fun onDestroy() {
        wsServer?.stop()
        httpServer?.stop()
        super.onDestroy()
    }
}
