package dev.cutiva.engine.reframe

import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sqrt

/** Left and right are treated as one channel when their difference holds less than this share of the energy (as `stereoPan`). */
private const val MONO_ENERGY = 1e-3

/** Speech loudness and pan are measured within this many µs on each side of a time (`stereoPan`, `voiceLevels` on the web). */
private const val HALF_WINDOW_US = 100_000L

/** Nearest sample to [us], halves up, as `sampleAt` in `@cutiva/core`. */
internal fun sampleAt(us: Long, sampleRate: Int): Long = Math.floorDiv(us * sampleRate + 500_000, 1_000_000)

/**
 * Speech loudness and stereo pan around given times, from samples fed in order, in one pass and
 * without keeping the audio. [pan] gives what `stereoPan` in `@cutiva/core` gives for the same
 * samples; [voice] what `voiceLevels` in `@cutiva/web` gives: the RMS of the first channel
 * within 100 ms on each side, over the 90th percentile of those RMS values, capped at 1.
 */
class AudioSignals(private val sampleRate: Int, timesUs: LongArray) {
    private val n = timesUs.size
    private val from = LongArray(n)
    private val to = LongArray(n)
    private val left = DoubleArray(n)
    private val right = DoubleArray(n)
    private var diff = 0.0
    private var total = 0.0
    private var index = 0L
    /** First window that may still contain the next sample (windows are sorted and of equal length). */
    private var first = 0

    init {
        require(sampleRate > 0) { "sampleRate must be positive." }
        val half = sampleAt(HALF_WINDOW_US, sampleRate)
        for (k in 0 until n) {
            require(timesUs[k] >= 0 && (k == 0 || timesUs[k] > timesUs[k - 1])) { "Times must be sorted and non-negative." }
            val mid = sampleAt(timesUs[k], sampleRate)
            from[k] = (mid - half).coerceAtLeast(0)
            to[k] = mid + half
        }
    }

    /** One sample frame: the first two channels (the same value twice for mono). */
    fun add(l: Float, r: Float) {
        val i = index++
        val dl = l.toDouble()
        val dr = r.toDouble()
        diff += (dl - dr) * (dl - dr)
        total += dl * dl + dr * dr
        while (first < n && to[first] <= i) first++
        var k = first
        while (k < n && from[k] <= i) {
            if (i < to[k]) {
                left[k] += dl * dl
                right[k] += dr * dr
            }
            k++
        }
    }

    /** Pan at each time, -1 (left) to 1 (right); null when both channels carry the same signal. Silence gives 0. */
    fun pan(): DoubleArray? {
        if (total == 0.0 || diff <= MONO_ENERGY * total) return null
        return DoubleArray(n) { k -> if (left[k] + right[k] > 0) (right[k] - left[k]) / (right[k] + left[k]) else 0.0 }
    }

    /** Loudness at each time, 0 to 1. */
    fun voice(): DoubleArray {
        val rms = DoubleArray(n) { k ->
            val len = min(to[k], index) - from[k]
            if (len > 0) sqrt(left[k] / len) else 0.0
        }
        val sorted = rms.sorted()
        val ref = sorted.getOrNull(floor(n * 0.9).toInt()) ?: 0.0
        return DoubleArray(n) { k -> if (ref > 0) min(1.0, rms[k] / ref) else 0.0 }
    }
}

/** 16 bins each for red, green and blue of a 32 × 18 thumbnail's ARGB pixels, as `analyzeAsset` on the web. */
fun histogram(argb: IntArray): IntArray {
    val bins = IntArray(48)
    for (p in argb) {
        bins[((p shr 16) and 0xff) shr 4]++
        bins[16 + (((p shr 8) and 0xff) shr 4)]++
        bins[32 + ((p and 0xff) shr 4)]++
    }
    return bins
}

/** Keep, for each pixel, the brightest luma (BT.601 weights, as on the web) seen so far. */
fun addPeak(argb: IntArray, peak: ByteArray) {
    for (i in peak.indices) {
        val p = argb[i]
        val y = (77 * ((p shr 16) and 0xff) + 150 * ((p shr 8) and 0xff) + 29 * (p and 0xff)) shr 8
        if (y > (peak[i].toInt() and 0xff)) peak[i] = y.toByte()
    }
}
