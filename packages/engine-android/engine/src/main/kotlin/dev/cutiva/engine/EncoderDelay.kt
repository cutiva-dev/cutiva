package dev.cutiva.engine

import android.media.MediaCodec
import android.media.MediaFormat
import android.util.Log
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.sqrt

/**
 * AAC encoders prepend "priming" samples, and the MP4 needs an edit list that skips exactly that many
 * or the audio plays late. Media3 assumes 1600 for `c2.android.aac.encoder` (the emulator's encoder
 * measures 2048) and nothing for hardware encoders, so measure it, like the web engine does: encode a
 * known noise burst with the same encoder, decode it, and find where it lands.
 */
internal object EncoderDelay {
    private const val TAG = "CutivaEngine"
    private const val PROBE_FRAMES = 8192
    private const val MAX_LAG = 4096
    private const val WINDOW = 2048
    private const val TIMEOUT_US = 10_000L

    private val cache = ConcurrentHashMap<String, Int>()

    /** Priming samples added by encoder [codecName], or null when it can't be measured. */
    fun samples(codecName: String, sampleRate: Int, channels: Int): Int? {
        val key = "$codecName@$sampleRate/$channels"
        cache[key]?.let { return it }
        return try {
            measure(codecName, sampleRate, channels)?.also { cache[key] = it }
        } catch (e: Exception) {
            Log.w(TAG, "Could not measure the delay of $codecName; exported audio may start a few tens of ms late.", e)
            null
        }
    }

    fun noise(frames: Int): FloatArray {
        val out = FloatArray(frames)
        var seed = 0x2545f491L
        for (i in 0 until frames) {
            seed = (seed * 1664525L + 1013904223L) and 0xffffffffL
            out[i] = ((seed.toDouble() / 0xffffffffL - 0.5) * 0.8).toFloat()
        }
        return out
    }

    /** Where [input]'s middle window best matches [output], in samples, or null if nothing matches. */
    fun bestLag(input: FloatArray, output: FloatArray): Int? {
        var energyIn = 0.0
        for (i in 0 until WINDOW) energyIn += input[WINDOW + i].toDouble() * input[WINDOW + i]
        var bestLag = -1
        var best = 0.0
        var lag = 0
        while (lag <= MAX_LAG && WINDOW * 2 + lag <= output.size) {
            var dot = 0.0
            var energyOut = 0.0
            for (i in 0 until WINDOW) {
                val o = output[WINDOW + lag + i].toDouble()
                dot += input[WINDOW + i] * o
                energyOut += o * o
            }
            val score = if (energyOut > 0) dot / sqrt(energyIn * energyOut) else 0.0
            if (score > best) {
                best = score
                bestLag = lag
            }
            lag++
        }
        return if (best > 0.5) bestLag else null
    }

    private fun measure(codecName: String, sampleRate: Int, channels: Int): Int? {
        val input = noise(PROBE_FRAMES)
        val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply {
            setInteger(MediaFormat.KEY_BIT_RATE, 128_000)
            setInteger(MediaFormat.KEY_AAC_PROFILE, android.media.MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        }
        val pcm = ByteBuffer.allocate(PROBE_FRAMES * channels * 2).order(ByteOrder.nativeOrder())
        for (v in input) repeat(channels) { pcm.putShort((v * 32767).toInt().toShort()) }
        pcm.flip()

        // Encode.
        val packets = mutableListOf<Pair<ByteArray, Long>>()
        var csd: ByteBuffer? = null
        val encoder = MediaCodec.createByCodecName(codecName)
        try {
            encoder.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
            encoder.start()
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            var framesIn = 0L
            while (true) {
                if (!inputDone) {
                    val i = encoder.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        val buf = encoder.getInputBuffer(i)!!
                        val n = minOf(buf.remaining(), pcm.remaining())
                        if (n == 0) {
                            encoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            val slice = pcm.duplicate().apply { limit(position() + n) }
                            buf.put(slice)
                            pcm.position(pcm.position() + n)
                            encoder.queueInputBuffer(i, 0, n, framesIn * 1_000_000L / sampleRate, 0)
                            framesIn += n / (2 * channels)
                        }
                    }
                }
                val o = encoder.dequeueOutputBuffer(info, TIMEOUT_US)
                if (o >= 0) {
                    val out = encoder.getOutputBuffer(o)!!
                    val bytes = ByteArray(info.size).also { out.position(info.offset); out.get(it) }
                    if (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG != 0) csd = ByteBuffer.wrap(bytes)
                    else if (info.size > 0) packets.add(bytes to info.presentationTimeUs)
                    encoder.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                } else if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
                    csd = encoder.outputFormat.getByteBuffer("csd-0") ?: csd
                }
            }
        } finally {
            encoder.release()
        }
        if (packets.isEmpty() || csd == null) return null

        // Decode every packet as a player would before applying an edit list.
        val decoded = mutableListOf<Float>()
        val decoder = MediaCodec.createDecoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
        try {
            decoder.configure(
                MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, sampleRate, channels).apply { setByteBuffer("csd-0", csd) },
                null, null, 0,
            )
            decoder.start()
            val info = MediaCodec.BufferInfo()
            var next = 0
            while (true) {
                if (next <= packets.size) {
                    val i = decoder.dequeueInputBuffer(TIMEOUT_US)
                    if (i >= 0) {
                        if (next == packets.size) {
                            decoder.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        } else {
                            val (bytes, pts) = packets[next]
                            decoder.getInputBuffer(i)!!.put(bytes)
                            decoder.queueInputBuffer(i, 0, bytes.size, pts, 0)
                        }
                        next++
                    }
                }
                val o = decoder.dequeueOutputBuffer(info, TIMEOUT_US)
                if (o >= 0) {
                    val outChannels = decoder.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    val samples = decoder.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder()).asShortBuffer()
                    for (f in 0 until samples.remaining() / outChannels) decoded.add(samples.get(f * outChannels) / 32768f)
                    decoder.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
        } finally {
            decoder.release()
        }
        return bestLag(input, decoded.toFloatArray())
    }
}
