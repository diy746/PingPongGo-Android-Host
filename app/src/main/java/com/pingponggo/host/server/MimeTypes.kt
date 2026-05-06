package com.pingponggo.host.server

object MimeTypes {
    fun of(path: String): String = when {
        path.endsWith(".html") -> "text/html"
        path.endsWith(".js") -> "application/javascript"
        path.endsWith(".css") -> "text/css"
        path.endsWith(".json") -> "application/json"
        path.endsWith(".png") -> "image/png"
        path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
        path.endsWith(".webp") -> "image/webp"
        path.endsWith(".svg") -> "image/svg+xml"
        path.endsWith(".mp3") -> "audio/mpeg"
        path.endsWith(".ogg") -> "audio/ogg"
        path.endsWith(".zip") -> "application/zip"
        else -> "application/octet-stream"
    }
}
