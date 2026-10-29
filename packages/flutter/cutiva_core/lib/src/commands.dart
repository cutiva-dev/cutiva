import 'errors.dart';
import 'ids.dart';
import 'project.dart';
import 'time.dart';
import 'types.dart';

/// Every edit is a plain, serializable object. [R] is what applying it returns.
sealed class Command<R extends CommandResult> {
  const Command();

  /// The command's name, the same in every Cutiva SDK: `clip.split`, `track.add`, …
  String get type;

  /// The command as a JSON object, shaped like the TypeScript SDK's.
  Map<String, Object?> toJson() => {'type': type, ..._fields()};
  Map<String, Object?> _fields();
}

class AssetAdd extends Command<AssetAddResult> {
  final Asset asset;
  const AssetAdd(this.asset);
  @override
  String get type => 'asset.add';
  @override
  Map<String, Object?> _fields() => {'asset': asset.toJson()};
}

class TrackAdd extends Command<TrackAddResult> {
  final TrackKind kind;
  final String? trackId;
  const TrackAdd(this.kind, {this.trackId});
  @override
  String get type => 'track.add';
  @override
  Map<String, Object?> _fields() => {'kind': kind.name, if (trackId != null) 'trackId': trackId};
}

class TrackSetMuted extends Command<CommandResult> {
  final String trackId;
  final bool muted;
  const TrackSetMuted(this.trackId, {required this.muted});
  @override
  String get type => 'track.setMuted';
  @override
  Map<String, Object?> _fields() => {'trackId': trackId, 'muted': muted};
}

class ClipAdd extends Command<ClipAddResult> {
  final String assetId;

  /// Null picks the first track of the matching kind, creating it if needed.
  final String? trackId;

  /// Defaults to the end of the track.
  final Us? startUs;
  final Us? sourceInUs;
  final Us? sourceOutUs;
  final String? clipId;
  const ClipAdd(this.assetId, {this.trackId, this.startUs, this.sourceInUs, this.sourceOutUs, this.clipId});
  @override
  String get type => 'clip.add';
  @override
  Map<String, Object?> _fields() => {
    'assetId': assetId,
    if (trackId != null) 'trackId': trackId,
    if (startUs != null) 'startUs': startUs,
    if (sourceInUs != null) 'sourceInUs': sourceInUs,
    if (sourceOutUs != null) 'sourceOutUs': sourceOutUs,
    if (clipId != null) 'clipId': clipId,
  };
}

class ClipRemove extends Command<CommandResult> {
  final String clipId;
  final bool ripple;
  const ClipRemove(this.clipId, {this.ripple = false});
  @override
  String get type => 'clip.remove';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, if (ripple) 'ripple': true};
}

class ClipSplit extends Command<ClipSplitResult> {
  final String clipId;
  final Us atUs;
  const ClipSplit(this.clipId, {required this.atUs});
  @override
  String get type => 'clip.split';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, 'atUs': atUs};
}

class ClipTrim extends Command<CommandResult> {
  final String clipId;
  final Us? sourceInUs;
  final Us? sourceOutUs;
  const ClipTrim(this.clipId, {this.sourceInUs, this.sourceOutUs});
  @override
  String get type => 'clip.trim';
  @override
  Map<String, Object?> _fields() => {
    'clipId': clipId,
    if (sourceInUs != null) 'sourceInUs': sourceInUs,
    if (sourceOutUs != null) 'sourceOutUs': sourceOutUs,
  };
}

class ClipMove extends Command<CommandResult> {
  final String clipId;
  final Us startUs;
  final String? trackId;
  const ClipMove(this.clipId, {required this.startUs, this.trackId});
  @override
  String get type => 'clip.move';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, 'startUs': startUs, if (trackId != null) 'trackId': trackId};
}

class ClipReorder extends Command<CommandResult> {
  final String clipId;
  final int index;
  const ClipReorder(this.clipId, {required this.index});
  @override
  String get type => 'clip.reorder';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, 'index': index};
}

