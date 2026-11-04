import 'dart:math' as math;

import 'errors.dart';
import 'reframe.dart';
import 'types.dart';

// The Reframe planner, ported line for line from packages/core/src/reframe-plan.ts. Keep both in
// step: the conformance fixtures in conformance/fixtures/auto-reframe/plan-*.json pin the output.

/// A face seen in one analysed frame, in source pixels (display orientation).
class PlanFace {
  final double x;
  final double y;
  final double w;
  final double h;

  /// Mouth openness, 0 closed to 1 wide open. Null when the mouth can't be seen.
  final double? mouth;

  /// Detector confidence, 0 to 1. Faces under 0.6 are ignored. Null when the detector gives none.
  final double? conf;

  /// How likely this face is talking right now, 0 to 1, from an active-speaker model (for example
  /// Light-ASD). When a person's faces carry it, it replaces their lip activity. Null without one.
  final double? speaking;
  const PlanFace({
    required this.x,
    required this.y,
    required this.w,
    required this.h,
    this.mouth,
    this.conf,
    this.speaking,
  });

  factory PlanFace.fromJson(Map<String, Object?> json) => PlanFace(
    x: (json['x'] as num).toDouble(),
    y: (json['y'] as num).toDouble(),
    w: (json['w'] as num).toDouble(),
    h: (json['h'] as num).toDouble(),
    mouth: (json['mouth'] as num?)?.toDouble(),
    conf: (json['conf'] as num?)?.toDouble(),
    speaking: (json['speaking'] as num?)?.toDouble(),
  );
}

/// What the detectors saw at one source time.
class PlanFrame {
  final Us atUs;
  final List<PlanFace> faces;

  /// Speech level, 0 to 1; 0.1 and above is voice. Null on every frame when the source has no audio.
  final double? voice;

  /// Stereo balance of the speech, -1 (left) to 1 (right). Null for mono.
  final double? pan;
  const PlanFrame({required this.atUs, required this.faces, this.voice, this.pan});

  factory PlanFrame.fromJson(Map<String, Object?> json) => PlanFrame(
    atUs: (json['atUs'] as num).toInt(),
    faces: [for (final f in json['faces'] as List<Object?>) PlanFace.fromJson(f as Map<String, Object?>)],
    voice: (json['voice'] as num?)?.toDouble(),
    pan: (json['pan'] as num?)?.toDouble(),
  );
}

/// The result of [planReframe].
class ReframePlanResult {
  final ReframeTrack track;
  final List<ReframeKey> keys;

  /// The source already has the output's shape (within 2%): one key showing the whole active area.
  final bool passthrough;

  /// Where each face person was seen: the input's faces that the planner kept and tracked, with the
  /// person they belong to (after merges), by time and then person. For an editor's clickable faces
  /// and avatars; not stored in the project. Empty for passthrough.
  final List<PlanSighting> sightings;
  const ReframePlanResult({
    required this.track,
    required this.keys,
    required this.passthrough,
    this.sightings = const [],
  });

  Map<String, Object?> toJson() => {
    'track': track.toJson(),
    'keys': [for (final k in keys) k.toJson()],
    'passthrough': passthrough,
    'sightings': [for (final s in sightings) s.toJson()],
  };
}

/// One face of the input, assigned to a person of the track.
class PlanSighting {
  final String personId;
  final Us atUs;
  final double x;
  final double y;
  final double w;
  final double h;
  const PlanSighting({
    required this.personId,
    required this.atUs,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
  });

  Map<String, Object?> toJson() => {'personId': personId, 'atUs': atUs, 'x': x, 'y': y, 'w': w, 'h': h};
}

const _minConf = 0.6;
const _minFaceShare = 0.04;
const _maxCandidates = 4;
const _minIou = 0.3;
const _maxGapUs = 1000000;

/// A track that starts after another ended, this many face widths or less from its last face, continues it.
const _relinkWidths = 1.5;
const _minTrackShare = 0.2;
const _voiceLevel = 0.1;
const _voiceMinUs = 250000;
const _voiceGapUs = 300000;
// Five samples at 5 fps; three (250 ms) were too noisy on real faces to keep a speaker for a second.
const _lipsWindowUs = 500000;
const _lipsFull = 0.05;
const _lipsCandidate = 0.3;

/// With an active-speaker score, a face averaging under this within the lips window isn't a candidate speaker.
const _speakingCandidate = 0.5;
const _wLips = 0.6;
const _wPan = 0.25;
// Small: the hold time and the switch margin already keep the camera steady.
const _wContinuity = 0.05;
const _switchMargin = 0.15;
const _overlapScore = 0.5;
const _overlapMinUs = 1500000;
const _voiceOnlyMinUs = 1000000;
const _snapUs = 400000;
const _headroom = 0.12;

/// In a split, a face fills at most this share of its region's height. Small faces get a larger
/// region: each half is at least half as tall as a single window, so a split is never blurrier than
/// a single framing of the same clip.
const _splitFaceShare = 0.35;

/// Two people share one window only when both faces span at most this share of its width. Wider,
/// they sit on its edges, and a split as sharp as a single frames each of them better.
const _sharedWindowShare = 0.6;
const _passthrough = 0.02;
const _oneEuroBeta = 1.0;
const _oneEuroDCutoff = 1.0;

const _holdUs = [1600000, 1000000, 400000];
const _minSegmentUs = [1500000, 1000000, 600000];
const _deadZone = [0.06, 0.04, 0.02];
const _minCutoff = [0.3, 0.8, 1.5];
const _maxSpeed = [0.15, 0.25, 0.4];

/// n / d rounded half up, for integers with d > 0 (n may be negative).
int _divRound(int n, int d) {
  final a = 2 * n + d;
  final b = 2 * d;
  return (a - a % b) ~/ b;
}

/// Rounded half up, the same `floor(x + 0.5)` as TypeScript.
int _half(double x) => (x + 0.5).floor();
double _clamp(double v, double lo, double hi) => math.min(hi, math.max(lo, v));
int _clampInt(int v, int lo, int hi) => math.min(hi, math.max(lo, v));

