import 'dart:math' as math;

import 'errors.dart';
import 'reframe.dart';
import 'time.dart';
import 'types.dart';

/// A face seen in one analysed frame, in source pixels.
class FaceObservation {
  final double x;
  final double y;
  final double w;
  final double h;

  /// How open the mouth is, from 0 (closed) to 1 (wide open).
  final double mouth;
  const FaceObservation({required this.x, required this.y, required this.w, required this.h, required this.mouth});

  factory FaceObservation.fromJson(Map<String, Object?> json) => FaceObservation(
    x: (json['x'] as num).toDouble(),
    y: (json['y'] as num).toDouble(),
    w: (json['w'] as num).toDouble(),
    h: (json['h'] as num).toDouble(),
    mouth: (json['mouth'] as num).toDouble(),
  );

  Map<String, Object?> toJson() => {
    'x': jsonNumber(x),
    'y': jsonNumber(y),
    'w': jsonNumber(w),
    'h': jsonNumber(h),
    'mouth': jsonNumber(mouth),
  };
}

/// What a detector saw at one source time.
class FrameObservation {
  final Us atUs;
  final List<FaceObservation> faces;

  /// Loudness of speech around this frame, 0 to 1. Below 0.1 counts as silence. Null when unknown.
  final double? voice;
  const FrameObservation({required this.atUs, required this.faces, this.voice});

  factory FrameObservation.fromJson(Map<String, Object?> json) => FrameObservation(
    atUs: (json['atUs'] as num).toInt(),
    faces: [for (final f in json['faces'] as List<Object?>) FaceObservation.fromJson(f as Map<String, Object?>)],
    voice: (json['voice'] as num?)?.toDouble(),
  );
}

/// One person found by [autoReframe].
class ReframePerson {
  /// `s<shot>p<n>`; the same person in two shots gets two ids.
  final String id;
  final int shot;

  /// Time framed as the speaker. Zero means they never got the frame.
  final Us speakingUs;

  /// Their largest sighting, for an avatar.
  final FaceObservation face;
  final Us faceAtUs;
  const ReframePerson({
    required this.id,
    required this.shot,
    required this.speakingUs,
    required this.face,
    required this.faceAtUs,
  });

  Map<String, Object?> toJson() => {
    'id': id,
    'shot': shot,
    'speakingUs': speakingUs,
    'face': {...face.toJson(), 'atUs': faceAtUs},
  };
}

class AutoReframeResult {
  final List<ReframeKey> keys;
  final List<ReframePerson> people;

  /// Start time of each shot: 0, then every cut.
  final List<Us> shotStartsUs;
  const AutoReframeResult({required this.keys, required this.people, required this.shotStartsUs});

  Map<String, Object?> toJson() => {
    'keys': [for (final k in keys) k.toJson()],
    'people': [for (final p in people) p.toJson()],
    'shotStartsUs': shotStartsUs,
  };
}

/// A face matches a track when their centres are closer than this share of the larger face width.
const _matchDistance = 0.75;

/// Tracks seen in fewer than this share of a shot's frames are dropped as noise.
const _minTrackShare = 0.2;

/// Mouth movement is averaged over this many µs on each side of a frame.
const _activityWindowUs = 400000;

/// Lowest averaged mouth movement that counts as talking.
const _speakingThreshold = 0.02;
const _silence = 0.1;

/// Face positions are averaged over this many µs on each side of a frame.
const _smoothWindowUs = 500000;

/// The window follows a face only after it moves more than this share of the window's size.
const _deadzone = 0.05;

/// The face's centre sits this share of the window height above the window's centre.
const _headroom = 0.15;

class _Track {
  /// Observation by frame index within the shot.
  final Map<int, FaceObservation> seen;
  FaceObservation last;
  _Track(this.seen, this.last);
}

double _cx(FaceObservation f) => f.x + f.w / 2;
double _cy(FaceObservation f) => f.y + f.h / 2;

void _check(bool ok, String message) {
  if (!ok) throw CutivaError(CutivaErrorCode.invalidRange, message);
}

