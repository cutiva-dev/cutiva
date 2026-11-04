package dev.cutiva.engine.reframe

import android.content.Context
import dev.cutiva.engine.CutivaException
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * The face model: MediaPipe's `face_landmarker.task` (float16, version 1, 3,758,596 bytes,
 * Apache-2.0), the same file and hash as `@cutiva/web/mediapipe`. Downloaded on first use, checked
 * against its pinned SHA-256 and kept in the app's files; checked again on every load.
 */
object FaceModel {
    const val URL_DEFAULT = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    const val SHA256 = "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff"

    private fun sha256(bytes: ByteArray): String = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

    /**
     * The model's bytes, from the app's files when the copy there still has [sha256], else
     * downloaded from [url] and checked. Blocks; call it off the main thread. Throws
     * [CutivaException] with `MODEL_LOAD_FAILED` when the download fails or the hash doesn't match.
     */
    @JvmStatic
    @JvmOverloads
    fun load(context: Context, url: String = URL_DEFAULT, sha256: String = SHA256, onProgress: ((Double) -> Unit)? = null): ByteArray {
        val expected = sha256.lowercase()
        val dir = File(context.filesDir, "cutiva-models").apply { mkdirs() }
        val file = File(dir, "$expected.task")
        if (file.exists()) {
            val bytes = file.readBytes()
            if (sha256(bytes) == expected) return bytes
            file.delete()
        }
        val bytes = try {
            download(url, onProgress)
        } catch (e: Exception) {
            throw CutivaException("MODEL_LOAD_FAILED", "Couldn't download the face model from $url: ${e.message}", e)
        }
        val got = sha256(bytes)
        if (got != expected) throw CutivaException("MODEL_LOAD_FAILED", "The face model from $url has SHA-256 $got, expected $expected.")
        val tmp = File(dir, "$expected.part")
        tmp.writeBytes(bytes)
        tmp.renameTo(file)
        return bytes
    }

    private fun download(url: String, onProgress: ((Double) -> Unit)?): ByteArray {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.connectTimeout = 15_000
        conn.readTimeout = 30_000
        try {
            if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
            val total = conn.contentLengthLong
            val out = java.io.ByteArrayOutputStream(if (total > 0) total.toInt() else 1 shl 22)
            val buf = ByteArray(1 shl 16)
            conn.inputStream.use { input ->
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    out.write(buf, 0, n)
                    if (total > 0) onProgress?.invoke(out.size().toDouble() / total)
                }
            }
            return out.toByteArray()
        } finally {
            conn.disconnect()
        }
    }
}
