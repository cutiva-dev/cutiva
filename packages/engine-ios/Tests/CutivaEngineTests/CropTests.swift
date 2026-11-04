import XCTest
@testable import CutivaEngine

/**
 * The engine evaluates crop keys the way `@cutiva/core` does: for every `videoAt` sample of the
 * reframe conformance fixtures, the plan segment on screen gives the same source time, rectangle
 * and layout as the expected values (written by hand from the spec).
 */
final class CropTests: XCTestCase {
    static let fixtures = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("../../../../conformance/fixtures").standardized

    private struct Expected: Decodable {
        struct Sample: Decodable {
            struct Layer: Decodable {
                let clipId: String
                let sourceTimeUs: Int64
                let crop: CropRect
                let layout: CropLayout?
            }
            let tUs: Int64
            let layers: [Layer]
        }
        struct Seg: Decodable {
            let layer: Int
            let clipId: String
            let startUs: Int64
            let endUs: Int64
            let sourceInUs: Int64
            let sourceOutUs: Int64
            let speed: Double
            let crop: [CropKey]?
            let sourceWidth: Int?
            let sourceHeight: Int?
        }
        let videoSegments: [Seg]
        let videoAt: [Sample]
    }

    private func check(_ name: String) throws {
        let data = try Data(contentsOf: Self.fixtures.appendingPathComponent("\(name).expected.json"))
        let expected = try JSONDecoder().decode(Expected.self, from: data)
        let segs = expected.videoSegments.map {
            VideoSegment(layer: $0.layer, trackId: "t", clipId: $0.clipId, assetId: "a", uri: "file://a", startUs: $0.startUs, endUs: $0.endUs,
                         sourceInUs: $0.sourceInUs, sourceOutUs: $0.sourceOutUs, speed: $0.speed, crop: $0.crop,
                         sourceWidth: $0.sourceWidth, sourceHeight: $0.sourceHeight)
        }
        XCTAssertTrue(segs.allSatisfy { $0.crop != nil && $0.sourceWidth == 1920 && $0.sourceHeight == 1080 })
        XCTAssertFalse(expected.videoAt.isEmpty)
        for sample in expected.videoAt {
            let t = sample.tUs
            let layer = sample.layers[0]
            let matching = segs.filter { t >= $0.startUs && t < $0.endUs }
            XCTAssertEqual(matching.count, 1, "\(name) one segment at \(t)")
            let seg = matching[0]
            XCTAssertEqual(seg.clipId, layer.clipId, "\(name) clip at \(t)")
            let s = sourceTimeAt(seg, t)
            XCTAssertEqual(s, layer.sourceTimeUs, "\(name) source time at \(t)")
            XCTAssertEqual(cropAt(seg.crop!, s), layer.crop, "\(name) crop at \(t)")
            XCTAssertEqual(layoutAt(seg.crop!, s), layer.layout, "\(name) layout at \(t)")
        }
    }

    func testReframeFixture() throws { try check("reframe") }

    func testReframeLayoutsFixture() throws { try check("reframe-layouts") }

    func testBeforeTheFirstKeyTheFirstHolds() {
        let keys = [
            CropKey(atUs: 1_000, rect: CropRect(10, 0, 100, 100), layout: .wide(area: CropRect(0, 0, 200, 100))),
            CropKey(atUs: 2_000, rect: CropRect(20, 0, 100, 100)),
        ]
        XCTAssertEqual(cropAt(keys, 0), CropRect(10, 0, 100, 100))
        XCTAssertEqual(layoutAt(keys, 0), .wide(area: CropRect(0, 0, 200, 100)))
        XCTAssertEqual(cropAt(keys, 1_500), CropRect(15, 0, 100, 100))
        XCTAssertNil(layoutAt(keys, 2_000))
        XCTAssertEqual(cropAt(keys, 9_000), CropRect(20, 0, 100, 100))
    }

    func testParsesPlanCropKeys() throws {
        let plan = try RenderPlan.fromJson("""
        { "durationUs": 1000000, "settings": { "width": 1080, "height": 1920, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [ { "layer": 0, "trackId": "t", "clipId": "c", "assetId": "a", "uri": "file://a", "startUs": 0, "endUs": 1000000,
            "sourceInUs": 0, "sourceOutUs": 1000000, "speed": 1, "sourceWidth": 1920, "sourceHeight": 1080,
            "crop": [ { "atUs": 0, "rect": { "x": 1, "y": 2, "w": 3, "h": 4 }, "cut": false,
              "layout": { "kind": "split", "regions": [ { "x": 0, "y": 0, "w": 5, "h": 5 }, { "x": 6, "y": 6, "w": 5, "h": 5 } ] } } ] } ],
          "audio": [] }
        """)
        let v = plan.video[0]
        XCTAssertEqual(v.sourceWidth, 1920)
        XCTAssertEqual(v.crop, [CropKey(atUs: 0, rect: CropRect(1, 2, 3, 4), layout: .split(top: CropRect(0, 0, 5, 5), bottom: CropRect(6, 6, 5, 5)))])
    }

    func testInvalidPlanIsInvalidProject() {
        XCTAssertThrowsError(try RenderPlan.fromJson("{}")) { XCTAssertEqual(($0 as? CutivaError)?.code, "INVALID_PROJECT") }
        XCTAssertThrowsError(try RenderPlan.fromJson("""
        { "durationUs": 1, "settings": { "width": 2, "height": 2, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [ { "layer": 0, "trackId": "t", "clipId": "c", "assetId": "a", "uri": "u", "startUs": 0, "endUs": 1, "sourceInUs": 0,
            "sourceOutUs": 1, "speed": 1, "crop": [ { "atUs": 0, "rect": { "x": 0, "y": 0, "w": 1, "h": 1 }, "layout": { "kind": "zoom" } } ] } ],
          "audio": [] }
        """)) { XCTAssertEqual(($0 as? CutivaError)?.code, "INVALID_PROJECT") }
    }
}
