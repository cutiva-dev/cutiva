import AVFoundation
import Foundation

/** What an export produced, read from the finished file. */
public struct ExportSummary: Sendable {
    public let durationMs: Int64
    public let fileSizeBytes: Int64
    /** Display size of the video. */
    public let width: Int
    public let height: Int
}

/** Microseconds as a `CMTime`. */
func cmTime(_ us: Int64) -> CMTime { CMTime(value: us, timescale: 1_000_000) }

/** A plan URI (`file://` URL or plain path) as a file URL. */
func fileURL(_ uri: String) -> URL {
    if let url = URL(string: uri), url.scheme != nil { return url }
    return URL(fileURLWithPath: uri)
}

/**
 * Exports a `RenderPlan` to an MP4 (H.264 + AAC) with AVFoundation and the device's encoders.
 *
 * Supported today, as the Android engine: one video layer (gaps show black, plain clips are
 * letterboxed), reframed clips (single, split and wide crops, drawn as `@cutiva/web` draws them),
 * any number of audio segments mixed together, speed, volume and fades. Plans with more than one
 * video layer fail with `UNSUPPORTED_FEATURE`.
 */
public final class CutivaExporter {
    public init() {}

    /** Cancelling the calling Task stops the export and throws CutivaError("EXPORT_CANCELLED"). */
    public func export(_ plan: RenderPlan, to output: URL, onProgress: @escaping @Sendable (Double) -> Void = { _ in }) async throws -> ExportSummary {
        try Self.validate(plan)
        try Task.checkCancellation(or: CutivaError("EXPORT_CANCELLED", "Export was cancelled."))
        let built = try await Self.build(plan)
        try? FileManager.default.removeItem(at: output)
        guard let session = AVAssetExportSession(asset: built.composition, presetName: AVAssetExportPresetHighestQuality) else {
            throw CutivaError("EXPORT_FAILED", "AVFoundation can't export this composition.")
        }
        session.outputURL = output
        session.outputFileType = .mp4
        session.videoComposition = built.video
        session.audioMix = built.audio
        // Sped-up sound changes pitch, as `playbackRate` does in `@cutiva/web`; it also keeps onsets exact
        // (spectral and time-domain stretching moved beeps 5–40 ms, differently on each run).
        session.audioTimePitchAlgorithm = .varispeed
        session.timeRange = CMTimeRange(start: .zero, duration: cmTime(plan.durationUs))
        session.shouldOptimizeForNetworkUse = true

        let box = SessionBox(session)
        let poll = Task {
            while !Task.isCancelled {
                onProgress(Double(box.session.progress))
                try? await Task.sleep(nanoseconds: 100_000_000)
            }
        }
        defer { poll.cancel() }
        await withTaskCancellationHandler {
            await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
                box.session.exportAsynchronously { done.resume() }
            }
        } onCancel: {
            box.session.cancelExport()
        }
        switch session.status {
        case .completed:
            onProgress(1)
            return try await Self.summary(output)
        case .cancelled:
            throw CutivaError("EXPORT_CANCELLED", "Export was cancelled.")
        default:
            throw CutivaError("EXPORT_FAILED", "Export failed: \(session.error?.localizedDescription ?? "unknown error")")
        }
    }

    /** What the plan asks for that this engine can't draw yet, or can't draw at all. */
    static func validate(_ plan: RenderPlan) throws {
        if plan.durationUs <= 0 || plan.video.isEmpty { throw CutivaError("NOTHING_TO_EXPORT", "The project has no video to export.") }
        if plan.video.contains(where: { $0.layer != plan.video[0].layer }) {
            throw CutivaError("UNSUPPORTED_FEATURE", "The iOS engine exports one video layer for now; this project has several.")
        }
        if plan.video.contains(where: { $0.crop != nil && ($0.crop!.isEmpty || ($0.sourceWidth ?? 0) <= 0 || ($0.sourceHeight ?? 0) <= 0) }) {
            throw CutivaError("INVALID_PROJECT", "A reframed segment needs crop keys and its source size.")
        }
    }

    struct Built {
        let composition: AVMutableComposition
        let video: AVMutableVideoComposition
        let audio: AVMutableAudioMix
    }

    private final class SessionBox: @unchecked Sendable {
        let session: AVAssetExportSession
        init(_ session: AVAssetExportSession) { self.session = session }
    }

    private static func load(_ uri: String) async throws -> AVURLAsset {
        let url = fileURL(uri)
        if url.isFileURL && !FileManager.default.fileExists(atPath: url.path) {
            throw CutivaError("ASSET_NOT_FOUND", "Couldn't read \(uri): no such file.")
        }
        let asset = AVURLAsset(url: url, options: [AVURLAssetPreferPreciseDurationAndTimingKey: true])
        do {
            _ = try await asset.load(.tracks)
        } catch {
            throw CutivaError("ASSET_NOT_FOUND", "Couldn't read \(uri): \(error.localizedDescription)")
        }
        return asset
    }

    /**
     * The AVFoundation composition for `plan`: one video track whose instructions cover the whole
     * timeline (segments and black gaps), and one audio track per lane of non-overlapping sounds with
     * volume ramps for volume and fades.
     */
    static func build(_ plan: RenderPlan) async throws -> Built {
        let composition = AVMutableComposition()
        let (width, height) = evenSize(plan.settings.width, plan.settings.height)
        let size = CGSize(width: width, height: height)
        var assets: [String: AVURLAsset] = [:]
        func asset(_ uri: String) async throws -> AVURLAsset {
            if let a = assets[uri] { return a }
            let a = try await load(uri)
            assets[uri] = a
            return a
        }

        guard let videoTrack = composition.addMutableTrack(withMediaType: .video, preferredTrackID: kCMPersistentTrackID_Invalid) else {
            throw CutivaError("EXPORT_FAILED", "Couldn't create a video track.")
        }
        var instructions: [CutivaInstruction] = []
        var cursor: Int64 = 0
        func gap(until end: Int64) {
            guard end > cursor else { return }
            let range = CMTimeRange(start: cmTime(cursor), end: cmTime(end))
            videoTrack.insertEmptyTimeRange(range)
            instructions.append(CutivaInstruction(timeRange: range, segment: nil, trackID: videoTrack.trackID, transform: .identity, outputSize: size))
            cursor = end
        }
        for segment in plan.video.sorted(by: { $0.startUs < $1.startUs }) {
            gap(until: segment.startUs)
            let source = try await asset(segment.uri)
            guard let track = try await source.loadTracks(withMediaType: .video).first else {
                throw CutivaError("NO_VIDEO_TRACK", "\(segment.uri) has no video track.")
            }
            let transform = try await track.load(.preferredTransform)
            let at = cmTime(segment.startUs)
            let sourceRange = CMTimeRange(start: cmTime(segment.sourceInUs), end: cmTime(segment.sourceOutUs))
            do {
                try videoTrack.insertTimeRange(sourceRange, of: track, at: at)
            } catch {
                throw CutivaError("EXPORT_FAILED", "Couldn't place \(segment.clipId): \(error.localizedDescription)")
            }
            let range = CMTimeRange(start: at, end: cmTime(segment.endUs))
            if sourceRange.duration != range.duration {
                videoTrack.scaleTimeRange(CMTimeRange(start: at, duration: sourceRange.duration), toDuration: range.duration)
            }
            instructions.append(CutivaInstruction(timeRange: range, segment: segment, trackID: videoTrack.trackID, transform: transform, outputSize: size))
            cursor = segment.endUs
        }
        gap(until: plan.durationUs)

        let mix = AVMutableAudioMix()
        var parameters: [AVMutableAudioMixInputParameters] = []
        for lane in audioLanes(plan.audio) {
            var placed: [(AudioSegment, CMTimeRange)] = []
            var track: AVMutableCompositionTrack?
            for segment in lane {
                let source = try await asset(segment.uri)
                // A sound from a file without audio has nothing to play.
                guard let sourceTrack = try await source.loadTracks(withMediaType: .audio).first else { continue }
                if track == nil { track = composition.addMutableTrack(withMediaType: .audio, preferredTrackID: kCMPersistentTrackID_Invalid) }
                guard let track else { throw CutivaError("EXPORT_FAILED", "Couldn't create an audio track.") }
                let at = cmTime(segment.startUs)
                let sourceRange = CMTimeRange(start: cmTime(segment.sourceInUs), end: cmTime(segment.sourceOutUs))
                do {
                    try track.insertTimeRange(sourceRange, of: sourceTrack, at: at)
                } catch {
                    throw CutivaError("EXPORT_FAILED", "Couldn't place \(segment.clipId): \(error.localizedDescription)")
                }
                let range = CMTimeRange(start: at, end: cmTime(segment.endUs))
                if sourceRange.duration != range.duration {
                    track.scaleTimeRange(CMTimeRange(start: at, duration: sourceRange.duration), toDuration: range.duration)
                }
                placed.append((segment, range))
            }
            guard let track else { continue }
            let p = AVMutableAudioMixInputParameters(track: track)
            for (segment, _) in placed { addRamps(p, segment) }
            parameters.append(p)
        }
        mix.inputParameters = parameters

        let video = AVMutableVideoComposition()
        video.customVideoCompositorClass = CutivaCompositor.self
        video.renderSize = size
        video.frameDuration = CMTime(value: CMTimeValue(plan.settings.fps.den), timescale: CMTimeScale(plan.settings.fps.num))
        video.instructions = instructions
        return Built(composition: composition, video: video, audio: mix)
    }

    /**
     * Volume and fades as linear ramps, exactly `gainAt`: one ramp per stretch between the segment's
     * start, the end of its fade in, the start of its fade out and its end. Where the fades overlap
     * the gain is their product, so that stretch is split into short ramps.
     */
    static func addRamps(_ p: AVMutableAudioMixInputParameters, _ s: AudioSegment) {
        let d = s.endUs - s.startUs
        guard d > 0 else { return }
        func gain(_ t: Int64) -> Float { Float(gainAt(t, durationUs: d, volume: s.volume, fadeInUs: s.fadeInUs, fadeOutUs: s.fadeOutUs)) }
        var points = Set<Int64>([0, d])
        if s.fadeInUs > 0 && s.fadeInUs < d { points.insert(s.fadeInUs) }
        if s.fadeOutUs > 0 && d - s.fadeOutUs > 0 { points.insert(d - s.fadeOutUs) }
        let sorted = points.sorted()
        var stops: [Int64] = []
        for (a, b) in zip(sorted, sorted.dropFirst()) {
            let overlap = a < s.fadeInUs && b > d - s.fadeOutUs && s.fadeInUs > 0 && s.fadeOutUs > 0
            let pieces: Int64 = overlap ? 16 : 1
            for k in 0..<pieces { stops.append(a + (b - a) * k / pieces) }
        }
        stops.append(d)
        if stops.count == 2 && gain(0) == gain(d) {
            p.setVolume(gain(0), at: cmTime(s.startUs))
            return
        }
        for (a, b) in zip(stops, stops.dropFirst()) {
            p.setVolumeRamp(fromStartVolume: gain(a), toEndVolume: gain(b), timeRange: CMTimeRange(start: cmTime(s.startUs + a), end: cmTime(s.startUs + b)))
        }
    }

    private static func summary(_ url: URL) async throws -> ExportSummary {
        let asset = AVURLAsset(url: url)
        let duration = try await asset.load(.duration)
        var width = 0
        var height = 0
        if let track = try await asset.loadTracks(withMediaType: .video).first {
            let (natural, transform) = try await track.load(.naturalSize, .preferredTransform)
            let shown = natural.applying(transform)
            width = Int(abs(shown.width).rounded())
            height = Int(abs(shown.height).rounded())
        }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value ?? 0
        return ExportSummary(durationMs: Int64((duration.seconds * 1000).rounded()), fileSizeBytes: bytes, width: width, height: height)
    }
}

private extension Task where Success == Never, Failure == Never {
    static func checkCancellation(or error: CutivaError) throws {
        if Task.isCancelled { throw error }
    }
}
