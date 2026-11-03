import 'errors.dart';
import 'types.dart';

/// Effect type that holds a video clip's crop keys: `{type: 'core/reframe', params: {keys: [...]}}`.
const reframeEffect = 'core/reframe';

/// A crop window: centre and height in source pixels; the width follows the output's aspect.
class ReframeWindow {
  final int x;
  final int y;
  final int h;
  const ReframeWindow({required this.x, required this.y, required this.h});

  Map<String, Object?> toJson() => {'x': x, 'y': y, 'h': h};
}

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

  /// Null: one window at (x, y, h). `split`: two [regions], each filling half the output. `wide`:
  /// the whole active area over a blurred fill. Renderers that don't draw layouts show (x, y, h).
  final String? layout;

  /// The two windows of a `split` key, each with the aspect of half the output.
  final List<ReframeWindow>? regions;
  const ReframeKey({
    required this.atUs,
    required this.x,
    required this.y,
    required this.h,
    this.cut = false,
    this.layout,
    this.regions,
  });

  Map<String, Object?> toJson() => {
    'atUs': atUs,
    'x': x,
    'y': y,
    'h': h,
    if (cut) 'cut': true,
    if (layout != null) 'layout': layout,
    if (regions != null) 'regions': [for (final r in regions!) r.toJson()],
  };
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

ReframeWindow _window(Object? input, String what) {
  final w = input is ReframeWindow ? input.toJson() : input;
  final x = w is Map<String, Object?> ? _whole(w['x'], 0) : null;
  final y = w is Map<String, Object?> ? _whole(w['y'], 0) : null;
  final h = w is Map<String, Object?> ? _whole(w['h'], 1) : null;
  if (x == null || y == null || h == null) _bad('$what needs integer x, y >= 0 and h >= 1.');
  return ReframeWindow(x: x, y: y, h: h);
}

/// Check and copy a list of reframe keys: [ReframeKey]s or their JSON maps. Keys must be sorted by
/// strictly increasing `atUs`; every field is a non-negative integer and `h` is at least 1. A `split`
/// key needs exactly two regions; no other key may have any. Throws `INVALID_RANGE`.
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
    final layout = k['layout'];
    if (layout != null && layout != 'split' && layout != 'wide') {
      _bad('Reframe key $i: layout must be "split" or "wide".');
    }
    final split = layout == 'split';
    final regions = k['regions'];
    if (split != (regions != null)) _bad('Reframe key $i: regions go with the split layout, and only with it.');
    if (split && (regions is! List<Object?> || regions.length != 2)) _bad('Reframe key $i: a split needs two regions.');
    last = atUs;
    out.add(
      ReframeKey(
        atUs: atUs,
        x: x,
        y: y,
        h: h,
        cut: cut == true,
        layout: layout as String?,
        regions:
            split
                ? [
                  _window((regions as List<Object?>)[0], 'Reframe key $i region 0'),
                  _window(regions[1], 'Reframe key $i region 1'),
                ]
                : null,
      ),
    );
  }
  return out;
}

/// Someone in a reframed clip. Ids, labels and flags only: never embeddings, images or audio.
class TrackPerson {
  /// `p1`, `p2`, ... in order of first appearance.
  String id;
  String label;

  /// `face`, or `voice` (heard with no face on screen).
  String kind;
  bool priority;
  bool neverFocus;

  /// Ids of detected people the user merged into this one.
  List<String>? merged;
  TrackPerson({
    required this.id,
    required this.label,
    required this.kind,
    required this.priority,
    required this.neverFocus,
    this.merged,
  });

  TrackPerson copy() => TrackPerson(
    id: id,
    label: label,
    kind: kind,
    priority: priority,
    neverFocus: neverFocus,
    merged: merged == null ? null : [...merged!],
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'label': label,
    'kind': kind,
    'priority': priority,
    'neverFocus': neverFocus,
    if (merged != null) 'merged': [...merged!],
  };
}

/// A stretch of source time framed one way.
class TrackSegment {
  String id;

