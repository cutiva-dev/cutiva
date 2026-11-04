import XCTest
@testable import CutivaEngine

/**
 * The web E2E test, on iOS: clip.mp4 is 4 s, 640x360, H.264 + AAC. Every second, from x.5 to x.6,
 * the frame flashes white and a 440 Hz beep plays. The plans below are what `renderPlan` returns.
 */
final class ExportTests: XCTestCase {
    private let clip = Media.resource("clip.mp4").absoluteString

    /** A plan with one clip of clip.mp4 on both the video and the audio side. */
    private func plan(_ durationUs: Int64, video: String, audio: String) throws -> RenderPlan {
        try RenderPlan.fromJson("""
        { "durationUs": \(durationUs),
          "settings": { "width": 640, "height": 360, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [\(video)], "audio": [\(audio)] }
        """)
    }

    private func videoSeg(_ startUs: Int64, _ endUs: Int64, _ inUs: Int64, _ outUs: Int64, speed: Double = 1) -> String {
        """
        { "layer": 0, "trackId": "t", "clipId": "v", "assetId": "a", "uri": "\(clip)", "startUs": \(startUs), "endUs": \(endUs),
          "sourceInUs": \(inUs), "sourceOutUs": \(outUs), "speed": \(speed) }
        """
    }

    private func audioSeg(_ startUs: Int64, _ endUs: Int64, _ inUs: Int64, _ outUs: Int64, speed: Double = 1, volume: Double = 1, fadeInUs: Int64 = 0, id: String = "s") -> String {
        """
        { "clipId": "\(id)", "assetId": "a", "uri": "\(clip)", "startUs": \(startUs), "endUs": \(endUs), "sourceInUs": \(inUs),
          "sourceOutUs": \(outUs), "speed": \(speed), "volume": \(volume), "fadeInUs": \(fadeInUs), "fadeOutUs": 0 }
        """
    }

    /** The playground E2E edit: split at 1 s and delete the first part, leaving source 1–4 s at 0–3 s. */
    func testTrimmedExportIsInSync() async throws {
        let (summary, file) = try await Media.export(try plan(3_000_000, video: videoSeg(0, 3_000_000, 1_000_000, 4_000_000), audio: audioSeg(0, 3_000_000, 1_000_000, 4_000_000)))
        let codecs = try await Media.codecs(file)
        XCTAssertEqual(codecs.video, "avc1")
        XCTAssertEqual(codecs.audio, "aac ")
        XCTAssertEqual(summary.width, 640)
        XCTAssertEqual(summary.height, 360)
        XCTAssertGreaterThan(summary.fileSizeBytes, 0)

        let video = try await Media.videoTimestampsUs(file)
        XCTAssertEqual(video.count, 90, "video frames: \(video.count), from \(video.first ?? -1) to \(video.last ?? -1)")
        XCTAssertLessThan(video.first!, 1_000, "first frame")

        // Picture: white during the flashes, not just before or after.
        for t: Int64 in [550_000, 1_550_000, 2_550_000] {
            let l = try await Media.frame(file, t).luma
            XCTAssertGreaterThan(l, 240, "luma at \(t)")
        }
        for t: Int64 in [450_000, 650_000] {
            let l = try await Media.frame(file, t).luma
            XCTAssertLessThan(l, 200, "luma at \(t)")
        }

        // Sound: three beeps, each within 5 ms of where it belongs.
        let onsets = try await Media.beepOnsetsUs(file)
        XCTAssertEqual(onsets.count, 3, "onsets \(onsets)")
        for (i, t) in onsets.enumerated() {
            XCTAssertLessThan(abs(t - (500_000 + Int64(i) * 1_000_000)), 5_000, "beep \(i) at \(t) µs")
        }
    }

    func testAudioStaysInSyncWhereverAClipStarts() async throws {
        for inUs: Int64 in [0, 10_000, 21_333, 250_000, 1_333_333] {
            let (_, file) = try await Media.export(try plan(2_000_000, video: videoSeg(0, 2_000_000, inUs, inUs + 2_000_000), audio: audioSeg(0, 2_000_000, inUs, inUs + 2_000_000)))
            let expected = (1_500_000 - inUs) % 1_000_000
            let first = try await Media.beepOnsetsUs(file).first!
            XCTAssertLessThan(abs(first - expected), 5_000, "cut at \(inUs): beep at \(first) µs, expected \(expected)")
        }
    }

    func testGapsShowBlackAndSpeedChangesTiming() async throws {
        // 0.5 s of nothing, then source 1–3 s at 2x (1 s), then 0.5 s of nothing.
        let (summary, file) = try await Media.export(try plan(2_000_000, video: videoSeg(500_000, 1_500_000, 1_000_000, 3_000_000, speed: 2), audio: audioSeg(500_000, 1_500_000, 1_000_000, 3_000_000, speed: 2)))
        let frames = try await Media.videoTimestampsUs(file)
        XCTAssertEqual(frames.count, 60, "video frames: \(frames.count), from \(frames.first ?? -1) to \(frames.last ?? -1)")
        XCTAssertLessThan(abs(frames.last! - 1_966_667), 1_000, "last frame at \(frames.last!)")
        XCTAssertTrue((1_960...2_000).contains(summary.durationMs), "summary says \(summary.durationMs) ms")
        let before = try await Media.frame(file, 250_000).luma
        let after = try await Media.frame(file, 1_750_000).luma
        XCTAssertLessThan(before, 20, "black before the clip")
        XCTAssertLessThan(after, 20, "black after the clip")
        // Source flashes at 1.5–1.6 s and 2.5–2.6 s land at 0.5 + (t - 1) / 2: 0.75–0.80 s and 1.25–1.30 s.
        let f1 = try await Media.frame(file, 775_000).luma
        let f2 = try await Media.frame(file, 1_275_000).luma
        let none = try await Media.frame(file, 1_000_000).luma
        XCTAssertGreaterThan(f1, 240, "flash at 0.775 s")
        XCTAssertGreaterThan(f2, 240, "flash at 1.275 s")
        XCTAssertLessThan(none, 200, "no flash at 1.0 s")
        let onsets = try await Media.beepOnsetsUs(file)
        XCTAssertEqual(onsets.count, 2, "onsets \(onsets)")
        for (t, e) in zip(onsets, [Int64(750_000), 1_250_000]) { XCTAssertLessThan(abs(t - e), 5_000, "beep at \(t), expected \(e)") }
    }

