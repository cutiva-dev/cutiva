package dev.cutiva.engine

import org.junit.Assert.assertEquals
import org.junit.Test

class TimingTest {
    private fun seg(id: String, start: Long, end: Long) =
        AudioSegment(id, "a", "file://a", start, end, 0, end - start, 1.0, 1.0, 0, 0)

    @Test
    fun audioLanesKeepNonOverlappingSoundsTogether() {
        val lanes = audioLanes(listOf(seg("music", 0, 10), seg("voice", 2, 4), seg("sfx", 4, 6), seg("tail", 10, 12)))
        assertEquals(listOf(listOf("music", "tail"), listOf("voice", "sfx")), lanes.map { lane -> lane.map { it.clipId } })
    }

    @Test
    fun audioLanesOfNothingIsEmpty() {
        assertEquals(emptyList<List<AudioSegment>>(), audioLanes(emptyList()))
    }

    @Test
    fun withGapsFillsBeforeBetweenAndAfter() {
        val slots = withGaps(listOf(2L to 5L, 8L to 9L), 12, { it.first }, { it.second })
        assertEquals(
            listOf(Slot.Gap(2), Slot.Item(2L to 5L), Slot.Gap(3), Slot.Item(8L to 9L), Slot.Gap(3)),
            slots,
        )
        assertEquals(listOf(Slot.Item(0L to 12L)), withGaps(listOf(0L to 12L), 12, { it.first }, { it.second }))
    }

    @Test
    fun gainRampsLinearlyInTimelineTime() {
        assertEquals(0.0, gainAt(0, 1_000_000, 2.0, 100_000, 0), 1e-9)
        assertEquals(1.0, gainAt(50_000, 1_000_000, 2.0, 100_000, 0), 1e-9)
        assertEquals(2.0, gainAt(500_000, 1_000_000, 2.0, 100_000, 200_000), 1e-9)
        assertEquals(1.0, gainAt(900_000, 1_000_000, 2.0, 100_000, 200_000), 1e-9)
        assertEquals(0.0, gainAt(1_000_000, 1_000_000, 2.0, 100_000, 200_000), 1e-9)
        assertEquals(0.5, gainAt(10, 20, 1.0, 0, 0) * 0.5, 1e-9)
    }

    @Test
    fun evenSizeDropsOddPixels() {
        assertEquals(1920 to 1080, evenSize(1920, 1080))
        assertEquals(1278 to 719 - 1, evenSize(1279, 719))
    }
}
