enum CutivaErrorCode {
  assetNotFound('ASSET_NOT_FOUND'),
  clipNotFound('CLIP_NOT_FOUND'),
  trackNotFound('TRACK_NOT_FOUND'),
  trackKindMismatch('TRACK_KIND_MISMATCH'),
  invalidRange('INVALID_RANGE'),
  overlap('OVERLAP'),
  invalidProject('INVALID_PROJECT'),
  unsupportedVersion('UNSUPPORTED_VERSION'),
  unsupportedCodec('UNSUPPORTED_CODEC'),
  exportCancelled('EXPORT_CANCELLED'),
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
