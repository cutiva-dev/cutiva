import 'time.dart';
import 'types.dart';

class ActiveVideoLayer {
  final Track track;
  final Clip clip;
  final Asset asset;

  /// Source time to show from the asset at this instant.
  final Us sourceTimeUs;
  const ActiveVideoLayer({required this.track, required this.clip, required this.asset, required this.sourceTimeUs});
}

Asset? _assetOf(Project project, Clip clip) {
  for (final a in project.assets) {
    if (a.id == clip.assetId) return a;
  }
  return null;
}

/// What is visible at timeline time [t]. Bottom layer first.
/// Every engine (web, native) draws exactly this list, so preview and export never disagree.
List<ActiveVideoLayer> resolveVideoAt(Project project, Us t) {
  final layers = <ActiveVideoLayer>[];
  for (final track in project.tracks) {
    if (track.kind != TrackKind.video) continue;
    Clip? clip;
    for (final c in track.clips) {
      if (t >= c.startUs && t < clipEndUs(c)) {
        clip = c;
        break;
      }
    }
    if (clip == null) continue;
    final asset = _assetOf(project, clip);
    if (asset == null) continue;
    layers.add(ActiveVideoLayer(track: track, clip: clip, asset: asset, sourceTimeUs: sourceTimeAt(clip, t)));
  }
  return layers;
}

class AudioSegment {
  final String clipId;
  final String assetId;

  /// Timeline position where this segment starts playing.
  final Us startUs;
  final Us sourceInUs;
  final Us sourceOutUs;
  final double speed;
  final double volume;
  final Us fadeInUs;
  final Us fadeOutUs;
  const AudioSegment({
    required this.clipId,
    required this.assetId,
    required this.startUs,
    required this.sourceInUs,
    required this.sourceOutUs,
    required this.speed,
    required this.volume,
    required this.fadeInUs,
    required this.fadeOutUs,
  });

  Map<String, Object?> toJson() => {
    'clipId': clipId,
    'assetId': assetId,
    'startUs': startUs,
    'sourceInUs': sourceInUs,
    'sourceOutUs': sourceOutUs,
    'speed': jsonNumber(speed),
    'volume': jsonNumber(volume),
    'fadeInUs': fadeInUs,
    'fadeOutUs': fadeOutUs,
  };
}

/// A fade length from effect params: a number, or 0 when missing or not a number.
Us _fadeParam(Object? v) => v is num && v.isFinite ? roundHalfUp(v.toDouble()) : 0;

/// Every piece of sound in the project: audio tracks plus the audio of video clips.
List<AudioSegment> audioSegments(Project project) {
  final out = <AudioSegment>[];
  for (final track in project.tracks) {
    if (track.muted) continue;
    for (final clip in track.clips) {
      final asset = _assetOf(project, clip);
      if (asset == null) continue;
      if (asset.kind == AssetKind.video && asset.hasAudio == false) continue;
      if (clip.volume == 0) continue;
      Effect? fade;
      for (final e in clip.effects) {
        if (e.type == 'core/fade') {
          fade = e;
          break;
        }
      }
      out.add(
        AudioSegment(
          clipId: clip.id,
          assetId: asset.id,
          startUs: clip.startUs,
          sourceInUs: clip.sourceInUs,
          sourceOutUs: clip.sourceOutUs,
          speed: clip.speed,
          volume: clip.volume,
          fadeInUs: _fadeParam(fade?.params['inUs']),
          fadeOutUs: _fadeParam(fade?.params['outUs']),
        ),
      );
    }
  }
  return out;
}