class ClipSetVolume extends Command<CommandResult> {
  final String clipId;
  final double volume;
  const ClipSetVolume(this.clipId, this.volume);
  @override
  String get type => 'clip.setVolume';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, 'volume': jsonNumber(volume)};
}

class ClipSetSpeed extends Command<CommandResult> {
  final String clipId;
  final double speed;
  const ClipSetSpeed(this.clipId, this.speed);
  @override
  String get type => 'clip.setSpeed';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, 'speed': jsonNumber(speed)};
}

class ClipSetFade extends Command<CommandResult> {
  final String clipId;
  final Us inUs;
  final Us outUs;
  const ClipSetFade(this.clipId, {required this.inUs, required this.outUs});
  @override
  String get type => 'clip.setFade';
  @override
  Map<String, Object?> _fields() => {'clipId': clipId, 'inUs': inUs, 'outUs': outUs};
}

/// What a command returns. Commands that create things return a subclass with the new ids.
class CommandResult {
  final String type;
  const CommandResult(this.type);
}

class AssetAddResult extends CommandResult {
  final String assetId;
  const AssetAddResult(this.assetId) : super('asset.add');
}

class TrackAddResult extends CommandResult {
  final String trackId;
  const TrackAddResult(this.trackId) : super('track.add');
}

class ClipAddResult extends CommandResult {
  final String clipId;
  final String trackId;
  const ClipAddResult({required this.clipId, required this.trackId}) : super('clip.add');
}

class ClipSplitResult extends CommandResult {
  final String leftId;
  final String rightId;
  const ClipSplitResult({required this.leftId, required this.rightId}) : super('clip.split');
}

const _minClipUs = 1000; // 1 ms

void _assertNoOverlap(Track track) {
  final clips = [...track.clips];
  sortClips(clips);
  for (var i = 1; i < clips.length; i++) {
    final prev = clips[i - 1];
    final cur = clips[i];
    if (cur.startUs < clipEndUs(prev)) {
      throw CutivaError(CutivaErrorCode.overlap, 'Clip "${cur.id}" overlaps clip "${prev.id}" on track "${track.id}".');
    }
  }
}

Asset _findAsset(Project project, String assetId) {
  for (final a in project.assets) {
    if (a.id == assetId) return a;
  }
  throw CutivaError(CutivaErrorCode.assetNotFound, 'Asset "$assetId" does not exist.');
}

Us _trackEndUs(Track track) {
  var end = 0;
  for (final c in track.clips) {
    final e = clipEndUs(c);
    if (e > end) end = e;
  }
  return end;
}

void _checkKind(Asset asset, Track track, String what) {
  if (asset.kind.name != track.kind.name) {
    throw CutivaError(
      CutivaErrorCode.trackKindMismatch,
      '$what of ${asset.kind.name} asset "${asset.id}" needs a ${asset.kind.name} track.',
    );
  }
}

void _checkTime(Us value, String name) {
  if (value < 0) throw CutivaError(CutivaErrorCode.invalidRange, '$name must be a non-negative integer.');
}

void _checkRange(Asset asset, Us sourceInUs, Us sourceOutUs) {
  if (sourceInUs < 0 || sourceOutUs > asset.durationUs || sourceOutUs - sourceInUs < _minClipUs) {
    throw CutivaError(
      CutivaErrorCode.invalidRange,
      'Range $sourceInUs..$sourceOutUs is outside asset "${asset.id}" (0..${asset.durationUs}) or too short.',
    );
  }
}

/// Repack a track's clips back to back, starting at 0, in their current list order.
void _pack(Track track) {
  var cursor = 0;
  for (final clip in track.clips) {
    clip.startUs = cursor;
    cursor += clipDurationUs(clip);
  }
}

