import AVFoundation
import XCTest
@testable import CutivaEngine

/**
 * talk.mp4 (the web E2E fixture): 6 s, 1920x1080, no audio; a red "face" at x 390–690 and a blue one
 * at x 1230–1530, both y 300–600, on grey, with white "mouths" that flicker (red talks first, blue
 * after 3 s). clip.mp4: 4 s, 640x360, a white flash and a 440 Hz beep from x.5 to x.6 s every second.
 */
final class AnalyzerTests: XCTestCase {
    static func resource(_ name: String) -> URL {
        Bundle.module.resourceURL!.appendingPathComponent("Fixtures").appendingPathComponent(name)
    }

    let talk = resource("talk.mp4")
    let clip = resource("clip.mp4")

    /** The web E2E fake detector: reads both squares and whether each mouth is open from the pixels. */
    struct Fake: FaceDetector {
        func detect(_ frame: CGImage) throws -> [FaceBox] {
            let s = Double(frame.width) / 1920
            let px = argbPixels(frame, frame.width, frame.height)
            return [(390.0, 540.0), (1230.0, 1380.0)].map { x, mouthX in
                let p = px[Int(532 * s) * frame.width + Int(mouthX * s)]
                let green = (p >> 8) & 0xff
                return FaceBox(x: x * s, y: 300 * s, w: 300 * s, h: 300 * s, mouth: green > 200 ? 0.4 : 0.1)
            }
        }
    }

    func testMeasuresFramesFacesCutsAndBars() async throws {
        var stages: [String] = []
        var last = 0.0
        let m = try await ReframeAnalyzer().analyze(talk, detector: Fake()) { r, stage in
            XCTAssertGreaterThanOrEqual(r, last, "progress goes forward")
            last = r
            stages.append(stage)
        }
        XCTAssertEqual(m.width, 1920)
        XCTAssertEqual(m.height, 1080)
        XCTAssertLessThan(abs(m.durationUs - 6_000_000), 50_000, "duration \(m.durationUs)")
        XCTAssertEqual(m.fps, 5)
        // 6 s at 5 fps.
        XCTAssertEqual(m.frames.map(\.atUs), (0..<30).map { Int64($0) * 200_000 })
        XCTAssertEqual(m.histograms.count, 30)
        XCTAssertEqual(last, 1, accuracy: 1e-9)
        XCTAssertEqual(Set(stages), ["video"])
        XCTAssertFalse(m.hasAudio)
        // Faces come back in source pixels.
        let first = m.frames[0].faces
        XCTAssertEqual(first.count, 2)
        XCTAssertEqual(first[0].x, 390, accuracy: 1e-6)
        XCTAssertEqual(first[0].h, 300, accuracy: 1e-6)
        // Red's mouth moves in the first 3 s, blue's after.
        let redOpen = m.frames.filter { $0.faces[0].mouth > 0.3 }.map(\.atUs)
        let blueOpen = m.frames.filter { $0.faces[1].mouth > 0.3 }.map(\.atUs)
        XCTAssertTrue(!redOpen.isEmpty && redOpen.allSatisfy { $0 < 3_000_000 }, "red \(redOpen)")
        XCTAssertTrue(!blueOpen.isEmpty && blueOpen.allSatisfy { $0 >= 3_000_000 }, "blue \(blueOpen)")
        // No audio: no voice or pan.
        XCTAssertTrue(m.frames.allSatisfy { $0.voice == nil && $0.pan == nil })
        // Grey edges (about 128 luma): no black bars.
        XCTAssertEqual(m.peakWidth, 320)
        XCTAssertEqual(m.peakHeight, 180)
        let luma = { (x: Int, y: Int) in Int(m.peak[y * 320 + x]) }
        XCTAssertTrue((0..<320).allSatisfy { (110...150).contains(luma($0, 0)) && (110...150).contains(luma($0, 179)) })
        XCTAssertTrue((0..<180).allSatisfy { (110...150).contains(luma(0, $0)) && (110...150).contains(luma(319, $0)) })

        // The JSON `@cutiva/expo` reads.
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(m.toJson().utf8)) as? [String: Any])
        XCTAssertEqual((json["frames"] as? [Any])?.count, 30)
        XCTAssertEqual(((json["histograms"] as? [[Int]])?.first)?.count, 48)
        XCTAssertEqual(json["hasAudio"] as? Bool, false)
        XCTAssertEqual(json["width"] as? Int, 1920)
        let peak = try XCTUnwrap(json["peak"] as? [String: Any])
        XCTAssertEqual(Data(base64Encoded: peak["luma"] as! String)?.count, 320 * 180)
        let face = try XCTUnwrap(((json["frames"] as? [[String: Any]])?.first?["faces"] as? [[String: Double]])?.first)
        XCTAssertEqual(Set(face.keys), ["x", "y", "w", "h", "mouth"])
    }

    func testPartOfTheSource() async throws {
        let m = try await ReframeAnalyzer().analyze(talk, detector: Fake(), options: AnalyzeOptions(fps: 2, fromUs: 1_000_000, toUs: 3_000_000))
        XCTAssertEqual(m.frames.map(\.atUs), [1_000_000, 1_500_000, 2_000_000, 2_500_000])
        XCTAssertEqual(m.fromUs, 1_000_000)
        XCTAssertEqual(m.toUs, 3_000_000)
    }

    func testCancel() async throws {
        let task = Task { try await ReframeAnalyzer().analyze(talk, detector: Fake()) }
        task.cancel()
        do {
            _ = try await task.value
            XCTFail("not cancelled")
        } catch let e as CutivaError {
            XCTAssertEqual(e.code, "ANALYSIS_CANCELLED")
        }

        // Cancelled midway, after some frames.
        let started = expectation(description: "started")
        let midway = Task {
            var once = false
            return try await ReframeAnalyzer().analyze(talk, detector: Fake()) { _, _ in
                if !once {
                    once = true
                    started.fulfill()
                }
            }
        }
        await fulfillment(of: [started], timeout: 30)
        midway.cancel()
        do {
            _ = try await midway.value
            XCTFail("not cancelled")
        } catch let e as CutivaError {
            XCTAssertEqual(e.code, "ANALYSIS_CANCELLED")
        }
    }

    /** Speech loudness: the beeps of clip.mp4 are loud, the rest silent. */
    func testMeasuresVoice() async throws {
        var stages: [String] = []
        // 20 fps, so frames land mid-beep (x.55 s): a ±100 ms window there holds the whole beep.
        let m = try await ReframeAnalyzer().analyze(clip, detector: Fake(), options: AnalyzeOptions(fps: 20)) { _, stage in stages.append(stage) }
        XCTAssertTrue(m.hasAudio)
        XCTAssertEqual(m.width, 640)
        XCTAssertEqual(m.frames.count, 80)
        XCTAssertEqual(stages.first, "video")
        XCTAssertEqual(stages.last, "audio")
        let voice = Dictionary(uniqueKeysWithValues: m.frames.map { ($0.atUs, $0.voice ?? -1) })
        for t: Int64 in [550_000, 1_550_000, 2_550_000, 3_550_000] { XCTAssertGreaterThan(voice[t] ?? -1, 0.8, "voice at \(t)") }
        for t: Int64 in [0, 200_000, 1_000_000, 2_200_000, 3_000_000] { XCTAssertLessThan(voice[t] ?? 9, 0.1, "voice at \(t)") }
        // Mono beeps: no pan.
        XCTAssertTrue(m.frames.allSatisfy { $0.pan == nil })
        // The flashes show in the peak: everything was white once.
        XCTAssertTrue(m.peak.allSatisfy { $0 > 240 })
        let json = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(m.toJson().utf8)) as? [String: Any])
        XCTAssertEqual(json["hasAudio"] as? Bool, true)
        XCTAssertNotNil((json["frames"] as? [[String: Any]])?.first?["voice"])
    }

    func testRefusesFilesWithoutVideoOrMissing() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let wav = dir.appendingPathComponent("tone.wav")
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        let file = try AVAudioFile(forWriting: wav, settings: format.settings)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 4800)!
        buffer.frameLength = 4800
        try file.write(from: buffer)

        for (url, code) in [(wav, "NO_VIDEO_TRACK"), (dir.appendingPathComponent("none.mp4"), "ASSET_NOT_FOUND")] {
            do {
                _ = try await ReframeAnalyzer().analyze(url, detector: Fake())
                XCTFail("\(url.lastPathComponent) analysed")
            } catch let e as CutivaError {
                XCTAssertEqual(e.code, code)
            }
        }
    }
}

