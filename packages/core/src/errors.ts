export type CutivaErrorCode =
  | "ASSET_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "TRACK_NOT_FOUND"
  | "TRACK_KIND_MISMATCH"
  | "INVALID_RANGE"
  | "OVERLAP"
  | "INVALID_PROJECT"
  | "ASSET_SIZE_UNKNOWN"
  | "UNSUPPORTED_VERSION"
  | "UNSUPPORTED_CODEC"
  /** The engine on this platform can't render part of the project yet (for example, more than one video layer on Android). */
  | "UNSUPPORTED_FEATURE"
  /** The platform encoder or muxer failed during export. */
  | "EXPORT_FAILED"
  | "EXPORT_CANCELLED"
  | "ANALYSIS_CANCELLED"
  /** Analysis needs a video track and the asset has none (or its media isn't loaded with one). */
  | "NO_VIDEO_TRACK"
  /** A detection model couldn't be downloaded, failed its SHA-256 check, or didn't start. */
  | "MODEL_LOAD_FAILED"
  /** A reframe edit names a segment the clip's track doesn't have. */
  | "SEGMENT_NOT_FOUND"
  /** A reframe edit names a person the clip's track doesn't have. */
  | "PERSON_NOT_FOUND"
  | "NOTHING_TO_EXPORT";

/** Every error thrown by Cutiva carries a stable, machine-readable code. */
export class CutivaError extends Error {
  readonly code: CutivaErrorCode;
  constructor(code: CutivaErrorCode, message: string) {
    super(message);
    this.name = "CutivaError";
    this.code = code;
  }
}
