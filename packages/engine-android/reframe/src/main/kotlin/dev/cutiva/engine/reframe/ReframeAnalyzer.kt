package dev.cutiva.engine.reframe

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.util.Base64
import androidx.media3.common.MediaItem
import androidx.media3.common.util.UnstableApi
import androidx.media3.effect.Presentation
import androidx.media3.inspector.frame.FrameExtractor
import dev.cutiva.engine.CutivaException
import org.json.JSONArray
import org.json.JSONObject
import java.nio.ByteOrder
import java.util.concurrent.ExecutionException
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.roundToLong

/** One analysed frame: faces in source pixels (display orientation), and the speech level and pan around it. */
data class AnalyzedFrame(val atUs: Long, val faces: List<FaceBox>, var voice: Double? = null, var pan: Double? = null)

/**
 * What the analysis measured, as numbers only (no images or audio): the input `@cutiva/core` needs
 * to build a `ReframeAnalysis` (`detectCuts` on [histograms], `detectActiveArea` on the peak luma)
 * and plan with `planReframe`. [toJson] is the shape `@cutiva/expo` reads.
 */
class ReframeMeasurements(
    val durationUs: Long,
    /** Display size of the source (rotation applied), the pixels faces are in. */
    val width: Int,
    val height: Int,
    val fromUs: Long,
    val toUs: Long,
    val fps: Int,
    val frames: List<AnalyzedFrame>,
    /** 16 bins each for red, green and blue per analysed frame (`FrameHistogram.bins`). */
    val histograms: List<IntArray>,
    /** The brightest luma each pixel had across the frames, [peakWidth] × [peakHeight]. */
    val peakWidth: Int,
    val peakHeight: Int,
    val peak: ByteArray,
) {
    fun toJson(): JSONObject = JSONObject().apply {
        put("durationUs", durationUs)
        put("width", width)
        put("height", height)
        put("fromUs", fromUs)
        put("toUs", toUs)
        put("fps", fps)
        put("frames", JSONArray().apply {
            for (f in frames) put(JSONObject().apply {
                put("atUs", f.atUs)
                put("faces", JSONArray().apply {
                    for (b in f.faces) put(JSONObject().put("x", b.x).put("y", b.y).put("w", b.w).put("h", b.h).put("mouth", b.mouth))
                })
                f.voice?.let { put("voice", it) }
                f.pan?.let { put("pan", it) }
            })
        })
        put("histograms", JSONArray().apply { for (h in histograms) put(JSONArray().apply { h.forEach { put(it) } }) })
        put("peak", JSONObject().put("width", peakWidth).put("height", peakHeight).put("luma", Base64.encodeToString(peak, Base64.NO_WRAP)))
    }
}

/** Analysis options, as `AnalyzeOptions` in `@cutiva/web`. */
data class AnalyzeOptions(
    /** Frames analysed per second of source. */
    val fps: Int = 5,
    /** Frames are scaled to this width for detection. */
    val width: Int = 640,
    /** Part of the source to analyse; [toUs] < 0 means to the end. */
    val fromUs: Long = 0,
    val toUs: Long = -1,
)

private const val HIST_W = 32
private const val HIST_H = 18
/** Width of the picture black bars are looked for in (as on the web). */
private const val BARS_W = 320
/** Share of the progress the video stage takes when there is audio to read after it. */
private const val VIDEO_SHARE = 0.9

/**
 * Samples a video at a few frames per second and records what `analyzeAsset` in `@cutiva/web`
 * records: faces and mouth openness, colour histograms (for camera cuts), the brightest luma per
 * pixel (for burned-in bars), and speech loudness and stereo pan. Blocks; run it on a worker thread.
 */
@UnstableApi
class ReframeAnalyzer(context: Context) {
    private val context = context.applicationContext

