import AVFoundation
import CoreGraphics
import CoreMedia
import Foundation

/** Finds faces in one frame, in the frame's own pixels, with how open each mouth is (0 to 1). */
public protocol FaceDetector {
    func detect(_ frame: CGImage) throws -> [FaceBox]
}

/** One analysed frame: faces in source pixels (display orientation), and the speech level and pan around it. */
public struct AnalyzedFrame: Equatable, Sendable {
    public let atUs: Int64
    public let faces: [FaceBox]
    public var voice: Double?
    public var pan: Double?
}

/**
 * What the analysis measured, as numbers only (no images or audio): the input `@cutiva/core` needs
 * to build a `ReframeAnalysis` (`detectCuts` on `histograms`, `detectActiveArea` on the peak luma)
 * and plan with `planReframe`. `toJson()` is the shape `@cutiva/expo` reads, the same as the
 * Android engine's `ReframeMeasurements.toJson`.
 */
public struct ReframeMeasurements: Sendable {
    public let durationUs: Int64
    /** Display size of the source (rotation applied), the pixels faces are in. */
    public let width: Int
    public let height: Int
    public let fromUs: Int64
    public let toUs: Int64
    public let fps: Int
    public let frames: [AnalyzedFrame]
    /** 16 bins each for red, green and blue per analysed frame. */
    public let histograms: [[Int]]
    /** The brightest luma each pixel had across the frames, `peakWidth` × `peakHeight`. */
    public let peakWidth: Int
    public let peakHeight: Int
    public let peak: [UInt8]
    /** The file has an audio track. */
    public let hasAudio: Bool

    public func toJsonObject() -> [String: Any] {
        [
            "durationUs": durationUs,
            "width": width,
            "height": height,
            "fromUs": fromUs,
            "toUs": toUs,
            "fps": fps,
            "hasAudio": hasAudio,
            "frames": frames.map { f -> [String: Any] in
                var o: [String: Any] = [
                    "atUs": f.atUs,
                    "faces": f.faces.map { ["x": $0.x, "y": $0.y, "w": $0.w, "h": $0.h, "mouth": $0.mouth] },
                ]
                if let v = f.voice { o["voice"] = v }
                if let p = f.pan { o["pan"] = p }
                return o
            },
            "histograms": histograms,
            "peak": ["width": peakWidth, "height": peakHeight, "luma": Data(peak).base64EncodedString()],
        ]
    }

    public func toJson() -> String {
        // Only numbers, strings and arrays: serialization can't fail.
        let data = try! JSONSerialization.data(withJSONObject: toJsonObject())
        return String(decoding: data, as: UTF8.self)
    }
}

/** Analysis options, as `AnalyzeOptions` in `@cutiva/web`. */
public struct AnalyzeOptions: Sendable {
    /** Frames analysed per second of source. */
    public var fps: Int
    /** Frames are scaled to this width for detection. */
    public var width: Int
    /** Part of the source to analyse; `toUs` < 0 means to the end. */
    public var fromUs: Int64
    public var toUs: Int64

    public init(fps: Int = 5, width: Int = 640, fromUs: Int64 = 0, toUs: Int64 = -1) {
        self.fps = fps
        self.width = width
        self.fromUs = fromUs
        self.toUs = toUs
    }
}

private let histW = 32
private let histH = 18
/** Width of the picture black bars are looked for in (as on the web). */
private let barsWidth = 320
/** Share of the progress the video stage takes when there is audio to read after it. */
private let videoShare = 0.9

/** Halves up, like Kotlin's roundToInt for the positive sizes used here. */
private func roundHalfUp(_ v: Double) -> Int { Int((v + 0.5).rounded(.down)) }

private func us(_ t: CMTime) -> Int64 {
    guard t.isNumeric else { return 0 }
    return CMTimeConvertScale(t, timescale: 1_000_000, method: .roundHalfAwayFromZero).value
}

private func cancelled() -> CutivaError { CutivaError("ANALYSIS_CANCELLED", "Analysis was cancelled.") }

private func checkCancelled() throws {
    if Task.isCancelled { throw cancelled() }
}

