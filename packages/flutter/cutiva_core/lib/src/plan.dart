import 'reframe.dart';
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

  /// When the clip is reframed: crop rectangles by source time. At a source time `s` the engine shows
  /// `cropAt(crop, s)`, scaled to fill the output frame. Without it, the frame is letterboxed.
  final List<CropKey>? crop;

  /// With [crop]: the asset's size, the pixels the crop rectangles are in (display orientation).
  final int? sourceWidth;
  final int? sourceHeight;
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
    this.crop,
    this.sourceWidth,
    this.sourceHeight,
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
    if (crop != null) 'sourceWidth': sourceWidth,
    if (crop != null) 'sourceHeight': sourceHeight,
    if (crop != null) 'crop': [for (final k in crop!) k.toJson()],
  };
}

/// An [AudioSegment] with its asset's URI and the timeline time where it stops playing.
class PlanAudioSegment {
  final AudioSegment segment;
  final String uri;

  /// `startUs` plus the segment's length after speed.
  final Us endUs;
  const PlanAudioSegment(this.segment, this.uri, this.endUs);

  Map<String, Object?> toJson() => {...segment.toJson(), 'uri': uri, 'endUs': endUs};
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
  final assets = {for (final a in project.assets) a.id: a};
  final video = <VideoSegment>[];
  var layer = 0;
  for (final track in project.tracks) {
    if (track.kind != TrackKind.video) continue;
    for (final clip in track.clips) {
      final uri = uris[clip.assetId];
      if (uri == null) continue;
      final asset = assets[clip.assetId]!;
      final keys = clipCropKeys(clip, asset, project.settings);
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
          crop: keys == null ? null : cropKeysInRange(keys, clip.sourceInUs, clip.sourceOutUs),
          sourceWidth: keys == null ? null : asset.width,
          sourceHeight: keys == null ? null : asset.height,
        ),
      );
    }
    layer++;
  }
  return RenderPlan(
    durationUs: projectDurationUs(project),
    settings: project.settings.copy(),
    video: video,
    audio: [
      for (final s in audioSegments(project))
        PlanAudioSegment(s, uris[s.assetId]!, s.startUs + timelineLengthUs(s.sourceInUs, s.sourceOutUs, s.speed)),
    ],
  );
}
