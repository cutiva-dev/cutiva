import 'dart:convert';

import 'errors.dart';
import 'ids.dart';
import 'time.dart';
import 'types.dart';

ProjectSettings defaultSettings() =>
    ProjectSettings(width: 1920, height: 1080, fps: Rational(30, 1), sampleRate: 48000);

const cpfSchemaUrl = 'https://cutiva.dev/schema/0.1.json';

/// An empty project. Settings not given take the defaults: 1920x1080, 30 fps, 48 kHz.
Project createProject({int? width, int? height, Rational? fps, int? sampleRate, IdFactory ids = randomId}) {
  final d = defaultSettings();
  return Project(
    schema: cpfSchemaUrl,
    id: ids('prj'),
    settings: ProjectSettings(
      width: width ?? d.width,
      height: height ?? d.height,
      fps: fps?.copy() ?? d.fps,
      sampleRate: sampleRate ?? d.sampleRate,
    ),
  );
}

Track findTrack(Project project, String trackId) {
  for (final t in project.tracks) {
    if (t.id == trackId) return t;
  }
  throw CutivaError(CutivaErrorCode.trackNotFound, 'Track "$trackId" does not exist.');
}

({Track track, Clip clip, int index}) findClip(Project project, String clipId) {
  for (final track in project.tracks) {
    final index = track.clips.indexWhere((c) => c.id == clipId);
    if (index >= 0) return (track: track, clip: track.clips[index], index: index);
  }
  throw CutivaError(CutivaErrorCode.clipNotFound, 'Clip "$clipId" does not exist.');
}

// ---------- Validation of untrusted JSON ----------

typedef _Json = Map<String, Object?>;

Never _fail(String path, String expected) =>
    throw CutivaError(CutivaErrorCode.invalidProject, 'Invalid project at $path: expected $expected.');

num _num(_Json o, String k, String path, {bool int = false, num? min, num? max}) {
  final v = o[k];
  if (v is! num || !v.isFinite) _fail('$path.$k', 'a number');
  if (int && v != v.truncate()) _fail('$path.$k', 'an integer');
  if (min != null && v < min) _fail('$path.$k', 'a number >= $min');
  if (max != null && v > max) _fail('$path.$k', 'a number <= $max');
  return v;
}

int _int(_Json o, String k, String path, {num? min}) => _num(o, k, path, int: true, min: min).toInt();

String _str(_Json o, String k, String path) {
  final v = o[k];
  if (v is! String || v.isEmpty) _fail('$path.$k', 'a non-empty string');
  return v;
}

List<Object?> _arr(_Json o, String k, String path) {
  final v = o[k];
  if (v is! List<Object?>) _fail('$path.$k', 'an array');
  return v;
}

/// The value as an int when it is a whole number, else null.
int? _wholeOrNull(Object? v) => v is num && v.isFinite && v == v.truncate() ? v.toInt() : null;

