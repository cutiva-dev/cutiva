package dev.cutiva.engine

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * The web E2E test, on Android: clip.mp4 is 4 s, 640x360, H.264 + AAC. Every second, from x.5 to x.6,
 * the frame flashes white and a 440 Hz beep plays. The plans below are what `renderPlan` returns.
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class ExportTest {
    private lateinit var context: Context
    private lateinit var clipUri: String

    @Before
    fun copyFixture() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.cacheDir, "clip.mp4")
        InstrumentationRegistry.getInstrumentation().context.assets.open("clip.mp4").use { input ->
            file.outputStream().use { input.copyTo(it) }
        }
        clipUri = file.toURI().toString()
    }

    /** The playground E2E edit: split at 1 s and delete the first part, leaving source 1–4 s at 0–3 s. */
    private fun trimmedPlan() = RenderPlan.fromJson(
        """
        {
          "durationUs": 3000000,
          "settings": { "width": 640, "height": 360, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [
            { "layer": 0, "trackId": "trk_1", "clipId": "clip_2", "assetId": "ast_1", "uri": "$clipUri",
              "startUs": 0, "endUs": 3000000, "sourceInUs": 1000000, "sourceOutUs": 4000000, "speed": 1 }
          ],
          "audio": [
            { "clipId": "clip_2", "assetId": "ast_1", "uri": "$clipUri", "startUs": 0, "endUs": 3000000,
              "sourceInUs": 1000000, "sourceOutUs": 4000000, "speed": 1, "volume": 1, "fadeInUs": 0, "fadeOutUs": 0 }
          ]
        }
        """,
    )

    @Test
    fun trimmedExportIsInSync() {
        val (summary, file) = export(trimmedPlan())
        assertEquals("video/avc", summary.videoMimeType)
        assertEquals("audio/mp4a-latm", summary.audioMimeType)
        assertEquals(640, summary.width)
        assertEquals(360, summary.height)

        val video = videoTimestampsUs(file)
        assertEquals("video frames: ${video.size}, from ${video.first()} to ${video.last()}", 90, video.size)
        assertTrue("first frame at ${video.first()}", video.first() < 1_000)

        // Picture: white during the flashes, not just before or after.
        for (t in listOf(550_000L, 1_550_000L, 2_550_000L)) assertTrue("luma at $t", luma(file, t) > 240)
        for (t in listOf(450_000L, 650_000L)) assertTrue("luma at $t", luma(file, t) < 200)

        // Sound: three beeps, each within 5 ms of where it belongs.
        val onsets = beepOnsetsUs(file)
        assertEquals("onsets $onsets", 3, onsets.size)
        onsets.forEachIndexed { i, t -> assertTrue("beep $i at $t µs", abs(t - (500_000L + i * 1_000_000L)) < 5_000) }
    }


    /** A plan with one clip of [clipUri] on both the video and the audio side. */
    private fun plan(durationUs: Long, video: String, audio: String) = RenderPlan.fromJson(
        """
        { "durationUs": $durationUs,
          "settings": { "width": 640, "height": 360, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [$video], "audio": [$audio] }
        """,
    )

    private fun videoSeg(startUs: Long, endUs: Long, inUs: Long, outUs: Long, speed: Double = 1.0) =
        """{ "layer": 0, "trackId": "t", "clipId": "v", "assetId": "a", "uri": "$clipUri", "startUs": $startUs, "endUs": $endUs,
             "sourceInUs": $inUs, "sourceOutUs": $outUs, "speed": $speed }"""

    private fun audioSeg(startUs: Long, endUs: Long, inUs: Long, outUs: Long, speed: Double = 1.0, volume: Double = 1.0, fadeInUs: Long = 0) =
        """{ "clipId": "s", "assetId": "a", "uri": "$clipUri", "startUs": $startUs, "endUs": $endUs, "sourceInUs": $inUs,
             "sourceOutUs": $outUs, "speed": $speed, "volume": $volume, "fadeInUs": $fadeInUs, "fadeOutUs": 0 }"""

    @Test
    fun audioStaysInSyncWhereverAClipStarts() {
        // Media3 plays AAC one frame late when a cut isn't at 0; SourceDelay compensates. See its comment.
        for (inUs in listOf(0L, 10_000L, 21_333L, 250_000L, 1_333_333L)) {
            val (_, file) = export(plan(2_000_000, videoSeg(0, 2_000_000, inUs, inUs + 2_000_000), audioSeg(0, 2_000_000, inUs, inUs + 2_000_000)))
            val expected = (1_500_000L - inUs) % 1_000_000L
            val first = beepOnsetsUs(file).first()
            assertTrue("cut at $inUs: beep at $first µs, expected $expected", abs(first - expected) < 5_000)
        }
    }

    @Test
    fun gapsShowBlackAndSpeedChangesTiming() {
        // 0.5 s of nothing, then source 1–3 s at 2x (1 s), then 0.5 s of nothing.
        val (summary, file) = export(plan(2_000_000, videoSeg(500_000, 1_500_000, 1_000_000, 3_000_000, 2.0), audioSeg(500_000, 1_500_000, 1_000_000, 3_000_000, 2.0)))
        val frames = videoTimestampsUs(file)
        assertEquals("video frames: ${frames.size}, from ${frames.first()} to ${frames.last()}", 60, frames.size)
        assertTrue("last frame at ${frames.last()}", abs(frames.last() - 1_966_667) < 1_000)
        assertTrue("summary says ${summary.durationMs} ms", summary.durationMs in 1_960L..2_000L)
        assertTrue("black before the clip", luma(file, 250_000) < 20)
        assertTrue("black after the clip", luma(file, 1_750_000) < 20)
        // Source flashes at 1.5–1.6 s and 2.5–2.6 s land at 0.5 + (t - 1) / 2: 0.75–0.80 s and 1.25–1.30 s.
        assertTrue("flash at 0.775 s", luma(file, 775_000) > 240)
        assertTrue("flash at 1.275 s", luma(file, 1_275_000) > 240)
        assertTrue("no flash at 1.0 s", luma(file, 1_000_000) < 200)
        val onsets = beepOnsetsUs(file)
        assertEquals("onsets $onsets", 2, onsets.size)
        onsets.zip(listOf(750_000L, 1_250_000L)).forEach { (t, e) -> assertTrue("beep at $t, expected $e", abs(t - e) < 5_000) }
    }

    @Test
    fun volumeAndFadesFollowTheTimeline() {
        // Volume 0.5 with a 1 s fade in: the beep at 0.5 s plays at 0.25 of the source level, the one at 1.5 s at 0.5.
        val source = beepPeaks(File(context.cacheDir, "clip.mp4"))
        val (_, file) = export(plan(2_000_000, videoSeg(0, 2_000_000, 0, 2_000_000), audioSeg(0, 2_000_000, 0, 2_000_000, volume = 0.5, fadeInUs = 1_000_000)))
        val out = beepPeaks(file)
        assertEquals(0.25, out[0] / source[0], 0.03)
        assertEquals(0.5, out[1] / source[1], 0.03)
    }

    @Test
    fun soundsThatOverlapAreMixed() {
        // The clip's own sound plus the same file again from 0.25 s: four beeps instead of two.
        val (_, file) = export(
            plan(
                2_000_000,
                videoSeg(0, 2_000_000, 0, 2_000_000),
                audioSeg(0, 2_000_000, 0, 2_000_000) + "," + audioSeg(250_000, 2_000_000, 0, 1_750_000).replace("\"s\"", "\"m\""),
            ),
        )
        val onsets = beepOnsetsUs(file)
        assertEquals("onsets $onsets", 4, onsets.size)
        onsets.zip(listOf(500_000L, 750_000L, 1_500_000L, 1_750_000L)).forEach { (t, e) -> assertTrue("beep at $t, expected $e", abs(t - e) < 5_000) }
    }

    @Test
    fun refusesWhatItCannotExportYet() {
        val two = plan(1_000_000, videoSeg(0, 1_000_000, 0, 1_000_000) + "," + videoSeg(0, 1_000_000, 0, 1_000_000).replace("\"layer\": 0", "\"layer\": 1"), "")
        assertEquals("UNSUPPORTED_FEATURE", codeOf { CutivaExporter.buildComposition(two) })
        assertEquals("NOTHING_TO_EXPORT", codeOf { CutivaExporter.buildComposition(plan(0, "", "")) })
        assertEquals("INVALID_PROJECT", codeOf { RenderPlan.fromJson("{}") })
    }

    private fun codeOf(block: () -> Unit): String = try {
        block()
        "NONE"
    } catch (e: CutivaException) {
        e.code
    }

    private fun export(plan: RenderPlan): Pair<ExportSummary, File> {
        val out = File(context.cacheDir, "out-${System.nanoTime()}.mp4")
        val done = CountDownLatch(1)
        var summary: ExportSummary? = null
        var error: CutivaException? = null
        CutivaExporter(context).export(plan, out.absolutePath, object : CutivaExporter.Listener {
            override fun onCompleted(summary_: ExportSummary) {
                summary = summary_
                done.countDown()
            }

            override fun onError(error_: CutivaException) {
                error = error_
                done.countDown()
            }
        })
        assertTrue("export timed out", done.await(60, TimeUnit.SECONDS))
        error?.let { fail("${it.code}: ${it.message}") }
        return summary!! to out
    }

    private fun videoTimestampsUs(file: File): List<Long> {
        val extractor = MediaExtractor().apply { setDataSource(file.absolutePath) }
        val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("video/") }
        extractor.selectTrack(track)
        val times = mutableListOf<Long>()
        while (extractor.sampleTime >= 0) {
            times.add(extractor.sampleTime)
            extractor.advance()
        }
        extractor.release()
        return times.sorted()
    }

    /** Average luma of the frame shown at [timeUs], 0–255. */
    private fun luma(file: File, timeUs: Long): Double {
        val retriever = MediaMetadataRetriever().apply { setDataSource(file.absolutePath) }
        val frame: Bitmap = retriever.getFrameAtTime(timeUs, MediaMetadataRetriever.OPTION_CLOSEST)!!
        retriever.release()
        val px = IntArray(frame.width * frame.height)
        frame.getPixels(px, 0, frame.width, 0, 0, frame.width, frame.height)
        return px.sumOf { p -> 0.299 * (p shr 16 and 0xff) + 0.587 * (p shr 8 and 0xff) + 0.114 * (p and 0xff) } / px.size
    }

    /** The loudest sample of each beep, in order. */
    private fun beepPeaks(file: File): List<Double> {
        val (rate, samples) = decodeFirstChannel(file)
        return beepOnsetsUs(file).map { t ->
            val from = (t * rate / 1_000_000).toInt()
            (from until minOf(samples.size, from + rate / 20)).maxOf { abs(samples[it].toDouble()) }
        }
    }

    /** Decodes the audio track and returns the times where it gets loud after silence, in µs. */
    private fun beepOnsetsUs(file: File): List<Long> {
        val (rate, samples) = decodeFirstChannel(file)
        val onsets = mutableListOf<Long>()
        var wasLoud = false
        for (i in samples.indices) {
            val loud = abs(samples[i].toInt()) > 3000
            val t = i * 1_000_000L / rate
            if (loud && !wasLoud && (onsets.isEmpty() || t - onsets.last() > 200_000)) onsets.add(t)
            wasLoud = loud
        }
        return onsets
    }

    /** The first channel of the audio track, decoded, starting at presentation time 0. */
    private fun decodeFirstChannel(file: File): Pair<Int, ShortArray> {
        val extractor = MediaExtractor().apply { setDataSource(file.absolutePath) }
        val track = (0 until extractor.trackCount).first { extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)!!.startsWith("audio/") }
        val format = extractor.getTrackFormat(track)
        extractor.selectTrack(track)
        val codec = MediaCodec.createDecoderByType(format.getString(MediaFormat.KEY_MIME)!!)
        codec.configure(format, null, null, 0)
        codec.start()
        val info = MediaCodec.BufferInfo()
        var inputDone = false
        var rate = format.getInteger(MediaFormat.KEY_SAMPLE_RATE)
        val samples = mutableMapOf<Int, Short>()
        while (true) {
            if (!inputDone) {
                val i = codec.dequeueInputBuffer(10_000)
                if (i >= 0) {
                    val n = extractor.readSampleData(codec.getInputBuffer(i)!!, 0)
                    if (n < 0) {
                        codec.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                        inputDone = true
                    } else {
                        codec.queueInputBuffer(i, 0, n, extractor.sampleTime, 0)
                        extractor.advance()
                    }
                }
            }
            val o = codec.dequeueOutputBuffer(info, 10_000)
            if (o >= 0) {
                val out = codec.getOutputBuffer(o)!!.order(ByteOrder.nativeOrder()).asShortBuffer()
                rate = codec.outputFormat.getInteger(MediaFormat.KEY_SAMPLE_RATE)
                val channels = codec.outputFormat.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
                val first = (info.presentationTimeUs * rate / 1_000_000).toInt()
                for (f in 0 until out.remaining() / channels) if (first + f >= 0) samples[first + f] = out.get(f * channels)
                codec.releaseOutputBuffer(o, false)
                if (info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0) break
            }
        }
        codec.stop()
        codec.release()
        extractor.release()
        val array = ShortArray((samples.keys.maxOrNull() ?: -1) + 1)
        for ((i, v) in samples) array[i] = v
        return rate to array
    }
}
