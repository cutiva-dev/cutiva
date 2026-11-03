enum CutivaErrorCode {
  assetNotFound('ASSET_NOT_FOUND'),
  clipNotFound('CLIP_NOT_FOUND'),
  trackNotFound('TRACK_NOT_FOUND'),
  trackKindMismatch('TRACK_KIND_MISMATCH'),
  invalidRange('INVALID_RANGE'),
  overlap('OVERLAP'),
  invalidProject('INVALID_PROJECT'),
  assetSizeUnknown('ASSET_SIZE_UNKNOWN'),
  unsupportedVersion('UNSUPPORTED_VERSION'),
  unsupportedCodec('UNSUPPORTED_CODEC'),

  /// The engine on this platform can't render part of the project yet.
  unsupportedFeature('UNSUPPORTED_FEATURE'),

  /// The platform encoder or muxer failed during export.
  exportFailed('EXPORT_FAILED'),
  exportCancelled('EXPORT_CANCELLED'),
  analysisCancelled('ANALYSIS_CANCELLED'),

  /// Analysis needs a video track and the asset has none.
  noVideoTrack('NO_VIDEO_TRACK'),

  /// A detection model couldn't be downloaded, failed its SHA-256 check, or didn't start.
  modelLoadFailed('MODEL_LOAD_FAILED'),

  /// A reframe edit needs the clip's analysis (faces, speech) and it isn't cached: analyse again.
  analysisNeeded('ANALYSIS_NEEDED'),

  /// A reframe edit names a segment the clip's track doesn't have.
  segmentNotFound('SEGMENT_NOT_FOUND'),

  /// A reframe edit names a person the clip's track doesn't have.
  personNotFound('PERSON_NOT_FOUND'),
  nothingToExport('NOTHING_TO_EXPORT');

  /// The same string every Cutiva SDK uses for this error.
  final String value;
  const CutivaErrorCode(this.value);
}

/// Every error thrown by Cutiva carries a stable, machine-readable code.
class CutivaError implements Exception {
  final CutivaErrorCode code;
  final String message;
  const CutivaError(this.code, this.message);

  @override
  String toString() => 'CutivaError(${code.value}): $message';
}