/// The camera style's parameters (0 calm, 50 balanced, 100 dynamic; linear in between).
({Us holdUs, Us minSegmentUs, double deadZone, double minCutoff, double maxSpeed}) reframeStyle(int style) {
  final i = style <= 50 ? 0 : 1;
  final u = style <= 50 ? style : style - 50;
  int whole(List<int> v) => v[i] + _divRound((v[i + 1] - v[i]) * u, 50);
  double real(List<double> v) => v[i] + ((v[i + 1] - v[i]) * u) / 50;
  return (
    holdUs: whole(_holdUs),
    minSegmentUs: whole(_minSegmentUs),
    deadZone: real(_deadZone),
    minCutoff: real(_minCutoff),
    maxSpeed: real(_maxSpeed),
  );
}

void _check(bool ok, String message) {
  if (!ok) throw CutivaError(CutivaErrorCode.invalidRange, message);
}

class _Sighting {
  final int fi;
  final PlanFace face;
  const _Sighting(this.fi, this.face);
}

class _FaceTrack {
  final int shot;
  final List<_Sighting> seen;
  int person = -1;
  _FaceTrack(this.shot, this.seen);
}

enum _Kind { speak, over, voice, noface, never, hold }

class _Label {
  final _Kind kind;

  /// The person for speak and never; the first of two for over.
  final int a;
  final int b;
  const _Label(this.kind, [this.a = -1, this.b = -1]);

  bool same(_Label o) => kind == o.kind && a == o.a && b == o.b;
}

class _Seg {
  Us startUs;
  Us endUs;
  _Label label;
  final TrackSegment? locked;
  _Seg(this.startUs, this.endUs, this.label, [this.locked]);
}

