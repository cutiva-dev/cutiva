import XCTest
@testable import CutivaEngine

/** The same cases as `SignalsTest.kt` in the Android engine. */
final class SignalsTests: XCTestCase {
    static let fixtures = CropTests.fixtures.appendingPathComponent("auto-reframe")

    private func signals(_ left: [Double], _ right: [Double], _ rate: Int, _ times: [Int64]) -> AudioSignals {
        let s = AudioSignals(sampleRate: rate, timesUs: times)
        for i in left.indices { s.add(Float(left[i]), Float(right[i])) }
        return s
    }

    /** The `stereoPan` conformance fixture (expected values written by hand from the spec). */
    func testPanMatchesTheFixture() throws {
        struct Input: Decodable {
            struct Inner: Decodable {
                let sampleRate: Int
                let left: [Double]
                let right: [Double]
                let timesUs: [Int64]
            }
            let input: Inner
        }
        struct Expected: Decodable { let pan: [Double] }
        let input = try JSONDecoder().decode(Input.self, from: Data(contentsOf: Self.fixtures.appendingPathComponent("signals-pan.input.json"))).input
        let expected = try JSONDecoder().decode(Expected.self, from: Data(contentsOf: Self.fixtures.appendingPathComponent("signals-pan.expected.json"))).pan
        let pan = try XCTUnwrap(signals(input.left, input.right, input.sampleRate, input.timesUs).pan())
        XCTAssertEqual(pan.count, expected.count)
        for (a, b) in zip(pan, expected) { XCTAssertEqual(a, b, accuracy: 1e-12) }
    }

    func testMonoSavedAsStereoHasNoPan() {
        let same = (0..<100).map { $0 % 2 == 0 ? 0.3 : -0.3 }
        XCTAssertNil(signals(same, same, 100, [0, 500_000]).pan())
        XCTAssertNil(signals([Double](repeating: 0, count: 10), [Double](repeating: 0, count: 10), 10, [0]).pan())
    }

    func testVoiceIsRmsOverThe90thPercentile() {
        // 100 samples per second, windows of ±10 samples. Loud (0.8) for the first second, quiet (0.2) after, 3 s in all.
        let samples = (0..<300).map { $0 < 100 ? 0.8 : 0.2 }
        let voice = signals(samples, samples, 100, [0, 1_000_000, 2_000_000, 3_200_000]).voice()
        // RMS: 0.8; at 1 s, 10 samples of 0.8 and 10 of 0.2; 0.2; past the end, no samples: 0.
        // Sorted, the 90th percentile is index floor(4 × 0.9) = 3: 0.8.
        let expected = [1.0, ((10 * 0.64 + 10 * 0.04) / 20).squareRoot() / 0.8, 0.25, 0.0]
        for (a, b) in zip(voice, expected) { XCTAssertEqual(a, b, accuracy: 1e-6) }
    }

    func testHistogramAndPeak() {
        let px: [UInt32] = [0xffff0000, 0xff00ff00, 0xff808080]
        let bins = histogram(px)
        XCTAssertEqual(bins[15], 1)
        XCTAssertEqual(bins[0], 1)
        XCTAssertEqual(bins[8], 1)
        XCTAssertEqual(bins[16 + 15], 1)
        XCTAssertEqual(bins[32 + 8], 1)
        var peak = [UInt8](repeating: 100, count: 3)
        addPeak(px, &peak)
        // Red: 77·255 >> 8 = 76 (kept 100); green: 150·255 >> 8 = 149; grey: 256·128 >> 8 = 128.
        XCTAssertEqual(peak, [100, 149, 128])
    }
}

/** The same cases as `face-tiles.test.ts` in @cutiva/web and `FaceTilesTest.kt`. */
final class FaceTilesTests: XCTestCase {
    func testCoversA16by9FrameWith4x2Squares() {
        let tiles = faceTiles(640, 360)
        XCTAssertEqual(tiles.map { [$0.x, $0.y] }, [[0, 0], [133, 0], [267, 0], [400, 0], [0, 120], [133, 120], [267, 120], [400, 120]])
        XCTAssertEqual(Set(tiles.map(\.size)), [240])
    }

    func testNeighboursOverlapByAThird() {
        for (w, h) in [(1280, 720), (1080, 1920), (1440, 1080), (3840, 2160)] {
            let tiles = faceTiles(w, h)
            let size = tiles[0].size
            for list in [Array(Set(tiles.map(\.x))).sorted(), Array(Set(tiles.map(\.y))).sorted()] {
                for i in 1..<max(1, list.count) { XCTAssertLessThanOrEqual(Double(list[i] - list[i - 1]), (Double(size) * 2 / 3).rounded(.up)) }
            }
            XCTAssertEqual(tiles.map(\.x).max()! + size, w)
            XCTAssertEqual(tiles.map(\.y).max()! + size, h)
        }
    }

    func testSquareFrame() {
        XCTAssertEqual(faceTiles(900, 900).map { [$0.x, $0.y] }, [[0, 0], [300, 0], [0, 300], [300, 300]])
    }

    private func box(_ x: Double, _ y: Double, _ w: Double, _ h: Double, _ mouth: Double = 0) -> FaceBox { FaceBox(x: x, y: y, w: w, h: h, mouth: mouth) }

    func testMergeKeepsTheLargestBoxPerFace() {
        let whole = box(100, 100, 50, 60, 0.1)
        let cut = box(100, 100, 30, 60, 0.2)
        let shifted = box(102, 99, 49, 61)
        let other = box(300, 100, 50, 60)
        XCTAssertEqual(mergeFaces([cut, other, shifted, whole]).sorted { $0.x < $1.x }, [whole, other])
    }

    func testMergeKeepsFacesThatOnlyTouch() {
        XCTAssertEqual(mergeFaces([box(0, 0, 10, 10), box(9, 0, 10, 10)]).count, 2)
    }
}
