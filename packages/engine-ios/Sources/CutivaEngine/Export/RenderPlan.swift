import Foundation

/** A frame rate as a fraction, like 30000/1001. */
public struct Fps: Codable, Equatable, Sendable {
    public let num: Int
    public let den: Int
}

public struct PlanSettings: Codable, Equatable, Sendable {
    public let width: Int
    public let height: Int
    public let fps: Fps
    public let sampleRate: Int
}

/** One video clip on the timeline. All times are integer microseconds. */
public struct VideoSegment: Codable, Equatable, Sendable {
    /** Position among the video tracks: 0 is the bottom, higher layers draw on top. */
    public let layer: Int
    public let trackId: String
    public let clipId: String
    public let assetId: String
    public let uri: String
    /** Visible during `[startUs, endUs)` on the timeline. */
    public let startUs: Int64
    public let endUs: Int64
    public let sourceInUs: Int64
    public let sourceOutUs: Int64
    public let speed: Double
    /**
     * When the clip is reframed: crop keys by source time (`cropAt`, `layoutAt`), in the pixels of a
     * `sourceWidth` × `sourceHeight` source (display orientation). Without them the frame is letterboxed.
     */
    public let crop: [CropKey]?
    public let sourceWidth: Int?
    public let sourceHeight: Int?

    public init(
        layer: Int, trackId: String, clipId: String, assetId: String, uri: String, startUs: Int64, endUs: Int64,
        sourceInUs: Int64, sourceOutUs: Int64, speed: Double, crop: [CropKey]? = nil, sourceWidth: Int? = nil, sourceHeight: Int? = nil
    ) {
        self.layer = layer
        self.trackId = trackId
        self.clipId = clipId
        self.assetId = assetId
        self.uri = uri
        self.startUs = startUs
        self.endUs = endUs
        self.sourceInUs = sourceInUs
        self.sourceOutUs = sourceOutUs
        self.speed = speed
        self.crop = crop
        self.sourceWidth = sourceWidth
        self.sourceHeight = sourceHeight
    }
}

/** One piece of sound on the timeline. Fades are in timeline time. */
public struct AudioSegment: Codable, Equatable, Sendable {
    public let clipId: String
    public let assetId: String
    public let uri: String
    public let startUs: Int64
    public let endUs: Int64
    public let sourceInUs: Int64
    public let sourceOutUs: Int64
    public let speed: Double
    public let volume: Double
    public let fadeInUs: Int64
    public let fadeOutUs: Int64
}

/**
 * What plays where, as computed by `renderPlan(project)` in `@cutiva/core` or `cutiva_core` (ADR 0004).
 * The engine renders it as is and applies no edit rules of its own.
 */
public struct RenderPlan: Codable, Equatable, Sendable {
    public let durationUs: Int64
    public let settings: PlanSettings
    public let video: [VideoSegment]
    public let audio: [AudioSegment]

    /** Parse the JSON that `renderPlan` produces. Throws `CutivaError` with `INVALID_PROJECT`. */
    public static func fromJson(_ json: String) throws -> RenderPlan {
        do {
            return try JSONDecoder().decode(RenderPlan.self, from: Data(json.utf8))
        } catch let error as CutivaError {
            throw error
        } catch {
            throw CutivaError("INVALID_PROJECT", "Invalid render plan: \(error)")
        }
    }
}
