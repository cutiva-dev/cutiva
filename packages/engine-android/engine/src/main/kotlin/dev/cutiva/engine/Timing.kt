package dev.cutiva.engine

/**
 * Splits audio segments into lanes where no two segments overlap, so each lane can become one
 * Media3 sequence. Segments keep their plan order within a lane; lanes are filled first come, first served.
 */
internal fun audioLanes(segments: List<AudioSegment>): List<List<AudioSegment>> {
    val lanes = mutableListOf<MutableList<AudioSegment>>()
    for (segment in segments.sortedBy { it.startUs }) {
        val lane = lanes.firstOrNull { it.last().endUs <= segment.startUs }
        if (lane != null) lane.add(segment) else lanes.add(mutableListOf(segment))
    }
    return lanes
}

/** One entry of a sequence: either a gap of [durationUs] or a [segment]. */
internal sealed interface Slot<out T> {
    data class Gap(val durationUs: Long) : Slot<Nothing>
    data class Item<T>(val segment: T) : Slot<T>
}

/**
 * Lays segments sorted by start on a timeline from 0 to [totalUs], with gaps before, between and
 * after them, so every sequence lasts exactly as long as the project.
 */
internal fun <T> withGaps(segments: List<T>, totalUs: Long, startOf: (T) -> Long, endOf: (T) -> Long): List<Slot<T>> {
    val slots = mutableListOf<Slot<T>>()
    var cursor = 0L
    for (segment in segments) {
        val start = startOf(segment)
        if (start > cursor) slots.add(Slot.Gap(start - cursor))
        slots.add(Slot.Item(segment))
        cursor = endOf(segment)
    }
    if (totalUs > cursor) slots.add(Slot.Gap(totalUs - cursor))
    return slots
}

/**
 * Gain at [tUs] into a segment of [durationUs], in timeline time: [volume], ramping linearly up from 0
 * over [fadeInUs] and down to 0 over the last [fadeOutUs], like the web engine's Web Audio envelope.
 */
internal fun gainAt(tUs: Long, durationUs: Long, volume: Double, fadeInUs: Long, fadeOutUs: Long): Double {
    var gain = volume
    if (fadeInUs > 0 && tUs < fadeInUs) gain *= tUs.toDouble() / fadeInUs
    val untilEnd = durationUs - tUs
    if (fadeOutUs > 0 && untilEnd < fadeOutUs) gain *= maxOf(0L, untilEnd).toDouble() / fadeOutUs
    return gain
}

/** Even output size, like `outputSize(project)` on the web. */
internal fun evenSize(width: Int, height: Int): Pair<Int, Int> = (width - width % 2) to (height - height % 2)
