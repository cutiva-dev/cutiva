package dev.cutiva.engine.reframe

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.ceil

/** The same cases as `face-tiles.test.ts` in @cutiva/web. */
class FaceTilesTest {
    @Test
    fun coversA16by9FrameWith4x2Squares() {
        val tiles = faceTiles(640, 360)
        assertEquals(
            listOf(0 to 0, 133 to 0, 267 to 0, 400 to 0, 0 to 120, 133 to 120, 267 to 120, 400 to 120),
            tiles.map { it.x to it.y },
        )
        assertEquals(setOf(240), tiles.map { it.size }.toSet())
    }

    @Test
    fun neighboursOverlapByAThird() {
        for ((w, h) in listOf(1280 to 720, 1080 to 1920, 1440 to 1080, 3840 to 2160)) {
            val tiles = faceTiles(w, h)
            val size = tiles[0].size
            for (list in listOf(tiles.map { it.x }.distinct(), tiles.map { it.y }.distinct())) {
                for (i in 1 until list.size) assertTrue(list[i] - list[i - 1] <= ceil(size * 2.0 / 3))
            }
            assertEquals(w, tiles.maxOf { it.x } + size)
            assertEquals(h, tiles.maxOf { it.y } + size)
        }
    }

    @Test
    fun squareFrame() {
        assertEquals(listOf(0 to 0, 300 to 0, 0 to 300, 300 to 300), faceTiles(900, 900).map { it.x to it.y })
    }

    private fun box(x: Double, y: Double, w: Double, h: Double, mouth: Double = 0.0) = FaceBox(x, y, w, h, mouth)

    @Test
    fun mergeKeepsTheLargestBoxPerFace() {
        val whole = box(100.0, 100.0, 50.0, 60.0, 0.1)
        val cut = box(100.0, 100.0, 30.0, 60.0, 0.2)
        val shifted = box(102.0, 99.0, 49.0, 61.0)
        val other = box(300.0, 100.0, 50.0, 60.0)
        assertEquals(listOf(whole, other), mergeFaces(listOf(cut, other, shifted, whole)).sortedBy { it.x })
    }

    @Test
    fun mergeKeepsFacesThatOnlyTouch() {
        assertEquals(2, mergeFaces(listOf(box(0.0, 0.0, 10.0, 10.0), box(9.0, 0.0, 10.0, 10.0))).size)
    }
}
