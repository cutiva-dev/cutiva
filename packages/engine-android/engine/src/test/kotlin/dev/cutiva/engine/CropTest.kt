package dev.cutiva.engine

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * The engine evaluates crop keys the way `@cutiva/core` does: for every `videoAt` sample of the
 * reframe conformance fixtures, the plan segment on screen gives the same source time, rectangle
 * and layout as the expected values (written by hand from the spec).
 */
class CropTest {
    private val fixtures = File("../../../conformance/fixtures")

    private fun segments(expected: JSONObject): List<VideoSegment> {
        val list = expected.getJSONArray("videoSegments")
        return List(list.length()) { i ->
            val v = list.getJSONObject(i)
            val keys = v.optJSONArray("crop")
            VideoSegment(
                layer = v.getInt("layer"), trackId = "t", clipId = v.getString("clipId"), assetId = "a", uri = "file://a",
                startUs = v.getLong("startUs"), endUs = v.getLong("endUs"),
                sourceInUs = v.getLong("sourceInUs"), sourceOutUs = v.getLong("sourceOutUs"), speed = v.getDouble("speed"),
                crop = keys?.let { k -> List(k.length()) { parseCropKey(k.getJSONObject(it)) } },
                sourceWidth = v.optInt("sourceWidth"), sourceHeight = v.optInt("sourceHeight"),
            )
        }
    }

    private fun layoutJson(l: CropLayout?): Any? = when (l) {
        null -> null
        is CropLayout.Split -> mapOf("kind" to "split", "regions" to listOf(rectJson(l.top), rectJson(l.bottom)))
        is CropLayout.Wide -> mapOf("kind" to "wide", "area" to rectJson(l.area))
    }

    private fun rectJson(r: CropRect) = mapOf("x" to r.x, "y" to r.y, "w" to r.w, "h" to r.h)

    /** JSON as plain maps and lists (android.jar's org.json, first on the classpath, has no toMap). */
    private fun plain(v: Any?): Any? = when (v) {
        is JSONObject -> v.keys().asSequence().associateWith { plain(v.get(it)) }
        is JSONArray -> List(v.length()) { plain(v.get(it)) }
        JSONObject.NULL -> null
        else -> v
    }

    private fun check(name: String) {
        val expected = JSONObject(File(fixtures, "$name.expected.json").readText())
        val segs = segments(expected)
        assertTrue(segs.all { it.cropped && it.sourceWidth == 1920 && it.sourceHeight == 1080 })
        val samples = expected.getJSONArray("videoAt")
        assertTrue(samples.length() > 0)
        for (i in 0 until samples.length()) {
            val sample = samples.getJSONObject(i)
            val t = sample.getLong("tUs")
            val layer = sample.getJSONArray("layers").getJSONObject(0)
            val seg = segs.single { t >= it.startUs && t < it.endUs }
            assertEquals("$name clip at $t", layer.getString("clipId"), seg.clipId)
            val s = sourceTimeAt(seg, t)
            assertEquals("$name source time at $t", layer.getLong("sourceTimeUs"), s)
            assertEquals("$name crop at $t", plain(layer.getJSONObject("crop")), rectJson(cropAt(seg.crop!!, s)))
            assertEquals("$name layout at $t", plain(layer.opt("layout")), layoutJson(layoutAt(seg.crop!!, s)))
        }
    }

    @Test
    fun reframeFixture() = check("reframe")

    @Test
    fun reframeLayoutsFixture() = check("reframe-layouts")

    @Test
    fun beforeTheFirstKeyTheFirstHolds() {
        val keys = listOf(CropKey(1_000, CropRect(10, 0, 100, 100), false, CropLayout.Wide(CropRect(0, 0, 200, 100))), CropKey(2_000, CropRect(20, 0, 100, 100), false))
        assertEquals(CropRect(10, 0, 100, 100), cropAt(keys, 0))
        assertEquals(CropLayout.Wide(CropRect(0, 0, 200, 100)), layoutAt(keys, 0))
        assertEquals(CropRect(15, 0, 100, 100), cropAt(keys, 1_500))
        assertNull(layoutAt(keys, 2_000))
        assertEquals(CropRect(20, 0, 100, 100), cropAt(keys, 9_000))
    }

    @Test
    fun parsesPlanCropKeys() {
        val plan = RenderPlan.fromJson(
            """
            { "durationUs": 1000000, "settings": { "width": 1080, "height": 1920, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
              "video": [ { "layer": 0, "trackId": "t", "clipId": "c", "assetId": "a", "uri": "file://a", "startUs": 0, "endUs": 1000000,
                "sourceInUs": 0, "sourceOutUs": 1000000, "speed": 1, "sourceWidth": 1920, "sourceHeight": 1080,
                "crop": [ { "atUs": 0, "rect": { "x": 1, "y": 2, "w": 3, "h": 4 }, "cut": false,
                  "layout": { "kind": "split", "regions": [ { "x": 0, "y": 0, "w": 5, "h": 5 }, { "x": 6, "y": 6, "w": 5, "h": 5 } ] } } ] } ],
              "audio": [] }
            """,
        )
        val v = plan.video.single()
        assertEquals(1920, v.sourceWidth)
        assertEquals(listOf(CropKey(0, CropRect(1, 2, 3, 4), false, CropLayout.Split(CropRect(0, 0, 5, 5), CropRect(6, 6, 5, 5)))), v.crop)
    }
}
