package dev.cutiva.engine.reframe

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.io.File

class SignalsTest {
    private val fixtures = File("../../../conformance/fixtures/auto-reframe")

    private fun signals(left: DoubleArray, right: DoubleArray, rate: Int, times: LongArray) =
        AudioSignals(rate, times).apply { left.indices.forEach { add(left[it].toFloat(), right[it].toFloat()) } }

    /** The `stereoPan` conformance fixture (expected values written by hand from the spec). */
    @Test
    fun panMatchesTheFixture() {
        val input = JSONObject(File(fixtures, "signals-pan.input.json").readText()).getJSONObject("input")
        val expected = JSONObject(File(fixtures, "signals-pan.expected.json").readText()).getJSONArray("pan")
        fun doubles(key: String) = input.getJSONArray(key).let { a -> DoubleArray(a.length()) { a.getDouble(it) } }
        val times = input.getJSONArray("timesUs").let { a -> LongArray(a.length()) { a.getLong(it) } }
        val pan = signals(doubles("left"), doubles("right"), input.getInt("sampleRate"), times).pan()!!
        assertArrayEquals(DoubleArray(expected.length()) { expected.getDouble(it) }, pan, 1e-12)
    }

    @Test
    fun monoSavedAsStereoHasNoPan() {
        val same = DoubleArray(100) { if (it % 2 == 0) 0.3 else -0.3 }
        assertNull(signals(same, same, 100, longArrayOf(0, 500_000)).pan())
        assertNull(signals(DoubleArray(10), DoubleArray(10), 10, longArrayOf(0)).pan())
    }

    @Test
    fun voiceIsRmsOverThe90thPercentile() {
        // 100 samples per second, windows of ±10 samples. Loud (0.8) for the first second, quiet (0.2) after, 3 s in all.
        val samples = DoubleArray(300) { if (it < 100) 0.8 else 0.2 }
        val voice = signals(samples, samples, 100, longArrayOf(0, 1_000_000, 2_000_000, 3_200_000)).voice()
        // RMS: 0.8; at 1 s, 10 samples of 0.8 and 10 of 0.2; 0.2; past the end, no samples: 0.
        // Sorted, the 90th percentile is index floor(4 × 0.9) = 3: 0.8.
        assertArrayEquals(doubleArrayOf(1.0, Math.sqrt((10 * 0.64 + 10 * 0.04) / 20) / 0.8, 0.25, 0.0), voice, 1e-9)
    }

    @Test
    fun histogramAndPeak() {
        val px = intArrayOf(0xffff0000.toInt(), 0xff00ff00.toInt(), 0xff808080.toInt())
        val bins = histogram(px)
        assertEquals(1, bins[15]); assertEquals(1, bins[0]); assertEquals(1, bins[8])
        assertEquals(1, bins[16 + 15]); assertEquals(1, bins[32 + 8])
        val peak = ByteArray(3) { 100 }
        addPeak(px, peak)
        // Red: 77·255 >> 8 = 76 (kept 100); green: 150·255 >> 8 = 149; grey: 256·128 >> 8 = 128.
        assertArrayEquals(byteArrayOf(100, 149.toByte(), 128.toByte()), peak)
    }
}
