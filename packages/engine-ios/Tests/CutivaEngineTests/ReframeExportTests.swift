import AVFoundation
import XCTest
@testable import CutivaEngine

/**
 * Reframed clips, checked like the web's `reframe-export.spec.ts` and the Android `ReframeExportTest`.
 * talk.mp4 is 6 s, 1920x1080: a red face at x 390–690 and a blue one at x 1230–1530, both y 300–600,
 * on grey (128).
 */
final class ReframeExportTests: XCTestCase {
    /**
     * Keys in source time, as `renderPlan` writes them for a 9:16 output: the red face (single window,
     * 608x1080 at x 236) from 0, wide from 2 s, a split of red over blue from 4 s. The clip shows
     * source 1–6 s at timeline 0.5–5.5 s, after a 0.5 s gap, so the engine must map timeline to source time.
     */
    private func plan(_ uri: String, sourceWidth: Int = 1920, sourceHeight: Int = 1080, keys: String? = nil) throws -> RenderPlan {
        try RenderPlan.fromJson("""
        { "durationUs": 5500000, "settings": { "width": 1080, "height": 1920, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [ { "layer": 0, "trackId": "t", "clipId": "c", "assetId": "a", "uri": "\(uri)",
            "startUs": 500000, "endUs": 5500000, "sourceInUs": 1000000, "sourceOutUs": 6000000, "speed": 1,
            "sourceWidth": \(sourceWidth), "sourceHeight": \(sourceHeight),
            "crop": \(keys ?? """
            [
              { "atUs": 0, "rect": { "x": 236, "y": 0, "w": 608, "h": 1080 }, "cut": false },
              { "atUs": 2000000, "rect": { "x": 656, "y": 0, "w": 608, "h": 1080 }, "cut": true,
                "layout": { "kind": "wide", "area": { "x": 0, "y": 0, "w": 1920, "h": 1080 } } },
              { "atUs": 4000000, "rect": { "x": 656, "y": 0, "w": 608, "h": 1080 }, "cut": true,
                "layout": { "kind": "split", "regions": [ { "x": 236, "y": 180, "w": 608, "h": 540 }, { "x": 1076, "y": 180, "w": 608, "h": 540 } ] } }
            ]
            """) } ],
          "audio": [] }
        """)
    }

    private func classOf(_ p: (r: Int, g: Int, b: Int)) -> String {
        func near(_ v: Int, _ want: Int) -> Bool { abs(v - want) < 30 }
        if p.r > 180 && p.g < 80 && p.b < 80 { return "red" }
        if p.b > 180 && p.r < 80 && p.g < 100 { return "blue" }
        if near(p.r, 128) && near(p.g, 128) && near(p.b, 128) { return "grey" }
        if near(p.r, 83) && near(p.g, 83) && near(p.b, 83) { return "dim" }
        return "other(\(p.r),\(p.g),\(p.b))"
    }

    private func at(_ f: Media.Frame, _ fx: Double, _ fy: Double) -> String {
        classOf(f.pixel(Int(Double(f.width) * fx), Int(Double(f.height) * fy)))
    }

    /** Where red and blue start along the row at `fy`, or -1. */
    private func edges(_ f: Media.Frame, _ fy: Double) -> (red: Int, blue: Int) {
        let y = Int(Double(f.height) * fy)
        var red = -1
        var blue = -1
        for x in 0..<f.width {
            let c = classOf(f.pixel(x, y))
            if c == "red" && red < 0 { red = x }
            if c == "blue" && blue < 0 { blue = x }
        }
        return (red, blue)
    }

