import 'errors.dart';
import 'types.dart';

/// Effect type that holds a video clip's crop keys: `{type: 'core/reframe', params: {keys: [...]}}`.
const reframeEffect = 'core/reframe';

/// Where the crop window sits at one instant of the source. Integers only.
class ReframeKey {
  /// Source time of the asset (not timeline time), so split, trim and speed keep the framing.
  final Us atUs;

  /// Centre of the crop window, in source pixels.
  final int x;
  final int y;

  /// Height of the crop window in source pixels. Its width follows the project's aspect ratio.
  final int h;

  /// Jump to this key at [atUs] instead of gliding to it from the previous key.
  final bool cut;
  const ReframeKey({required this.atUs, required this.x, required this.y, required this.h, this.cut = false});

  Map<String, Object?> toJson() => {'atUs': atUs, 'x': x, 'y': y, 'h': h, if (cut) 'cut': true};
}

/// A rectangle of the source frame, in integer source pixels.
class CropRect {
  final int x;
  final int y;
  final int w;
  final int h;
  const CropRect(this.x, this.y, this.w, this.h);

  Map<String, Object?> toJson() => {'x': x, 'y': y, 'w': w, 'h': h};
}

/// A reframe key turned into a crop rectangle for one source size and one output aspect.
class CropKey {
  /// Source time of the asset.
  final Us atUs;
  final CropRect rect;

  /// Hold the previous rectangle until [atUs], then jump here.
  final bool cut;
  const CropKey(this.atUs, this.rect, {required this.cut});

  Map<String, Object?> toJson() => {'atUs': atUs, 'rect': rect.toJson(), 'cut': cut};
}

Never _bad(String message) => throw CutivaError(CutivaErrorCode.invalidRange, message);

int? _whole(Object? v, int min) => v is num && v.isFinite && v == v.truncate() && v >= min ? v.toInt() : null;

/// Check and copy a list of reframe keys: [ReframeKey]s or their JSON maps. Keys must be sorted by
/// strictly increasing `atUs`; every field is a non-negative integer and `h` is at least 1.
/// Throws `INVALID_RANGE`.
List<ReframeKey> normalizeReframeKeys(Object? input) {
  if (input is! List<Object?>) _bad('Reframe keys must be an array.');
  var last = -1;
  final out = <ReframeKey>[];
  for (var i = 0; i < input.length; i++) {
    final raw = input[i];
    final k = raw is ReframeKey ? raw.toJson() : raw;
    if (k is! Map<String, Object?>) _bad('Reframe key $i must be an object.');
    final atUs = _whole(k['atUs'], 0);
    final x = _whole(k['x'], 0);
    final y = _whole(k['y'], 0);
    final h = _whole(k['h'], 1);
    if (atUs == null || x == null || y == null || h == null) {
      _bad('Reframe key $i needs integer atUs, x, y >= 0 and h >= 1.');
    }
    if (atUs <= last) _bad('Reframe key $i must come after the previous key.');
    final cut = k['cut'];
    if (cut != null && cut is! bool) _bad('Reframe key $i: cut must be a boolean.');
    last = atUs;
    out.add(ReframeKey(atUs: atUs, x: x, y: y, h: h, cut: cut == true));
  }
  return out;
}

/// The clip's reframe keys, or null when it has none.
List<ReframeKey>? reframeKeys(Clip clip) {
  for (final e in clip.effects) {
    if (e.type != reframeEffect) continue;
    final keys = e.params['keys'];
    if (keys is! List<Object?> || keys.isEmpty) return null;
    return normalizeReframeKeys(keys);
  }
  return null;
}

/// a / b rounded down, for b > 0. Dart's `%` is never negative for a positive divisor.
int _floorDiv(int a, int b) => (a - a % b) ~/ b;

/// n / d rounded half up, for n >= 0 and d > 0.
int _divRound(int n, int d) => (2 * n + d) ~/ (2 * d);

int _clamp(int v, int lo, int hi) => v < lo ? lo : (v > hi ? hi : v);

/// The crop rectangle of one key. Its aspect is the output's (`outW:outH`); it is as tall as `key.h`
/// allows while fitting inside the source, and centred on `(x, y)` but pushed back inside the frame.
CropRect cropRect(ReframeKey key, int srcW, int srcH, int outW, int outH) {
  final maxH = srcH < (srcW * outH) ~/ outW ? srcH : (srcW * outH) ~/ outW;
  final h = _clamp(key.h, 1, maxH < 1 ? 1 : maxH);
  final w = _clamp(_divRound(h * outW, outH), 1, srcW);
  final x = _clamp(_floorDiv(2 * key.x - w + 1, 2), 0, srcW - w);
  final y = _clamp(_floorDiv(2 * key.y - h + 1, 2), 0, srcH - h);
  return CropRect(x, y, w, h);
}

/// Every key of a clip turned into rectangles, or null when the clip isn't reframed or the asset's size is unknown.
List<CropKey>? clipCropKeys(Clip clip, Asset asset, ProjectSettings settings) {
  final keys = reframeKeys(clip);
  final srcW = asset.width;
  final srcH = asset.height;
  if (keys == null || srcW == null || srcH == null || srcW == 0 || srcH == 0) return null;
  return [for (final k in keys) CropKey(k.atUs, cropRect(k, srcW, srcH, settings.width, settings.height), cut: k.cut)];
}

/// The crop rectangle at a source time. Before the first key it is the first key's; after the last,
/// the last key's. Between two keys the edges glide linearly (rounded half up), unless the later key
/// is a cut: then the earlier rectangle holds until the cut.
CropRect cropAt(List<CropKey> keys, Us sourceUs) {
  var i = -1;
  while (i + 1 < keys.length && keys[i + 1].atUs <= sourceUs) {
    i++;
  }
  if (i < 0) return keys[0].rect;
  final a = keys[i];
  if (i + 1 == keys.length || keys[i + 1].cut) return a.rect;
  final b = keys[i + 1];
  final dt = b.atUs - a.atUs;
  final u = sourceUs - a.atUs;
  final v = b.atUs - sourceUs;
  int lerp(int p, int q) => (2 * (p * v + q * u) + dt) ~/ (2 * dt);
  final x = lerp(a.rect.x, b.rect.x);
  final y = lerp(a.rect.y, b.rect.y);
  return CropRect(
    x,
    y,
    lerp(a.rect.x + a.rect.w, b.rect.x + b.rect.w) - x,
    lerp(a.rect.y + a.rect.h, b.rect.y + b.rect.h) - y,
  );
}

/// The keys that matter for source times in `[sourceInUs, sourceOutUs)`, so [cropAt] gives the same result there.
List<CropKey> cropKeysInRange(List<CropKey> keys, Us sourceInUs, Us sourceOutUs) {
  var from = 0;
  while (from + 1 < keys.length && keys[from + 1].atUs <= sourceInUs) {
    from++;
  }
  var to = from;
  while (to + 1 < keys.length && keys[to].atUs < sourceOutUs) {
    to++;
  }
  return keys.sublist(from, to + 1);
}
