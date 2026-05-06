package com.pingponggo.host.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.pingponggo.host.qr.QrGenerator

@Composable
fun HostScreen(ip: String, guestUrl: String, zipUrl: String, httpPort: Int, wsPort: Int) {
    val qr = QrGenerator.create(guestUrl, 768).asImageBitmap()
    Column(Modifier.fillMaxSize().padding(16.dp)) {
        Text("PingPongGo LAN Host", style = MaterialTheme.typography.headlineSmall)
        Spacer(Modifier.height(8.dp))
        Text("HTTP: http://$ip:$httpPort")
        Text("WS: ws://$ip:$wsPort/v0/signaling")
        Spacer(Modifier.height(12.dp))
        Text("Guest QR:")
        Image(qr, contentDescription = "Guest QR", modifier = Modifier.size(280.dp))
        Spacer(Modifier.height(12.dp))
        Text("Guest URL:")
        Text(guestUrl, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(12.dp))
        Text("Manual ZIP download:")
        Text(zipUrl, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))
        Text("Instructions: enable hotspot on this phone, connect guest phone to hotspot, then scan QR.")
    }
}
