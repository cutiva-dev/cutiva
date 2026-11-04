import AVFoundation
import XCTest
@testable import CutivaEngine

final class TimingTests: XCTestCase {
    private func seg(_ id: String, _ start: Int64, _ end: Int64) -> AudioSegment {
        AudioSegment(clipId: id, assetId: "a", uri: "file://a", startUs: start, endUs: end, sourceInUs: 0, sourceOutUs: end - start,
                     speed: 1, volume: 1, fadeInUs: 0, fadeOutUs: 0)
    }

    func testAudioLanesKeepNonOverlappingSoundsTogether() {
        let lanes = audioLanes([seg("music", 0, 10), seg("voice", 2, 4), seg("sfx", 4, 6), seg("tail", 10, 12)])
        XCTAssertEqual(lanes.map { $0.map(\.clipId) }, [["music", "tail"], ["voice", "sfx"]])
    }

    func testAudioLanesOfNothingIsEmpty() {
        XCTAssertTrue(audioLanes([]).isEmpty)
    }

    func testGainRampsLinearlyInTimelineTime() {
        XCTAssertEqual(gainAt(0, durationUs: 1_000_000, volume: 2, fadeInUs: 100_000, fadeOutUs: 0), 0, accuracy: 1e-9)
        XCTAssertEqual(gainAt(50_000, durationUs: 1_000_000, volume: 2, fadeInUs: 100_000, fadeOutUs: 0), 1, accuracy: 1e-9)
        XCTAssertEqual(gainAt(500_000, durationUs: 1_000_000, volume: 2, fadeInUs: 100_000, fadeOutUs: 200_000), 2, accuracy: 1e-9)
        XCTAssertEqual(gainAt(900_000, durationUs: 1_000_000, volume: 2, fadeInUs: 100_000, fadeOutUs: 200_000), 1, accuracy: 1e-9)
        XCTAssertEqual(gainAt(1_000_000, durationUs: 1_000_000, volume: 2, fadeInUs: 100_000, fadeOutUs: 200_000), 0, accuracy: 1e-9)
    }

    func testEvenSizeDropsOddPixels() {
        XCTAssertTrue(evenSize(1920, 1080) == (1920, 1080))
        XCTAssertTrue(evenSize(1279, 719) == (1278, 718))
    }

    func testSourceTimeRoundsHalvesUp() {
        let s = VideoSegment(layer: 0, trackId: "t", clipId: "c", assetId: "a", uri: "u", startUs: 100, endUs: 200, sourceInUs: 1_000, sourceOutUs: 1_150, speed: 1.5)
        XCTAssertEqual(sourceTimeAt(s, 101), 1_002) // 1.5 rounds up to 2
        XCTAssertEqual(sourceTimeAt(s, 100), 1_000)
    }

    /** The ramps give `gainAt` at their ends, also where a fade in and a fade out overlap. */
    func testVolumeRampsFollowGainAt() {
        let s = AudioSegment(clipId: "c", assetId: "a", uri: "u", startUs: 2_000_000, endUs: 3_000_000, sourceInUs: 0, sourceOutUs: 1_000_000,
                             speed: 1, volume: 0.8, fadeInUs: 600_000, fadeOutUs: 600_000)
        let comp = AVMutableComposition()
        let p = AVMutableAudioMixInputParameters(track: comp.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid))
        CutivaExporter.addRamps(p, s)
        for t: Int64 in [0, 100_000, 400_000, 500_000, 650_000, 900_000] {
            var start: Float = -1
            var end: Float = -1
            var range = CMTimeRange.zero
            XCTAssertTrue(p.getVolumeRamp(for: cmTime(s.startUs + t), startVolume: &start, endVolume: &end, timeRange: &range), "ramp at \(t)")
            let a = Int64((range.start.seconds * 1e6).rounded()) - s.startUs
            XCTAssertEqual(Double(start), gainAt(a, durationUs: 1_000_000, volume: 0.8, fadeInUs: 600_000, fadeOutUs: 600_000), accuracy: 1e-6)
            XCTAssertEqual(Double(end), gainAt(a + Int64((range.duration.seconds * 1e6).rounded()), durationUs: 1_000_000, volume: 0.8, fadeInUs: 600_000, fadeOutUs: 600_000), accuracy: 1e-6)
            XCTAssertLessThanOrEqual(range.duration.seconds, 0.4 / 16 + 1e-9 + (t < 400_000 || t >= 600_000 ? 0.4 : 0))
        }
    }
}
