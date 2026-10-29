import 'resolve.dart';
import 'time.dart';
import 'types.dart';

class VideoSegment {
  /// Position among the video tracks: 0 is the bottom, higher layers draw on top.
  final int layer;
  final String trackId;
  final String clipId;
  final String assetId;
  final String uri;

  /// Timeline range `[startUs, endUs)` where this segment is visible.
  final Us startUs;
  final Us endUs;

  /// Source range that plays over it, at [speed].
  final Us sourceInUs;
  final Us sourceOutUs;
  final double speed;
  const VideoSegment({
    required this.layer,
    required this.trackId,
    required this.clipId,
    required this.assetId,
    required this.uri,
    required this.startUs,
    required this.endUs,
    required this.sourceInUs,
    required this.sourceOutUs,
    required this.speed,
  });

  Map<String, Object?> toJson() => {
    'layer': layer,
    'trackId': trackId,
    'clipId': clipId,
    'assetId': assetId,
    'uri': uri,
    'startUs': startUs,
    'endUs': endUs,
    'sourceInUs': sourceInUs,
    'sourceOutUs': sourceOutUs,
    'speed': jsonNumber(speed),
  };
}

/// An [AudioSegment] with its asset's URI.
class PlanAudioSegment {
  final AudioSegment segment;
  final String uri;
  const PlanAudioSegment(this.segment, this.uri);

  Map<String, Object?> toJson() => {...segment.toJson(), 'uri': uri};
}

/// A flat description of what plays where. Native engines (AVFoundation, Media3) build their
/// compositions from this and apply no edit rules of their own (ADR 0004).
class RenderPlan {
  final Us durationUs;
  final ProjectSettings settings;

  /// Bottom layer first, then by start time. Muted video tracks are still visible.
  final List<VideoSegment> video;

  /// The same segments as [audioSegments], each with its asset's URI.
  final List<PlanAudioSegment> audio;
  const RenderPlan({required this.durationUs, required this.settings, required this.video, required this.audio});

  /// The plan as JSON, shaped like the TypeScript SDK's. This is what goes to the native engines.
  Map<String, Object?> toJson() => {
    'durationUs': durationUs,
    'settings': settings.toJson(),
    'video': [for (final v in video) v.toJson()],
    'audio': [for (final a in audio) a.toJson()],
  };
}

RenderPlan renderPlan(Project project) {
  final uris = {for (final a in project.assets) a.id: a.uri};
  final video = <VideoSegment>[];
  var layer = 0;
  for (final track in project.tracks) {
    if (track.kind != TrackKind.video) continue;
    for (final clip in track.clips) {
      final uri = uris[clip.assetId];
      if (uri == null) continue;
      video.add(
        VideoSegment(
          layer: layer,
          trackId: track.id,
          clipId: clip.id,
          assetId: clip.assetId,
          uri: uri,
          startUs: clip.startUs,
          endUs: clipEndUs(clip),
          sourceInUs: clip.sourceInUs,
          sourceOutUs: clip.sourceOutUs,
          speed: clip.speed,
        ),
      );
    }
    layer++;
  }
  return RenderPlan(
    durationUs: projectDurationUs(project),
    settings: project.settings.copy(),
    video: video,
    audio: [for (final s in audioSegments(project)) PlanAudioSegment(s, uris[s.assetId]!)],
  );
}