/// Apply one command to a project **in place**. Callers pass a draft copy;
/// if this throws, the draft is discarded and the real state is untouched.
R applyCommand<R extends CommandResult>(Project project, Command<R> cmd, IdFactory ids) {
  final CommandResult result = switch (cmd as Command) {
    final AssetAdd c => _assetAdd(project, c),
    final TrackAdd c => _trackAdd(project, c, ids),
    final TrackSetMuted c => _trackSetMuted(project, c),
    final ClipAdd c => _clipAdd(project, c, ids),
    final ClipRemove c => _clipRemove(project, c),
    final ClipSplit c => _clipSplit(project, c, ids),
    final ClipTrim c => _clipTrim(project, c),
    final ClipMove c => _clipMove(project, c),
    final ClipReorder c => _clipReorder(project, c),
    final ClipSetVolume c => _clipSetVolume(project, c),
    final ClipSetSpeed c => _clipSetSpeed(project, c),
    final ClipSetFade c => _clipSetFade(project, c),
  };
  return result as R;
}

AssetAddResult _assetAdd(Project project, AssetAdd cmd) {
  if (!project.assets.any((a) => a.id == cmd.asset.id)) project.assets.add(cmd.asset.copy());
  return AssetAddResult(cmd.asset.id);
}

TrackAddResult _trackAdd(Project project, TrackAdd cmd, IdFactory ids) {
  final trackId = cmd.trackId ?? ids('trk');
  project.tracks.add(Track(id: trackId, kind: cmd.kind));
  return TrackAddResult(trackId);
}

CommandResult _trackSetMuted(Project project, TrackSetMuted cmd) {
  findTrack(project, cmd.trackId).muted = cmd.muted;
  return CommandResult(cmd.type);
}

ClipAddResult _clipAdd(Project project, ClipAdd cmd, IdFactory ids) {
  final asset = _findAsset(project, cmd.assetId);
  final Track track;
  if (cmd.trackId == null) {
    final kind = TrackKind.values.byName(asset.kind.name);
    final existing = project.tracks.where((t) => t.kind == kind).firstOrNull;
    if (existing != null) {
      track = existing;
    } else {
      track = Track(id: ids('trk'), kind: kind);
      project.tracks.add(track);
    }
  } else {
    track = findTrack(project, cmd.trackId!);
  }
  _checkKind(asset, track, 'A clip');
  final sourceInUs = cmd.sourceInUs ?? 0;
  final sourceOutUs = cmd.sourceOutUs ?? asset.durationUs;
  _checkRange(asset, sourceInUs, sourceOutUs);
  final clip = Clip(
    id: cmd.clipId ?? ids('clip'),
    assetId: asset.id,
    startUs: cmd.startUs ?? _trackEndUs(track),
    sourceInUs: sourceInUs,
    sourceOutUs: sourceOutUs,
  );
  _checkTime(clip.startUs, 'startUs');
  track.clips.add(clip);
  _assertNoOverlap(track);
  sortClips(track.clips);
  return ClipAddResult(clipId: clip.id, trackId: track.id);
}

CommandResult _clipRemove(Project project, ClipRemove cmd) {
  final (:track, :clip, :index) = findClip(project, cmd.clipId);
  track.clips.removeAt(index);
  if (cmd.ripple) {
    final gap = clipDurationUs(clip);
    final end = clipEndUs(clip);
    for (final c in track.clips) {
      if (c.startUs >= end) c.startUs -= gap;
    }
  }
  return CommandResult(cmd.type);
}

ClipSplitResult _clipSplit(Project project, ClipSplit cmd, IdFactory ids) {
  final (:track, :clip, :index) = findClip(project, cmd.clipId);
  _checkTime(cmd.atUs, 'atUs');
  final offsetUs = cmd.atUs - clip.startUs;
  if (offsetUs < _minClipUs || cmd.atUs > clipEndUs(clip) - _minClipUs) {
    throw CutivaError(CutivaErrorCode.invalidRange, 'Split point ${cmd.atUs} is not inside clip "${clip.id}".');
  }
  final cutSourceUs = clip.sourceInUs + roundHalfUp(offsetUs * clip.speed);
  final right =
      clip.copy()
        ..id = ids('clip')
        ..startUs = cmd.atUs
        ..sourceInUs = cutSourceUs;
  clip.sourceOutUs = cutSourceUs;
  track.clips.insert(index + 1, right);
  return ClipSplitResult(leftId: clip.id, rightId: right.id);
}