/// Follow faces from frame to frame by nearest centre. Faces are matched closest pair first.
List<_Track> _trackFaces(List<FrameObservation> frames) {
  final tracks = <_Track>[];
  for (var fi = 0; fi < frames.length; fi++) {
    final faces = frames[fi].faces;
    final pairs = <(double, int, int)>[];
    for (var j = 0; j < faces.length; j++) {
      for (var k = 0; k < tracks.length; k++) {
        // Squared distances: no square root, so every language gets the same bits.
        final dx = _cx(faces[j]) - _cx(tracks[k].last);
        final dy = _cy(faces[j]) - _cy(tracks[k].last);
        final limit = _matchDistance * math.max(faces[j].w, tracks[k].last.w);
        if (dx * dx + dy * dy < limit * limit) pairs.add((dx * dx + dy * dy, j, k));
      }
    }
    pairs.sort((a, b) {
      final byDistance = a.$1.compareTo(b.$1);
      if (byDistance != 0) return byDistance;
      return a.$2 != b.$2 ? a.$2 - b.$2 : a.$3 - b.$3;
    });
    final usedFace = <int>{};
    final usedTrack = <int>{};
    for (final (_, j, k) in pairs) {
      if (usedFace.contains(j) || usedTrack.contains(k)) continue;
      usedFace.add(j);
      usedTrack.add(k);
      tracks[k].seen[fi] = faces[j];
      tracks[k].last = faces[j];
    }
    for (var j = 0; j < faces.length; j++) {
      if (!usedFace.contains(j)) tracks.add(_Track({fi: faces[j]}, faces[j]));
    }
  }
  final min = math.max(2, (_minTrackShare * frames.length).ceil());
  final kept = tracks.where((t) => t.seen.length >= min).toList();
  if (kept.isNotEmpty || tracks.isEmpty) return kept;
  return [tracks.reduce((best, t) => t.seen.length > best.seen.length ? t : best)];
}

/// Indexes of the frames within [windowUs] of frame [fi], in order.
List<int> _windowOf(List<FrameObservation> frames, int fi, Us windowUs) {
  final t = frames[fi].atUs;
  var from = fi;
  while (from - 1 >= 0 && t - frames[from - 1].atUs <= windowUs) {
    from--;
  }
  var to = fi;
  while (to + 1 < frames.length && frames[to + 1].atUs - t <= windowUs) {
    to++;
  }
  return [for (var g = from; g <= to; g++) g];
}

/// Who talks in each frame: the track whose mouth moves most, or null when nobody does.
List<int?> _speakers(List<FrameObservation> frames, List<_Track> tracks) {
  final motion = [
    for (final t in tracks)
      [
        for (var fi = 0; fi < frames.length; fi++)
          if (t.seen[fi] != null && t.seen[fi - 1] != null) (t.seen[fi]!.mouth - t.seen[fi - 1]!.mouth).abs() else 0.0,
      ],
  ];
  return [for (var fi = 0; fi < frames.length; fi++) _speakerAt(frames, fi, motion)];
}

int? _speakerAt(List<FrameObservation> frames, int fi, List<List<double>> motion) {
  final voice = frames[fi].voice;
  if (voice != null && voice < _silence) return null;
  final win = _windowOf(frames, fi, _activityWindowUs);
  int? best;
  var bestActivity = _speakingThreshold;
  for (var k = 0; k < motion.length; k++) {
    var sum = 0.0;
    for (final g in win) {
      sum += motion[k][g];
    }
    final activity = sum / win.length;
    if (activity > bestActivity || (best == null && activity == bestActivity)) {
      best = k;
      bestActivity = activity;
    }
  }
  return best;
}

class _Run {
  int track;

  /// First frame index.
  final int from;
  final Us startUs;
  _Run(this.track, this.from, this.startUs);
}

