package dev.cutiva.engine

import android.content.Context
import android.graphics.Bitmap
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlin.math.abs

/**
 * Reframed clips, checked like the web's `reframe-export.spec.ts`. talk.mp4 is 6 s, 1920x1080: a
 * red face at x 390–690 and a blue one at x 1230–1530, both y 300–600, on grey (128).
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class ReframeExportTest {
    private lateinit var context: Context
    private lateinit var uri: String

    @Before
    fun copyFixture() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.cacheDir, "talk.mp4")
        InstrumentationRegistry.getInstrumentation().context.assets.open("talk.mp4").use { input -> file.outputStream().use { input.copyTo(it) } }
        uri = file.toURI().toString()
    }

    /**
     * Keys in source time, as `renderPlan` writes them for a 9:16 output: the red face (single window,
     * 608x1080 at x 236) from 0, wide from 2 s, a split of red over blue from 4 s. The clip shows
     * source 1–6 s at timeline 0.5–5.5 s, after a 0.5 s gap, so the engine must map timeline to source time.
     */
    private fun plan() = RenderPlan.fromJson(
        """
        { "durationUs": 5500000, "settings": { "width": 1080, "height": 1920, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [ { "layer": 0, "trackId": "t", "clipId": "c", "assetId": "a", "uri": "$uri",
            "startUs": 500000, "endUs": 5500000, "sourceInUs": 1000000, "sourceOutUs": 6000000, "speed": 1,
            "sourceWidth": 1920, "sourceHeight": 1080,
            "crop": [
              { "atUs": 0, "rect": { "x": 236, "y": 0, "w": 608, "h": 1080 }, "cut": false },
              { "atUs": 2000000, "rect": { "x": 656, "y": 0, "w": 608, "h": 1080 }, "cut": true,
                "layout": { "kind": "wide", "area": { "x": 0, "y": 0, "w": 1920, "h": 1080 } } },
              { "atUs": 4000000, "rect": { "x": 656, "y": 0, "w": 608, "h": 1080 }, "cut": true,
                "layout": { "kind": "split", "regions": [ { "x": 236, "y": 180, "w": 608, "h": 540 }, { "x": 1076, "y": 180, "w": 608, "h": 540 } ] } }
            ] } ],
          "audio": [] }
        """,
    )

    private fun classOf(p: Int): String {
        val r = p shr 16 and 0xff
        val g = p shr 8 and 0xff
        val b = p and 0xff
        fun near(v: Int, want: Int) = abs(v - want) < 30
        return when {
            r > 180 && g < 80 && b < 80 -> "red"
            b > 180 && r < 80 && g < 100 -> "blue"
            near(r, 128) && near(g, 128) && near(b, 128) -> "grey"
            near(r, 83) && near(g, 83) && near(b, 83) -> "dim"
            else -> "other($r,$g,$b)"
        }
    }

    /** Colour classes at the web test's probe points, and where red and blue start along a row. */
    private fun measure(frame: Bitmap): Map<String, Any> {
        val w = frame.width
        val h = frame.height
        fun at(fx: Double, fy: Double) = classOf(frame.getPixel((w * fx).toInt(), (h * fy).toInt()))
        fun edges(fy: Double): Pair<Int, Int> {
            val y = (h * fy).toInt()
            var red = -1
            var blue = -1
            for (x in 0 until w) {
                val c = classOf(frame.getPixel(x, y))
                if (c == "red" && red < 0) red = x
                if (c == "blue" && blue < 0) blue = x
            }
            return red to blue
        }
        return mapOf(
            "centre30" to at(0.5, 0.3), "top" to at(0.5, 0.15), "bottom" to at(0.5, 0.65), "corner" to at(0.05, 0.05),
            "wideRed" to at(300.0 / 1080, 900.0 / 1920), "row30" to edges(0.3), "rowWide" to edges(900.0 / 1920),
        )
    }

    @Test
    fun drawsSingleWideAndSplitAtTheRightTimes() {
        val (_, file) = export(plan())
        val retriever = MediaMetadataRetriever().apply { setDataSource(file.absolutePath) }
        // Media3 may encode a portrait frame as landscape with a rotation tag; players show it upright.
        val rotation = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_ROTATION)!!.toInt()
        val coded = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_WIDTH)!!.toInt() to retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_VIDEO_HEIGHT)!!.toInt()
        assertEquals("display size (coded $coded, rotation $rotation)", 1080 to 1920, if (rotation % 180 == 0) coded else coded.second to coded.first)
        fun frame(t: Long) = retriever.getFrameAtTime(t, MediaMetadataRetriever.OPTION_CLOSEST)!!
        try {
            // Gap: black.
            val gap = frame(250_000)
            assertTrue("gap", (gap.getPixel(540, 960) and 0xffffff).let { (it shr 16 and 0xff) < 20 })

            // Timeline 1.0 s = source 1.5 s: single window on red. Red's left edge (source 390) lands at
            // (390 − 236) × 1080 / 608 = 273.6.
            val single = measure(frame(1_000_000))
            assertEquals("single $single", "red", single["centre30"])
            val (red30, blue30) = single["row30"] as Pair<*, *>
            assertTrue("single red edge $red30", abs((red30 as Int) - 274) <= 2)
            assertEquals("single shows no blue", -1, blue30)

            // Timeline 2.5 s = source 3 s: wide. The whole frame letterboxed (scale 0.5625) over a dimmed blur.
            val wide = measure(frame(2_500_000))
            assertEquals("wide $wide", "dim", wide["corner"])
            assertEquals("wide $wide", "red", wide["wideRed"])
            val (redW, blueW) = wide["rowWide"] as Pair<*, *>
            assertTrue("wide red edge $redW", abs((redW as Int) - 219) <= 2)
            assertTrue("wide blue edge $blueW", abs((blueW as Int) - 692) <= 2)

            // Timeline 4.0 s = source 4.5 s: split, red on top, blue below.
            val split = measure(frame(4_000_000))
            assertEquals("split $split", "red", split["top"])
            assertEquals("split $split", "blue", split["bottom"])
        } finally {
            retriever.release()
        }
    }

    private fun export(plan: RenderPlan): Pair<ExportSummary, File> {
        val out = File(context.cacheDir, "reframe-${System.nanoTime()}.mp4")
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
        assertTrue("export timed out", done.await(120, TimeUnit.SECONDS))
        error?.let { fail("${it.code}: ${it.message}") }
        return summary!! to out
    }
}