    private func checkSingleWideSplit(_ file: URL) async throws {
        // Gap: black.
        let gap = try await Media.frame(file, 250_000)
        XCTAssertEqual(gap.width, 1080)
        XCTAssertEqual(gap.height, 1920)
        XCTAssertLessThan(gap.pixel(540, 960).r, 20, "gap")

        // Timeline 1.0 s = source 1.5 s: single window on red. Red's left edge (source 390) lands at
        // (390 − 236) × 1080 / 608 = 273.6.
        let single = try await Media.frame(file, 1_000_000)
        XCTAssertEqual(at(single, 0.5, 0.3), "red", "single centre")
        let row = edges(single, 0.3)
        XCTAssertLessThanOrEqual(abs(row.red - 274), 2, "single red edge \(row.red)")
        XCTAssertEqual(row.blue, -1, "single shows no blue")

        // Timeline 2.5 s = source 3 s: wide. The whole frame letterboxed (scale 0.5625) over a dimmed blur.
        let wide = try await Media.frame(file, 2_500_000)
        XCTAssertEqual(at(wide, 0.05, 0.05), "dim", "wide corner")
        XCTAssertEqual(at(wide, 300.0 / 1080, 900.0 / 1920), "red", "wide red")
        let wideRow = edges(wide, 900.0 / 1920)
        XCTAssertLessThanOrEqual(abs(wideRow.red - 219), 2, "wide red edge \(wideRow.red)")
        XCTAssertLessThanOrEqual(abs(wideRow.blue - 692), 2, "wide blue edge \(wideRow.blue)")

        // Timeline 4.0 s = source 4.5 s: split, red on top, blue below.
        let split = try await Media.frame(file, 4_000_000)
        XCTAssertEqual(at(split, 0.5, 0.15), "red", "split top")
        XCTAssertEqual(at(split, 0.5, 0.65), "blue", "split bottom")
    }

    func testDrawsSingleWideAndSplitAtTheRightTimes() async throws {
        let (summary, file) = try await Media.export(try plan(Media.resource("talk.mp4").absoluteString), "reframe")
        XCTAssertEqual(summary.width, 1080)
        XCTAssertEqual(summary.height, 1920)
        try await checkSingleWideSplit(file)
    }

    /**
     * A phone video stored landscape with a 90° rotation tag shows portrait, and crop keys are in
     * the pixels shown. Rotate talk.mp4's display a quarter turn and back: the same keys, turned
     * with the picture, give the same frames.
     */
    func testCropsAreInDisplayPixelsOfRotatedVideos() async throws {
        // talk.mp4 tagged to show rotated 90° clockwise: 1080 wide, 1920 tall. A landscape point (x, y)
        // shows at (1080 − y, x), so the red face (x 390–690, y 300–600) shows at x 480–780, y 390–690.
        let rotated = try await Self.rotatedCopy(Media.resource("talk.mp4"))
        // A window over the red face's rows of the shown picture, stretched to fill the 1080x1920 output:
        // red covers x 480–780, grey elsewhere. Read without the rotation, red would not be there.
        let keys = """
        [ { "atUs": 0, "rect": { "x": 0, "y": 390, "w": 1080, "h": 300 }, "cut": false } ]
        """
        let (_, file) = try await Media.export(try plan(rotated.absoluteString, sourceWidth: 1080, sourceHeight: 1920, keys: keys), "rotated")
        let f = try await Media.frame(file, 1_000_000)
        let row = edges(f, 0.5)
        XCTAssertLessThanOrEqual(abs(row.red - 480), 3, "rotated red edge \(row.red)")
        XCTAssertEqual(at(f, 0.2, 0.5), "grey")
        XCTAssertEqual(at(f, 0.6, 0.5), "red")
        XCTAssertEqual(at(f, 0.8, 0.5), "grey")
    }

    /** A copy of `url` with a 90° clockwise rotation tag, same samples (passthrough). */
    static func rotatedCopy(_ url: URL) async throws -> URL {
        let asset = AVURLAsset(url: url)
        let composition = AVMutableComposition()
        let source = try await asset.loadTracks(withMediaType: .video).first!
        let track = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid)!
        try track.insertTimeRange(CMTimeRange(start: .zero, duration: try await asset.load(.duration)), of: source, at: .zero)
        track.preferredTransform = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: 1080, ty: 0)
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("rotated-\(UUID().uuidString).mov")
        let session = AVAssetExportSession(asset: composition, presetName: AVAssetExportPresetPassthrough)!
        session.outputURL = out
        session.outputFileType = .mov
        await session.export()
        XCTAssertEqual(session.status, .completed, "\(String(describing: session.error))")
        return out
    }
}