/// Turn per-frame speakers into runs and fold runs shorter than [minHoldUs] into a neighbour.
List<_Run> _holdRuns(List<FrameObservation> frames, List<int> who, Us startUs, Us endUs, Us minHoldUs) {
  var runs = <_Run>[];
  for (var fi = 0; fi < who.length; fi++) {
    if (runs.isEmpty || runs.last.track != who[fi]) {
      runs.add(_Run(who[fi], fi, runs.isEmpty ? startUs : frames[fi].atUs));
    }
  }
  Us lengthOf(int i) => (i + 1 < runs.length ? runs[i + 1].startUs : endUs) - runs[i].startUs;
  while (runs.length > 1) {
    var shortest = -1;
    for (var i = 0; i < runs.length; i++) {
      if (lengthOf(i) < minHoldUs && (shortest < 0 || lengthOf(i) < lengthOf(shortest))) shortest = i;
    }
    if (shortest < 0) break;
    runs[shortest].track = runs[shortest > 0 ? shortest - 1 : 1].track;
    final merged = <_Run>[];
    for (var i = 0; i < runs.length; i++) {
      if (i == 0 || runs[i].track != runs[i - 1].track) merged.add(runs[i]);
    }
    runs = merged;
  }
  return runs;
}

/// Plan crop keys that keep whoever is talking in frame. Pure and deterministic: every SDK gives the
/// same keys for the same observations. Detecting faces and mouth movement is the engine's job.
///
/// Per shot: faces are tracked by position, the speaker is the person whose mouth moves most, a
/// speaker holds the frame for at least [minHoldUs], and each speaker change is a cut. While one
/// person speaks the window follows them smoothly once they move past a small dead zone.
///
/// [outputWidth] and [outputHeight] only set the aspect ratio. [zoom] 1 uses the full source height;
/// 2 shows half of it. [cuts] are source times where the camera changes (see [detectCuts]).
AutoReframeResult autoReframe({
  required int sourceWidth,
  required int sourceHeight,
  required int outputWidth,
  required int outputHeight,
  required Us durationUs,
  required List<FrameObservation> frames,
  List<Us> cuts = const [],
  double zoom = 1,
  Us minHoldUs = 1500000,
}) {
  for (final v in [sourceWidth, sourceHeight, outputWidth, outputHeight]) {
    _check(v >= 1, 'Sizes must be positive integers.');
  }
  _check(durationUs >= 1, 'durationUs must be a positive integer.');
  _check(zoom >= 1 && zoom <= 10, 'zoom must be between 1 and 10.');
  _check(minHoldUs >= 0, 'minHoldUs must be a non-negative integer.');
  for (var i = 0; i < frames.length; i++) {
    _check(
      frames[i].atUs >= 0 && (i == 0 || frames[i].atUs > frames[i - 1].atUs),
      'Frames must have increasing integer atUs.',
    );
  }
  for (final c in cuts) {
    _check(c >= 0, 'Cuts must be non-negative integers.');
  }

  final shotStartsUs = [
    0,
    ...{...cuts.where((c) => c > 0 && c < durationUs)},
  ]..sort();
  final h = math.max(1, (sourceHeight / zoom).floor());
  final win = cropRect(ReframeKey(atUs: 0, x: 0, y: 0, h: h), sourceWidth, sourceHeight, outputWidth, outputHeight);
  ReframeKey keyAt(Us atUs, double x, double y, {bool cut = false}) =>
      ReframeKey(atUs: atUs, x: roundHalfUp(x), y: roundHalfUp(y + _headroom * win.h), h: h, cut: cut);

  final keys = <ReframeKey>[];
  final people = <ReframePerson>[];
  for (var shot = 0; shot < shotStartsUs.length; shot++) {
    final startUs = shotStartsUs[shot];
    final endUs = shot + 1 < shotStartsUs.length ? shotStartsUs[shot + 1] : durationUs;
    final shotFrames = frames.where((f) => f.atUs >= startUs && f.atUs < endUs).toList();
    final tracks = _trackFaces(shotFrames);
    if (tracks.isEmpty) {
      keys.add(ReframeKey(atUs: startUs, x: sourceWidth ~/ 2, y: sourceHeight ~/ 2, h: h, cut: true));
      continue;
    }

    final raw = _speakers(shotFrames, tracks);
    double area(_Track t) => t.seen.values.fold(0.0, (s, f) => s + f.w * f.h);
    var main = 0;
    for (var k = 0; k < tracks.length; k++) {
      if (area(tracks[k]) > area(tracks[main])) main = k;
    }
    var current = raw.firstWhere((k) => k != null, orElse: () => null) ?? main;
    final who = [for (final k in raw) current = k ?? current];
    final runs = _holdRuns(shotFrames, who, startUs, endUs, minHoldUs);

    ({double x, double y})? centreNear(int k, int fi) {
      var n = 0;
      var sx = 0.0;
      var sy = 0.0;
      for (final g in _windowOf(shotFrames, fi, _smoothWindowUs)) {
        final f = tracks[k].seen[g];
        if (f != null) {
          n++;
          sx += _cx(f);
          sy += _cy(f);
        }
      }
      return n > 0 ? (x: sx / n, y: sy / n) : null;
    }

    final spoke = List.filled(tracks.length, 0);
    for (var r = 0; r < runs.length; r++) {
      final run = runs[r];
      final to = r + 1 < runs.length ? runs[r + 1].from : shotFrames.length;
      spoke[run.track] += (r + 1 < runs.length ? runs[r + 1].startUs : endUs) - run.startUs;
      // The speaker may be out of sight when their run starts: frame them where they first show up.
      // Every run holds a frame near one of its speaker's sightings (the frame that made them the
      // speaker, or for the most visible person, the whole shot), so this always finds one.
      var fi = run.from;
      var at = centreNear(run.track, fi);
      while (at == null && fi + 1 < to) {
        at = centreNear(run.track, ++fi);
      }
      var last = keyAt(run.startUs, at!.x, at.y, cut: true);
      var anchor = at;
      keys.add(last);
      for (var g = fi + 1; g < to; g++) {
        final p = centreNear(run.track, g);
        if (p == null || ((p.x - anchor.x).abs() <= _deadzone * win.w && (p.y - anchor.y).abs() <= _deadzone * win.h)) {
          continue;
        }
        final before = shotFrames[g - 1].atUs;
        if (before > last.atUs) keys.add(ReframeKey(atUs: before, x: last.x, y: last.y, h: h));
        last = keyAt(shotFrames[g].atUs, p.x, p.y);
        anchor = p;
        keys.add(last);
      }
    }

    for (var k = 0; k < tracks.length; k++) {
      FaceObservation? face;
      var faceAtUs = 0;
      for (final MapEntry(key: fi, value: f) in tracks[k].seen.entries) {
        if (face == null || f.w * f.h > face.w * face.h) {
          face = f;
          faceAtUs = shotFrames[fi].atUs;
        }
      }
      people.add(ReframePerson(id: 's${shot}p$k', shot: shot, speakingUs: spoke[k], face: face!, faceAtUs: faceAtUs));
    }
  }
  return AutoReframeResult(keys: keys, people: people, shotStartsUs: shotStartsUs);
}

