package com.pingponggo.host

import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import com.pingponggo.host.network.IpDetector
import com.pingponggo.host.qr.QrGenerator
import com.pingponggo.host.server.GameHttpServer
import com.pingponggo.host.server.SignalingWsServer
import fi.iki.elonen.NanoHTTPD

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
        val testUrl = "http://$ip:$httpPort/ppg-test.html"
        val healthUrl = "http://$ip:$httpPort/__health"
        val zipUrl = "http://$ip:$httpPort/download/PingPongGo-LAN.zip"

        startServers()

        setContentView(makeUi(ip, hostUrl, guestUrl, testUrl, healthUrl, zipUrl))
    }

    private fun startServers() {
        try {
            httpServer = GameHttpServer(this, httpPort).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }

        try {
            wsServer = SignalingWsServer(wsPort).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        } catch (e: Exception) {
            e.printStackTrace()
        }
    }

    private fun makeUi(
        ip: String,
        hostUrl: String,
        guestUrl: String,
        testUrl: String,
        healthUrl: String,
        zipUrl: String
    ): ScrollView {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(32, 32, 32, 32)
        }

        fun text(value: String, size: Float = 16f): TextView {
            return TextView(this).apply {
                text = value
                textSize = size
                setPadding(0, 8, 0, 8)
            }
        }

        fun button(label: String, action: () -> Unit): Button {
            return Button(this).apply {
                text = label
                setOnClickListener { action() }
            }
        }

        root.addView(text("PingPongGo LAN Host", 24f))
        root.addView(text("HOST IP: $ip"))
        root.addView(text("HTTP: http://$ip:$httpPort"))
        root.addView(text("WS: ws://$ip:$wsPort/v0/signaling"))
        root.addView(text("Fixed lobby: GUEST"))
        root.addView(text("Max human peers: 2"))
        root.addView(text("Game slots: always 2 — HOST vs CPU or HOST vs GUEST"))

        val qrBitmap: Bitmap = QrGenerator.create(guestUrl, 768)
        root.addView(ImageView(this).apply {
            setImageBitmap(qrBitmap)
            adjustViewBounds = true
            maxWidth = 700
            maxHeight = 700
        })

        root.addView(text("Guest URL:"))
        root.addView(text(guestUrl, 14f))

        root.addView(button("Copy Guest URL") {
            val cm = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            cm.setPrimaryClip(ClipData.newPlainText("PingPongGo Guest URL", guestUrl))
        })

        root.addView(button("Open Health Check") { openUrl(healthUrl) })
        root.addView(button("Open Test Page") { openUrl(testUrl) })
        root.addView(button("Open HOST Game") { openUrl(hostUrl) })

        root.addView(text("ZIP manual download:"))
        root.addView(text(zipUrl, 14f))

        root.addView(text("Instructions:\n1. Enable hotspot on this phone.\n2. Keep this app open.\n3. Connect guest phone to hotspot.\n4. Scan QR on guest phone."))

        return ScrollView(this).apply {
            addView(root)
        }
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