  /// Source time, `[startUs, endUs)`.
  Us startUs;
  Us endUs;
  List<String> speakers;

  /// What the user asked for: `auto`, `single`, `split` or `wide`.
  String layout;
  List<String> focus;

  /// What the planner drew: `single`, `split` or `wide`.
  String resolved;
  bool locked;
  String reason;

  /// A window dragged by hand; only on locked segments.
  ReframeWindow? window;
  TrackSegment({
    required this.id,
    required this.startUs,
    required this.endUs,
    required this.speakers,
    required this.layout,
    required this.focus,
    required this.resolved,
    required this.locked,
    required this.reason,
    this.window,
  });

  TrackSegment copy() => TrackSegment(
    id: id,
    startUs: startUs,
    endUs: endUs,
    speakers: [...speakers],
    layout: layout,
    focus: [...focus],
    resolved: resolved,
    locked: locked,
    reason: reason,
    window: window,
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'startUs': startUs,
    'endUs': endUs,
    'speakers': [...speakers],
    'layout': layout,
    'focus': [...focus],
    'resolved': resolved,
    'locked': locked,
    'reason': reason,
    if (window != null) 'window': window!.toJson(),
  };
}

/// Automatic framing of a clip (ADR 0006), stored next to the keys in the `core/reframe` effect.
class ReframeTrack {
  final int version = 1;

  /// Camera style: 0 calm, 50 balanced, 100 dynamic.
  int style;

  /// Largest upscale a crop may need before the segment goes wide, in percent.
  int maxUpscalePct;

  /// Extra zoom of single windows, in percent (100 = the full height of the active area).
  int zoomPct;
  final String safeZone = 'none';

  /// The picture inside burned-in bars, in source pixels. Null: the whole frame.
  CropRect? activeArea;
  List<TrackPerson> people;
  List<TrackSegment> segments;
  ReframeTrack({
    this.style = 50,
    this.maxUpscalePct = 200,
    this.zoomPct = 100,
    this.activeArea,
    List<TrackPerson>? people,
    List<TrackSegment>? segments,
  }) : people = people ?? [],
       segments = segments ?? [];

  ReframeTrack copy() => ReframeTrack(
    style: style,
    maxUpscalePct: maxUpscalePct,
    zoomPct: zoomPct,
    activeArea: activeArea,
    people: [for (final p in people) p.copy()],
    segments: [for (final s in segments) s.copy()],
  );

  Map<String, Object?> toJson() => {
    'version': version,
    'style': style,
    'maxUpscalePct': maxUpscalePct,
    'zoomPct': zoomPct,
    'safeZone': safeZone,
    if (activeArea != null) 'activeArea': activeArea!.toJson(),
    'people': [for (final p in people) p.toJson()],
    'segments': [for (final s in segments) s.toJson()],
  };
}

final _personId = RegExp(r'^p[0-9]+$');
final _segmentId = RegExp(r'^s[0-9]+$');
const _layouts = ['auto', 'single', 'split', 'wide'];
const _resolved = ['single', 'split', 'wide'];
const _reasons = ['lips+voice', 'overlap', 'no-face', 'voice-only', 'never-focus', 'low-quality', 'user'];