/// A colour histogram of one analysed frame. Any bin layout works, as long as every frame uses the same.
class FrameHistogram {
  final Us atUs;
  final List<num> bins;
  const FrameHistogram(this.atUs, this.bins);
}

/// Source times where the camera changes: frames whose histogram differs from the previous frame's
/// by at least [threshold] (half the L1 distance of the normalised histograms, 0 to 1), at least
/// [minShotUs] after the previous cut. The cut is placed at the later frame.
List<Us> detectCuts(List<FrameHistogram> frames, {double threshold = 0.4, Us minShotUs = 1000000}) {
  List<double> norm(List<num> bins) {
    final total = bins.fold<num>(0, (s, b) => s + b);
    return [for (final b in bins) total > 0 ? b / total : 0.0];
  }

  final cuts = <Us>[];
  var lastCut = frames.isEmpty ? 0 : frames[0].atUs;
  for (var i = 1; i < frames.length; i++) {
    final a = norm(frames[i - 1].bins);
    final b = norm(frames[i].bins);
    _check(a.length == b.length, 'Every histogram needs the same number of bins.');
    var d = 0.0;
    for (var j = 0; j < a.length; j++) {
      d += (a[j] - b[j]).abs();
    }
    d /= 2;
    if (d >= threshold && frames[i].atUs - lastCut >= minShotUs) {
      cuts.add(frames[i].atUs);
      lastCut = frames[i].atUs;
    }
  }
  return cuts;
}