/** The pixels of `image` drawn at `w` × `h`, as 0xAARRGGBB. */
func argbPixels(_ image: CGImage, _ w: Int, _ h: Int) -> [UInt32] {
    var buf = [UInt32](repeating: 0, count: w * h)
    buf.withUnsafeMutableBytes { ptr in
        let ctx = argbContext(ptr.baseAddress, w, h)
        ctx.interpolationQuality = .high
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    }
    return buf
}

/** A context whose pixels read as native 32-bit 0xAARRGGBB. */
private func argbContext(_ data: UnsafeMutableRawPointer?, _ w: Int, _ h: Int) -> CGContext {
    CGContext(
        data: data, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: CGColorSpace(name: CGColorSpace.sRGB)!,
        bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
    )!
}

/** `image` redrawn at exactly `w` × `h` (stretched, as Media3's `LAYOUT_STRETCH_TO_FIT`). */
private func scaled(_ image: CGImage, _ w: Int, _ h: Int) -> CGImage {
    if image.width == w && image.height == h { return image }
    let ctx = argbContext(nil, w, h)
    ctx.interpolationQuality = .high
    ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
    return ctx.makeImage()!
}

/**
 * Samples a video at a few frames per second and records what `analyzeAsset` in `@cutiva/web`
 * records: faces and mouth openness, colour histograms (for camera cuts), the brightest luma per
 * pixel (for burned-in bars), and speech loudness and stereo pan. A port of the Android engine's
 * `ReframeAnalyzer`.
 */
public final class ReframeAnalyzer {
    public init() {}

    private struct Probe {
        let asset: AVURLAsset
        let durationUs: Int64
        let width: Int
        let height: Int
        let audio: AVAssetTrack?
    }

    private func probe(_ url: URL) async throws -> Probe {
        if url.isFileURL && !FileManager.default.fileExists(atPath: url.path) {
            throw CutivaError("ASSET_NOT_FOUND", "Couldn't read \(url): no such file.")
        }
        let asset = AVURLAsset(url: url)
        let videoTracks: [AVAssetTrack]
        let audioTracks: [AVAssetTrack]
        do {
            videoTracks = try await asset.loadTracks(withMediaType: .video)
            audioTracks = try await asset.loadTracks(withMediaType: .audio)
        } catch {
            try checkCancelled()
            throw CutivaError("ASSET_NOT_FOUND", "Couldn't read \(url): \(error.localizedDescription)")
        }
        guard let video = videoTracks.first else { throw CutivaError("NO_VIDEO_TRACK", "\(url) has no video track to analyse.") }
        let (size, transform, range) = try await video.load(.naturalSize, .preferredTransform, .timeRange)
        // Display size: the rotation applied, as browsers do.
        let display = CGRect(origin: .zero, size: size).applying(transform)
        return Probe(
            asset: asset, durationUs: us(range.duration), width: roundHalfUp(abs(display.width)), height: roundHalfUp(abs(display.height)),
            audio: audioTracks.first
        )
    }