/// Check and copy a Reframe Track ([ReframeTrack] or its JSON map), plus the rules a schema can't
/// express: unique ids, segments sorted and not overlapping, every person a segment or a merge names
/// exists, `window` only on locked segments. Throws `INVALID_RANGE`.
ReframeTrack normalizeReframeTrack(Object? input) {
  Never bad(String what) => _bad('Reframe track: $what.');
  final t = input is ReframeTrack ? input.toJson() : input;
  if (t is! Map<String, Object?>) bad('must be an object');
  if (t['version'] != 1) bad('version must be 1');
  final style = _whole(t['style'], 0);
  if (style == null || style > 100) bad('style must be an integer from 0 to 100');
  final maxUpscalePct = _whole(t['maxUpscalePct'], 100);
  if (maxUpscalePct == null) bad('maxUpscalePct must be an integer of at least 100');
  final zoomPct = _whole(t['zoomPct'], 100);
  if (zoomPct == null || zoomPct > 1000) bad('zoomPct must be an integer from 100 to 1000');
  if (t['safeZone'] != 'none') bad('safeZone must be "none"');
  CropRect? activeArea;
  if (t.containsKey('activeArea')) {
    final a = t['activeArea'];
    final x = a is Map<String, Object?> ? _whole(a['x'], 0) : null;
    final y = a is Map<String, Object?> ? _whole(a['y'], 0) : null;
    final w = a is Map<String, Object?> ? _whole(a['w'], 1) : null;
    final h = a is Map<String, Object?> ? _whole(a['h'], 1) : null;
    if (x == null || y == null || w == null || h == null) bad('activeArea needs integer x, y >= 0 and w, h >= 1');
    activeArea = CropRect(x, y, w, h);
  }
  final rawPeople = t['people'];
  final rawSegments = t['segments'];
  if (rawPeople is! List<Object?>) bad('people must be an array');
  if (rawSegments is! List<Object?>) bad('segments must be an array');

  final ids = <String>{};
  final people = <TrackPerson>[];
  for (var i = 0; i < rawPeople.length; i++) {
    final p = rawPeople[i];
    if (p is! Map<String, Object?>) bad('person $i must be an object');
    final id = p['id'];
    if (id is! String || !_personId.hasMatch(id) || ids.contains(id)) bad('person $i needs a unique id like "p1"');
    final label = p['label'];
    if (label is! String || label.isEmpty || label.length > 60) bad('person $i needs a label of 1 to 60 characters');
    final kind = p['kind'];
    if (kind != 'face' && kind != 'voice') bad('person $i: kind must be "face" or "voice"');
    final priority = p['priority'];
    final neverFocus = p['neverFocus'];
    if (priority is! bool || neverFocus is! bool) bad('person $i needs boolean priority and neverFocus');
    ids.add(id);
    people.add(
      TrackPerson(
        id: id,
        label: label,
        kind: kind as String,
        priority: priority,
        neverFocus: neverFocus,
        merged: p.containsKey('merged') ? <String>[] : null,
      ),
    );
  }
  final mergedAll = <String>[];
  for (var i = 0; i < people.length; i++) {
    if (people[i].merged == null) continue;
    final m = (rawPeople[i] as Map<String, Object?>)['merged'];
    if (m is! List<Object?> || m.any((x) => x is! String || !_personId.hasMatch(x) || ids.contains(x))) {
      bad('person $i: merged must list ids of people no longer in the track');
    }
    people[i].merged = m.cast<String>().toList();
    mergedAll.addAll(people[i].merged!);
  }
  if (mergedAll.toSet().length != mergedAll.length) bad('a person can be merged only once');

  List<String> known(Object? list, String what) {
    if (list is! List<Object?> ||
        list.any((x) => x is! String || !ids.contains(x)) ||
        list.toSet().length != list.length) {
      bad('$what must list distinct people of the track');
    }
    return list.cast<String>().toList();
  }

  final segIds = <String>{};
  var end = 0;
  final segments = <TrackSegment>[];
  for (var i = 0; i < rawSegments.length; i++) {
    final s = rawSegments[i];
    if (s is! Map<String, Object?>) bad('segment $i must be an object');
    final id = s['id'];
    if (id is! String || !_segmentId.hasMatch(id) || segIds.contains(id)) bad('segment $i needs a unique id like "s1"');
    final startUs = _whole(s['startUs'], 0);
    final endUs = _whole(s['endUs'], 1);
    if (startUs == null || endUs == null || endUs <= startUs) bad('segment $i needs integer startUs < endUs');
    if (startUs < end) bad('segment $i must start after the previous one ends');
    final layout = s['layout'];
    final resolved = s['resolved'];
    final reason = s['reason'];
    final locked = s['locked'];
    if (!_layouts.contains(layout)) bad('segment $i: unknown layout');
    if (!_resolved.contains(resolved)) bad('segment $i: unknown resolved layout');
    if (!_reasons.contains(reason)) bad('segment $i: unknown reason');
    if (locked is! bool) bad('segment $i: locked must be a boolean');
    final focus = known(s['focus'], 'segment $i focus');
    if (focus.length > 2) bad('segment $i: focus names at most two people');
    if (s.containsKey('window') && !locked) bad('segment $i: only locked segments have a window');
    segIds.add(id);
    end = endUs;
    segments.add(
      TrackSegment(
        id: id,
        startUs: startUs,
        endUs: endUs,
        speakers: known(s['speakers'], 'segment $i speakers'),
        layout: layout as String,
        focus: focus,
        resolved: resolved as String,
        locked: locked,
        reason: reason as String,
        window: s.containsKey('window') ? _window(s['window'], 'Reframe track segment $i window') : null,
      ),
    );
  }
  return ReframeTrack(
    style: style,
    maxUpscalePct: maxUpscalePct,
    zoomPct: zoomPct,
    activeArea: activeArea,
    people: people,
    segments: segments,
  );
}

