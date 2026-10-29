/// All times are integer microseconds. Never floats of seconds.
typedef Us = int;

const cpfVersion = '0.1.0';

class Rational {
  int num;
  int den;
  Rational(this.num, this.den);

  Rational copy() => Rational(num, den);
  Map<String, Object?> toJson() => {'num': num, 'den': den};
}

class ProjectSettings {
  int width;
  int height;
  Rational fps;
  int sampleRate;
  ProjectSettings({required this.width, required this.height, required this.fps, required this.sampleRate});

  ProjectSettings copy() => ProjectSettings(width: width, height: height, fps: fps.copy(), sampleRate: sampleRate);
  Map<String, Object?> toJson() => {'width': width, 'height': height, 'fps': fps.toJson(), 'sampleRate': sampleRate};
}

enum AssetKind { video, audio }

class AssetFingerprint {
  int size;

  /// Hex SHA-256 of the first 64 KiB, used to relink media on another device.
  String? sha256Head;
  AssetFingerprint({required this.size, this.sha256Head});

  AssetFingerprint copy() => AssetFingerprint(size: size, sha256Head: sha256Head);
  Map<String, Object?> toJson() => {'size': size, if (sha256Head != null) 'sha256Head': sha256Head};
}

class Asset {
  String id;
  AssetKind kind;
  String name;
  String uri;
  Us durationUs;
  int? width;
  int? height;
  bool? hasAudio;
  AssetFingerprint? fingerprint;
  Asset({
    required this.id,
    required this.kind,
    required this.name,
    required this.uri,
    required this.durationUs,
    this.width,
    this.height,
    this.hasAudio,
    this.fingerprint,
  });

  Asset copy() => Asset(
    id: id,
    kind: kind,
    name: name,
    uri: uri,
    durationUs: durationUs,
    width: width,
    height: height,
    hasAudio: hasAudio,
    fingerprint: fingerprint?.copy(),
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind.name,
    'name': name,
    'uri': uri,
    'durationUs': durationUs,
    if (width != null) 'width': width,
    if (height != null) 'height': height,
    if (hasAudio != null) 'hasAudio': hasAudio,
    if (fingerprint != null) 'fingerprint': fingerprint!.toJson(),
  };
}

class Effect {
  String type;
  Map<String, Object?> params;
  Effect({required this.type, Map<String, Object?>? params}) : params = params ?? {};

  Effect copy() => Effect(type: type, params: copyJson(params) as Map<String, Object?>);
  Map<String, Object?> toJson() => {'type': type, 'params': copyJson(params)};
}

class Clip {
  String id;
  String assetId;

  /// Position on the timeline.
  Us startUs;

  /// Range of the source asset that plays.
  Us sourceInUs;
  Us sourceOutUs;
  double speed;
  double volume;
  List<Effect> effects;
  Clip({
    required this.id,
    required this.assetId,
    required this.startUs,
    required this.sourceInUs,
    required this.sourceOutUs,
    this.speed = 1,
    this.volume = 1,
    List<Effect>? effects,
  }) : effects = effects ?? [];

  Clip copy() => Clip(
    id: id,
    assetId: assetId,
    startUs: startUs,
    sourceInUs: sourceInUs,
    sourceOutUs: sourceOutUs,
    speed: speed,
    volume: volume,
    effects: [for (final e in effects) e.copy()],
  );

  Map<String, Object?> toJson() => {
    'id': id,
    'assetId': assetId,
    'startUs': startUs,
    'sourceInUs': sourceInUs,
    'sourceOutUs': sourceOutUs,
    'speed': jsonNumber(speed),
    'volume': jsonNumber(volume),
    'effects': [for (final e in effects) e.toJson()],
  };
}

enum TrackKind { video, audio }

class Track {
  String id;
  TrackKind kind;
  bool muted;
  List<Clip> clips;
  Track({required this.id, required this.kind, this.muted = false, List<Clip>? clips}) : clips = clips ?? [];

  Track copy() => Track(id: id, kind: kind, muted: muted, clips: [for (final c in clips) c.copy()]);
  Map<String, Object?> toJson() => {
    'id': id,
    'kind': kind.name,
    'muted': muted,
    'clips': [for (final c in clips) c.toJson()],
  };
}

/// Cutiva Project Format (CPF).
class Project {
  String? schema;
  final String version = cpfVersion;
  String id;
  ProjectSettings settings;
  List<Asset> assets;

  /// Video tracks are composited in list order: later tracks draw on top.
  List<Track> tracks;
  Map<String, Object?>? meta;
  Project({this.schema, required this.id, required this.settings, List<Asset>? assets, List<Track>? tracks, this.meta})
    : assets = assets ?? [],
      tracks = tracks ?? [];

  /// A deep copy.
  Project copy() => Project(
    schema: schema,
    id: id,
    settings: settings.copy(),
    assets: [for (final a in assets) a.copy()],
    tracks: [for (final t in tracks) t.copy()],
    meta: meta == null ? null : copyJson(meta) as Map<String, Object?>,
  );

  /// The CPF document, ready for `jsonEncode`. Field names match every other Cutiva SDK.
  Map<String, Object?> toJson() => {
    if (schema != null) r'$schema': schema,
    'version': version,
    'id': id,
    'settings': settings.toJson(),
    'assets': [for (final a in assets) a.toJson()],
    'tracks': [for (final t in tracks) t.toJson()],
    if (meta != null) 'meta': copyJson(meta),
  };
}

/// Whole doubles are written as integers (`1`, not `1.0`), like JavaScript does.
Object jsonNumber(double value) => value.isFinite && value == value.truncateToDouble() ? value.toInt() : value;

/// Deep copy of a JSON-like value (maps, lists and scalars).
Object? copyJson(Object? value) => switch (value) {
  Map<Object?, Object?>() => {for (final e in value.entries) e.key as String: copyJson(e.value)},
  List<Object?>() => [for (final v in value) copyJson(v)],
  _ => value,
};