    /**
     * Analyse `url` (a file URL). `onProgress` gets the overall ratio and the stage (`video`, then
     * `audio`); cancelling the calling task stops with `ANALYSIS_CANCELLED`. Throws `NO_VIDEO_TRACK`
     * when the file has no video and `ASSET_NOT_FOUND` when it can't be read.
     */
    public func analyze(
        _ url: URL, detector: FaceDetector, options: AnalyzeOptions = .init(), onProgress: @escaping (Double, String) -> Void = { _, _ in }
    ) async throws -> ReframeMeasurements {
        try checkCancelled()
        let info = try await probe(url)
        let from = max(0, options.fromUs)
        let to = options.toUs < 0 ? info.durationUs : min(options.toUs, info.durationUs)
        let stepUs = Int64((1e6 / Double(options.fps)).rounded())
        let times = Array(stride(from: from, to: to, by: Int(stepUs)))

        let width = min(options.width, info.width)
        let height = max(1, roundHalfUp(Double(width) * Double(info.height) / Double(info.width)))
        let scale = Double(info.width) / Double(width)
        let barsW = min(barsWidth, width)
        let barsH = max(1, roundHalfUp(Double(barsW) * Double(height) / Double(width)))
        var peak = [UInt8](repeating: 0, count: barsW * barsH)
        let hasAudio = info.audio != nil
        let share = hasAudio ? videoShare : 1.0

        var frames: [AnalyzedFrame] = []
        var histograms: [[Int]] = []
        let generator = AVAssetImageGenerator(asset: info.asset)
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        generator.maximumSize = CGSize(width: width, height: height)
        for (i, atUs) in times.enumerated() {
            try checkCancelled()
            let image: CGImage
            do {
                image = try await generator.image(at: CMTime(value: atUs, timescale: 1_000_000)).image
            } catch {
                try checkCancelled()
                // A time the decoder can't reach (past the last frame): skip it, as the web does.
                continue
            }
            let frame = scaled(image, width, height)
            let faces = try detector.detect(frame).map {
                FaceBox(x: $0.x * scale, y: $0.y * scale, w: $0.w * scale, h: $0.h * scale, mouth: $0.mouth)
            }
            frames.append(AnalyzedFrame(atUs: atUs, faces: faces))
            histograms.append(histogram(argbPixels(frame, histW, histH)))
            addPeak(argbPixels(frame, barsW, barsH), &peak)
            onProgress(Double(i + 1) / Double(times.count) * share, "video")
        }

        if let track = info.audio, let last = frames.last {
            try checkCancelled()
            onProgress(share, "audio")
            if let signals = try readAudio(info.asset, track, times: frames.map(\.atUs), lastUs: last.atUs) {
                let voice = signals.voice()
                let pan = signals.pan()
                for k in frames.indices {
                    frames[k].voice = voice[k]
                    if let pan { frames[k].pan = pan[k] }
                }
            }
            onProgress(1, "audio")
        }
        return ReframeMeasurements(
            durationUs: info.durationUs, width: info.width, height: info.height, fromUs: from, toUs: to, fps: options.fps, frames: frames,
            histograms: histograms, peakWidth: barsW, peakHeight: barsH, peak: peak, hasAudio: hasAudio
        )
    }

    /** Decodes the audio track up to just past `lastUs` and measures it around `times`. Nil when it can't be decoded. */
    private func readAudio(_ asset: AVAsset, _ track: AVAssetTrack, times: [Int64], lastUs: Int64) throws -> AudioSignals? {
        let stopUs = lastUs + 200_000
        guard let reader = try? AVAssetReader(asset: asset) else { return nil }
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 32,
            AVLinearPCMIsFloatKey: true,
            AVLinearPCMIsNonInterleaved: false,
            AVLinearPCMIsBigEndianKey: false,
        ])
        guard reader.canAdd(output) else { return nil }
        reader.add(output)
        reader.timeRange = CMTimeRange(start: .zero, end: CMTime(value: stopUs, timescale: 1_000_000))
        guard reader.startReading() else { return nil }
        defer { reader.cancelReading() }
        var signals: AudioSignals?
        var channels = 0
        while let buffer = output.copyNextSampleBuffer() {
            if Task.isCancelled { throw cancelled() }
            if signals == nil {
                guard let format = CMSampleBufferGetFormatDescription(buffer),
                      let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(format)?.pointee,
                      asbd.mSampleRate > 0, asbd.mChannelsPerFrame > 0 else { return nil }
                channels = Int(asbd.mChannelsPerFrame)
                signals = AudioSignals(sampleRate: Int(asbd.mSampleRate.rounded()), timesUs: times)
            }
            guard let block = CMSampleBufferGetDataBuffer(buffer) else { continue }
            let length = CMBlockBufferGetDataLength(block)
            var samples = [Float](repeating: 0, count: length / MemoryLayout<Float>.size)
            let status = samples.withUnsafeMutableBytes { CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: length, destination: $0.baseAddress!) }
            guard status == kCMBlockBufferNoErr else { return nil }
            let s = signals!
            var i = 0
            while i + channels <= samples.count {
                let l = samples[i]
                s.add(l, channels >= 2 ? samples[i + 1] : l)
                i += channels
            }
        }
        // Undecodable audio: plan from faces alone, as the web does when decodeAudioData fails.
        if reader.status == .failed { return nil }
        return signals
    }
}
