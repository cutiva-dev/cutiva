package dev.cutiva.engine

import org.json.JSONObject
import kotlin.math.floor

/** A rectangle of the source, in integer source pixels. */
data class CropRect(val x: Int, val y: Int, val w: Int, val h: Int)

/** How a crop key fills the frame besides its single rectangle (`CropLayout` in `@cutiva/core`). */
sealed interface CropLayout {
    /** Two regions of the source: [top] fills the top half of the frame, [bottom] the bottom half. */
    data class Split(val top: CropRect, val bottom: CropRect) : CropLayout

    /** The whole [area] fitted inside the frame, over a blurred, darkened copy of it that covers the frame. */
    data class Wide(val area: CropRect) : CropLayout
}

/** One crop key of a render plan segment, in source time. */
data class CropKey(val atUs: Long, val rect: CropRect, val cut: Boolean, val layout: CropLayout? = null)

internal fun parseRect(o: JSONObject) = CropRect(o.getInt("x"), o.getInt("y"), o.getInt("w"), o.getInt("h"))

internal fun parseCropKey(o: JSONObject): CropKey {
    val layout = o.optJSONObject("layout")?.let { l ->
        when (val kind = l.getString("kind")) {
            "split" -> l.getJSONArray("regions").let { CropLayout.Split(parseRect(it.getJSONObject(0)), parseRect(it.getJSONObject(1))) }
            "wide" -> CropLayout.Wide(parseRect(l.getJSONObject("area")))
            else -> throw CutivaException("INVALID_PROJECT", "Unknown crop layout \"$kind\".")
        }
    }
    return CropKey(o.getLong("atUs"), parseRect(o.getJSONObject("rect")), o.optBoolean("cut", false), layout)
}

/** Index of the key in effect at [sourceUs]: the last at or before it, or -1 before the first. */
private fun keyIndex(keys: List<CropKey>, sourceUs: Long): Int {
    var i = -1
    while (i + 1 < keys.size && keys[i + 1].atUs <= sourceUs) i++
    return i
}

/**
 * The crop rectangle at a source time, as `cropAt` in `@cutiva/core`: before the first key, the first
 * key's; after the last, the last key's. Between two keys the edges glide linearly (rounded half up),
 * unless the later key is a cut, which holds the earlier rectangle until it.
 */
fun cropAt(keys: List<CropKey>, sourceUs: Long): CropRect {
    require(keys.isNotEmpty()) { "cropAt needs at least one key." }
    val i = keyIndex(keys, sourceUs)
    if (i < 0) return keys[0].rect
    val a = keys[i]
    val b = keys.getOrNull(i + 1)
    if (b == null || b.cut) return a.rect
    val dt = b.atUs - a.atUs
    val u = sourceUs - a.atUs
    val v = b.atUs - sourceUs
    // floor((2(p·v + q·u) + dt) / (2·dt)), exact in Long: p, q are pixels and dt a few seconds of µs.
    fun lerp(p: Int, q: Int): Int = Math.floorDiv(2 * (p * v + q * u) + dt, 2 * dt).toInt()
    val x = lerp(a.rect.x, b.rect.x)
    val y = lerp(a.rect.y, b.rect.y)
    return CropRect(x, y, lerp(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - x, lerp(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - y)
}

/** The layout at a source time (layouts never glide), as `layoutAt` in `@cutiva/core`. Null for a single window. */
fun layoutAt(keys: List<CropKey>, sourceUs: Long): CropLayout? = keys.getOrNull(keyIndex(keys, sourceUs).coerceAtLeast(0))?.layout

/**
 * The source time shown at a timeline time inside a segment, as `resolveVideoAt` in `@cutiva/core`:
 * `sourceInUs + round((t − startUs) × speed)`, halves up.
 */
fun sourceTimeAt(segment: VideoSegment, timelineUs: Long): Long =
    segment.sourceInUs + floor((timelineUs - segment.startUs) * segment.speed + 0.5).toLong()
