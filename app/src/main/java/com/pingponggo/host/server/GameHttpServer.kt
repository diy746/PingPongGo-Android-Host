package com.pingponggo.host.server

import android.content.Context
import fi.iki.elonen.NanoHTTPD
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

class GameHttpServer(
    private val context: Context,
    port: Int
) : NanoHTTPD("0.0.0.0", port) {

    override fun serve(session: IHTTPSession): Response {
        val uri = session.uri.trimStart('/')
        return try {
            when {
                uri == "" -> serveAsset("index.html")
                uri == "download/PingPongGo-LAN.zip" -> serveZip()
                else -> serveAsset(uri)
            }
        } catch (e: Exception) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "404: ${session.uri}")
        }
    }

    private fun serveAsset(path: String): Response {
        val cleanPath = path.removePrefix("/")
        val stream = context.assets.open("www/$cleanPath")
        return newChunkedResponse(Response.Status.OK, MimeTypes.of(cleanPath), stream)
    }

    private fun serveZip(): Response {
        val bytes = buildZipFromAssets("www")
        return newFixedLengthResponse(
            Response.Status.OK,
            "application/zip",
            ByteArrayInputStream(bytes),
            bytes.size.toLong()
        ).apply {
            addHeader("Content-Disposition", "attachment; filename=PingPongGo-LAN.zip")
        }
    }

    private fun buildZipFromAssets(root: String): ByteArray {
        val out = ByteArrayOutputStream()
        ZipOutputStream(out).use { zip ->
            addAssetDirToZip(root, "", zip)
        }
        return out.toByteArray()
    }

    private fun addAssetDirToZip(assetDir: String, zipDir: String, zip: ZipOutputStream) {
        val names = context.assets.list(assetDir).orEmpty()
        for (name in names) {
            val assetPath = "$assetDir/$name"
            val zipPath = if (zipDir.isEmpty()) name else "$zipDir/$name"
            val children = context.assets.list(assetPath).orEmpty()
            if (children.isNotEmpty()) {
                addAssetDirToZip(assetPath, zipPath, zip)
            } else {
                zip.putNextEntry(ZipEntry(zipPath))
                context.assets.open(assetPath).use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }
}