double _iou(PlanFace a, PlanFace b) {
  final ix = math.max(0.0, math.min(a.x + a.w, b.x + b.w) - math.max(a.x, b.x));
  final iy = math.max(0.0, math.min(a.y + a.h, b.y + b.h) - math.max(a.y, b.y));
  final inter = ix * iy;
  final union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

int _personNumber(String id) => int.parse(id.substring(1));

int _cmp(num a, num b) => a < b ? -1 : (a > b ? 1 : 0);

/// Plan a clip's reframe: segments (who is framed, and how) and the crop keys that draw them.
/// Locked segments, names, flags and merges of [track] are kept. Throws `INVALID_RANGE` on bad input.
ReframePlanResult planReframe({
  required int sourceWidth,
  required int sourceHeight,
  required int outputWidth,
  required int outputHeight,
  required Us durationUs,
  required List<PlanFrame> frames,
  List<Us> cuts = const [],
  CropRect? activeArea,
  ReframeTrack? track,
  Us? minShotUs,
}) {
  final srcW = sourceWidth;
  final srcH = sourceHeight;
  final outW = outputWidth;
  final outH = outputHeight;
  for (final v in [srcW, srcH, outW, outH]) {
    _check(v >= 1, 'Sizes must be positive integers.');
  }
  _check(durationUs >= 1, 'durationUs must be a positive integer.');
  for (var i = 0; i < frames.length; i++) {
    final f = frames[i];
    _check(
      f.atUs >= 0 && f.atUs < durationUs && (i == 0 || f.atUs > frames[i - 1].atUs),
      'Frames must have increasing integer atUs before durationUs.',
    );
    _check(f.voice == null || (f.voice!.isFinite && f.voice! >= 0 && f.voice! <= 1), 'voice must be between 0 and 1.');
    _check(f.pan == null || (f.pan!.isFinite && f.pan! >= -1 && f.pan! <= 1), 'pan must be between -1 and 1.');
    for (final face in f.faces) {
      _check(
        [face.x, face.y, face.w, face.h].every((v) => v.isFinite) && face.w > 0 && face.h > 0,
        'Faces need finite x, y and positive w, h.',
      );
      _check(
        face.mouth == null || (face.mouth!.isFinite && face.mouth! >= 0 && face.mouth! <= 1),
        'mouth must be null or between 0 and 1.',
      );
      _check(
        face.conf == null || (face.conf!.isFinite && face.conf! >= 0 && face.conf! <= 1),
        'conf must be between 0 and 1.',
      );
      _check(
        face.speaking == null || (face.speaking!.isFinite && face.speaking! >= 0 && face.speaking! <= 1),
        'speaking must be between 0 and 1.',
      );
    }
  }
  for (final c in cuts) {
    _check(c >= 0, 'Cuts must be non-negative integers.');
  }
  _check(minShotUs == null || minShotUs >= 0, 'minShotUs must be a non-negative integer.');

  final prev = track;
  final style = prev?.style ?? 50;
  final maxUpscalePct = prev?.maxUpscalePct ?? 200;
  final zoomPct = prev?.zoomPct ?? 100;
  final givenArea = activeArea ?? prev?.activeArea;
  final area = givenArea ?? CropRect(0, 0, srcW, srcH);
  _check(
    area.x >= 0 && area.y >= 0 && area.w >= 1 && area.h >= 1 && area.x + area.w <= srcW && area.y + area.h <= srcH,
    'activeArea must lie inside the source frame.',
  );
  final styleParams = reframeStyle(style);
  final params = (
    holdUs: styleParams.holdUs,
    minSegmentUs: math.max(styleParams.minSegmentUs, minShotUs ?? 0),
    deadZone: styleParams.deadZone,
    minCutoff: styleParams.minCutoff,
    maxSpeed: styleParams.maxSpeed,
  );
  ReframeTrack trackOf(List<TrackPerson> people, List<TrackSegment> segments) => ReframeTrack(
    style: style,
    maxUpscalePct: maxUpscalePct,
    zoomPct: zoomPct,
    activeArea: givenArea,
    people: people,
    segments: segments,
  );
  final centreX = area.x + area.w ~/ 2;
  final centreY = area.y + area.h ~/ 2;

  // 1. Passthrough.
  if ((area.w * outH - area.h * outW).abs() <= _passthrough * area.h * outW) {
    return ReframePlanResult(
      track: trackOf(prev == null ? [] : [for (final p in prev.people) p.copy()], []),
      keys: [ReframeKey(atUs: 0, x: centreX, y: centreY, h: area.h, cut: true)],
      passthrough: true,
    );
  }

  final fullH = math.min(area.h, (area.w * outH) ~/ outW);
  final keyH = math.max(1, (fullH * 100) ~/ zoomPct);
  final win = cropRect(ReframeKey(atUs: 0, x: 0, y: 0, h: keyH), srcW, srcH, outW, outH, area: area);

  // 2. Shots.
  final shotStarts = <Us>[0, ...cuts.where((c) => c > 0 && c < durationUs).toSet()]..sort();
  final cutList = shotStarts.sublist(1);
  int shotOf(Us atUs) {
    var s = 0;
    while (s + 1 < shotStarts.length && shotStarts[s + 1] <= atUs) {
      s++;
    }
    return s;
  }

  final n = frames.length;
  Us at(int fi) => frames[fi].atUs;
  Us endOf(int fi) => fi + 1 < n ? at(fi + 1) : durationUs;
  final frameShot = [for (final f in frames) shotOf(f.atUs)];

  // 3. Faces.
  final kept = <List<PlanFace>>[];
  for (final f in frames) {
    final list = <(PlanFace, int)>[];
    for (var j = 0; j < f.faces.length; j++) {
      final face = f.faces[j];
      if (!((face.conf == null || face.conf! >= _minConf) && face.h >= _minFaceShare * srcH)) continue;
      final cx = face.x + face.w / 2;
      final cy = face.y + face.h / 2;
      if (!(cx >= area.x && cx < area.x + area.w && cy >= area.y && cy < area.y + area.h)) continue;
      list.add((face, j));
    }
    list.sort((a, b) {
      final byArea = _cmp(b.$1.w * b.$1.h, a.$1.w * a.$1.h);
      if (byArea != 0) return byArea;
      final byX = _cmp(a.$1.x, b.$1.x);
      if (byX != 0) return byX;
      final byY = _cmp(a.$1.y, b.$1.y);
      return byY != 0 ? byY : a.$2.compareTo(b.$2);
    });
    kept.add([for (final e in list.take(_maxCandidates)) e.$1]);
  }

  // 4. Tracking.
  final tracks = <_FaceTrack>[];
  for (var shot = 0; shot < shotStarts.length; shot++) {
    final fis = [
      for (var fi = 0; fi < n; fi++)
        if (frameShot[fi] == shot) fi,
    ];
    final shotTracks = <_FaceTrack>[];
    for (final fi in fis) {
      final faces = kept[fi];
      final pairs = <(double, int, int)>[];
      for (var j = 0; j < faces.length; j++) {
        for (var k = 0; k < shotTracks.length; k++) {
          final last = shotTracks[k].seen.last;
          if (at(fi) - at(last.fi) > _maxGapUs) continue;
          final o = _iou(faces[j], last.face);
          if (o >= _minIou) pairs.add((o, j, k));
        }
      }
      pairs.sort((a, b) {
        final c = _cmp(b.$1, a.$1);
        if (c != 0) return c;
        final d = a.$2.compareTo(b.$2);
        return d != 0 ? d : a.$3.compareTo(b.$3);
      });
      final usedFace = <int>{};
      final usedTrack = <int>{};
      for (final (_, j, k) in pairs) {
        if (usedFace.contains(j) || usedTrack.contains(k)) continue;
        usedFace.add(j);
        usedTrack.add(k);
        shotTracks[k].seen.add(_Sighting(fi, faces[j]));
      }
      for (var j = 0; j < faces.length; j++) {
        if (!usedFace.contains(j)) shotTracks.add(_FaceTrack(shot, [_Sighting(fi, faces[j])]));
      }
    }
    // Re-link broken tracks: in order of first sighting, a track joins the nearest earlier track that
    // ended before it started, if close enough. Joined tracks are removed.
    final joined = <_FaceTrack>{};
    for (final b in shotTracks) {
      final first = b.seen[0];
      _FaceTrack? best;
      var bestD = double.infinity;
      for (final a in shotTracks) {
        if (identical(a, b)) break;
        if (joined.contains(a)) continue;
        final last = a.seen[a.seen.length - 1];
        if (last.fi >= first.fi) continue;
        final dx = last.face.x + last.face.w / 2 - (first.face.x + first.face.w / 2);
        final dy = last.face.y + last.face.h / 2 - (first.face.y + first.face.h / 2);
        final d = dx * dx + dy * dy;
        final reach = _relinkWidths * math.max(last.face.w, first.face.w);
        if (d <= reach * reach && d < bestD) {
          best = a;
          bestD = d;
        }
      }
      if (best != null) {
        best.seen.addAll(b.seen);
        joined.add(b);
      }
    }
    final linked = [
      for (final t in shotTracks)
        if (!joined.contains(t)) t,
    ];
    final min = math.max(2, (_minTrackShare * fis.length).ceil());
    var good = [
      for (var k = 0; k < linked.length; k++)
        if (linked[k].seen.length >= min) (linked[k], k),
    ];
    if (good.isEmpty && linked.isNotEmpty) {
      var best = 0;
      for (var k = 1; k < linked.length; k++) {
        if (linked[k].seen.length > linked[best].seen.length) best = k;
      }
      good = [(linked[best], 0)];
    }
    good.sort((a, b) {
      final c = b.$1.seen.length.compareTo(a.$1.seen.length);
      if (c != 0) return c;
      final d = a.$1.seen[0].fi.compareTo(b.$1.seen[0].fi);
      return d != 0 ? d : a.$2.compareTo(b.$2);
    });
    good = good.take(_maxCandidates).toList();
    good.sort((a, b) {
      final c = a.$1.seen[0].fi.compareTo(b.$1.seen[0].fi);
      if (c != 0) return c;
      final d = _cmp(a.$1.seen[0].face.x, b.$1.seen[0].face.x);
      if (d != 0) return d;
      final e = _cmp(a.$1.seen[0].face.y, b.$1.seen[0].face.y);
      return e != 0 ? e : a.$2.compareTo(b.$2);
    });
    tracks.addAll(good.map((e) => e.$1));
  }

  PlanFace? boxAt(_FaceTrack t, int fi, bool holdAfter) {
    if (frameShot[fi] != t.shot || fi < t.seen[0].fi) return null;
    var k = 0;
    while (k + 1 < t.seen.length && t.seen[k + 1].fi <= fi) {
      k++;
    }
    final a = t.seen[k];
    if (a.fi == fi) return a.face;
    if (k + 1 >= t.seen.length) return holdAfter ? a.face : null;
    final b = t.seen[k + 1];
    // Interpolate gaps up to _maxGapUs, then hold the last position (only inside a re-linked track).
    if (at(b.fi) - at(a.fi) > _maxGapUs) return a.face;
    final u = (at(fi) - at(a.fi)) / (at(b.fi) - at(a.fi));
    return PlanFace(
      x: a.face.x + (b.face.x - a.face.x) * u,
      y: a.face.y + (b.face.y - a.face.y) * u,
      w: a.face.w + (b.face.w - a.face.w) * u,
      h: a.face.h + (b.face.h - a.face.h) * u,
    );
  }

  // 5. People.
  final owner = <String, String>{};
  for (final p in prev?.people ?? const <TrackPerson>[]) {
    for (final m in p.merged ?? const <String>[]) {
      owner[m] = p.id;
    }
  }
  final prevById = {for (final p in prev?.people ?? const <TrackPerson>[]) p.id: p};
  final personIds = <String>[];
  for (var k = 0; k < tracks.length; k++) {
    final auto = 'p${k + 1}';
    final id = owner[auto] ?? auto;
    var idx = personIds.indexOf(id);
    if (idx < 0) {
      personIds.add(id);
      idx = personIds.length - 1;
    }
    tracks[k].person = idx;
  }
  final pCount = personIds.length;
  bool priorityOf(int i) => prevById[personIds[i]]?.priority == true;
  bool neverFocusOf(int i) => prevById[personIds[i]]?.neverFocus == true;
  PlanFace? personBox(int i, int fi, bool holdAfter) {
    for (final t in tracks) {
      if (t.person != i) continue;
      final b = boxAt(t, fi, holdAfter);
      if (b != null) return b;
    }
    return null;
  }

  bool present(int i, int fi) => personBox(i, fi, false) != null;

  // 6. Voice.
  final noAudio = frames.every((f) => f.voice == null);
  final voiced = [for (final f in frames) noAudio || (f.voice ?? 0) >= _voiceLevel];
  if (!noAudio) {
    List<(int, int)> runs(bool v) {
      final out = <(int, int)>[];
      for (var i = 0; i < n; i++) {
        if (voiced[i] != v) continue;
        if (out.isNotEmpty && out.last.$2 == i) {
          out[out.length - 1] = (out.last.$1, i + 1);
        } else {
          out.add((i, i + 1));
        }
      }
      return out;
    }

    for (final (a, b) in runs(false)) {
      if (a > 0 && b < n && endOf(b - 1) - at(a) < _voiceGapUs) {
        for (var i = a; i < b; i++) {
          voiced[i] = true;
        }
      }
    }
    for (final (a, b) in runs(true)) {
      if (endOf(b - 1) - at(a) < _voiceMinUs) {
        for (var i = a; i < b; i++) {
          voiced[i] = false;
        }
      }
    }
  }

  // 7. Lip activity.
  double? lips(int i, int fi) {
    final values = <double>[];
    for (final t in tracks) {
      if (t.person != i || t.shot != frameShot[fi]) continue;
      for (final s in t.seen) {
        if ((at(s.fi) - at(fi)).abs() <= _lipsWindowUs && s.face.mouth != null) values.add(s.face.mouth!);
      }
      if (values.isNotEmpty) break;
    }
    if (values.length < 2) return null;
    var mean = 0.0;
    for (final v in values) {
      mean += v;
    }
    mean /= values.length;
    var variance = 0.0;
    for (final v in values) {
      variance += (v - mean) * (v - mean);
    }
    variance /= values.length;
    return math.min(1, math.sqrt(variance) / _lipsFull);
  }

  // The mean active-speaker score of the person's real sightings within the lips window.
  double? speakingAt(int i, int fi) {
    final values = <double>[];
    for (final t in tracks) {
      if (t.person != i || t.shot != frameShot[fi]) continue;
      for (final s in t.seen) {
        if ((at(s.fi) - at(fi)).abs() <= _lipsWindowUs && s.face.speaking != null) values.add(s.face.speaking!);
      }
      if (values.isNotEmpty) break;
    }
    if (values.isEmpty) return null;
    var sum = 0.0;
    for (final v in values) {
      sum += v;
    }
    return sum / values.length;
  }

  double? activity(int i, int fi) => speakingAt(i, fi) ?? lips(i, fi);
  bool talking(int i, int fi) {
    final sp = speakingAt(i, fi);
    return sp != null ? sp >= _speakingCandidate : (lips(i, fi) ?? 0) >= _lipsCandidate;
  }

  bool candidate(int i, int fi) {
    final sp = speakingAt(i, fi);
    if (sp != null) return sp >= _speakingCandidate;
    final l = lips(i, fi);
    return l == null || l >= _lipsCandidate;
  }

  double score(int i, int fi, int? current) {
    final l = activity(i, fi);
    final pan = noAudio ? null : frames[fi].pan;
    var sum = _wContinuity * (i == current ? 1 : 0);
    var weight = _wContinuity;
    if (l != null) {
      sum += _wLips * l;
      weight += _wLips;
    }
    if (pan != null) {
      final box = personBox(i, fi, false)!;
      final expected = _clamp(((box.x + box.w / 2) / srcW) * 2 - 1, -1, 1);
      sum += _wPan * math.max(0, 1 - (pan - expected).abs());
      weight += _wPan;
    }
    return sum / weight;
  }

  // 8. Labels with hysteresis.
  final labels = <_Label>[];
  final speakerOf = <int?>[];
  int? current;
  (int, int)? challenger;
  for (var fi = 0; fi < n; fi++) {
    final visible = [
      for (var i = 0; i < pCount; i++)
        if (present(i, fi)) i,
    ];
    if (visible.isEmpty) {
      labels.add(const _Label(_Kind.noface));
      speakerOf.add(current);
      challenger = null;
      continue;
    }
    if (!voiced[fi]) {
      labels.add(const _Label(_Kind.hold));
      speakerOf.add(current);
      challenger = null;
      continue;
    }
    final focusable = visible.where((i) => !neverFocusOf(i)).toList();
    final candidates = focusable.where((i) => candidate(i, fi)).toList();
    if (candidates.isEmpty) {
      final hidden = visible.where((i) => neverFocusOf(i) && talking(i, fi)).toList();
      labels.add(hidden.isNotEmpty ? _Label(_Kind.never, hidden[0]) : const _Label(_Kind.voice));
      speakerOf.add(current);
      // A pause in someone's lip movement doesn't end their claim to the frame.
      continue;
    }
    final scores = {for (final i in focusable) i: score(i, fi, current)};
    final ranked = [...candidates]..sort((a, b) {
      final c = _cmp(scores[b]!, scores[a]!);
      if (c != 0) return c;
      final p = (priorityOf(b) ? 1 : 0) - (priorityOf(a) ? 1 : 0);
      return p != 0 ? p : a.compareTo(b);
    });
    final best = ranked[0];
    if (current == null || !present(current, fi) || neverFocusOf(current)) {
      current = best;
      challenger = null;
    } else {
      final cur = scores[current] ?? 0;
      // A challenger claims the frame by beating the current speaker by the margin, and keeps the
      // claim while it still scores higher than them; it wins once the claim lasts the hold time.
      final keeps = challenger != null && (scores[challenger.$1] ?? 0) > cur;
      final claims = best != current && scores[best]! > cur + _switchMargin;
      if (keeps || claims) {
        final ch = keeps ? challenger : (best, fi);
        challenger = ch;
        if (at(fi) - at(ch.$2) >= params.holdUs) {
          // Cut where the new speaker started, as an editor would.
          for (var g = ch.$2; g < fi; g++) {
            speakerOf[g] = ch.$1;
            if (labels[g].kind == _Kind.speak) labels[g] = _Label(_Kind.speak, ch.$1);
          }
          current = ch.$1;
          challenger = null;
        }
      } else {
        challenger = null;
      }
    }
    final over = ranked.where((i) => scores[i]! > _overlapScore && talking(i, fi)).toList();
    speakerOf.add(current);
    labels.add(
      over.length >= 2
          ? _Label(_Kind.over, math.min(over[0], over[1]), math.max(over[0], over[1]))
          : _Label(_Kind.speak, current),
    );
  }

  // 9. Durations.
  List<(int, int)> runsOf(_Kind kind) {
    final out = <(int, int)>[];
    for (var i = 0; i < n; i++) {
      if (labels[i].kind != kind) continue;
      if (out.isNotEmpty && out.last.$2 == i && labels[out.last.$1].same(labels[i])) {
        out[out.length - 1] = (out.last.$1, i + 1);
      } else {
        out.add((i, i + 1));
      }
    }
    return out;
  }

  for (final (a, b) in runsOf(_Kind.over)) {
    if (endOf(b - 1) - at(a) < _overlapMinUs) {
      for (var i = a; i < b; i++) {
        labels[i] = _Label(_Kind.speak, speakerOf[i]!);
      }
    }
  }
  for (final (a, b) in runsOf(_Kind.voice)) {
    if (endOf(b - 1) - at(a) <= _voiceOnlyMinUs) {
      for (var i = a; i < b; i++) {
        labels[i] = const _Label(_Kind.hold);
      }
    }
  }

  // 10. Silences.
  bool seenBy(int i, int fi) => personBox(i, fi, true) != null;
  bool valid(_Label l, int fi) => switch (l.kind) {
    _Kind.speak || _Kind.never => seenBy(l.a, fi),
    _Kind.over => seenBy(l.a, fi) && seenBy(l.b, fi),
    _Kind.noface => false,
    _Kind.voice => true,
    _Kind.hold => false,
  };
  _Label mostVisible(int fi) {
    var best = -1;
    var bestArea = -1.0;
    for (var i = 0; i < pCount; i++) {
      if (neverFocusOf(i) || !seenBy(i, fi)) continue;
      var sum = 0.0;
      for (final t in tracks) {
        if (t.person != i || t.shot != frameShot[fi]) continue;
        for (final s in t.seen) {
          sum += s.face.w * s.face.h;
        }
      }
      if (sum > bestArea) {
        best = i;
        bestArea = sum;
      }
    }
    if (best >= 0) return _Label(_Kind.speak, best);
    for (var i = 0; i < pCount; i++) {
      if (seenBy(i, fi)) return _Label(_Kind.never, i);
    }
    return const _Label(_Kind.noface);
  }

  for (var fi = 0; fi < n; fi++) {
    if (labels[fi].kind != _Kind.hold) continue;
    final before = fi > 0 ? labels[fi - 1] : null;
    if (before != null && frameShot[fi - 1] == frameShot[fi] && valid(before, fi)) {
      labels[fi] = before;
      continue;
    }
    _Label? next;
    for (var g = fi + 1; g < n && frameShot[g] == frameShot[fi]; g++) {
      final l = labels[g];
      if (l.kind == _Kind.hold) continue;
      if (valid(l, fi)) next = l;
      break;
    }
    labels[fi] = next ?? mostVisible(fi);
  }

  // 11. Segments and locked segments.
  var segs = <_Seg>[];
  for (var fi = 0; fi < n; fi++) {
    if (segs.isNotEmpty && segs.last.label.same(labels[fi])) {
      segs.last.endUs = endOf(fi);
    } else {
      segs.add(_Seg(segs.isEmpty ? 0 : at(fi), endOf(fi), labels[fi]));
    }
  }
  if (segs.isEmpty) segs.add(_Seg(0, durationUs, const _Label(_Kind.noface)));
  int personIndex(String id) => personIds.indexOf(owner[id] ?? id);
  final locked = [
    for (final s in prev?.segments ?? const <TrackSegment>[])
      if (s.locked && s.startUs < durationUs) s.copy()..endUs = math.min(s.endUs, durationUs),
  ];
  for (final l in locked) {
    final out = <_Seg>[];
    for (final s in segs) {
      if (s.locked != null || s.endUs <= l.startUs || s.startUs >= l.endUs) {
        out.add(s);
        continue;
      }
      if (s.startUs < l.startUs) out.add(_Seg(s.startUs, l.startUs, s.label));
      if (s.endUs > l.endUs) out.add(_Seg(l.endUs, s.endUs, s.label));
    }
    out.add(_Seg(l.startUs, l.endUs, const _Label(_Kind.hold), l));
    out.sort((a, b) => a.startUs.compareTo(b.startUs));
    segs = out;
  }

  // 12. Short segments, then snapping to cuts.
  void coalesce() {
    final out = <_Seg>[];
    for (final s in segs) {
      if (out.isNotEmpty &&
          out.last.locked == null &&
          s.locked == null &&
          out.last.endUs == s.startUs &&
          out.last.label.same(s.label)) {
        out.last.endUs = s.endUs;
      } else {
        out.add(s);
      }
    }
    segs = out;
  }

  coalesce();
  final stuck = <_Seg>{};
  for (;;) {
    var shortest = -1;
    for (var i = 0; i < segs.length; i++) {
      final s = segs[i];
      if (s.locked != null || stuck.contains(s) || s.endUs - s.startUs >= params.minSegmentUs) continue;
      if (shortest < 0 || s.endUs - s.startUs < segs[shortest].endUs - segs[shortest].startUs) shortest = i;
    }
    if (shortest < 0) break;
    final s = segs[shortest];
    final before = shortest > 0 ? segs[shortest - 1] : null;
    final after = shortest + 1 < segs.length ? segs[shortest + 1] : null;
    final into =
        before != null && before.locked == null && before.endUs == s.startUs
            ? before
            : (after != null && after.locked == null && after.startUs == s.endUs ? after : null);
    if (into == null) {
      stuck.add(s);
      continue;
    }
    s.label = into.label;
    coalesce();
  }
  for (var i = 1; i < segs.length; i++) {
    final a = segs[i - 1];
    final b = segs[i];
    if (a.locked != null || b.locked != null || a.endUs != b.startUs) continue;
    Us? best;
    for (final c in cutList) {
      if ((c - b.startUs).abs() < _snapUs && (best == null || (c - b.startUs).abs() < (best - b.startUs).abs())) {
        best = c;
      }
    }
    if (best != null && best > a.startUs && best < b.endUs) {
      a.endUs = best;
      b.startUs = best;
    }
  }

  // 13. Track segments and keys.
  List<int> fisIn(Us startUs, Us endUs) => [
    for (var fi = 0; fi < n; fi++)
      if (at(fi) >= startUs && at(fi) < endUs) fi,
  ];
  PlanFace? meanBox(int i, List<int> fis) {
    final boxes = [
      for (final fi in fis)
        if (personBox(i, fi, true) case final b?) b,
    ];
    if (boxes.isEmpty) return null;
    var x = 0.0, y = 0.0, w = 0.0, h = 0.0;
    for (final b in boxes) {
      x += b.x;
      y += b.y;
      w += b.w;
      h += b.h;
    }
    return PlanFace(x: x / boxes.length, y: y / boxes.length, w: w / boxes.length, h: h / boxes.length);
  }

  PlanFace union(PlanFace a, PlanFace b) {
    final x = math.min(a.x, b.x);
    final y = math.min(a.y, b.y);
    return PlanFace(x: x, y: y, w: math.max(a.x + a.w, b.x + b.w) - x, h: math.max(a.y + a.h, b.y + b.h) - y);
  }

  final maxRegionH = math.min(area.h, (area.w * outH) ~/ (2 * outW));
  ReframeWindow regionFor(PlanFace box, PlanFace other) {
    // Never blurrier than a single window, and never so wide that the other face shows in this half.
    final target = math.max(_half(box.h / _splitFaceShare), (keyH + 1) ~/ 2);
    final maxW = (2 * (box.x + box.w / 2 - (other.x + other.w / 2)).abs() - other.w).floor();
    final rh = _clampInt(math.min(target, ((maxW * outH) / (2 * outW)).floor()), 1, math.max(1, maxRegionH));
    final rw = _clampInt(_divRound(rh * 2 * outW, outH), 1, area.w);
    return ReframeWindow(
      x: _half(_clamp(box.x + box.w / 2, area.x + rw / 2, area.x + area.w - rw / 2)),
      y: _half(_clamp(box.y + (0.5 - _headroom) * rh, area.y + rh / 2, area.y + area.h - rh / 2)),
      h: rh,
    );
  }

  final lowQualitySingle = outH * 100 > maxUpscalePct * win.h;

  final people = <TrackPerson>[];
  var faceCount = 0;
  String letter(int k) => k < 26 ? String.fromCharCode(65 + k) : '${k + 1}';
  for (final id in personIds) {
    final old = prevById[id];
    final label = old?.label ?? 'Speaker ${letter(faceCount)}';
    faceCount++;
    people.add(
      TrackPerson(
        id: id,
        label: label,
        kind: 'face',
        priority: old?.priority ?? false,
        neverFocus: old?.neverFocus ?? false,
        merged: old?.merged == null ? null : [...old!.merged!],
      ),
    );
  }
  for (final l in locked) {
    for (final id in [...l.speakers, ...l.focus]) {
      final old = prevById[id];
      if (old != null && !people.any((p) => p.id == id)) people.add(old.copy());
    }
  }
  String? voiceId;
  String voicePerson() {
    if (voiceId != null) return voiceId!;
    TrackPerson? old;
    for (final p in prev?.people ?? const <TrackPerson>[]) {
      if (p.kind == 'voice') {
        old = p;
        break;
      }
    }
    if (old != null && !people.any((p) => p.id == old!.id)) people.add(old.copy());
    if (old != null) return voiceId = old.id;
    final used = [
      for (final p in people) ...[p.id, ...?p.merged],
      for (final p in prev?.people ?? const <TrackPerson>[]) ...[p.id, ...?p.merged],
    ];
    var top = 0;
    for (final id in used) {
      top = math.max(top, _personNumber(id));
    }
    voiceId = 'p${top + 1}';
    people.add(TrackPerson(id: voiceId!, label: 'Off-camera voice', kind: 'voice', priority: false, neverFocus: false));
    return voiceId!;
  }

  final segments = <TrackSegment>[];
  final keys = <ReframeKey>[];
  void pushKey(ReframeKey k) {
    if (keys.isNotEmpty && keys.last.atUs >= k.atUs) keys.removeLast();
    keys.add(k);
  }

  ReframeKey wideKey(Us atUs) => ReframeKey(atUs: atUs, x: centreX, y: centreY, h: keyH, cut: true, layout: 'wide');
  ReframeKey splitKey(Us atUs, PlanFace a, PlanFace b) {
    final leftFirst = a.x + a.w / 2 <= b.x + b.w / 2;
    final l = leftFirst ? a : b;
    final r = leftFirst ? b : a;
    return ReframeKey(
      atUs: atUs,
      x: centreX,
      y: centreY,
      h: keyH,
      cut: true,
      layout: 'split',
      regions: [regionFor(l, r), regionFor(r, l)],
    );
  }

  ({double x, double y}) centreFor(PlanFace box) => (
    x: _clamp(box.x + box.w / 2, area.x + win.w / 2, area.x + area.w - win.w / 2),
    y: _clamp(box.y + (0.5 - _headroom) * win.h, area.y + win.h / 2, area.y + area.h - win.h / 2),
  );
  double alpha(double cutoff, double te) => 1 / (1 + 1 / (2 * math.pi * cutoff * te));
  ({double p, double v}) step(double p, double g, double v, double scale, double te) {
    final dv = (g - p) / te / scale;
    final nv = v + alpha(_oneEuroDCutoff, te) * (dv - v);
    final cutoff = params.minCutoff + _oneEuroBeta * nv.abs();
    final limit = params.maxSpeed * scale * te;
    return (p: p + _clamp(alpha(cutoff, te) * (g - p), -limit, limit), v: nv);
  }

  void follow(Us startUs, Us endUs, PlanFace? Function(int fi) boxOf) {
    final fis = fisIn(startUs, endUs).where((fi) => boxOf(fi) != null).toList();
    if (fis.isEmpty) {
      pushKey(ReframeKey(atUs: startUs, x: centreX, y: centreY, h: keyH, cut: true));
      return;
    }
    var pos = centreFor(boxOf(fis[0])!);
    var moving = false;
    var speed = (x: 0.0, y: 0.0);
    var last = ReframeKey(atUs: startUs, x: _half(pos.x), y: _half(pos.y), h: keyH, cut: true);
    pushKey(last);
    for (var k = 1; k < fis.length; k++) {
      final fi = fis[k];
      final prevFi = fis[k - 1];
      final target = centreFor(boxOf(fi)!);
      if (frameShot[fi] != frameShot[prevFi]) {
        pos = target;
        moving = false;
        speed = (x: 0.0, y: 0.0);
        last = ReframeKey(atUs: at(fi), x: _half(pos.x), y: _half(pos.y), h: keyH, cut: true);
        pushKey(last);
        continue;
      }
      final te = (at(fi) - at(prevFi)) / 1e6;
      if (!moving &&
          ((target.x - pos.x).abs() > params.deadZone * win.w || (target.y - pos.y).abs() > params.deadZone * win.h)) {
        moving = true;
      } else if (moving && (target.x - pos.x).abs() < 1 && (target.y - pos.y).abs() < 1) {
        moving = false;
      }
      final goal = moving ? target : pos;
      final sx = step(pos.x, goal.x, speed.x, win.w.toDouble(), te);
      final sy = step(pos.y, goal.y, speed.y, win.h.toDouble(), te);
      pos = (x: sx.p, y: sy.p);
      speed = (x: sx.v, y: sy.v);
      final rx = _half(pos.x);
      final ry = _half(pos.y);
      if (rx == last.x && ry == last.y) continue;
      if (at(prevFi) > last.atUs) pushKey(ReframeKey(atUs: at(prevFi), x: last.x, y: last.y, h: keyH));
      last = ReframeKey(atUs: at(fi), x: rx, y: ry, h: keyH);
      pushKey(last);
    }
  }

  TrackSegment auto(_Seg s, List<String> speakers, String resolved, String reason) => TrackSegment(
    id: '',
    startUs: s.startUs,
    endUs: s.endUs,
    speakers: speakers,
    layout: 'auto',
    focus: [],
    resolved: resolved,
    locked: false,
    reason: reason,
  );

  for (final s in segs) {
    final l = s.locked;
    if (l != null) {
      final focus = (l.focus.isNotEmpty ? l.focus : l.speakers).map(personIndex).toList();
      segments.add(l.copy());
      if (l.window != null) {
        pushKey(ReframeKey(atUs: l.startUs, x: l.window!.x, y: l.window!.y, h: l.window!.h, cut: true));
      } else if (l.resolved == 'wide') {
        pushKey(wideKey(l.startUs));
      } else if (l.resolved == 'split') {
        final fis = fisIn(l.startUs, l.endUs);
        final a = focus.length >= 2 && focus[0] >= 0 ? meanBox(focus[0], fis) : null;
        final b = focus.length >= 2 && focus[1] >= 0 ? meanBox(focus[1], fis) : null;
        pushKey(a != null && b != null ? splitKey(l.startUs, a, b) : wideKey(l.startUs));
      } else if (focus.isNotEmpty && focus[0] >= 0) {
        follow(l.startUs, l.endUs, (fi) => personBox(focus[0], fi, true));
      } else {
        pushKey(ReframeKey(atUs: l.startUs, x: centreX, y: centreY, h: keyH, cut: true));
      }
      continue;
    }
    final lab = s.label;
    switch (lab.kind) {
      case _Kind.noface || _Kind.hold:
        segments.add(auto(s, [], 'wide', 'no-face'));
        pushKey(wideKey(s.startUs));
      case _Kind.voice:
        segments.add(auto(s, [voicePerson()], 'wide', 'voice-only'));
        pushKey(wideKey(s.startUs));
      case _Kind.never:
        segments.add(auto(s, [personIds[lab.a]], 'wide', 'never-focus'));
        pushKey(wideKey(s.startUs));
      case _Kind.speak:
        final speakers = [personIds[lab.a]];
        if (lowQualitySingle) {
          segments.add(auto(s, speakers, 'wide', 'low-quality'));
          pushKey(wideKey(s.startUs));
        } else {
          segments.add(auto(s, speakers, 'single', 'lips+voice'));
          follow(s.startUs, s.endUs, (fi) => personBox(lab.a, fi, true));
        }
      case _Kind.over:
        final speakers = [personIds[lab.a], personIds[lab.b]];
        final fis = fisIn(s.startUs, s.endUs);
        final a = meanBox(lab.a, fis);
        final b = meanBox(lab.b, fis);
        if (a == null || b == null) {
          segments.add(auto(s, speakers, 'single', 'overlap'));
          follow(s.startUs, s.endUs, (fi) => personBox(a != null ? lab.a : lab.b, fi, true));
          continue;
        }
        final both = union(a, b);
        final key = splitKey(s.startUs, a, b);
        // As sharp as a single window, and within the upscaling limit.
        final sharpSplit = key.regions!.every((r) => 2 * r.h >= keyH);
        final blurrySplit = key.regions!.any((r) => outH * 100 > maxUpscalePct * 2 * r.h);
        final fits = both.w <= win.w && both.h <= win.h;
        if (fits && (both.w <= _sharedWindowShare * win.w || !sharpSplit || blurrySplit)) {
          // Side by side: one window holds both.
          if (lowQualitySingle) {
            segments.add(auto(s, speakers, 'wide', 'low-quality'));
            pushKey(wideKey(s.startUs));
          } else {
            segments.add(auto(s, speakers, 'single', 'overlap'));
            follow(s.startUs, s.endUs, (fi) {
              final x = personBox(lab.a, fi, true);
              final y = personBox(lab.b, fi, true);
              return x != null && y != null ? union(x, y) : (x ?? y);
            });
          }
        } else if (blurrySplit) {
          if (lowQualitySingle) {
            segments.add(auto(s, speakers, 'wide', 'low-quality'));
            pushKey(wideKey(s.startUs));
          } else {
            // A split would be too blurry: frame whoever held the frame most of this stretch.
            int held(int i) => fis.where((fi) => speakerOf[fi] == i).length;
            final who = held(lab.b) > held(lab.a) ? lab.b : lab.a;
            segments.add(auto(s, speakers, 'single', 'overlap'));
            follow(s.startUs, s.endUs, (fi) => personBox(who, fi, true));
          }
        } else {
          segments.add(auto(s, speakers, 'split', 'overlap'));
          pushKey(key);
        }
    }
  }
  for (var i = 0; i < segments.length; i++) {
    segments[i].id = 's${i + 1}';
  }
  people.sort((a, b) => _personNumber(a.id).compareTo(_personNumber(b.id)));
  final sightings = [
    for (final t in tracks)
      for (final s in t.seen)
        PlanSighting(personId: personIds[t.person], atUs: at(s.fi), x: s.face.x, y: s.face.y, w: s.face.w, h: s.face.h),
  ]..sort((a, b) {
    final byTime = a.atUs.compareTo(b.atUs);
    if (byTime != 0) return byTime;
    final byPerson = _personNumber(a.personId).compareTo(_personNumber(b.personId));
    if (byPerson != 0) return byPerson;
    final byX = a.x.compareTo(b.x);
    return byX != 0 ? byX : a.y.compareTo(b.y);
  });
  return ReframePlanResult(track: trackOf(people, segments), keys: keys, passthrough: false, sightings: sightings);
}

/// A change the user makes to a clip's Reframe Track. Re-run [planReframe] with the result.
sealed class ReframeEdit {
  const ReframeEdit();
}

/// Choose how a segment is framed. Locks it. [window] keeps a dragged framing (single).
class SegmentEdit extends ReframeEdit {
  final String segmentId;
  final String? layout;
  final List<String>? focus;
  final ReframeWindow? window;
  const SegmentEdit(this.segmentId, {this.layout, this.focus, this.window});
}

/// Give a segment back to the planner.
class SegmentReset extends ReframeEdit {
  final String segmentId;
  const SegmentReset(this.segmentId);
}

class PersonEdit extends ReframeEdit {
  final String personId;
  final String? label;
  final bool? priority;
  final bool? neverFocus;
  const PersonEdit(this.personId, {this.label, this.priority, this.neverFocus});
}

/// [personId] and [intoId] are the same person: keep [intoId].
class PersonMerge extends ReframeEdit {
  final String personId;
  final String intoId;
  const PersonMerge(this.personId, this.intoId);
}

class ReframeSettingsEdit extends ReframeEdit {
  final int? style;
  final int? maxUpscalePct;
  final int? zoomPct;
  const ReframeSettingsEdit({this.style, this.maxUpscalePct, this.zoomPct});
}

/// Apply one edit to a track and return the new track; the input is not changed. Throws
/// `SEGMENT_NOT_FOUND`, `PERSON_NOT_FOUND` or `INVALID_RANGE`.
ReframeTrack editReframeTrack(ReframeTrack track, ReframeEdit edit) {
  final next = track.copy();
  TrackSegment segment(String id) {
    for (final s in next.segments) {
      if (s.id == id) return s;
    }
    throw CutivaError(CutivaErrorCode.segmentNotFound, 'The track has no segment "$id".');
  }

  TrackPerson person(String id) {
    for (final p in next.people) {
      if (p.id == id) return p;
    }
    throw CutivaError(CutivaErrorCode.personNotFound, 'The track has no person "$id".');
  }

  switch (edit) {
    case SegmentEdit():
      final s = segment(edit.segmentId);
      final focus = edit.focus ?? s.focus;
      for (final id in focus) {
        _check(person(id).kind == 'face', '"$id" has no face to frame.');
      }
      _check(focus.toSet().length == focus.length && focus.length <= 2, 'focus names at most two different people.');
      final layout = edit.window != null ? 'single' : (edit.layout ?? (focus.length == 2 ? 'split' : 'single'));
      if (layout == 'split') _check((focus.isNotEmpty ? focus : s.speakers).length >= 2, 'A split needs two people.');
      final w = edit.window;
      if (w != null) _check(w.x >= 0 && w.y >= 0 && w.h >= 1, 'window needs integer x, y >= 0 and h >= 1.');
      s
        ..window = w
        ..layout = layout
        ..focus = [...focus]
        ..resolved = layout
        ..locked = true
        ..reason = 'user';
    case SegmentReset():
      segment(edit.segmentId)
        ..window = null
        ..layout = 'auto'
        ..focus = []
        ..locked = false;
    case PersonEdit():
      final p = person(edit.personId);
      if (edit.label != null) {
        _check(edit.label!.isNotEmpty && edit.label!.length <= 60, 'A label has 1 to 60 characters.');
        p.label = edit.label!;
      }
      if (edit.priority != null) p.priority = edit.priority!;
      if (edit.neverFocus != null) p.neverFocus = edit.neverFocus!;
    case PersonMerge():
      _check(edit.personId != edit.intoId, 'A person can\'t be merged into themselves.');
      final from = person(edit.personId);
      final into = person(edit.intoId);
      _check(from.kind == into.kind, 'Only two faces or two voices can be merged.');
      into.merged = [...?into.merged, from.id, ...?from.merged];
      next.people.remove(from);
      List<String> swap(List<String> ids) => {for (final id in ids) id == from.id ? into.id : id}.toList();
      for (final s in next.segments) {
        s
          ..speakers = swap(s.speakers)
          ..focus = swap(s.focus);
      }
    case ReframeSettingsEdit():
      if (edit.style != null) {
        _check(edit.style! >= 0 && edit.style! <= 100, 'style is an integer from 0 to 100.');
        next.style = edit.style!;
      }
      if (edit.maxUpscalePct != null) {
        _check(edit.maxUpscalePct! >= 100, 'maxUpscalePct is an integer of at least 100.');
        next.maxUpscalePct = edit.maxUpscalePct!;
      }
      if (edit.zoomPct != null) {
        _check(edit.zoomPct! >= 100 && edit.zoomPct! <= 1000, 'zoomPct is an integer from 100 to 1000.');
        next.zoomPct = edit.zoomPct!;
      }
  }
  return next;
}
