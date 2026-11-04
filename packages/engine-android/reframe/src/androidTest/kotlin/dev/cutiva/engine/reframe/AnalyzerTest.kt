package dev.cutiva.engine.reframe

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import dev.cutiva.engine.CutivaException
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.abs

/**
 * talk.mp4 (the web E2E fixture): 6 s, 1920x1080, no audio; a red "face" at x 390–690 and a blue one
 * at x 1230–1530, both y 300–600, on grey, with white "mouths" that flicker (red talks first, blue after 3 s).
 */
@UnstableApi
@RunWith(AndroidJUnit4::class)
class AnalyzerTest {
    private lateinit var context: Context
    private lateinit var uri: String

    @Before
    fun copyFixture() {
        context = InstrumentationRegistry.getInstrumentation().targetContext
        val file = File(context.cacheDir, "talk.mp4")
        InstrumentationRegistry.getInstrumentation().context.assets.open("talk.mp4").use { input -> file.outputStream().use { input.copyTo(it) } }
        uri = file.toURI().toString()
    }

    /** The web E2E fake detector: reads both squares and whether each mouth is open from the pixels. */
    private val fake = FaceDetector { frame ->
        val s = frame.width / 1920.0
        listOf(390 to 540, 1230 to 1380).map { (x, mouthX) ->
            val green = (frame.getPixel((mouthX * s).toInt(), (532 * s).toInt()) shr 8) and 0xff
            FaceBox(x * s, 300 * s, 300 * s, 300 * s, if (green > 200) 0.4 else 0.1)
        }
    }

    @Test
    fun measuresFramesFacesCutsAndBars() {
        val stages = mutableListOf<String>()
        var last = 0.0
        val m = ReframeAnalyzer(context).analyze(uri, fake, onProgress = { r, stage ->
            assertTrue("progress goes forward", r >= last)
            last = r
            stages += stage
        })
        assertEquals(1920, m.width)
        assertEquals(1080, m.height)
        assertTrue("duration ${m.durationUs}", abs(m.durationUs - 6_000_000) < 50_000)
        assertEquals(5, m.fps)
        // 6 s at 5 fps.
        assertEquals((0 until 30).map { it * 200_000L }, m.frames.map { it.atUs })
        assertEquals(30, m.histograms.size)
        assertEquals(1.0, last, 1e-9)
        assertEquals(setOf("video"), stages.toSet())
        // Faces come back in source pixels.
        val first = m.frames[0].faces
        assertEquals(2, first.size)
        assertEquals(390.0, first[0].x, 1e-6)
        assertEquals(300.0, first[0].h, 1e-6)
        // Red's mouth moves in the first 3 s, blue's after.
        val redOpen = m.frames.filter { it.faces[0].mouth > 0.3 }.map { it.atUs }
        val blueOpen = m.frames.filter { it.faces[1].mouth > 0.3 }.map { it.atUs }
        assertTrue("red $redOpen", redOpen.isNotEmpty() && redOpen.all { it < 3_000_000 })
        assertTrue("blue $blueOpen", blueOpen.isNotEmpty() && blueOpen.all { it >= 3_000_000 })
        // No audio: no voice or pan.
        assertTrue(m.frames.all { it.voice == null && it.pan == null })
        // Grey edges (about 128 luma): no black bars.
        assertEquals(320, m.peakWidth)
        assertEquals(180, m.peakHeight)
        val luma = { x: Int, y: Int -> m.peak[y * 320 + x].toInt() and 0xff }
        assertTrue((0 until 320).all { luma(it, 0) in 110..150 && luma(it, 179) in 110..150 })
        assertTrue((0 until 180).all { luma(0, it) in 110..150 && luma(319, it) in 110..150 })
        val json = m.toJson()
        assertEquals(30, json.getJSONArray("frames").length())
        assertEquals(48, json.getJSONArray("histograms").getJSONArray(0).length())
    }

    @Test
    fun partOfTheSourceAndCancel() {
        val m = ReframeAnalyzer(context).analyze(uri, fake, AnalyzeOptions(fps = 2, fromUs = 1_000_000, toUs = 3_000_000))
        assertEquals(listOf(1_000_000L, 1_500_000L, 2_000_000L, 2_500_000L), m.frames.map { it.atUs })
        val code = try {
            ReframeAnalyzer(context).analyze(uri, fake, isCancelled = { true })
            "NONE"
        } catch (e: CutivaException) {
            e.code
        }
        assertEquals("ANALYSIS_CANCELLED", code)
    }

    /** Downloads the real model (network): it loads, its hash matches, and it runs on a frame. */
    @Test
    fun mediaPipeLoadsAndRuns() {
        val model = try {
            FaceModel.load(context)
        } catch (e: CutivaException) {
            assumeTrue("no network: ${e.message}", false)
            return
        }
        assertEquals(3_758_596, model.size)
        MediaPipeFaceDetector(context, model).use { detector ->
            val m = ReframeAnalyzer(context).analyze(uri, detector, AnalyzeOptions(fps = 1))
            assertEquals(6, m.frames.size)
            // Coloured squares aren't faces.
            assertTrue(m.frames.all { it.faces.isEmpty() })
        }
        // Second load comes from the app's files.
        assertEquals(3_758_596, FaceModel.load(context, url = "https://invalid.example/none").size)
    }
}
