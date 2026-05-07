package com.pingponggo.host

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
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
        const val ACTION_STOP = "com.pingponggo.host.STOP_SERVER"
        const val ACTION_RESET_SESSION = "com.pingponggo.host.RESET_SESSION"

        @Volatile var isRunning: Boolean = false
            private set
    }

    override fun onCreate() {
        super.onCreate()
        startForeground(NOTIFICATION_ID, buildNotification("Starting LAN server..."))
        startServers()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopServers()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_RESET_SESSION -> {
                wsServer?.resetSession("manual reset from service action")
                updateNotification("Session reset. Ready for new invitation.")
                return START_STICKY
            }
            else -> {
                startServers()
                updateNotification("LAN server running. Ready for invitation.")
                return START_STICKY
            }
        }
    }

    private fun startServers() {
        if (wsServer == null) {
            wsServer = SignalingWsServer(WS_PORT).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }

        if (httpServer == null) {
            httpServer = GameHttpServer(
                context = this,
                port = HTTP_PORT,
                onWebRtcConnected = {
                    wsServer?.markPlaying("browser /__connected")
                    updateNotification("Match playing. Signaling reset waits for Quit.")
                },
                onMatchEnded = {
                    wsServer?.resetSession("browser /__match-ended")
                    updateNotification("Match ended. Ready for new invitation.")
                }
            ).also {
                it.start(NanoHTTPD.SOCKET_READ_TIMEOUT, false)
            }
        }

        isRunning = true
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
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL_ID, "PingPongGo LAN Server", NotificationManager.IMPORTANCE_LOW)
            )
        }

        val stopIntent = Intent(this, ServerForegroundService::class.java).apply { action = ACTION_STOP }
        val stopPendingIntent = PendingIntent.getService(
            this, 1, stopIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val resetIntent = Intent(this, ServerForegroundService::class.java).apply { action = ACTION_RESET_SESSION }
        val resetPendingIntent = PendingIntent.getService(
            this, 2, resetIntent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("PingPongGo LAN Host")
            .setContentText(text)
            .setSmallIcon(android.R.drawable.stat_sys_upload_done)
            .setOngoing(true)
            .addAction(android.R.drawable.ic_menu_revert, "RESET", resetPendingIntent)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "QUIT", stopPendingIntent)
            .build()
    }
}
