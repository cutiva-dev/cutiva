import Foundation

/**
 * Splits audio segments into lanes where no two segments overlap, so each lane can become one
 * composition track. Segments keep their plan order within a lane; lanes are filled first come, first served.
 */
func audioLanes(_ segments: [AudioSegment]) -> [[AudioSegment]] {
    var lanes: [[AudioSegment]] = []
    // A stable sort by start, like Kotlin's sortedBy.
    let sorted = segments.enumerated().sorted { ($0.element.startUs, $0.offset) < ($1.element.startUs, $1.offset) }.map(\.element)
    for segment in sorted {
        if let i = lanes.firstIndex(where: { $0.last!.endUs <= segment.startUs }) {
            lanes[i].append(segment)
        } else {
            lanes.append([segment])
        }
    }
    return lanes
}

/**
 * Gain at `tUs` into a segment of `durationUs`, in timeline time: `volume`, ramping linearly up from 0
 * over `fadeInUs` and down to 0 over the last `fadeOutUs`, like the web engine's Web Audio envelope.
 */
func gainAt(_ tUs: Int64, durationUs: Int64, volume: Double, fadeInUs: Int64, fadeOutUs: Int64) -> Double {
    var gain = volume
    if fadeInUs > 0 && tUs < fadeInUs { gain *= Double(tUs) / Double(fadeInUs) }
    let untilEnd = durationUs - tUs
    if fadeOutUs > 0 && untilEnd < fadeOutUs { gain *= Double(max(0, untilEnd)) / Double(fadeOutUs) }
    return gain
}

/** Even output size, like `outputSize(project)` on the web. */
func evenSize(_ width: Int, _ height: Int) -> (Int, Int) { (width - width % 2, height - height % 2) }