final class FaceModelTests: XCTestCase {
    func testChecksTheHashAndKeepsAVerifiedCopy() async throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: dir) }
        let source = dir.appendingPathComponent("model.task")
        try Data("not a model".utf8).write(to: source)
        let cache = dir.appendingPathComponent("cache")

        // The pinned hash doesn't match: refused, nothing kept.
        do {
            _ = try await FaceModel.load(url: source, directory: cache)
            XCTFail("loaded a file with the wrong hash")
        } catch let e as CutivaError {
            XCTAssertEqual(e.code, "MODEL_LOAD_FAILED")
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: cache.path), [])

        // A matching hash: kept, then served from the copy even when the source is gone.
        let hash = FaceModel.sha256(Data("not a model".utf8))
        var progress: [Double] = []
        let file = try await FaceModel.load(url: source, sha256: hash, directory: cache) { progress.append($0) }
        XCTAssertEqual(try Data(contentsOf: file), Data("not a model".utf8))
        XCTAssertEqual(progress.last, 1)
        let again = try await FaceModel.load(url: dir.appendingPathComponent("gone.task"), sha256: hash, directory: cache)
        XCTAssertEqual(again, file)

        // A missing source with no copy: refused.
        do {
            _ = try await FaceModel.load(url: dir.appendingPathComponent("gone.task"), directory: cache)
            XCTFail("loaded a missing file")
        } catch let e as CutivaError {
            XCTAssertEqual(e.code, "MODEL_LOAD_FAILED")
        }
    }

    func testPinsTheWebModel() {
        XCTAssertEqual(FaceModel.SHA256, "64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff")
        XCTAssertEqual(FaceModel.defaultURL.absoluteString, "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task")
    }
}