CommandResult _clipTrim(Project project, ClipTrim cmd) {
  final (:track, :clip, index: _) = findClip(project, cmd.clipId);
  final asset = _findAsset(project, clip.assetId);
  final newIn = cmd.sourceInUs ?? clip.sourceInUs;
  final newOut = cmd.sourceOutUs ?? clip.sourceOutUs;
  _checkRange(asset, newIn, newOut);
  // Trimming the head keeps the clip's right edge in place.
  clip.startUs += roundHalfUp((newIn - clip.sourceInUs) / clip.speed);
  if (clip.startUs < 0) throw CutivaError(CutivaErrorCode.invalidRange, 'Trim would move the clip before 0.');
  clip.sourceInUs = newIn;
  clip.sourceOutUs = newOut;
  _assertNoOverlap(track);
  return CommandResult(cmd.type);
}

CommandResult _clipMove(Project project, ClipMove cmd) {
  final (:track, :clip, :index) = findClip(project, cmd.clipId);
  _checkTime(cmd.startUs, 'startUs');
  var target = track;
  if (cmd.trackId != null && cmd.trackId != track.id) {
    target = findTrack(project, cmd.trackId!);
    _checkKind(_findAsset(project, clip.assetId), target, 'Clip "${clip.id}"');
    track.clips.removeAt(index);
    target.clips.add(clip);
  }
  clip.startUs = cmd.startUs;
  _assertNoOverlap(target);
  sortClips(target.clips);
  return CommandResult(cmd.type);
}

CommandResult _clipReorder(Project project, ClipReorder cmd) {
  // Magnetic reorder: move the clip to `index` and pack the track with no gaps.
  final (:track, :clip, :index) = findClip(project, cmd.clipId);
  final to = cmd.index.clamp(0, track.clips.length - 1);
  track.clips.removeAt(index);
  track.clips.insert(to, clip);
  _pack(track);
  return CommandResult(cmd.type);
}

CommandResult _clipSetVolume(Project project, ClipSetVolume cmd) {
  if (!(cmd.volume >= 0 && cmd.volume <= 4)) {
    throw const CutivaError(CutivaErrorCode.invalidRange, 'volume must be between 0 and 4.');
  }
  findClip(project, cmd.clipId).clip.volume = cmd.volume;
  return CommandResult(cmd.type);
}

CommandResult _clipSetSpeed(Project project, ClipSetSpeed cmd) {
  if (!(cmd.speed >= 0.1 && cmd.speed <= 16)) {
    throw const CutivaError(CutivaErrorCode.invalidRange, 'speed must be between 0.1 and 16.');
  }
  final (:track, :clip, index: _) = findClip(project, cmd.clipId);
  clip.speed = cmd.speed;
  _assertNoOverlap(track);
  return CommandResult(cmd.type);
}

CommandResult _clipSetFade(Project project, ClipSetFade cmd) {
  final clip = findClip(project, cmd.clipId).clip;
  _checkTime(cmd.inUs, 'inUs');
  _checkTime(cmd.outUs, 'outUs');
  if (cmd.inUs + cmd.outUs > clipDurationUs(clip)) {
    throw const CutivaError(CutivaErrorCode.invalidRange, 'Fades must be non-negative and fit inside the clip.');
  }
  clip.effects.removeWhere((e) => e.type == 'core/fade');
  if (cmd.inUs > 0 || cmd.outUs > 0) {
    clip.effects.add(Effect(type: 'core/fade', params: {'inUs': cmd.inUs, 'outUs': cmd.outUs}));
  }
  return CommandResult(cmd.type);
}
