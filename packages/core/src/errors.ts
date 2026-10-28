export type CutivaErrorCode =
  | "ASSET_NOT_FOUND"
  | "CLIP_NOT_FOUND"
  | "TRACK_NOT_FOUND"
  | "TRACK_KIND_MISMATCH"
  | "INVALID_RANGE"
  | "OVERLAP"
  | "INVALID_PROJECT"
  | "UNSUPPORTED_VERSION"
  | "UNSUPPORTED_CODEC"
  | "EXPORT_CANCELLED"
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