    /**
     * Analyse [uri] (a `file://` or `content://` URI). [onProgress] gets the overall ratio and the
     * stage (`video`, then `audio`); return true from [isCancelled] to stop with `ANALYSIS_CANCELLED`.
     * Throws `NO_VIDEO_TRACK` when the file has no video and `ASSET_NOT_FOUND` when it can't be read.
     */
    @JvmOverloads
    fun analyze(
        uri: String,
        detector: FaceDetector,
        options: AnalyzeOptions = AnalyzeOptions(),
        onProgress: (ratio: Double, stage: String) -> Unit = { _, _ -> },
        isCancelled: () -> Boolean = { false },
    ): ReframeMeasurements {
        val info = probe(uri)
        val from = options.fromUs.coerceAtLeast(0)
        val to = if (options.toUs < 0) info.durationUs else min(options.toUs, info.durationUs)
        val stepUs = (1e6 / options.fps).roundToLong()
        val times = generateSequence(from) { it + stepUs }.takeWhile { it < to }.toList()

        val width = min(options.width, info.width)
        val height = max(1, (width.toDouble() * info.height / info.width).roundToInt())
        val scale = info.width.toDouble() / width
        val barsW = min(BARS_W, width)
        val barsH = max(1, (barsW.toDouble() * height / width).roundToInt())
        val peak = ByteArray(barsW * barsH)
        val hasAudio = info.audioTrack >= 0
        val videoShare = if (hasAudio) VIDEO_SHARE else 1.0
        fun cancelled() = CutivaException("ANALYSIS_CANCELLED", "Analysis was cancelled.")

        val frames = mutableListOf<AnalyzedFrame>()
        val histograms = mutableListOf<IntArray>()
        val extractor = FrameExtractor.Builder(context, MediaItem.fromUri(uri))
            .setEffects(listOf(Presentation.createForWidthAndHeight(width, height, Presentation.LAYOUT_STRETCH_TO_FIT)))
            .build()
        try {
            for ((i, atUs) in times.withIndex()) {
                if (isCancelled()) throw cancelled()
                val frame = try {
                    extractor.getFrame(atUs / 1000).get().bitmap
                } catch (e: ExecutionException) {
                    // A time the decoder can't reach (past the last frame): skip it, as the web does.
                    continue
                }
                val bitmap = if (frame.config == Bitmap.Config.HARDWARE) frame.copy(Bitmap.Config.ARGB_8888, false) else frame
                val faces = detector.detect(bitmap).map { FaceBox(it.x * scale, it.y * scale, it.w * scale, it.h * scale, it.mouth) }
                frames.add(AnalyzedFrame(atUs, faces))
                histograms.add(histogram(pixels(bitmap, HIST_W, HIST_H)))
                addPeak(pixels(bitmap, barsW, barsH), peak)
                onProgress((i + 1.0) / times.size * videoShare, "video")
            }
        } finally {
            extractor.close()
        }

        if (hasAudio && frames.isNotEmpty()) {
            if (isCancelled()) throw cancelled()
            onProgress(videoShare, "audio")
            val signals = readAudio(uri, info.audioTrack, frames.map { it.atUs }.toLongArray(), frames.last().atUs, isCancelled)
            if (signals != null) {
                val voice = signals.voice()
                val pan = signals.pan()
                frames.forEachIndexed { k, f ->
                    f.voice = voice[k]
                    if (pan != null) f.pan = pan[k]
                }
            }
            onProgress(1.0, "audio")
        }
        return ReframeMeasurements(info.durationUs, info.width, info.height, from, to, options.fps, frames, histograms, barsW, barsH, peak)
    }

    private fun pixels(bitmap: Bitmap, w: Int, h: Int): IntArray {
        val small = Bitmap.createScaledBitmap(bitmap, w, h, true)
        val px = IntArray(w * h)
        small.getPixels(px, 0, w, 0, 0, w, h)
        if (small !== bitmap) small.recycle()
        return px
    }

    private class Probe(val durationUs: Long, val width: Int, val height: Int, val audioTrack: Int)

    private fun extractor(uri: String) = MediaExtractor().apply { setDataSource(context, Uri.parse(uri), null) }

