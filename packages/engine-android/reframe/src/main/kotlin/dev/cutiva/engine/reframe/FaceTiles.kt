package dev.cutiva.engine.reframe

import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

// Port of `face-tiles.ts` in @cutiva/web: tiling for detectors that shrink the whole image
// (MediaPipe: 192 px), so small faces in a wide shot are found, and merging the same face seen twice.

/** A face box in frame pixels, with its mouth openness (0 closed to 1). */
data class FaceBox(val x: Double, val y: Double, val w: Double, val h: Double, val mouth: Double)

/** A square tile of a frame. */
data class Tile(val x: Int, val y: Int, val size: Int)

private fun overlap(a: FaceBox, b: FaceBox): Double {
    val ix = max(0.0, min(a.x + a.w, b.x + b.w) - max(a.x, b.x))
    val iy = max(0.0, min(a.y + a.h, b.y + b.h) - max(a.y, b.y))
    return ix * iy
}

/**
 * One face per person: boxes that overlap (IoU 0.3, or the smaller half inside the larger) are the
 * same face seen in two tiles; the largest box wins, since a face cut by a tile's edge is smaller.
 */
fun mergeFaces(boxes: List<FaceBox>): List<FaceBox> {
    val out = mutableListOf<FaceBox>()
    // A stable sort, like Array.prototype.sort: equal areas keep their order.
    for (b in boxes.sortedByDescending { it.w * it.h }) {
        val same = out.any { o ->
            val inter = overlap(o, b)
            inter / (o.w * o.h + b.w * b.h - inter) >= 0.3 || inter / min(o.w * o.h, b.w * b.h) >= 0.5
        }
        if (!same) out.add(b)
    }
    return out
}

/** JavaScript's Math.round: halves up. */
private fun jsRound(v: Double): Int = kotlin.math.floor(v + 0.5).toInt()

/**
 * Overlapping square tiles over a frame: side two thirds of the shorter side, spread evenly from
 * edge to edge at most two thirds of a side apart, so any face up to a third of a tile fits whole
 * in one of them. A 16:9 frame gets 4 × 2 tiles.
 */
fun faceTiles(width: Int, height: Int): List<Tile> {
    val size = jsRound(min(width, height) * 2.0 / 3)
    fun starts(len: Int): List<Int> {
        val span = max(0, len - size)
        val count = ceil(span / (size * 2.0 / 3)).toInt() + 1
        return List(count) { i -> if (count == 1) 0 else jsRound(i.toDouble() * span / (count - 1)) }
    }
    return starts(height).flatMap { y -> starts(width).map { x -> Tile(x, y, size) } }
}

