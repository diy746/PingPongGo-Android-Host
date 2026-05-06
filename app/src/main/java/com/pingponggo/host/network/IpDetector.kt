package com.pingponggo.host.network

import java.net.NetworkInterface

object IpDetector {
    fun detectLanIp(): String? {
        return NetworkInterface.getNetworkInterfaces().toList()
            .flatMap { it.inetAddresses.toList() }
            .mapNotNull { addr ->
                val host = addr.hostAddress ?: return@mapNotNull null
                if (!addr.isLoopbackAddress && host.indexOf(':') < 0 && isPrivateIpv4(host)) host else null
            }
            .firstOrNull()
    }

    private fun isPrivateIpv4(ip: String): Boolean =
        ip.startsWith("192.168.") ||
        ip.startsWith("10.") ||
        Regex("^172\\.(1[6-9]|2[0-9]|3[0-1])\\.").containsMatchIn(ip)
}