    func testVolumeAndFadesFollowTheTimeline() async throws {
        // Volume 0.5 with a 1 s fade in: the beep at 0.5 s plays at 0.25 of the source level, the one at 1.5 s at 0.5.
        let source = try await Media.beepPeaks(Media.resource("clip.mp4"))
        let (_, file) = try await Media.export(try plan(2_000_000, video: videoSeg(0, 2_000_000, 0, 2_000_000), audio: audioSeg(0, 2_000_000, 0, 2_000_000, volume: 0.5, fadeInUs: 1_000_000)))
        let out = try await Media.beepPeaks(file)
        XCTAssertEqual(out[0] / source[0], 0.25, accuracy: 0.03)
        XCTAssertEqual(out[1] / source[1], 0.5, accuracy: 0.03)
    }

    func testVolumeAboveOneAmplifies() async throws {
        // Volume goes up to 4 in CPF. The beeps peak at about 0.8 of full scale, so 1.2x doesn't clip.
        let source = try await Media.beepPeaks(Media.resource("clip.mp4"))
        XCTAssertLessThan(source[0] * 1.2, 32_000)
        let (_, file) = try await Media.export(try plan(2_000_000, video: videoSeg(0, 2_000_000, 0, 2_000_000), audio: audioSeg(0, 2_000_000, 0, 2_000_000, volume: 1.2)))
        let out = try await Media.beepPeaks(file)
        XCTAssertEqual(out[0] / source[0], 1.2, accuracy: 0.03, "source \(source), out \(out)")
    }

    func testSoundsThatOverlapAreMixed() async throws {
        // The clip's own sound plus the same file again from 0.25 s: four beeps instead of two.
        let (_, file) = try await Media.export(try plan(2_000_000, video: videoSeg(0, 2_000_000, 0, 2_000_000),
                                                         audio: audioSeg(0, 2_000_000, 0, 2_000_000) + "," + audioSeg(250_000, 2_000_000, 0, 1_750_000, id: "m")))
        let onsets = try await Media.beepOnsetsUs(file)
        XCTAssertEqual(onsets.count, 4, "onsets \(onsets)")
        for (t, e) in zip(onsets, [Int64(500_000), 750_000, 1_500_000, 1_750_000]) { XCTAssertLessThan(abs(t - e), 5_000, "beep at \(t), expected \(e)") }
    }

    func testRefusesWhatItCannotExportYet() async throws {
        func code(_ block: () throws -> Void) -> String {
            do {
                try block()
                return "NONE"
            } catch {
                return (error as? CutivaError)?.code ?? "\(error)"
            }
        }
        let two = try plan(1_000_000, video: videoSeg(0, 1_000_000, 0, 1_000_000) + "," + videoSeg(0, 1_000_000, 0, 1_000_000).replacingOccurrences(of: "\"layer\": 0", with: "\"layer\": 1"), audio: "")
        XCTAssertEqual(code { try CutivaExporter.validate(two) }, "UNSUPPORTED_FEATURE")
        let cropped = try plan(1_000_000, video: videoSeg(0, 1_000_000, 0, 1_000_000).replacingOccurrences(of: "\"speed\": 1.0 }", with: "\"speed\": 1.0, \"crop\": [] }"), audio: "")
        XCTAssertEqual(cropped.video[0].crop, [])
        // Reframed clips export (ReframeExportTests); keys without a source size can't be drawn.
        XCTAssertEqual(code { try CutivaExporter.validate(cropped) }, "INVALID_PROJECT")
        XCTAssertEqual(code { try CutivaExporter.validate(try self.plan(0, video: "", audio: "")) }, "NOTHING_TO_EXPORT")
        XCTAssertEqual(code { _ = try RenderPlan.fromJson("{}") }, "INVALID_PROJECT")

        let missing = try RenderPlan.fromJson("""
        { "durationUs": 1000000, "settings": { "width": 640, "height": 360, "fps": { "num": 30, "den": 1 }, "sampleRate": 48000 },
          "video": [ { "layer": 0, "trackId": "t", "clipId": "v", "assetId": "a", "uri": "file:///nowhere/missing.mp4", "startUs": 0,
            "endUs": 1000000, "sourceInUs": 0, "sourceOutUs": 1000000, "speed": 1 } ], "audio": [] }
        """)
        do {
            _ = try await Media.export(missing)
            XCTFail("exported a missing file")
        } catch {
            XCTAssertEqual((error as? CutivaError)?.code, "ASSET_NOT_FOUND")
        }
    }

    func testCancellingTheTaskCancelsTheExport() async throws {
        let p = try plan(3_000_000, video: videoSeg(0, 3_000_000, 1_000_000, 4_000_000), audio: audioSeg(0, 3_000_000, 1_000_000, 4_000_000))
        let task = Task { try await CutivaExporter().export(p, to: Media.tempURL("cancel")) }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("export finished after cancel")
        } catch {
            XCTAssertEqual((error as? CutivaError)?.code, "EXPORT_CANCELLED")
        }
    }
}