    private fun probe(uri: String): Probe {
        val ex = try {
            extractor(uri)
        } catch (e: Exception) {
            throw CutivaException("ASSET_NOT_FOUND", "Couldn't read $uri: ${e.message}", e)
        }
        try {
            val tracks = (0 until ex.trackCount).map { ex.getTrackFormat(it) }
            val video = tracks.indexOfFirst { it.getString(MediaFormat.KEY_MIME)?.startsWith("video/") == true }
            if (video < 0) throw CutivaException("NO_VIDEO_TRACK", "$uri has no video track to analyse.")
            val audio = tracks.indexOfFirst { it.getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true }
            val durationUs = tracks[video].let { if (it.containsKey(MediaFormat.KEY_DURATION)) it.getLong(MediaFormat.KEY_DURATION) else 0L }
            // Display size: the retriever applies the rotation tag, as browsers do.
            val r = MediaMetadataRetriever().apply { setDataSource(context, Uri.parse(uri)) }
            try {
                val w = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)!!.toInt()
                val h = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)!!.toInt()
                val rotation = r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)?.toIntOrNull() ?: 0
                val (dw, dh) = if (rotation % 180 == 0) w to h else h to w
                return Probe(durationUs, dw, dh, audio)
            } finally {
                r.release()
            }
        } finally {
            ex.release()
        }
    }

    /** Decodes the audio track up to just past [lastUs] and measures it around [times]. Null when it can't be decoded. */
    private fun readAudio(uri: String, track: Int, times: LongArray, lastUs: Long, isCancelled: () -> Boolean): AudioSignals? {
        val ex = extractor(uri)
        var codec: MediaCodec? = null
        try {
            ex.selectTrack(track)
            val format = ex.getTrackFormat(track)
            codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
            codec.configure(format, null, null, 0)
            codec.start()
            var signals: AudioSignals? = null
            var channels = 0
            val stopUs = lastUs + 200_000
            val info = MediaCodec.BufferInfo()
            var inputDone = false
            while (true) {
                if (isCancelled()) throw CutivaException("ANALYSIS_CANCELLED", "Analysis was cancelled.")
                if (!inputDone) {
                    val i = codec.dequeueInputBuffer(10_000)
                    if (i >= 0) {
                        val n = ex.readSampleData(codec.getInputBuffer(i)!!, 0)
                        if (n < 0 || ex.sampleTime > stopUs) {
                            codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                            inputDone = true
                        } else {
                            codec.queueInputBuffer(i, 0, n, ex.sampleTime, 0)
                            ex.advance()
                        }
                    }
                }
                val o = codec.dequeueOutputBuffer(info, 10_000)
                if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED || (o >= 0 && signals == null)) {
                    val out = codec.outputFormat
                    channels = out.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                    signals = AudioSignals(out.getInteger(MediaFormat.KEY_SAMPLE_RATE), times)
                }
                if (o >= 0) {
                    val float = codec.outputFormat.let { it.containsKey(MediaFormat.KEY_PCM_ENCODING) && it.getInteger(MediaFormat.KEY_PCM_ENCODING) == android.media.AudioFormat.ENCODING_PCM_FLOAT }
                    val buf = codec.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder())
                    buf.position(info.offset)
                    buf.limit(info.offset + info.size)
                    val s = signals!!
                    if (float) {
                        val fb = buf.asFloatBuffer()
                        while (fb.remaining() >= channels) {
                            val l = fb.get()
                            val r = if (channels >= 2) fb.get() else l
                            for (c in 2 until channels) fb.get()
                            s.add(l, r)
                        }
                    } else {
                        val sb = buf.asShortBuffer()
                        while (sb.remaining() >= channels) {
                            val l = sb.get() / 32768f
                            val r = if (channels >= 2) sb.get() / 32768f else l
                            for (c in 2 until channels) sb.get()
                            s.add(l, r)
                        }
                    }
                    codec.releaseOutputBuffer(o, false)
                    if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
                }
            }
            return signals
        } catch (e: CutivaException) {
            throw e
        } catch (e: Exception) {
            // Undecodable audio: plan from faces alone, as the web does when decodeAudioData fails.
            return null
        } finally {
            codec?.let {
                try { it.stop() } catch (_: Exception) {}
                it.release()
            }
            ex.release()
        }
    }
}
