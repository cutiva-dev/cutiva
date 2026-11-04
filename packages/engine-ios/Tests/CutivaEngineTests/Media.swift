import AVFoundation
import CoreGraphics
import XCTest
@testable import CutivaEngine

/** Reading exported files back, for the export tests: frame times, pixels and decoded sound. */
enum Media {
    static func resource(_ name: String) -> URL {
        Bundle.module.url(forResource: name, withExtension: nil, subdirectory: "Resources")!
    }

    static func tempURL(_ prefix: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("\(prefix)-\(UUID().uuidString).mp4")
    }

    static func export(_ plan: RenderPlan, _ prefix: String = "out") async throws -> (ExportSummary, URL) {
        let url = tempURL(prefix)
        let summary = try await CutivaExporter().export(plan, to: url)
        return (summary, url)
    }

    /** Codec FourCCs of the first video and audio tracks, like "avc1" and "aac ". */
    static func codecs(_ url: URL) async throws -> (video: String, audio: String) {
        let asset = AVURLAsset(url: url)
        func fourCC(_ type: AVMediaType) async throws -> String {
            guard let track = try await asset.loadTracks(withMediaType: type).first,
                  let desc = try await track.load(.formatDescriptions).first else { return "none" }
            let code = CMFormatDescriptionGetMediaSubType(desc)
            return String(bytes: [24, 16, 8, 0].map { UInt8((code >> $0) & 0xff) }, encoding: .ascii) ?? "?"
        }
        return (try await fourCC(.video), try await fourCC(.audio))
    }

    /**
     * When every video frame is shown, in µs, sorted: the samples' media times mapped through the
     * track's edit list, as players do (H.264 with B-frames is stored with its first frame a little
     * after 0 and an edit list that shifts it back).
     */
    static func videoTimestampsUs(_ url: URL) async throws -> [Int64] {
        let asset = AVURLAsset(url: url)
        let track = try await asset.loadTracks(withMediaType: .video).first!
        let segments = try await track.load(.segments).filter { !$0.isEmpty }
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: nil)
        reader.add(output)
        reader.startReading()
        var times: [Int64] = []
        while let sample = output.copyNextSampleBuffer() {
            guard CMSampleBufferGetNumSamples(sample) > 0 else { continue }
            let media = CMSampleBufferGetPresentationTimeStamp(sample)
            guard let seg = segments.first(where: { $0.timeMapping.source.containsTime(media) }) else { continue }
            let shown = CMTimeAdd(seg.timeMapping.target.start, CMTimeSubtract(media, seg.timeMapping.source.start))
            times.append(Int64((shown.seconds * 1e6).rounded()))
        }
        return times.sorted()
    }

    /** The frame shown at `timeUs`, as RGBA bytes, upright. */
    struct Frame {
        let width: Int
        let height: Int
        let rgba: [UInt8]

        func pixel(_ x: Int, _ y: Int) -> (r: Int, g: Int, b: Int) {
            let i = (y * width + x) * 4
            return (Int(rgba[i]), Int(rgba[i + 1]), Int(rgba[i + 2]))
        }

        /** Average luma, 0–255. */
        var luma: Double {
            var sum = 0.0
            for i in stride(from: 0, to: rgba.count, by: 4) {
                sum += 0.299 * Double(rgba[i]) + 0.587 * Double(rgba[i + 1]) + 0.114 * Double(rgba[i + 2])
            }
            return sum / Double(width * height)
        }
    }

    static func frame(_ url: URL, _ timeUs: Int64) async throws -> Frame {
        let generator = AVAssetImageGenerator(asset: AVURLAsset(url: url))
        generator.appliesPreferredTrackTransform = true
        generator.requestedTimeToleranceBefore = .zero
        generator.requestedTimeToleranceAfter = .zero
        let image = try generator.copyCGImage(at: cmTime(timeUs), actualTime: nil)
        let w = image.width
        let h = image.height
        var bytes = [UInt8](repeating: 0, count: w * h * 4)
        // No colour management: the raw values, as the Android test reads them.
        let ctx = CGContext(data: &bytes, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                            space: image.colorSpace ?? CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return Frame(width: w, height: h, rgba: bytes)
    }

    /** The first channel of the audio track as 16-bit samples from time 0, and its sample rate. */
    static func firstChannel(_ url: URL) async throws -> (rate: Int, samples: [Int16]) {
        let asset = AVURLAsset(url: url)
        let track = try await asset.loadTracks(withMediaType: .audio).first!
        let desc = try await track.load(.formatDescriptions).first!
        let asbd = CMAudioFormatDescriptionGetStreamBasicDescription(desc)!.pointee
        let rate = Int(asbd.mSampleRate)
        let reader = try AVAssetReader(asset: asset)
        let output = AVAssetReaderTrackOutput(track: track, outputSettings: [
            AVFormatIDKey: kAudioFormatLinearPCM,
            AVLinearPCMBitDepthKey: 16,
            AVLinearPCMIsFloatKey: false,
            AVLinearPCMIsBigEndianKey: false,
            AVLinearPCMIsNonInterleaved: false,
        ])
        reader.add(output)
        reader.startReading()
        var samples: [Int16] = []
        while let sample = output.copyNextSampleBuffer() {
            guard let block = CMSampleBufferGetDataBuffer(sample) else { continue }
            let fmt = CMAudioFormatDescriptionGetStreamBasicDescription(CMSampleBufferGetFormatDescription(sample)!)!.pointee
            let channels = Int(fmt.mChannelsPerFrame)
            let start = Int((CMSampleBufferGetPresentationTimeStamp(sample).seconds * Double(rate)).rounded())
            var length = 0
            var pointer: UnsafeMutablePointer<CChar>?
            CMBlockBufferGetDataPointer(block, atOffset: 0, lengthAtOffsetOut: nil, totalLengthOut: &length, dataPointerOut: &pointer)
            let frames = length / 2 / channels
            if samples.count < start + frames { samples += [Int16](repeating: 0, count: start + frames - samples.count) }
            pointer!.withMemoryRebound(to: Int16.self, capacity: frames * channels) { p in
                for f in 0..<frames where start + f >= 0 { samples[start + f] = p[f * channels] }
            }
        }
        return (rate, samples)
    }

    /** Times where the sound gets loud after silence, in µs. */
    static func beepOnsetsUs(_ url: URL) async throws -> [Int64] {
        let (rate, samples) = try await firstChannel(url)
        var onsets: [Int64] = []
        var wasLoud = false
        for (i, s) in samples.enumerated() {
            let loud = abs(Int(s)) > 3000
            let t = Int64(i) * 1_000_000 / Int64(rate)
            if loud && !wasLoud && (onsets.isEmpty || t - onsets.last! > 200_000) { onsets.append(t) }
            wasLoud = loud
        }
        return onsets
    }

    /** The loudest sample of each beep, in order. */
    static func beepPeaks(_ url: URL) async throws -> [Double] {
        let (rate, samples) = try await firstChannel(url)
        return try await beepOnsetsUs(url).map { t in
            let from = Int(t * Int64(rate) / 1_000_000)
            return Double((from..<min(samples.count, from + rate / 20)).map { abs(Int(samples[$0])) }.max() ?? 0)
        }
    }
}
