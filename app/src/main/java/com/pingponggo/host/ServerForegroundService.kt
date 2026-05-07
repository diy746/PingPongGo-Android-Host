package com.pingponggo.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Intent
import android.os.Build
import android.os.IBinder
import com.pingponggo.host.server.GameHttpServer
import com.pingponggo.host.server.SignalingWsServer
import fi.iki.elonen.NanoHTTPD

class ServerForegroundService : Service() {
    private var httpServer: GameHttpServer? = null
    private var wsServer: SignalingWsServer? = null

    companion object {
        const val HTTP_PORT = 8123
        const val WS_PORT = 8124
        const val CHANNEL_ID = "pingponggo_lan_server"
        const val NOTIFICATION_ID = 746
        var isRunning: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, buildNotification("Starting LAN server..."))
        startServers()
        isRunning = true
        updateNotification("HTTP :8123 and WS :8124 running")
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!isRunning) {
            startServers()
            isRunning = true
        }
        updateNotification("PingPongGo LAN server running")
        return START_STICKY
    }

    private fun startServers() {
        if (httpServer == null) {
            httpServer = GameHttpServer(this, HTTP_PORT).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }

        if (wsServer == null) {
            wsServer = SignalingWsServer(WS_PORT).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }
    }

    private fun stopServers() {
        try { wsServer?.stop() } catch (_: Exception) {}
        try { httpServer?.stop() } catch (_: Exception) {}
        wsServer = null
        httpServer = null
        isRunning = false
    }

    override fun onDestroy() {
        stopServers()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    private fun updateNotification(text: String) {
        val nm = getSystemService(NotificationManager::class.java)
        nm.notify(NOTIFICATION_ID, buildNotification(text))
    }

    private fun buildNotification(text: String): Notification {
        val nm = getSystemService(NotificationManager::class.java)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "PingPongGo LAN Server",
                NotificationManager.IMPORTANCE_LOW
            )
            nm.createNotificationChannel(channel)
        }

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("PingPongGo LAN Host")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .build()
    }
}
