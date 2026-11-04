import Foundation

/**
 * Every error thrown by the engine carries a stable `code`, the same strings as the other Cutiva
 * SDKs: `NOTHING_TO_EXPORT`, `UNSUPPORTED_FEATURE`, `EXPORT_CANCELLED`, `EXPORT_FAILED`,
 * `INVALID_PROJECT`, `ASSET_NOT_FOUND`, `NO_VIDEO_TRACK`, `MODEL_LOAD_FAILED`, `ANALYSIS_CANCELLED`.
 */
public struct CutivaError: Error, LocalizedError, Equatable {
    public let code: String
    public let message: String

    public init(_ code: String, _ message: String) {
        self.code = code
        self.message = message
    }

    public var errorDescription: String? { message }
}