/// The checked params of a `core/reframe` effect.
typedef ReframeParams = ({List<ReframeKey> keys, ReframeTrack? track});

/// Check and copy the params of a `core/reframe` effect: `keys`, and `track` when present. With the
/// asset's size, the track's active area must lie inside the frame. Throws `INVALID_RANGE`.
ReframeParams normalizeReframeParams(Map<String, Object?> params, {int? width, int? height}) {
  final keys = normalizeReframeKeys(params['keys']);
  if (!params.containsKey('track') || params['track'] == null) return (keys: keys, track: null);
  final track = normalizeReframeTrack(params['track']);
  final a = track.activeArea;
  if (a != null &&
      width != null &&
      height != null &&
      width > 0 &&
      height > 0 &&
      (a.x + a.w > width || a.y + a.h > height)) {
    _bad('Reframe track: activeArea must lie inside the source frame.');
  }
  return (keys: keys, track: track);
}

/// The params map of a `core/reframe` effect.
Map<String, Object?> reframeParamsJson(ReframeParams p) => {
  'keys': [for (final k in p.keys) k.toJson()],
  if (p.track != null) 'track': p.track!.toJson(),
};

/// The clip's Reframe Track, or null when it is framed by hand only.
ReframeTrack? reframeTrack(Clip clip) {
  for (final e in clip.effects) {
    if (e.type != reframeEffect) continue;
    final t = e.params['track'];
    return t == null ? null : normalizeReframeTrack(t);
  }
  return null;
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
/// With an [area] (the active area, inside burned-in bars), it fits and stays inside that instead.
CropRect cropRect(ReframeKey key, int srcW, int srcH, int outW, int outH, {CropRect? area}) {
  final a = area ?? CropRect(0, 0, srcW, srcH);
  final fit = (a.w * outH) ~/ outW;
  final maxH = a.h < fit ? a.h : fit;
  final h = _clamp(key.h, 1, maxH < 1 ? 1 : maxH);
  final w = _clamp(_divRound(h * outW, outH), 1, a.w);
  final x = _clamp(_floorDiv(2 * key.x - w + 1, 2), a.x, a.x + a.w - w);
  final y = _clamp(_floorDiv(2 * key.y - h + 1, 2), a.y, a.y + a.h - h);
  return CropRect(x, y, w, h);
}

/// Every key of a clip turned into rectangles, or null when the clip isn't reframed or the asset's size is unknown.
List<CropKey>? clipCropKeys(Clip clip, Asset asset, ProjectSettings settings) {
  final keys = reframeKeys(clip);
  final srcW = asset.width;
  final srcH = asset.height;
  if (keys == null || srcW == null || srcH == null || srcW == 0 || srcH == 0) return null;
  final area = reframeTrack(clip)?.activeArea;
  return [
    for (final k in keys)
      CropKey(k.atUs, cropRect(k, srcW, srcH, settings.width, settings.height, area: area), cut: k.cut),
  ];
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