/// Parse and validate a CPF document: a JSON string, a decoded JSON map, or a [Project].
/// Returns a clean Project or throws [CutivaError] with `INVALID_PROJECT` or `UNSUPPORTED_VERSION`.
/// A string that isn't JSON throws a [FormatException].
Project parseProject(Object? input) {
  final raw = switch (input) {
    String() => jsonDecode(input),
    Project() => input.toJson(),
    _ => input,
  };
  if (raw is! _Json) _fail(r'$', 'an object');
  final version = raw['version'];
  if (version != cpfVersion) {
    throw CutivaError(
      CutivaErrorCode.unsupportedVersion,
      'CPF version "$version" is not supported (expected $cpfVersion).',
    );
  }
  final s = raw['settings'];
  if (s is! _Json) _fail(r'$.settings', 'an object');
  final fps = s['fps'];
  if (fps is! _Json) _fail(r'$.settings.fps', 'an object');
  final settings = ProjectSettings(
    width: _int(s, 'width', r'$.settings', min: 2),
    height: _int(s, 'height', r'$.settings', min: 2),
    fps: Rational(_int(fps, 'num', r'$.settings.fps', min: 1), _int(fps, 'den', r'$.settings.fps', min: 1)),
    sampleRate: _int(s, 'sampleRate', r'$.settings', min: 8000),
  );

  final assetKinds = <String, AssetKind>{};
  final assetList = _arr(raw, 'assets', r'$');
  final assets = [for (var i = 0; i < assetList.length; i++) _parseAsset(assetList[i], '\$.assets[$i]', assetKinds)];

  final clipIds = <String>{};
  final trackList = _arr(raw, 'tracks', r'$');
  final tracks = <Track>[];
  for (var i = 0; i < trackList.length; i++) {
    final t = trackList[i];
    final p = '\$.tracks[$i]';
    if (t is! _Json) _fail(p, 'an object');
    final kind = switch (t['kind']) {
      'video' => TrackKind.video,
      'audio' => TrackKind.audio,
      _ => _fail('$p.kind', '"video" or "audio"'),
    };
    final clipList = _arr(t, 'clips', p);
    final clips = <Clip>[];
    for (var j = 0; j < clipList.length; j++) {
      final c = clipList[j];
      final cp = '$p.clips[$j]';
      if (c is! _Json) _fail(cp, 'an object');
      final id = _str(c, 'id', cp);
      if (!clipIds.add(id)) _fail('$cp.id', 'a unique clip id');
      final assetId = _str(c, 'assetId', cp);
      final assetKind = assetKinds[assetId];
      if (assetKind == null) _fail('$cp.assetId', r'the id of an asset in $.assets');
      if (assetKind.name != kind.name) _fail('$cp.assetId', 'a ${kind.name} asset, like its track');
      final effects = c['effects'];
      final clip = Clip(
        id: id,
        assetId: assetId,
        startUs: _int(c, 'startUs', cp, min: 0),
        sourceInUs: _int(c, 'sourceInUs', cp, min: 0),
        sourceOutUs: _int(c, 'sourceOutUs', cp, min: 1),
        speed: c['speed'] == null ? 1 : _num(c, 'speed', cp, min: 0.1, max: 16).toDouble(),
        volume: c['volume'] == null ? 1 : _num(c, 'volume', cp, min: 0, max: 4).toDouble(),
        effects:
            effects is List<Object?>
                ? [
                  for (final e in effects.whereType<_Json>())
                    Effect(type: '${e['type']}', params: e['params'] is _Json ? copyJson(e['params']) as _Json : {}),
                ]
                : [],
      );
      if (clip.sourceOutUs <= clip.sourceInUs) _fail('$cp.sourceOutUs', 'a value greater than sourceInUs');
      clips.add(clip);
    }
    // Clips are kept in start order; they may have gaps but must not overlap.
    sortClips(clips);
    for (var j = 1; j < clips.length; j++) {
      if (clips[j].startUs < clipEndUs(clips[j - 1])) {
        _fail('$p.clips', 'clips that do not overlap ("${clips[j].id}" starts inside "${clips[j - 1].id}")');
      }
    }
    tracks.add(Track(id: _str(t, 'id', p), kind: kind, muted: t['muted'] == true, clips: clips));
  }

  final schema = raw[r'$schema'];
  final meta = raw['meta'];
  return Project(
    schema: schema is String ? schema : cpfSchemaUrl,
    id: _str(raw, 'id', r'$'),
    settings: settings,
    assets: assets,
    tracks: tracks,
    meta: meta is _Json ? copyJson(meta) as _Json : null,
  );
}

Asset _parseAsset(Object? a, String p, Map<String, AssetKind> assetKinds) {
  if (a is! _Json) _fail(p, 'an object');
  final kind = switch (a['kind']) {
    'video' => AssetKind.video,
    'audio' => AssetKind.audio,
    _ => _fail('$p.kind', '"video" or "audio"'),
  };
  final id = _str(a, 'id', p);
  assetKinds[id] = kind;
  final name = a['name'];
  final hasAudio = a['hasAudio'];
  final fp = a['fingerprint'];
  final fpSize = fp is _Json ? _wholeOrNull(fp['size']) : null;
  final sha = fp is _Json ? fp['sha256Head'] : null;
  return Asset(
    id: id,
    kind: kind,
    name: name is String ? name : id,
    uri: _str(a, 'uri', p),
    durationUs: _int(a, 'durationUs', p, min: 1),
    width: _wholeOrNull(a['width']),
    height: _wholeOrNull(a['height']),
    hasAudio: hasAudio is bool ? hasAudio : null,
    fingerprint: fpSize == null ? null : AssetFingerprint(size: fpSize, sha256Head: sha is String ? sha : null),
  );
}

/// Stable sort by start time. Dart's `List.sort` is not stable; JavaScript's is.
void sortClips(List<Clip> clips) {
  final indexed = [for (var i = 0; i < clips.length; i++) (i, clips[i])];
  indexed.sort((a, b) {
    final byStart = a.$2.startUs.compareTo(b.$2.startUs);
    return byStart != 0 ? byStart : a.$1.compareTo(b.$1);
  });
  for (var i = 0; i < clips.length; i++) {
    clips[i] = indexed[i].$2;
  }
}
