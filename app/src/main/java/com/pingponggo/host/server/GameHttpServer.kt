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
        val uri = session.uri.trimStart('/').ifBlank { "index.html" }
        return try {
            when (uri) {
                "__health" -> html("OK: PingPongGo HTTP server is running")
                "ppg-test.html" -> html(testPage())
                "download/PingPongGo-LAN.zip" -> serveZip()
                else -> serveAsset(uri)
            }
        } catch (e: Exception) {
            newFixedLengthResponse(
                Response.Status.NOT_FOUND,
                "text/plain; charset=utf-8",
                "404: ${session.uri}\n${e.javaClass.simpleName}: ${e.message}"
            )
        }
    }

    private fun html(body: String): Response =
        newFixedLengthResponse(Response.Status.OK, "text/html; charset=utf-8", body)

    private fun testPage(): String = """
        <!doctype html>
        <html>
        <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
        <body style="font-family:sans-serif;padding:20px">
          <h2>PingPongGo LAN Test</h2>
          <p><b>HTTP server works.</b></p>
          <ul>
            <li><a href="/__health">Health check</a></li>
            <li><a href="/index.html">HOST game</a></li>
            <li><a href="/index.html?id=GUEST">GUEST game</a></li>
            <li><a href="/download/PingPongGo-LAN.zip">Download ZIP package</a></li>
          </ul>
        </body>
        </html>
    """.trimIndent()

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
        ZipOutputStream(out).use { zip -> addAssetDirToZip(root, "", zip) }
        return out.toByteArray()
    }

    private fun addAssetDirToZip(assetDir: String, zipDir: String, zip: ZipOutputStream) {
        val names = context.assets.list(assetDir).orEmpty()
        for (name in names) {
            if (name == ".browser-profile" || name == "node_modules" || name == "logs") continue
            val assetPath = "$assetDir/$name"
            val zipPath = if (zipDir.isEmpty()) name else "$zipDir/$name"
            val children = context.assets.list(assetPath).orEmpty()
            if (children.isNotEmpty()) addAssetDirToZip(assetPath, zipPath, zip)
            else {
                zip.putNextEntry(ZipEntry(zipPath))
                context.assets.open(assetPath).use { it.copyTo(zip) }
                zip.closeEntry()
            }
        }
    }
}
